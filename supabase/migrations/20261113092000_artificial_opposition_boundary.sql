-- Frontera de oposición para el Examen artificial (unidad m03-artificial-oposicion).
--
-- Operativa:
--   1. La RPC v2 public.start_or_resume_artificial_attempt_v2(modo, oposición,
--      fuentes) verifica en servidor, ANTES de crear el intento o sus fuentes,
--      que cada fuente está mapeada en public.opposition_exams hacia LA
--      oposición solicitada (una fuente sin mapeo o de otra oposición impide
--      materializar nada: fallo cerrado), que la oposición solicitada existe en
--      public.oppositions y que cada tuplo (exam_id, exam_version_id,
--      exam_version_path, source_question_id) existe en
--      public.official_exam_versions con is_published. Exige exactamente 75
--      referencias distintas: la selección con menos de 75 referencias se
--      bloquea y las duplicadas se rechazan; nunca se completa con otro banco
--      ni se duplican preguntas. Conserva, además, las comprobaciones
--      existentes: reanudación fijada, guard de Modo examen activo para el
--      estudio y límites de forma.
--   2. La reanudación precede a TODA verificación: si el usuario ya tiene su
--      único intento artificial activo (índice único
--      attempts_one_active_artificial_study en estudio, o el único Modo examen
--      activo que no sea oficial) la RPC lo devuelve con su composición
--      persistida (fuentes, identidades de origen y versiones fijadas) aunque
--      se solicite otra oposición o la selección llegue vacía o corta; no se
--      crea ningún intento adicional y los intentos históricos no se
--      reinterpretan. La identidad de pregunta de origen (source_question_id)
--      la anotan las RPC de respuesta existentes, que no cambian aquí.
--   3. La firma antigua public.start_or_resume_artificial_attempt(modo,
--      fuentes) sigue operativa con su privilegio authenticated
--      (compatibilidad con el frontend antiguo, cuyo despliegue precede a la
--      UI), pero ya no permite materializar una mezcla: la oposición única se
--      deriva de la selección desde el mapeo administrativo y se delega en la
--      RPC v2, que aplica la frontera; sin fila de mapeo o con selección
--      mezclada falla cerrado y las selecciones homogéneas siguen funcionando.
--   4. Migración forward-only: no toca filas ni esquema de attempts,
--      attempt_question_sources, question_progress ni attempt_answers, no
--      redefine las RPC de respuesta artificial ni el resto de motores
--      (scoring, sincronización, guard, dashboard, registro oficial, locking).
--      Los 120 minutos del Modo examen artificial, el deadline absoluto y la
--      identidad sintética artificial-qNNN con su origen se conservan.

create function public.start_or_resume_artificial_attempt_v2(
  p_mode text,
  p_opposition_id text,
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
  v_has_attempt boolean := false;
  v_source_count integer;
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
    select * into v_attempt from public.attempts
    where user_id = v_user_id and status = 'active'
      and origin = 'artificial' and kind = 'normal'
    for update;
    v_has_attempt := found;
  end if;

  -- Guard de Modo examen activo para el estudio (comprobación existente) y
  -- devolución de la reanudación fijada tras él.
  if p_mode <> 'exam' then
    perform public.reject_study_interaction_during_active_exam(v_user_id);
  end if;
  if v_has_attempt then
    return to_jsonb(v_attempt);
  end if;

  -- Límites de forma de la oposición y de la selección: obligatorios antes de
  -- crear nada, pero jamás antes de la reanudación fijada.
  if p_opposition_id is null or length(p_opposition_id) not between 1 and 200 then
    raise exception 'La oposición solicitada no es válida.';
  end if;
  if jsonb_typeof(p_sources) <> 'array' then
    raise exception 'La selección del Examen artificial no es válida.';
  end if;
  select count(*) into v_source_count from jsonb_array_elements(p_sources);
  if v_source_count <> 75 then
    raise exception 'El Examen artificial debe contener exactamente 75 Preguntas activas distintas.';
  end if;

  -- La oposición solicitada debe existir en el registro administrativo.
  if not exists (
    select 1
    from public.oppositions opposition
    where opposition.id = p_opposition_id
  ) then
    raise exception 'La oposición solicitada no existe en el registro de oposiciones.';
  end if;

  -- Frontera de oposición en servidor, antes de materializar nada: cada fuente
  -- debe estar mapeada en el registro administrativo hacia LA oposición
  -- solicitada. Sin fila de mapeo o con otra oposición no se materializa nada.
  if exists (
    select 1
    from jsonb_array_elements(p_sources) source(value)
    where not exists (
      select 1
      from public.opposition_exams mapping
      where mapping.exam_id = source.value->>'exam_id'
        and mapping.opposition_id = p_opposition_id
    )
  ) then
    raise exception 'Cada fuente debe estar mapeada en el registro administrativo a la oposición solicitada: sin mapeo no se materializa el Examen artificial.';
  end if;

  -- Fuentes publicadas exactas: cada tuplo (exam_id, exam_version_id,
  -- exam_version_path, source_question_id) existe en el registro oficial con
  -- is_published; sin esa coincidencia exacta no se materializa nada.
  if exists (
    select 1
    from jsonb_array_elements(p_sources) source(value)
    where nullif(source.value->>'exam_id', '') is null
       or nullif(source.value->>'exam_version_id', '') is null
       or nullif(source.value->>'exam_version_path', '') is null
       or nullif(source.value->>'source_question_id', '') is null
       or length(source.value->>'exam_id') > 200
       or length(source.value->>'exam_version_id') > 200
       or length(source.value->>'exam_version_path') > 500
       or length(source.value->>'source_question_id') > 300
       or source.value->>'exam_version_path' like '/%'
       or source.value->>'exam_version_path' like '%..%'
       or source.value->>'exam_version_path' not like '%.json'
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

  -- Exactamente 75 referencias distintas: la selección no puede repetir una
  -- referencia de Pregunta; nunca se completa con otro banco ni se duplican
  -- preguntas.
  if (
    select count(*)
    from (
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

-- Firma antigua endurecida: mismas comprobaciones existentes y reanudación
-- fijada, pero la oposición única de la selección se deriva en servidor desde
-- el mapeo administrativo y se delega en la RPC v2, que aplica la frontera.
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
  v_has_attempt boolean := false;
  v_opposition_ids text[];
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  if p_mode not in ('study', 'exam') then
    raise exception 'El modo del Examen artificial no es válido.';
  end if;

  insert into public.profiles(id) values (v_user_id) on conflict (id) do nothing;
  perform 1 from public.profiles where id = v_user_id for update;

  -- La reanudación fijada precede a la derivación de oposición: el único
  -- intento artificial activo se devuelve con su composición persistida aunque
  -- la selección llegue vacía, corta o alterada.
  if p_mode = 'exam' then
    select * into v_attempt from public.attempts
    where user_id = v_user_id and status = 'active' and kind = 'exam'
    for update;
    if found then
      if v_attempt.origin <> 'artificial' then
        raise exception 'Ya existe un Modo examen oficial activo.';
      end if;
      return to_jsonb(v_attempt) || jsonb_build_object('server_now', clock_timestamp());
    end if;
  else
    select * into v_attempt from public.attempts
    where user_id = v_user_id and status = 'active'
      and origin = 'artificial' and kind = 'normal'
    for update;
    v_has_attempt := found;
  end if;

  perform public.reject_study_interaction_during_active_exam(v_user_id);

  if v_has_attempt then
    return to_jsonb(v_attempt);
  end if;

  if jsonb_typeof(p_sources) <> 'array' then
    raise exception 'La selección del Examen artificial no es válida.';
  end if;

  -- Sin fila de mapeo explícita no se materializa nada (fallo cerrado).
  if exists (
    select 1
    from jsonb_array_elements(p_sources) source(value)
    where not exists (
      select 1
      from public.opposition_exams mapped
      where mapped.exam_id = source.value->>'exam_id'
    )
  ) then
    raise exception 'Cada fuente necesita un mapeo administrativo explícito a su oposición: sin mapeo no se materializa el Examen artificial.';
  end if;

  -- La oposición única se deriva del mapeo; una selección que mezcle más de
  -- una oposición se rechaza en servidor.
  select array_agg(distinct mapped.opposition_id) into v_opposition_ids
  from jsonb_array_elements(p_sources) source(value)
  join public.opposition_exams mapped
    on mapped.exam_id = source.value->>'exam_id';

  if coalesce(cardinality(v_opposition_ids), 0) <> 1 then
    raise exception 'La selección mezcla más de una oposición: cada Examen artificial pertenece a una única oposición.';
  end if;

  return public.start_or_resume_artificial_attempt_v2(p_mode, v_opposition_ids[1], p_sources);
end;
$$;

revoke all on function public.start_or_resume_artificial_attempt_v2(text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.start_or_resume_artificial_attempt(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.start_or_resume_artificial_attempt_v2(text, text, jsonb) to authenticated;
grant execute on function public.start_or_resume_artificial_attempt(text, jsonb) to authenticated;
