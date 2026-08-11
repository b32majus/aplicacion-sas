alter table public.official_exam_versions
  add column is_published boolean not null default true;

create unique index official_exam_versions_one_published
  on public.official_exam_versions(exam_id)
  where is_published;

alter table public.attempts
  add column origin text not null default 'official';

alter table public.attempts
  drop constraint attempts_kind_check,
  drop constraint attempts_strategy_check,
  drop constraint attempts_kind_shape_check,
  add constraint attempts_origin_check check (origin in ('official', 'artificial')),
  add constraint attempts_kind_check check (kind in ('normal', 'failed', 'exam')),
  add constraint attempts_strategy_check check (
    strategy in ('normal', 'random', 'failed', 'exam', 'artificial_study', 'artificial_exam')
  ),
  add constraint attempts_kind_shape_check check (
    (origin = 'official' and kind = 'normal' and principal
      and strategy in ('normal', 'random') and failed_scope_exam_id is null
      and duration_minutes is null and started_at is null and deadline_at is null)
    or
    (origin = 'official' and kind = 'failed' and not principal and strategy = 'failed'
      and duration_minutes is null and started_at is null and deadline_at is null)
    or
    (origin = 'official' and kind = 'exam' and not principal and strategy = 'exam'
      and failed_scope_exam_id is null and duration_minutes between 1 and 1440
      and started_at is not null and deadline_at = started_at + make_interval(mins => duration_minutes))
    or
    (origin = 'artificial' and kind = 'normal' and not principal
      and strategy = 'artificial_study' and failed_scope_exam_id is null
      and duration_minutes is null and started_at is null and deadline_at is null)
    or
    (origin = 'artificial' and kind = 'exam' and not principal
      and strategy = 'artificial_exam' and failed_scope_exam_id is null
      and duration_minutes = 120 and started_at is not null
      and deadline_at = started_at + interval '120 minutes')
  );

create unique index attempts_one_active_artificial_study
  on public.attempts(user_id)
  where status = 'active' and origin = 'artificial' and kind = 'normal';

create or replace function public.reject_attempt_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    old.user_id, old.exam_id, old.exam_version_id, old.exam_version_path,
    old.question_ids, old.kind, old.principal, old.strategy, old.failed_scope_exam_id,
    old.duration_minutes, old.started_at, old.deadline_at, old.origin
  ) is distinct from row(
    new.user_id, new.exam_id, new.exam_version_id, new.exam_version_path,
    new.question_ids, new.kind, new.principal, new.strategy, new.failed_scope_exam_id,
    new.duration_minutes, new.started_at, new.deadline_at, new.origin
  ) then
    raise exception 'La identidad fijada del intento no se puede modificar.';
  end if;
  return new;
end;
$$;

create function public.start_or_resume_artificial_attempt(
  p_mode text,
  p_sources jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
  v_count integer;
  v_question_ids text[];
  v_attempt_id uuid := gen_random_uuid();
  v_now timestamptz := clock_timestamp();
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  if p_mode not in ('study', 'exam') then
    raise exception 'El modo del Examen artificial no es válido.';
  end if;

  insert into public.profiles(id) values (v_user_id) on conflict (id) do nothing;
  perform 1 from public.profiles where id = v_user_id for update;

  if p_mode = 'exam' then
    select * into v_attempt from public.attempts
    where user_id = v_user_id and status = 'active' and kind = 'exam'
    for update;
    if found then
      if v_attempt.origin <> 'artificial' then
        raise exception 'Ya existe un Modo examen oficial activo.';
      end if;
      return to_jsonb(v_attempt) || jsonb_build_object('server_now', v_now);
    end if;
  else
    if exists (
      select 1 from public.attempts
      where user_id = v_user_id and status = 'active' and kind = 'exam'
        and deadline_at > v_now
    ) then
      raise exception 'No se puede iniciar estudio mientras existe un Modo examen activo.';
    end if;
    select * into v_attempt from public.attempts
    where user_id = v_user_id and status = 'active'
      and origin = 'artificial' and kind = 'normal'
    for update;
    if found then return to_jsonb(v_attempt); end if;
  end if;

  if jsonb_typeof(p_sources) <> 'array' then
    raise exception 'La selección del Examen artificial no es válida.';
  end if;
  select count(*) into v_count from jsonb_array_elements(p_sources);
  if v_count <> 75 then
    raise exception 'El Examen artificial debe contener exactamente 75 Preguntas activas distintas.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_sources) source(value)
    where nullif(source.value->>'exam_id', '') is null
       or nullif(source.value->>'exam_version_id', '') is null
       or nullif(source.value->>'exam_version_path', '') is null
       or source.value->>'exam_version_path' like '/%'
       or source.value->>'exam_version_path' like '%..%'
       or source.value->>'exam_version_path' not like '%.json'
       or nullif(source.value->>'question_id', '') is null
       or not exists (
         select 1 from public.official_exam_versions official
         where official.is_published
           and official.exam_id = source.value->>'exam_id'
           and official.exam_version_id = source.value->>'exam_version_id'
           and official.exam_version_path = source.value->>'exam_version_path'
           and source.value->>'question_id' = any(official.question_ids)
       )
  ) then
    raise exception 'La selección solo puede contener Preguntas activas de paquetes actualmente publicados.';
  end if;
  if (
    select count(*) from (
      select source.value->>'exam_id', source.value->>'question_id'
      from jsonb_array_elements(p_sources) source(value)
      group by source.value->>'exam_id', source.value->>'question_id'
    ) distinct_records
  ) <> 75 or (
    select count(distinct source.value->>'question_id')
    from jsonb_array_elements(p_sources) source(value)
  ) <> 75 then
    raise exception 'El Examen artificial no puede repetir una referencia de Pregunta.';
  end if;

  select array_agg(source.value->>'question_id' order by source.ordinality)
  into v_question_ids
  from jsonb_array_elements(p_sources) with ordinality source(value, ordinality);

  insert into public.attempts(
    id, user_id, exam_id, exam_version_id, exam_version_path, question_ids,
    kind, principal, strategy, duration_minutes, started_at, deadline_at, origin
  ) values (
    v_attempt_id, v_user_id, '__artificial__', v_attempt_id::text,
    'artificial/' || v_attempt_id::text || '.json', v_question_ids,
    case when p_mode = 'exam' then 'exam' else 'normal' end,
    false,
    case when p_mode = 'exam' then 'artificial_exam' else 'artificial_study' end,
    case when p_mode = 'exam' then 120 else null end,
    case when p_mode = 'exam' then v_now else null end,
    case when p_mode = 'exam' then v_now + interval '120 minutes' else null end,
    'artificial'
  ) returning * into v_attempt;

  insert into public.attempt_question_sources(
    attempt_id, user_id, position, exam_id, exam_version_id, exam_version_path, question_id
  )
  select v_attempt.id, v_user_id, source.ordinality - 1,
         source.value->>'exam_id', source.value->>'exam_version_id',
         source.value->>'exam_version_path', source.value->>'question_id'
  from jsonb_array_elements(p_sources) with ordinality source(value, ordinality);

  return to_jsonb(v_attempt) || case when p_mode = 'exam'
    then jsonb_build_object('server_now', v_now) else '{}'::jsonb end;
end;
$$;

create function public.apply_artificial_question_progress(
  p_user_id uuid,
  p_exam_id text,
  p_question_id text,
  p_is_correct boolean
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_progress public.question_progress;
  v_newly_pending boolean := false;
  v_newly_mastered boolean := false;
begin
  select * into v_progress from public.question_progress
  where user_id = p_user_id and exam_id = p_exam_id and question_id = p_question_id
  for update;
  if not found then
    insert into public.question_progress(user_id, exam_id, question_id)
    values (p_user_id, p_exam_id, p_question_id)
    returning * into v_progress;
  end if;

  if p_is_correct then
    v_newly_mastered := v_progress.pending_failure and v_progress.current_streak + 1 >= 2;
    update public.question_progress
    set correct_count = correct_count + 1,
        current_streak = current_streak + 1,
        mastered = mastered or (pending_failure and current_streak + 1 >= 2),
        pending_failure = pending_failure and current_streak + 1 < 2,
        updated_at = now()
    where id = v_progress.id;
  else
    v_newly_pending := not v_progress.pending_failure;
    update public.question_progress
    set wrong_count = wrong_count + 1, current_streak = 0,
        mastered = false, pending_failure = true, updated_at = now()
    where id = v_progress.id;
  end if;
  return jsonb_build_object(
    'newly_pending_failure', v_newly_pending,
    'newly_mastered', v_newly_mastered
  );
end;
$$;

create function public.confirm_artificial_study_answer(
  p_confirmation_id uuid,
  p_attempt_id uuid,
  p_question_id text,
  p_selected_option text,
  p_correct_option text
)
returns public.attempt_answers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
  v_source public.attempt_question_sources;
  v_existing public.attempt_answers;
  v_answer public.attempt_answers;
  v_progress_result jsonb;
  v_official_option text;
  v_is_correct boolean;
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  select * into v_existing from public.attempt_answers where id = p_confirmation_id;
  if found then
    if v_existing.attempt_id <> p_attempt_id or v_existing.user_id <> v_user_id
       or v_existing.question_id <> p_question_id
       or v_existing.selected_option <> p_selected_option
       or v_existing.correct_option <> p_correct_option then
      raise exception 'La clave idempotente ya pertenece a otro resultado.';
    end if;
    return v_existing;
  end if;

  select * into v_attempt from public.attempts
  where id = p_attempt_id and user_id = v_user_id and status = 'active'
    and origin = 'artificial' and kind = 'normal'
  for update;
  if not found then raise exception 'No existe un Examen artificial de estudio activo propio.'; end if;
  select source.* into v_source
  from public.attempt_question_sources source
  where source.attempt_id = p_attempt_id and source.question_id = p_question_id;
  if not found then raise exception 'La pregunta no coincide con su origen fijado.'; end if;
  select official.answer_key ->> v_source.question_id into v_official_option
  from public.official_exam_versions official
  where official.exam_id = v_source.exam_id
    and official.exam_version_id = v_source.exam_version_id
    and official.exam_version_path = v_source.exam_version_path;
  if not found or v_official_option is distinct from p_correct_option then
    raise exception 'La pregunta no coincide con su origen fijado.';
  end if;
  if exists (
    select 1 from public.attempt_answers
    where attempt_id = p_attempt_id and question_id = p_question_id
  ) then raise exception 'La pregunta ya tiene una respuesta confirmada en este intento.'; end if;

  v_is_correct := p_selected_option = v_official_option;
  v_progress_result := public.apply_artificial_question_progress(
    v_user_id, v_source.exam_id, p_question_id, v_is_correct
  );
  insert into public.attempt_answers(
    id, attempt_id, user_id, question_id, answer_sequence,
    selected_option, correct_option, is_correct,
    newly_pending_failure, newly_mastered
  ) values (
    p_confirmation_id, p_attempt_id, v_user_id, p_question_id, 1,
    p_selected_option, v_official_option, v_is_correct,
    (v_progress_result->>'newly_pending_failure')::boolean,
    (v_progress_result->>'newly_mastered')::boolean
  ) returning * into v_answer;
  update public.attempts set updated_at = now() where id = p_attempt_id;
  return v_answer;
end;
$$;

alter function public.confirm_normal_answer(uuid, uuid, text, text, text)
  rename to confirm_official_normal_answer;
revoke all on function public.confirm_official_normal_answer(uuid, uuid, text, text, text)
  from public, anon, authenticated;

create function public.confirm_normal_answer(
  p_confirmation_id uuid,
  p_attempt_id uuid,
  p_question_id text,
  p_selected_option text,
  p_correct_option text
)
returns public.attempt_answers
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text;
begin
  select origin into v_origin from public.attempts
  where id = p_attempt_id and user_id = auth.uid();
  if v_origin = 'artificial' then
    return public.confirm_artificial_study_answer(
      p_confirmation_id, p_attempt_id, p_question_id, p_selected_option, p_correct_option
    );
  end if;
  return public.confirm_official_normal_answer(
    p_confirmation_id, p_attempt_id, p_question_id, p_selected_option, p_correct_option
  );
end;
$$;

create function public.complete_artificial_study_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts;
  v_unanswered integer;
  v_correct integer;
  v_wrong integer;
  v_new_pending integer;
  v_new_mastered integer;
begin
  select * into v_attempt from public.attempts
  where id = p_attempt_id and user_id = auth.uid()
    and origin = 'artificial' and kind = 'normal'
  for update;
  if not found then raise exception 'No existe un Examen artificial de estudio propio.'; end if;
  if v_attempt.status = 'active' then
    select count(*) into v_unanswered
    from public.attempt_question_sources source
    where source.attempt_id = v_attempt.id
      and not exists (
        select 1 from public.attempt_answers answer
        where answer.attempt_id = source.attempt_id and answer.question_id = source.question_id
      );
    if v_unanswered <> 0 then raise exception 'Aún quedan preguntas pendientes.'; end if;
    update public.attempts
    set status = 'completed', completed_at = now(), is_paused = false, updated_at = now()
    where id = v_attempt.id returning * into v_attempt;
  end if;
  select count(*) filter (where is_correct), count(*) filter (where not is_correct),
         count(*) filter (where newly_pending_failure), count(*) filter (where newly_mastered)
  into v_correct, v_wrong, v_new_pending, v_new_mastered
  from public.attempt_answers where attempt_id = v_attempt.id;
  return jsonb_build_object(
    'attempt_id', v_attempt.id, 'correct', v_correct, 'wrong', v_wrong,
    'accuracy', round((100.0 * v_correct / 75)::numeric, 1),
    'active_seconds', v_attempt.active_seconds,
    'newly_pending_failures', v_new_pending, 'newly_mastered', v_new_mastered,
    'completed_at', v_attempt.completed_at
  );
end;
$$;

alter function public.complete_normal_attempt(uuid)
  rename to complete_official_normal_attempt;
revoke all on function public.complete_official_normal_attempt(uuid)
  from public, anon, authenticated;

create function public.complete_normal_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text;
begin
  select origin into v_origin from public.attempts
  where id = p_attempt_id and user_id = auth.uid();
  if v_origin = 'artificial' then
    return public.complete_artificial_study_attempt(p_attempt_id);
  end if;
  return public.complete_official_normal_attempt(p_attempt_id);
end;
$$;

create function public.finish_artificial_exam_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
  v_source public.attempt_question_sources;
  v_selected_option text;
  v_correct_option text;
  v_is_correct boolean;
  v_progress_result jsonb;
  v_sequence integer;
  v_correct integer := 0;
  v_wrong integer := 0;
  v_blank integer := 0;
  v_score numeric(7, 2);
  v_elapsed_ms bigint;
  v_completed_at timestamptz;
begin
  select * into v_attempt from public.attempts
  where id = p_attempt_id and user_id = v_user_id
    and origin = 'artificial' and kind = 'exam'
  for update;
  if not found then raise exception 'No existe un Examen artificial cronometrado propio.'; end if;
  if v_attempt.status = 'completed' then
    return jsonb_build_object(
      'attempt_id', v_attempt.id, 'correct', v_attempt.correct_answers,
      'wrong', v_attempt.wrong_answers, 'blank', v_attempt.blank_answers,
      'score', v_attempt.score, 'elapsed_ms', v_attempt.exam_elapsed_ms,
      'new_personal_record', false, 'completed_at', v_attempt.completed_at
    );
  end if;

  for v_source in
    select source.* from public.attempt_question_sources source
    where source.attempt_id = v_attempt.id order by source.position
  loop
    select official.answer_key ->> v_source.question_id into v_correct_option
    from public.official_exam_versions official
    where official.exam_id = v_source.exam_id
      and official.exam_version_id = v_source.exam_version_id
      and official.exam_version_path = v_source.exam_version_path;
    if v_correct_option is null then raise exception 'No se puede recuperar la plantilla fijada de origen.'; end if;
    select answer.selected_option into v_selected_option
    from public.attempt_answers answer
    where answer.attempt_id = v_attempt.id and answer.question_id = v_source.question_id
      and answer.correct_option is null
    order by answer.answer_sequence desc limit 1;
    v_is_correct := v_selected_option is not null and v_selected_option = v_correct_option;
    if v_selected_option is null then v_blank := v_blank + 1;
    elsif v_is_correct then v_correct := v_correct + 1;
    else v_wrong := v_wrong + 1;
    end if;
    v_progress_result := public.apply_artificial_question_progress(
      v_user_id, v_source.exam_id, v_source.question_id, v_is_correct
    );
    select coalesce(max(answer_sequence), 0) + 1 into v_sequence
    from public.attempt_answers
    where attempt_id = v_attempt.id and question_id = v_source.question_id;
    insert into public.attempt_answers(
      id, attempt_id, user_id, question_id, answer_sequence,
      selected_option, correct_option, is_correct,
      newly_pending_failure, newly_mastered
    ) values (
      gen_random_uuid(), v_attempt.id, v_user_id, v_source.question_id, v_sequence,
      v_selected_option, v_correct_option, v_is_correct,
      (v_progress_result->>'newly_pending_failure')::boolean,
      (v_progress_result->>'newly_mastered')::boolean
    );
  end loop;

  v_score := round((100.0 / 75) * (v_correct - v_wrong / 4.0), 2);
  v_completed_at := clock_timestamp();
  v_elapsed_ms := greatest(0, floor(extract(epoch from (
    least(v_completed_at, v_attempt.deadline_at) - v_attempt.started_at
  )) * 1000))::bigint;
  update public.attempts
  set status = 'completed', completed_at = v_completed_at, updated_at = v_completed_at,
      score = v_score, correct_answers = v_correct, wrong_answers = v_wrong,
      blank_answers = v_blank, exam_elapsed_ms = v_elapsed_ms,
      new_personal_record = false, is_paused = false
  where id = v_attempt.id returning * into v_attempt;
  return jsonb_build_object(
    'attempt_id', v_attempt.id, 'correct', v_correct, 'wrong', v_wrong,
    'blank', v_blank, 'score', v_score, 'elapsed_ms', v_elapsed_ms,
    'new_personal_record', false, 'completed_at', v_attempt.completed_at
  );
end;
$$;

alter function public.finish_exam_attempt(uuid)
  rename to finish_official_exam_attempt;
revoke all on function public.finish_official_exam_attempt(uuid)
  from public, anon, authenticated;

create function public.finish_exam_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_origin text;
begin
  select origin into v_origin from public.attempts
  where id = p_attempt_id and user_id = auth.uid();
  if v_origin = 'artificial' then
    return public.finish_artificial_exam_attempt(p_attempt_id);
  end if;
  return public.finish_official_exam_attempt(p_attempt_id);
end;
$$;

create or replace view public.personal_attempt_history
with (security_invoker = true)
as
select
  attempt.id, attempt.user_id, attempt.created_at,
  coalesce(attempt.completed_at, attempt.abandoned_at) as ended_at,
  attempt.exam_id, attempt.exam_version_id, attempt.exam_version_path,
  attempt.question_ids, attempt.kind, attempt.strategy, attempt.status,
  attempt.failed_scope_exam_id, attempt.active_seconds, attempt.started_at,
  attempt.deadline_at, attempt.exam_elapsed_ms, attempt.score,
  coalesce(attempt.correct_answers, answer_metrics.correct_answers, 0) as correct_answers,
  coalesce(attempt.wrong_answers, answer_metrics.wrong_answers, 0) as wrong_answers,
  attempt.blank_answers,
  coalesce(answer_metrics.answered_questions, 0) as answered_questions,
  attempt.origin
from public.attempts attempt
left join lateral (
  select count(*) filter (where latest.is_correct) as correct_answers,
         count(*) filter (where latest.is_correct is false) as wrong_answers,
         count(*) filter (where latest.selected_option is not null) as answered_questions
  from (
    select distinct on (answer.question_id)
      answer.question_id, answer.selected_option, answer.is_correct
    from public.attempt_answers answer
    where answer.attempt_id = attempt.id
    order by answer.question_id, answer.answer_sequence desc
  ) latest
) answer_metrics on true;

revoke all on function public.start_or_resume_artificial_attempt(text, jsonb) from public, anon;
revoke all on function public.apply_artificial_question_progress(uuid, text, text, boolean) from public, anon, authenticated;
revoke all on function public.confirm_artificial_study_answer(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.complete_artificial_study_attempt(uuid) from public, anon, authenticated;
revoke all on function public.finish_artificial_exam_attempt(uuid) from public, anon, authenticated;
revoke execute on function public.confirm_normal_answer(uuid, uuid, text, text, text) from public, anon;
revoke execute on function public.complete_normal_attempt(uuid) from public, anon;
revoke execute on function public.finish_exam_attempt(uuid) from public, anon;
grant execute on function public.start_or_resume_artificial_attempt(text, jsonb) to authenticated;
grant execute on function public.confirm_normal_answer(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.complete_normal_attempt(uuid) to authenticated;
grant execute on function public.finish_exam_attempt(uuid) to authenticated;
revoke all on public.personal_attempt_history from public, anon, authenticated;
grant select on public.personal_attempt_history to authenticated;
