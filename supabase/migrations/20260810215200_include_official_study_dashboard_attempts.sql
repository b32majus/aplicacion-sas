create or replace function public.get_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_profile_count integer;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  if not exists (
    select 1 from public.shared_profile_aliases profile where profile.user_id = v_user_id
  ) then
    raise exception 'El perfil no pertenece al Dashboard compartido.';
  end if;
  select count(*) into v_profile_count from public.shared_profile_aliases;
  if v_profile_count <> 3 then
    raise exception 'El Dashboard compartido requiere exactamente tres perfiles.';
  end if;

  with
  official_exams as (
    select distinct official.exam_id
    from public.official_exam_versions official
  ),
  registered_official_attempts as (
    select attempt.*
    from public.attempts attempt
    join public.official_exam_versions official
      on official.exam_id = attempt.exam_id
     and official.exam_version_id = attempt.exam_version_id
     and official.exam_version_path = attempt.exam_version_path
    where (
      attempt.kind = 'exam'
      and attempt.strategy = 'exam'
      and official.question_ids = attempt.question_ids
      and official.duration_minutes = attempt.duration_minutes
    ) or (
      attempt.kind = 'normal'
      and attempt.strategy in ('normal', 'random')
      and official.question_ids @> attempt.question_ids
      and attempt.question_ids @> official.question_ids
    ) or (
      attempt.kind = 'failed'
      and attempt.strategy = 'failed'
      and attempt.failed_scope_exam_id = official.exam_id
      and exists (
        select 1 from public.attempt_question_sources source
        where source.attempt_id = attempt.id
      )
      and not exists (
        select 1
        from public.attempt_question_sources source
        where source.attempt_id = attempt.id
          and (
            source.exam_id <> official.exam_id
            or source.exam_version_id <> official.exam_version_id
            or source.exam_version_path <> official.exam_version_path
            or not (source.question_id = any(official.question_ids))
          )
      )
    )
  ),
  official_attempts as (
    select attempt.*
    from registered_official_attempts attempt
    where attempt.kind = 'exam' and attempt.strategy = 'exam'
  ),
  completed_official_attempts as (
    select * from official_attempts
    where status = 'completed' and score is not null and exam_elapsed_ms is not null
  ),
  graded_answers as (
    select answer.user_id, answer.is_correct
    from public.attempt_answers answer
    where answer.is_correct is not null and answer.selected_option is not null
  ),
  profile_metrics as (
    select
      profile.alias,
      profile.user_id,
      coalesce(answer.total, 0) as answer_count,
      case when coalesce(answer.total, 0) = 0 then 0
        else round((100.0 * answer.correct / answer.total)::numeric, 1) end as accuracy,
      coalesce(study.active_seconds, 0) as study_active_seconds,
      exam.average_score,
      exam.best_score,
      coalesce(progress.dominated_count, 0) as dominated_count
    from public.shared_profile_aliases profile
    left join lateral (
      select count(*) as total, count(*) filter (where graded.is_correct) as correct
      from graded_answers graded where graded.user_id = profile.user_id
    ) answer on true
    left join lateral (
      select coalesce(sum(attempt.active_seconds), 0) as active_seconds
      from public.attempts attempt
      where attempt.user_id = profile.user_id and attempt.kind in ('normal', 'failed')
    ) study on true
    left join lateral (
      select round(avg(attempt.score), 2) as average_score, max(attempt.score) as best_score
      from completed_official_attempts attempt where attempt.user_id = profile.user_id
    ) exam on true
    left join lateral (
      select count(*) as dominated_count
      from public.question_progress progress
      where progress.user_id = profile.user_id and progress.mastered
    ) progress on true
  ),
  best_rank_attempts as (
    select distinct on (attempt.exam_id, attempt.user_id)
      attempt.exam_id,
      attempt.user_id,
      attempt.score,
      attempt.exam_elapsed_ms
    from completed_official_attempts attempt
    order by attempt.exam_id, attempt.user_id, attempt.score desc,
      attempt.exam_elapsed_ms asc, attempt.completed_at asc
  ),
  ranked_attempts as (
    select
      best.exam_id,
      profile.alias,
      best.score,
      best.exam_elapsed_ms,
      rank() over (
        partition by best.exam_id order by best.score desc, best.exam_elapsed_ms asc
      )::integer as rank
    from best_rank_attempts best
    join public.shared_profile_aliases profile on profile.user_id = best.user_id
  ),
  own_exam_metrics as (
    select
      exam.exam_id,
      coalesce(activity.attempt_count, 0) as attempt_count,
      score.best_score,
      score.average_score,
      score.best_time_ms,
      case when coalesce(progress.correct + progress.wrong, 0) = 0 then 0
        else round((100.0 * progress.correct / (progress.correct + progress.wrong))::numeric, 1) end as accuracy,
      coalesce(progress.pending_failures, 0) as pending_failures,
      coalesce(progress.dominated_count, 0) as dominated_count,
      latest.created_at as latest_attempt_at,
      latest.status as latest_attempt_status,
      latest.score as latest_attempt_score
    from official_exams exam
    left join lateral (
      select count(*) as attempt_count
      from registered_official_attempts own
      where own.user_id = v_user_id and own.exam_id = exam.exam_id
    ) activity on true
    left join lateral (
      select
        max(own.score) as best_score,
        round(avg(own.score), 2) as average_score,
        min(own.exam_elapsed_ms) as best_time_ms
      from completed_official_attempts own
      where own.user_id = v_user_id and own.exam_id = exam.exam_id
    ) score on true
    left join lateral (
      select
        coalesce(sum(own.correct_count), 0) as correct,
        coalesce(sum(own.wrong_count), 0) as wrong,
        count(*) filter (where own.pending_failure) as pending_failures,
        count(*) filter (where own.mastered) as dominated_count
      from public.question_progress own
      where own.user_id = v_user_id and own.exam_id = exam.exam_id
    ) progress on true
    left join lateral (
      select own.created_at, own.status, own.score
      from registered_official_attempts own
      where own.user_id = v_user_id and own.exam_id = exam.exam_id
      order by own.created_at desc, own.id desc
      limit 1
    ) latest on true
  )
  select jsonb_build_object(
    'personal', jsonb_build_object(
      'global', (
        select to_jsonb(metric) - 'user_id' - 'alias'
        from profile_metrics metric where metric.user_id = v_user_id
      ),
      'official_exams', coalesce((
        select jsonb_agg(to_jsonb(metric) order by metric.exam_id) from own_exam_metrics metric
      ), '[]'::jsonb),
      'questions', coalesce((
        select jsonb_agg(jsonb_build_object(
          'exam_id', progress.exam_id,
          'question_id', progress.question_id,
          'attempts', progress.correct_count + progress.wrong_count,
          'correct', progress.correct_count,
          'wrong', progress.wrong_count,
          'accuracy', case when progress.correct_count + progress.wrong_count = 0 then 0
            else round((100.0 * progress.correct_count / (progress.correct_count + progress.wrong_count))::numeric, 1) end,
          'mastery', case when progress.mastered then 'mastered'
            when progress.pending_failure then 'pending' else 'never_failed' end
        ) order by progress.exam_id, progress.question_id)
        from public.question_progress progress where progress.user_id = v_user_id
      ), '[]'::jsonb)
    ),
    'shared', jsonb_build_object(
      'profiles', coalesce((
        select jsonb_agg(to_jsonb(metric) - 'user_id' order by metric.alias)
        from profile_metrics metric
      ), '[]'::jsonb),
      'official_exam_rankings', coalesce((
        select jsonb_agg(to_jsonb(ranking) order by ranking.exam_id, ranking.rank, ranking.alias)
        from ranked_attempts ranking
      ), '[]'::jsonb),
      'failed_by_all', coalesce((
        select jsonb_agg(jsonb_build_object(
          'exam_id', common.exam_id,
          'question_id', common.question_id,
          'failed_profile_count', 3
        ) order by common.exam_id, common.question_id)
        from (
          select progress.exam_id, progress.question_id
          from public.question_progress progress
          join public.shared_profile_aliases profile on profile.user_id = progress.user_id
          where progress.wrong_count > 0
          group by progress.exam_id, progress.question_id
          having count(distinct profile.user_id) = 3
        ) common
      ), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_dashboard() from public, anon, authenticated;
grant execute on function public.get_dashboard() to authenticated;
