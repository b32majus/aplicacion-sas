alter table public.attempt_question_sources
  add column source_question_id text;

alter table public.attempt_question_sources
  disable trigger attempt_question_sources_are_immutable;

update public.attempt_question_sources
set source_question_id = question_id;

alter table public.attempt_question_sources
  enable trigger attempt_question_sources_are_immutable;

alter table public.attempt_question_sources
  alter column source_question_id set not null,
  add constraint attempt_question_sources_source_question_id_check
    check (length(source_question_id) between 1 and 300),
  add constraint attempt_question_sources_canonical_identity_key
    unique (attempt_id, exam_id, source_question_id);

create function public.default_attempt_source_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.source_question_id := coalesce(new.source_question_id, new.question_id);
  return new;
end;
$$;

create trigger attempt_question_sources_default_source_identity
before insert on public.attempt_question_sources
for each row execute function public.default_attempt_source_identity();

revoke execute on function public.default_attempt_source_identity()
  from public, anon, authenticated;

create or replace function public.start_or_resume_artificial_attempt(
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
       or nullif(source.value->>'source_question_id', '') is null
       or not exists (
         select 1 from public.official_exam_versions official
         where official.is_published
           and official.exam_id = source.value->>'exam_id'
           and official.exam_version_id = source.value->>'exam_version_id'
           and official.exam_version_path = source.value->>'exam_version_path'
           and source.value->>'source_question_id' = any(official.question_ids)
       )
  ) then
    raise exception 'La selección solo puede contener Preguntas activas de paquetes actualmente publicados.';
  end if;
  if (
    select count(*) from (
      select source.value->>'exam_id', source.value->>'source_question_id'
      from jsonb_array_elements(p_sources) source(value)
      group by source.value->>'exam_id', source.value->>'source_question_id'
    ) distinct_records
  ) <> 75 then
    raise exception 'El Examen artificial no puede repetir una referencia de Pregunta.';
  end if;

  select array_agg(
    'artificial-q' || lpad(source.ordinality::text, 3, '0')
    order by source.ordinality
  ) into v_question_ids
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
    attempt_id, user_id, position, exam_id, exam_version_id,
    exam_version_path, question_id, source_question_id
  )
  select v_attempt.id, v_user_id, source.ordinality - 1,
         source.value->>'exam_id', source.value->>'exam_version_id',
         source.value->>'exam_version_path',
         'artificial-q' || lpad(source.ordinality::text, 3, '0'),
         source.value->>'source_question_id'
  from jsonb_array_elements(p_sources) with ordinality source(value, ordinality);

  return to_jsonb(v_attempt) || case when p_mode = 'exam'
    then jsonb_build_object('server_now', v_now) else '{}'::jsonb end;
end;
$$;

create or replace function public.confirm_artificial_study_answer(
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

  perform 1 from public.attempts
  where id = p_attempt_id and user_id = v_user_id and status = 'active'
    and origin = 'artificial' and kind = 'normal'
  for update;
  if not found then raise exception 'No existe un Examen artificial de estudio activo propio.'; end if;
  select source.* into v_source
  from public.attempt_question_sources source
  where source.attempt_id = p_attempt_id and source.question_id = p_question_id;
  if not found then raise exception 'La pregunta no coincide con su origen fijado.'; end if;
  select official.answer_key ->> v_source.source_question_id into v_official_option
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
    v_user_id, v_source.exam_id, v_source.source_question_id, v_is_correct
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

create or replace function public.finish_artificial_exam_attempt(p_attempt_id uuid)
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
    select official.answer_key ->> v_source.source_question_id into v_correct_option
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
      v_user_id, v_source.exam_id, v_source.source_question_id, v_is_correct
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
