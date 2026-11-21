-- M04 seguimiento: incluir participantes sin fila de rol explícita.
-- El contrato de app_access_roles trata ausencia de fila como participant:
-- es el estado real de los tres participantes de SAS tras la asignación inicial.
-- La comparativa solo incluye usuarios con perfil y alias compartido, con
-- actividad persistida en la oposición seleccionada. Admin y test siguen
-- excluidos; no se escriben perfiles, roles, intentos ni respuestas.
-- Se conserva la autorización auth.uid(), la política de ocultación del grupo
-- unitario en "Falladas por todos", y la firma/privilegios RPC.
-- Forward-only; M04 original ya aplicada en producción, no modificarla.

create or replace function public.get_opposition_dashboard_v2(p_opposition_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Se requiere autenticación para consultar el Dashboard de una oposición.';
  end if;
  if p_opposition_id is null or length(p_opposition_id) not between 1 and 200 then
    raise exception 'La oposición solicitada no es válida.';
  end if;
  if not exists (
    select 1
    from public.oppositions opposition
    where opposition.id = p_opposition_id
  ) then
    raise exception 'La oposición solicitada no está registrada en el servidor.';
  end if;

  with
  opposition_exams as (
    select mapped.exam_id
    from public.opposition_exams mapped
    where mapped.opposition_id = p_opposition_id
  ),
  active_participants as (
    select
      profile.id as user_id,
      alias.alias
    from public.profiles profile
    join public.shared_profile_aliases alias
      on alias.user_id = profile.id
    left join public.app_access_roles access
      on access.user_id = profile.id
    where (access.role = 'participant' or access.user_id is null)
      and exists (
        select 1
        from public.attempts attempt
        where attempt.user_id = profile.id
          and public.opposition_of_attempt(attempt.id, attempt.user_id) = p_opposition_id
      )
  ),
  official_attempts as (
    select attempt.*
    from public.attempts attempt
    join opposition_exams exam
      on exam.exam_id = attempt.exam_id
    join public.official_exam_versions official
      on official.exam_id = attempt.exam_id
     and official.exam_version_id = attempt.exam_version_id
     and official.exam_version_path = attempt.exam_version_path
     and official.question_ids = attempt.question_ids
     and official.duration_minutes = attempt.duration_minutes
    where attempt.kind = 'exam'
      and attempt.strategy = 'exam'
      and coalesce(attempt.origin, 'official') <> 'artificial'
  ),
  completed_official_attempts as (
    select * from official_attempts
    where status = 'completed' and score is not null and exam_elapsed_ms is not null
  ),
  own_metrics as (
    select
      coalesce(answer.total, 0) as answer_count,
      case when coalesce(answer.total, 0) = 0 then 0
        else round((100.0 * answer.correct / answer.total)::numeric, 1) end as accuracy,
      coalesce(study.active_seconds, 0) as study_active_seconds,
      exam.average_score,
      exam.best_score,
      coalesce(progress.dominated_count, 0) as dominated_count
    from (select 1) own
    left join lateral (
      select count(*) as total, count(*) filter (where graded.is_correct) as correct
      from public.attempt_answers graded
      where graded.user_id = v_user_id
        and graded.is_correct is not null
        and graded.selected_option is not null
        and exists (
          select 1
          from public.attempts attempt
          where attempt.id = graded.attempt_id
            and attempt.user_id = v_user_id
            and public.opposition_of_attempt(attempt.id, attempt.user_id) = p_opposition_id
        )
    ) answer on true
    left join lateral (
      select coalesce(sum(attempt.active_seconds), 0) as active_seconds
      from public.attempts attempt
      where attempt.user_id = v_user_id
        and attempt.kind in ('normal', 'failed')
        and public.opposition_of_attempt(attempt.id, attempt.user_id) = p_opposition_id
    ) study on true
    left join lateral (
      select round(avg(attempt.score), 2) as average_score, max(attempt.score) as best_score
      from completed_official_attempts attempt
      where attempt.user_id = v_user_id
    ) exam on true
    left join lateral (
      select count(*) as dominated_count
      from public.question_progress progress
      join opposition_exams exam
        on exam.exam_id = progress.exam_id
      where progress.user_id = v_user_id and progress.mastered
    ) progress on true
  ),
  own_exam_metrics as (
    select
      exam.exam_id,
      coalesce(attempt.attempt_count, 0) as attempt_count,
      attempt.best_score,
      attempt.average_score,
      attempt.best_time_ms,
      case when coalesce(attempt.answered, 0) = 0 then 0
        else round((100.0 * attempt.correct / attempt.answered)::numeric, 1) end as accuracy,
      coalesce(progress.pending_failures, 0) as pending_failures,
      coalesce(progress.dominated_count, 0) as dominated_count,
      latest.created_at as latest_attempt_at,
      latest.status as latest_attempt_status,
      latest.score as latest_attempt_score
    from opposition_exams exam
    left join lateral (
      select
        count(*) as attempt_count,
        max(own.score) filter (where own.status = 'completed') as best_score,
        round(avg(own.score) filter (where own.status = 'completed'), 2) as average_score,
        min(own.exam_elapsed_ms) filter (where own.status = 'completed') as best_time_ms,
        coalesce(sum(own.correct_answers) filter (where own.status = 'completed'), 0) as correct,
        coalesce(sum(own.correct_answers + own.wrong_answers) filter (where own.status = 'completed'), 0) as answered
      from official_attempts own
      where own.user_id = v_user_id and own.exam_id = exam.exam_id
    ) attempt on true
    left join lateral (
      select
        count(*) filter (where own.pending_failure) as pending_failures,
        count(*) filter (where own.mastered) as dominated_count
      from public.question_progress own
      where own.user_id = v_user_id and own.exam_id = exam.exam_id
    ) progress on true
    left join lateral (
      select own.created_at, own.status, own.score
      from official_attempts own
      where own.user_id = v_user_id and own.exam_id = exam.exam_id
      order by own.created_at desc, own.id desc
      limit 1
    ) latest on true
  ),
  own_questions as (
    select
      progress.exam_id,
      progress.question_id,
      progress.correct_count + progress.wrong_count as attempts,
      progress.correct_count as correct,
      progress.wrong_count as wrong,
      case when progress.correct_count + progress.wrong_count = 0 then 0
        else round((100.0 * progress.correct_count / (progress.correct_count + progress.wrong_count))::numeric, 1) end as accuracy,
      case when progress.mastered then 'mastered'
        when progress.pending_failure then 'pending' else 'never_failed' end as mastery
    from public.question_progress progress
    join opposition_exams exam
      on exam.exam_id = progress.exam_id
    where progress.user_id = v_user_id
  ),
  participant_metrics as (
    select
      participant.user_id,
      participant.alias,
      coalesce(answer.total, 0) as answer_count,
      case when coalesce(answer.total, 0) = 0 then 0
        else round((100.0 * answer.correct / answer.total)::numeric, 1) end as accuracy,
      coalesce(study.active_seconds, 0) as study_active_seconds,
      exam.average_score,
      exam.best_score,
      coalesce(progress.dominated_count, 0) as dominated_count
    from active_participants participant
    left join lateral (
      select count(*) as total, count(*) filter (where graded.is_correct) as correct
      from public.attempt_answers graded
      where graded.user_id = participant.user_id
        and graded.is_correct is not null
        and graded.selected_option is not null
        and exists (
          select 1
          from public.attempts attempt
          where attempt.id = graded.attempt_id
            and public.opposition_of_attempt(attempt.id, attempt.user_id) = p_opposition_id
        )
    ) answer on true
    left join lateral (
      select coalesce(sum(attempt.active_seconds), 0) as active_seconds
      from public.attempts attempt
      where attempt.user_id = participant.user_id
        and attempt.kind in ('normal', 'failed')
        and public.opposition_of_attempt(attempt.id, attempt.user_id) = p_opposition_id
    ) study on true
    left join lateral (
      select round(avg(attempt.score), 2) as average_score, max(attempt.score) as best_score
      from completed_official_attempts attempt
      where attempt.user_id = participant.user_id
    ) exam on true
    left join lateral (
      select count(*) as dominated_count
      from public.question_progress progress
      join opposition_exams exam
        on exam.exam_id = progress.exam_id
      where progress.user_id = participant.user_id and progress.mastered
    ) progress on true
  ),
  best_rank_attempts as (
    select distinct on (attempt.exam_id, attempt.user_id)
      attempt.exam_id,
      attempt.user_id,
      attempt.score,
      attempt.exam_elapsed_ms
    from completed_official_attempts attempt
    where exists (
      select 1 from active_participants participant
      where participant.user_id = attempt.user_id
    )
    order by attempt.exam_id, attempt.user_id, attempt.score desc,
      attempt.exam_elapsed_ms asc, attempt.completed_at asc
  ),
  ranked_attempts as (
    select
      best.exam_id,
      participant.alias,
      best.score,
      best.exam_elapsed_ms,
      rank() over (
        partition by best.exam_id order by best.score desc, best.exam_elapsed_ms asc
      )::integer as rank
    from best_rank_attempts best
    join active_participants participant
      on participant.user_id = best.user_id
  ),
  common_failed as (
    select
      progress.exam_id,
      progress.question_id,
      count(distinct progress.user_id) as failed_profile_count
    from public.question_progress progress
    join opposition_exams exam
      on exam.exam_id = progress.exam_id
    join active_participants participant
      on participant.user_id = progress.user_id
    where progress.wrong_count > 0
    group by progress.exam_id, progress.question_id
    having count(distinct progress.user_id) >= 2
       and count(distinct progress.user_id) = (select count(*) from active_participants)
  )
  select jsonb_build_object(
    'personal', jsonb_build_object(
      'global', (
        select to_jsonb(metric) from own_metrics metric
      ),
      'official_exams', coalesce((
        select jsonb_agg(to_jsonb(metric) order by metric.exam_id) from own_exam_metrics metric
      ), '[]'::jsonb),
      'questions', coalesce((
        select jsonb_agg(to_jsonb(question) order by question.exam_id, question.question_id) from own_questions question
      ), '[]'::jsonb)
    ),
    'shared', jsonb_build_object(
      'profiles', coalesce((
        select jsonb_agg(to_jsonb(metric) - 'user_id' order by metric.alias) from participant_metrics metric
      ), '[]'::jsonb),
      'official_exam_rankings', coalesce((
        select jsonb_agg(to_jsonb(ranking) order by ranking.exam_id, ranking.rank, ranking.alias) from ranked_attempts ranking
      ), '[]'::jsonb),
      'failed_by_all', coalesce((
        select jsonb_agg(jsonb_build_object(
          'exam_id', common.exam_id,
          'question_id', common.question_id,
          'failed_profile_count', common.failed_profile_count
        ) order by common.exam_id, common.question_id)
        from common_failed common
      ), '[]'::jsonb)
    )
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_opposition_dashboard_v2(text)
  from public, anon, authenticated;
grant execute on function public.get_opposition_dashboard_v2(text)
  to authenticated;
