create function public.reject_study_interaction_during_active_exam(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.attempts exam
    where exam.user_id = p_user_id
      and exam.kind = 'exam'
      and exam.status = 'active'
      and exam.deadline_at > clock_timestamp()
  ) then
    raise exception 'No se admite actividad de estudio mientras existe un Modo examen activo.';
  end if;
end;
$$;

revoke all on function public.reject_study_interaction_during_active_exam(uuid)
  from public, anon, authenticated;

create or replace function public.start_or_replace_principal_attempt(
  p_exam_id text,
  p_exam_version_id text,
  p_exam_version_path text,
  p_question_ids text[],
  p_strategy text,
  p_replace_active boolean default false
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
  v_official public.official_exam_versions;
  v_has_attempt boolean;
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  if p_strategy is null or p_strategy not in ('normal', 'random') then
    raise exception 'La estrategia principal no es válida.';
  end if;

  insert into public.profiles(id) values (v_user_id) on conflict (id) do nothing;
  perform 1 from public.profiles where id = v_user_id for update;

  select * into v_attempt
  from public.attempts
  where user_id = v_user_id and exam_id = p_exam_id and status = 'active'
    and kind = 'normal' and principal
  for update;
  v_has_attempt := found;

  perform public.reject_study_interaction_during_active_exam(v_user_id);

  if v_has_attempt and v_attempt.strategy = p_strategy then return v_attempt; end if;
  if v_has_attempt and not p_replace_active then
    raise exception 'Ya existe un recorrido principal activo con otra estrategia.';
  end if;

  select * into v_official
  from public.official_exam_versions official
  where official.exam_id = p_exam_id
    and official.exam_version_id = p_exam_version_id
    and official.exam_version_path = p_exam_version_path
    and official.is_published;
  if not found then
    raise exception 'El paquete no coincide con una versión oficial actualmente publicada.';
  end if;

  if p_strategy = 'normal' and p_question_ids is distinct from v_official.question_ids then
    raise exception 'El Orden normal debe conservar el Conjunto puntuable oficial completo.';
  end if;
  if p_strategy = 'random' and (
    cardinality(p_question_ids) is distinct from cardinality(v_official.question_ids)
    or coalesce((
      select count(distinct question_id)
      from unnest(p_question_ids) questions(question_id)
    ), 0) <> cardinality(v_official.question_ids)
    or not (p_question_ids <@ v_official.question_ids)
    or not (p_question_ids @> v_official.question_ids)
  ) then
    raise exception 'El Orden aleatorio debe ser una permutación completa del Conjunto puntuable oficial.';
  end if;

  if v_has_attempt then
    update public.attempts
    set status = 'abandoned', abandoned_at = now(), is_paused = false, updated_at = now()
    where id = v_attempt.id;
  end if;

  insert into public.attempts(
    user_id, exam_id, exam_version_id, exam_version_path, question_ids, strategy
  ) values (
    v_user_id, v_official.exam_id, v_official.exam_version_id,
    v_official.exam_version_path, p_question_ids, p_strategy
  ) returning * into v_attempt;

  return v_attempt;
end;
$$;

create or replace function public.start_or_resume_exam_attempt(
  p_exam_id text,
  p_exam_version_id text,
  p_exam_version_path text,
  p_question_ids text[],
  p_duration_minutes integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
  v_official public.official_exam_versions;
  v_now timestamptz := clock_timestamp();
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;

  insert into public.profiles(id) values (v_user_id) on conflict (id) do nothing;
  perform 1 from public.profiles where id = v_user_id for update;

  select * into v_attempt
  from public.attempts
  where user_id = v_user_id and status = 'active' and kind = 'exam'
  for update;
  if found then
    return to_jsonb(v_attempt) || jsonb_build_object('server_now', v_now);
  end if;

  select * into v_official
  from public.official_exam_versions official
  where official.exam_id = p_exam_id
    and official.exam_version_id = p_exam_version_id
    and official.exam_version_path = p_exam_version_path
    and official.question_ids = p_question_ids
    and official.duration_minutes = p_duration_minutes
    and official.is_published;
  if not found then
    raise exception 'El paquete no coincide con una versión oficial actualmente publicada.';
  end if;

  insert into public.attempts(
    user_id, exam_id, exam_version_id, exam_version_path, question_ids,
    kind, principal, strategy, duration_minutes, started_at, deadline_at
  ) values (
    v_user_id, v_official.exam_id, v_official.exam_version_id,
    v_official.exam_version_path, v_official.question_ids,
    'exam', false, 'exam', v_official.duration_minutes, v_now,
    v_now + make_interval(mins => v_official.duration_minutes)
  ) returning * into v_attempt;

  return to_jsonb(v_attempt) || jsonb_build_object('server_now', v_now);
end;
$$;

create or replace function public.start_or_resume_failed_attempt(
  p_scope_exam_id text,
  p_sources jsonb
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
  v_source_count integer;
  v_question_ids text[];
  v_first_source jsonb;
  v_has_attempt boolean;
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  if p_scope_exam_id is not null and length(p_scope_exam_id) not between 1 and 200 then
    raise exception 'El ámbito de falladas no es válido.';
  end if;

  insert into public.profiles(id) values (v_user_id) on conflict (id) do nothing;
  perform 1 from public.profiles where id = v_user_id for update;

  select * into v_attempt
  from public.attempts
  where user_id = v_user_id and status = 'active' and kind = 'failed'
  for update;
  v_has_attempt := found;

  perform public.reject_study_interaction_during_active_exam(v_user_id);

  if v_has_attempt then return v_attempt; end if;
  if jsonb_typeof(p_sources) <> 'array' then
    raise exception 'La cola de Falladas pendientes no es válida.';
  end if;
  select count(*) into v_source_count from jsonb_array_elements(p_sources);
  if v_source_count = 0 or v_source_count > 1000 then
    raise exception 'No hay Falladas pendientes elegibles para este ámbito.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sources) source(value)
    where nullif(source.value->>'exam_id', '') is null
       or nullif(source.value->>'exam_version_id', '') is null
       or nullif(source.value->>'exam_version_path', '') is null
       or nullif(source.value->>'question_id', '') is null
       or length(source.value->>'exam_id') > 200
       or length(source.value->>'exam_version_id') > 200
       or length(source.value->>'exam_version_path') > 500
       or length(source.value->>'question_id') > 300
       or (p_scope_exam_id is not null and source.value->>'exam_id' <> p_scope_exam_id)
       or not exists (
         select 1
         from public.official_exam_versions official
         where official.exam_id = source.value->>'exam_id'
           and official.exam_version_id = source.value->>'exam_version_id'
           and official.exam_version_path = source.value->>'exam_version_path'
           and official.is_published
           and source.value->>'question_id' = any(official.question_ids)
       )
  ) then
    raise exception 'La cola solo puede usar identidades estables actualmente publicadas.';
  end if;

  if (
    select count(*)
    from (
      select source.value->>'exam_id', source.value->>'question_id'
      from jsonb_array_elements(p_sources) source(value)
      group by source.value->>'exam_id', source.value->>'question_id'
    ) identities
  ) <> v_source_count or (
    select count(distinct source.value->>'question_id')
    from jsonb_array_elements(p_sources) source(value)
  ) <> v_source_count then
    raise exception 'Cada pregunta puede aparecer una sola vez en la Sesión de falladas.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sources) source(value)
    where not exists (
      select 1
      from public.question_progress progress
      where progress.user_id = v_user_id
        and progress.exam_id = source.value->>'exam_id'
        and progress.question_id = source.value->>'question_id'
        and progress.pending_failure
    )
  ) then
    raise exception 'La cola contiene preguntas que ya no están pendientes.';
  end if;

  select array_agg(source.value->>'question_id' order by source.ordinality),
         (array_agg(source.value order by source.ordinality))[1]
  into v_question_ids, v_first_source
  from jsonb_array_elements(p_sources) with ordinality source(value, ordinality);

  insert into public.attempts(
    user_id, exam_id, exam_version_id, exam_version_path, question_ids,
    kind, principal, strategy, failed_scope_exam_id
  ) values (
    v_user_id,
    coalesce(p_scope_exam_id, '__all_failed__'),
    case when p_scope_exam_id is null then 'mixed' else v_first_source->>'exam_version_id' end,
    case when p_scope_exam_id is null then 'mixed.json' else v_first_source->>'exam_version_path' end,
    v_question_ids,
    'failed', false, 'failed', p_scope_exam_id
  ) returning * into v_attempt;

  insert into public.attempt_question_sources(
    attempt_id, user_id, position, exam_id, exam_version_id,
    exam_version_path, question_id, source_question_id
  )
  select v_attempt.id, v_user_id, source.ordinality - 1,
         source.value->>'exam_id', source.value->>'exam_version_id',
         source.value->>'exam_version_path', source.value->>'question_id',
         source.value->>'question_id'
  from jsonb_array_elements(p_sources) with ordinality source(value, ordinality);

  return v_attempt;
end;
$$;

create or replace function public.save_normal_attempt(
  p_save_id uuid,
  p_attempt_id uuid,
  p_position integer,
  p_active_seconds integer,
  p_is_paused boolean
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
  v_existing public.attempt_save_operations;
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  if p_save_id is null then raise exception 'La identidad del guardado es obligatoria.'; end if;
  if p_active_seconds is null or p_active_seconds < 0 or p_active_seconds > 300 then
    raise exception 'El incremento de tiempo no es válido.';
  end if;

  select * into v_attempt
  from public.attempts
  where id = p_attempt_id and user_id = v_user_id
  for update;
  if not found then raise exception 'No existe un intento propio.'; end if;

  select * into v_existing
  from public.attempt_save_operations
  where id = p_save_id;
  if found then
    if row(
      v_existing.attempt_id, v_existing.user_id, v_existing.position,
      v_existing.active_seconds, v_existing.is_paused
    ) is distinct from row(
      p_attempt_id, v_user_id, p_position, p_active_seconds, p_is_paused
    ) then
      raise exception 'La clave idempotente ya pertenece a otro guardado.';
    end if;
    return v_attempt;
  end if;

  if v_attempt.status <> 'active'
     or v_attempt.kind = 'exam'
     or p_position is null
     or p_position < 0
     or p_position >= cardinality(v_attempt.question_ids) then
    raise exception 'No existe un intento de estudio activo propio en esa posición.';
  end if;

  perform public.reject_study_interaction_during_active_exam(v_user_id);

  insert into public.attempt_save_operations(
    id, attempt_id, user_id, position, active_seconds, is_paused
  ) values (
    p_save_id, p_attempt_id, v_user_id, p_position, p_active_seconds, p_is_paused
  );

  update public.attempts
  set current_position = p_position,
      active_seconds = active_seconds + p_active_seconds,
      is_paused = p_is_paused,
      updated_at = now()
  where id = p_attempt_id
  returning * into v_attempt;

  return v_attempt;
end;
$$;
