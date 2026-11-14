-- Frontera de oposición para las Sesiones de falladas (unidad m02-falladas-oposicion).
--
-- Operativa:
--   1. La RPC v2 public.start_or_resume_failed_attempt_v2(oposición, ámbito,
--      fuentes) verifica en servidor, ANTES de crear el intento o sus fuentes,
--      que cada fuente tiene fila de mapeo explícita en public.opposition_exams
--      hacia la oposición solicitada (sin fila de mapeo no se materializa nada:
--      fallo cerrado), que el ámbito pedido pertenece a la misma oposición y que
--      cada tuplo (exam_id, exam_version_id, exam_version_path, question_id)
--      existe en public.official_exam_versions con is_published. Conserva,
--      además, las comprobaciones existentes: reanudación fijada, guard del
--      Modo examen activo, cola con preguntas aún pendientes, sin duplicados y
--      límites de forma.
--   2. La reanudación precede a toda verificación: si el usuario ya tiene su
--      única Sesión de falladas activa (índice único
--      attempts_one_active_failed_session) la RPC la devuelve con sus fuentes y
--      versiones fijadas aunque se solicite otra oposición o la cola venga
--      vacía; no se crea ninguna sesión adicional y los intentos históricos no
--      se reinterpretan ni se filtran por la selección actual.
--   3. La firma antigua public.start_or_resume_failed_attempt(ámbito, fuentes)
--      sigue operativa con su privilegio authenticated (compatibilidad con el
--      frontend antiguo, cuyo despliegue precede a la UI), pero ya no permite
--      crear una sesión mezclada: el servidor deriva la oposición única de la
--      cola desde el mapeo administrativo y falla cerrado si falta el mapeo o
--      la cola mezcla más de una oposición; las colas homogéneas existentes
--      siguen funcionando porque se derivan a la RPC v2 con esa oposición.
--   4. Migración forward-only: no toca filas ni esquema de attempts,
--      attempt_question_sources, question_progress ni attempt_answers (sin
--      update, delete ni alter table), no redefine el algoritmo de dos aciertos
--      (confirm_failed_answer, complete_failed_attempt,
--      apply_principal_answer), ni scoring, sincronización, guard, dashboard ni
--      las RPC del registro oficial.

create function public.start_or_resume_failed_attempt_v2(
  p_opposition_id text,
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
  if p_opposition_id is null or length(p_opposition_id) not between 1 and 200 then
    raise exception 'La oposición solicitada no es válida.';
  end if;
  if p_scope_exam_id is not null and length(p_scope_exam_id) not between 1 and 200 then
    raise exception 'El ámbito de falladas no es válido.';
  end if;

  insert into public.profiles(id) values (v_user_id) on conflict (id) do nothing;
  perform 1 from public.profiles where id = v_user_id for update;

  -- La reanudación precede a toda verificación: la única Sesión de falladas
  -- activa se devuelve fijada aunque se solicite otra oposición o la cola venga
  -- vacía; los intentos históricos no se reinterpretan.
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

  -- Frontera de oposición en servidor, antes de materializar nada: cada fuente
  -- debe estar mapeada en el registro administrativo hacia LA oposición
  -- solicitada, y el ámbito pedido también. Sin fila de mapeo explícita o con
  -- otra oposición el inicio falla cerrado.
  if p_scope_exam_id is not null and not exists (
    select 1
    from public.opposition_exams scope_mapping
    where scope_mapping.exam_id = p_scope_exam_id
      and scope_mapping.opposition_id = p_opposition_id
  ) then
    raise exception 'El ámbito de falladas no pertenece a la oposición solicitada.';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_sources) source(value)
    where not exists (
      select 1
      from public.opposition_exams mapped
      where mapped.exam_id = source.value->>'exam_id'
        and mapped.opposition_id = p_opposition_id
    )
  ) then
    raise exception 'Cada fuente debe estar mapeada en el registro administrativo a la oposición solicitada: sin mapeo no se materializa la Sesión de falladas.';
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
       or source.value->>'exam_version_path' like '/%'
       or source.value->>'exam_version_path' like '%..%'
       or source.value->>'exam_version_path' not like '%.json'
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

-- Firma antigua endurecida: mismas comprobaciones existentes y reanudación
-- fijada, pero la oposición única de la cola se deriva en servidor desde el
-- mapeo administrativo y se delega en la RPC v2, que aplica la frontera.
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
  v_has_attempt boolean;
  v_opposition_ids text[];
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
    raise exception 'Cada fuente necesita un mapeo administrativo explícito a su oposición: sin mapeo no se materializa la Sesión de falladas.';
  end if;

  -- La oposición única se deriva del mapeo; una cola que mezcle más de una
  -- oposición se rechaza en servidor.
  select array_agg(distinct mapped.opposition_id) into v_opposition_ids
  from jsonb_array_elements(p_sources) source(value)
  join public.opposition_exams mapped
    on mapped.exam_id = source.value->>'exam_id';

  if coalesce(cardinality(v_opposition_ids), 0) <> 1 then
    raise exception 'La cola mezcla más de una oposición: cada Sesión de falladas pertenece a una única oposición.';
  end if;

  return public.start_or_resume_failed_attempt_v2(v_opposition_ids[1], p_scope_exam_id, p_sources);
end;
$$;

revoke all on function public.start_or_resume_failed_attempt_v2(text, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.start_or_resume_failed_attempt(text, jsonb)
  from public, anon, authenticated;
grant execute on function public.start_or_resume_failed_attempt_v2(text, text, jsonb) to authenticated;
grant execute on function public.start_or_resume_failed_attempt(text, jsonb) to authenticated;
