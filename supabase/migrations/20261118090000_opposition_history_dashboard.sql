-- Historial y Dashboard por oposición (unidad m04-historial-dashboard).
--
-- Operativa:
--   1. La oposición de cada intento del Historial se resuelve EN SERVIDOR y se
--      expone como columna `opposition_id` al final de la vista existente
--      `public.personal_attempt_history`. La resolución la realiza una función
--      security definer que verifica autorización real: el intento debe
--      pertenecer a `auth.uid()`; para intentos ajenos devuelve NULL sin
--      revelar nada. Para intentos oficiales y de estudio la oposición sale del
--      mapeo administrativo `public.opposition_exams` por `exam_id`; las
--      sesiones de falladas y los intentos artificiales (identificados por sus
--      propios campos kind/origin, nunca por la existencia de fuentes) se
--      resuelven EXCLUSIVAMENTE por `public.attempt_question_sources`, y solo
--      cuando TODAS las fuentes resuelven a una misma oposición: un intento
--      sin fuentes resolubles, mezclado o sin mapeo no pertenece a ninguna
--      oposición y ningún selector lo reclasifica.
--   2. La vista se recrea con `create or replace view` (nunca se destruye ni se
--      renombra): conserva todas sus columnas (incluida `origin`, añadida por
--      la migración del examen artificial), su `security_invoker = true`
--      (la RLS de `attempts` sigue filtrando la lectura), su endpoint y sus
--      privilegios (`revoke all` + `grant select` a `authenticated`). El
--      registro administrativo sigue sin SELECT directo: la columna resuelta
--      no concede ninguna lectura nueva sobre `oppositions` ni
--      `opposition_exams`.
--   3. La RPC v2 `public.get_opposition_dashboard_v2(p_opposition_id text)`
--      (security definer, `search_path = ''`) devuelve el resumen personal del
--      usuario autenticado en ESA oposición, incluidas las cuentas admin/test
--      que el Dashboard legacy les negaba. Cada métrica, examen y pregunta del
--      resultado pertenece exclusivamente a la oposición solicitada; falla
--      cerrado si la oposición no está registrada o no hay sesión real.
--   4. La sección comparativa agrega únicamente usuarios con rol `participant`
--      en `public.app_access_roles` con actividad persistida (intentos) en ESA
--      oposición: excluye admin/test y participantes sin actividad. «Falladas
--      por todos» solo aparece cuando la pregunta está fallada por TODOS los
--      participantes activos (el recuento de quienes la fallaron coincide con
--      el grupo activo completo) y hay al menos DOS: con grupo 0 o 1 no se
--      expone nada y ningún agregado permite inferir respuestas de un grupo
--      unitario.
--   5. Migración forward-only: no contiene `drop`, ni `alter table`, ni
--      operaciones sobre filas; no redefine `get_dashboard`, los tres alias de
--      `shared_profile_aliases`, el registro oficial ni ninguna RPC de
--      estudio, examen, falladas, artificial o sincronización.
--
-- Resolución pura de la oposición de un intento (sin verificación de sesión):
-- es la pieza interna que comparten la lectura del Historial y la RPC v2. Solo
-- es invocable desde funciones definer: no se concede EXECUTE a ningún rol.

create function public.resolve_attempt_opposition(p_attempt_id uuid, p_user_id uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
begin
  -- Autorización real: la oposición de un intento solo se resuelve para su
  -- propietario autenticado; para intentos ajenos devuelve NULL sin revelar
  -- nada y sin conceder SELECT administrativo sobre el registro.
  if v_user_id is null or p_user_id is null or p_user_id <> v_user_id then
    return null;
  end if;
  if not exists (
    select 1
    from public.attempts attempt
    where attempt.id = p_attempt_id
      and attempt.user_id = v_user_id
  ) then
    return null;
  end if;
  return public.opposition_of_attempt(p_attempt_id, p_user_id);
end;
$$;

revoke all on function public.resolve_attempt_opposition(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.resolve_attempt_opposition(uuid, uuid)
  to authenticated;

create function public.opposition_of_attempt(p_attempt_id uuid, p_owner uuid)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_origin text;
  v_source_total integer;
  v_opposition_id text;
begin
  if p_attempt_id is null or p_owner is null then
    return null;
  end if;

  -- El TIPO del intento lo deciden sus propios campos (kind/origin), nunca la
  -- existencia de fuentes: una fallada o un artificial sin fuentes no puede
  -- heredar la oposición de su exam_id.
  select attempt.kind, coalesce(attempt.origin, 'official')
    into v_kind, v_origin
  from public.attempts attempt
  where attempt.id = p_attempt_id
    and attempt.user_id = p_owner;

  if v_kind is null then
    return null;
  end if;

  -- Falladas y artificiales se resuelven EXCLUSIVAMENTE por sus fuentes
  -- persistidas: sin fuentes resolubles o con fuentes mezcladas el intento no
  -- pertenece a ninguna oposición (nunca se reclasifica por su exam_id).
  if v_kind = 'failed' or v_origin = 'artificial' then
    select count(*) into v_source_total
    from public.attempt_question_sources source
    where source.attempt_id = p_attempt_id
      and source.user_id = p_owner;

    if v_source_total = 0 then
      return null;
    end if;

    select mapped.opposition_id into v_opposition_id
    from public.attempt_question_sources source
    join public.opposition_exams mapped
      on mapped.exam_id = source.exam_id
    where source.attempt_id = p_attempt_id
      and source.user_id = p_owner
    group by mapped.opposition_id
    having count(*) = v_source_total;
    return v_opposition_id;
  end if;

  -- Intento oficial o de estudio no compuesto: decide el mapeo administrativo
  -- explícito del exam_id, nunca un prefijo ni una etiqueta.
  select mapped.opposition_id into v_opposition_id
  from public.attempts attempt
  join public.opposition_exams mapped
    on mapped.exam_id = attempt.exam_id
  where attempt.id = p_attempt_id
    and attempt.user_id = p_owner;
  return v_opposition_id;
end;
$$;

revoke all on function public.opposition_of_attempt(uuid, uuid)
  from public, anon, authenticated;

-- Lectura estrecha del Historial: la vista EXISTENTE se recrea conservando el
-- endpoint, todas sus columnas y su security_invoker (la RLS de attempts sigue
-- aplicándose al invocador), y añade al final la oposición resuelta en
-- servidor. Cambiar el selector del frontend solo cambia el filtro de consulta
-- sobre esta columna: nunca reclasifica ni modifica intentos.
create or replace view public.personal_attempt_history
with (security_invoker = true)
as
select
  attempt.id,
  attempt.user_id,
  attempt.created_at,
  coalesce(attempt.completed_at, attempt.abandoned_at) as ended_at,
  attempt.exam_id,
  attempt.exam_version_id,
  attempt.exam_version_path,
  attempt.question_ids,
  attempt.kind,
  attempt.strategy,
  attempt.status,
  attempt.failed_scope_exam_id,
  attempt.active_seconds,
  attempt.started_at,
  attempt.deadline_at,
  attempt.exam_elapsed_ms,
  attempt.score,
  coalesce(attempt.correct_answers, answer_metrics.correct_answers, 0) as correct_answers,
  coalesce(attempt.wrong_answers, answer_metrics.wrong_answers, 0) as wrong_answers,
  attempt.blank_answers,
  coalesce(answer_metrics.answered_questions, 0) as answered_questions,
  attempt.origin,
  public.resolve_attempt_opposition(attempt.id, attempt.user_id) as opposition_id
from public.attempts attempt
left join lateral (
  select
    count(*) filter (where latest.is_correct) as correct_answers,
    count(*) filter (where latest.is_correct is false) as wrong_answers,
    count(*) filter (where latest.selected_option is not null) as answered_questions
  from (
    select distinct on (answer.question_id)
      answer.question_id,
      answer.selected_option,
      answer.is_correct
    from public.attempt_answers answer
    where answer.attempt_id = attempt.id
    order by answer.question_id, answer.answer_sequence desc
  ) latest
) answer_metrics on true;

revoke all on public.personal_attempt_history from public, anon, authenticated;
grant select on public.personal_attempt_history to authenticated;

-- RPC v2 del Dashboard por oposición: resumen personal de cualquier cuenta
-- legítima (incluidas admin/test, que el legacy negaba) acotado a la oposición
-- solicitada, con comparativas solo de participantes reales activos.
create function public.get_opposition_dashboard_v2(p_opposition_id text)
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
      access.user_id,
      coalesce(alias.alias, 'Participante') as alias
    from public.app_access_roles access
    left join public.shared_profile_aliases alias
      on alias.user_id = access.user_id
    where access.role = 'participant'
      and exists (
        select 1
        from public.attempts attempt
        where attempt.user_id = access.user_id
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
