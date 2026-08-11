create or replace function public.apply_principal_answer(
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
  v_existing public.attempt_answers;
  v_answer public.attempt_answers;
  v_progress public.question_progress;
  v_is_correct boolean := p_selected_option = p_correct_option;
  v_newly_pending boolean := false;
  v_newly_mastered boolean := false;
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  if p_confirmation_id is null then raise exception 'La identidad de confirmación es obligatoria.'; end if;

  select * into v_attempt
  from public.attempts
  where id = p_attempt_id and user_id = v_user_id
  for update;
  if not found then raise exception 'No existe un Recorrido principal propio.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_confirmation_id::text, 0));

  select * into v_existing from public.attempt_answers where id = p_confirmation_id;
  if found then
    if v_existing.attempt_id <> p_attempt_id
       or v_existing.user_id <> v_user_id
       or v_existing.question_id <> p_question_id
       or v_existing.selected_option <> p_selected_option
       or v_existing.correct_option <> p_correct_option then
      raise exception 'La clave idempotente ya pertenece a otro resultado.';
    end if;
    return v_existing;
  end if;

  if v_attempt.status <> 'active' or v_attempt.kind <> 'normal' or not v_attempt.principal then
    raise exception 'No existe un Recorrido principal activo propio.';
  end if;
  if not (p_question_id = any(v_attempt.question_ids)) then
    raise exception 'La pregunta no pertenece a la versión fijada.';
  end if;
  if exists (
    select 1 from public.attempt_answers
    where attempt_id = p_attempt_id and question_id = p_question_id
  ) then
    raise exception 'La pregunta ya tiene una respuesta confirmada en este intento.';
  end if;

  select * into v_progress from public.question_progress
  where user_id = v_user_id and exam_id = v_attempt.exam_id and question_id = p_question_id
  for update;
  if not found then
    insert into public.question_progress(user_id, exam_id, question_id)
    values (v_user_id, v_attempt.exam_id, p_question_id)
    returning * into v_progress;
  end if;

  if v_is_correct then
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
    set wrong_count = wrong_count + 1,
        current_streak = 0,
        mastered = false,
        pending_failure = true,
        updated_at = now()
    where id = v_progress.id;
  end if;

  insert into public.attempt_answers(
    id, attempt_id, user_id, question_id, answer_sequence,
    selected_option, correct_option, is_correct,
    newly_pending_failure, newly_mastered
  ) values (
    p_confirmation_id, p_attempt_id, v_user_id, p_question_id, 1,
    p_selected_option, p_correct_option, v_is_correct,
    v_newly_pending, v_newly_mastered
  ) returning * into v_answer;

  update public.attempts set updated_at = now() where id = p_attempt_id;
  return v_answer;
end;
$$;

create or replace function public.confirm_failed_answer(
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
  v_progress public.question_progress;
  v_is_correct boolean := p_selected_option = p_correct_option;
  v_newly_pending boolean := false;
  v_newly_mastered boolean := false;
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  if p_confirmation_id is null then raise exception 'La identidad de confirmación es obligatoria.'; end if;

  select * into v_attempt
  from public.attempts
  where id = p_attempt_id and user_id = v_user_id
  for update;
  if not found then raise exception 'No existe una Sesión de falladas propia.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_confirmation_id::text, 0));

  select * into v_existing from public.attempt_answers where id = p_confirmation_id;
  if found then
    if v_existing.attempt_id <> p_attempt_id
       or v_existing.user_id <> v_user_id
       or v_existing.question_id <> p_question_id
       or v_existing.selected_option <> p_selected_option
       or v_existing.correct_option <> p_correct_option then
      raise exception 'La clave idempotente ya pertenece a otro resultado.';
    end if;
    return v_existing;
  end if;

  if v_attempt.status <> 'active' or v_attempt.kind <> 'failed' then
    raise exception 'No existe una Sesión de falladas activa propia.';
  end if;
  select * into v_source from public.attempt_question_sources
  where attempt_id = p_attempt_id and user_id = v_user_id and question_id = p_question_id;
  if not found then raise exception 'La pregunta no pertenece a la cola fijada.'; end if;
  if exists (
    select 1 from public.attempt_answers
    where attempt_id = p_attempt_id and question_id = p_question_id
  ) then
    raise exception 'La pregunta ya tiene una respuesta confirmada en este intento.';
  end if;

  select * into v_progress from public.question_progress
  where user_id = v_user_id and exam_id = v_source.exam_id
    and question_id = v_source.source_question_id
  for update;
  if not found then raise exception 'La pregunta ya no tiene progreso pendiente.'; end if;

  if v_is_correct then
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
    set wrong_count = wrong_count + 1,
        current_streak = 0,
        mastered = false,
        pending_failure = true,
        updated_at = now()
    where id = v_progress.id;
  end if;

  insert into public.attempt_answers(
    id, attempt_id, user_id, question_id, answer_sequence,
    selected_option, correct_option, is_correct,
    newly_pending_failure, newly_mastered
  ) values (
    p_confirmation_id, p_attempt_id, v_user_id, p_question_id, 1,
    p_selected_option, p_correct_option, v_is_correct,
    v_newly_pending, v_newly_mastered
  ) returning * into v_answer;

  update public.attempts set updated_at = now() where id = p_attempt_id;
  return v_answer;
end;
$$;

create or replace function public.save_exam_answer(
  p_answer_id uuid,
  p_attempt_id uuid,
  p_question_id text,
  p_selected_option text,
  p_position integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
  v_existing public.attempt_answers;
  v_answer public.attempt_answers;
  v_sequence integer;
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  if p_answer_id is null then raise exception 'La identidad del guardado es obligatoria.'; end if;

  select * into v_attempt
  from public.attempts
  where id = p_attempt_id and user_id = v_user_id
  for update;
  if not found then raise exception 'No existe un Modo examen propio.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_answer_id::text, 0));

  select * into v_existing from public.attempt_answers where id = p_answer_id;
  if found then
    if v_existing.attempt_id <> p_attempt_id
       or v_existing.user_id <> v_user_id
       or v_existing.question_id <> p_question_id
       or v_existing.selected_option is distinct from p_selected_option
       or v_existing.correct_option is not null
       or v_existing.is_correct is not null then
      raise exception 'La clave idempotente ya pertenece a otro cambio de respuesta.';
    end if;
    return to_jsonb(v_existing);
  end if;

  if v_attempt.status <> 'active' or v_attempt.kind <> 'exam' then
    raise exception 'No existe un Modo examen activo propio.';
  end if;
  if clock_timestamp() >= v_attempt.deadline_at then
    raise exception 'El deadline del Modo examen ya ha vencido.';
  end if;
  if not (p_question_id = any(v_attempt.question_ids)) then
    raise exception 'La pregunta no pertenece al Conjunto puntuable definitivo.';
  end if;
  if p_position is null or p_position < 0 or p_position >= cardinality(v_attempt.question_ids) then
    raise exception 'La posición de examen no es válida.';
  end if;
  if p_selected_option is not null and length(p_selected_option) not between 1 and 20 then
    raise exception 'La opción elegida no es válida.';
  end if;

  select coalesce(max(answer_sequence), 0) + 1 into v_sequence
  from public.attempt_answers
  where attempt_id = p_attempt_id and question_id = p_question_id;
  insert into public.attempt_answers(
    id, attempt_id, user_id, question_id, answer_sequence,
    selected_option, correct_option, is_correct
  ) values (
    p_answer_id, p_attempt_id, v_user_id, p_question_id, v_sequence,
    p_selected_option, null, null
  ) returning * into v_answer;

  update public.attempts
  set current_position = p_position, updated_at = now()
  where id = p_attempt_id;
  return to_jsonb(v_answer);
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
  v_attempt public.attempts;
  v_source public.attempt_question_sources;
  v_existing public.attempt_answers;
  v_answer public.attempt_answers;
  v_progress_result jsonb;
  v_official_option text;
  v_is_correct boolean;
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  if p_confirmation_id is null then raise exception 'La identidad de confirmación es obligatoria.'; end if;

  select * into v_attempt
  from public.attempts
  where id = p_attempt_id and user_id = v_user_id
  for update;
  if not found then raise exception 'No existe un Examen artificial de estudio propio.'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_confirmation_id::text, 0));

  select * into v_existing from public.attempt_answers where id = p_confirmation_id;
  if found then
    if v_existing.attempt_id <> p_attempt_id
       or v_existing.user_id <> v_user_id
       or v_existing.question_id <> p_question_id
       or v_existing.selected_option <> p_selected_option
       or v_existing.correct_option <> p_correct_option then
      raise exception 'La clave idempotente ya pertenece a otro resultado.';
    end if;
    return v_existing;
  end if;

  if v_attempt.status <> 'active' or v_attempt.origin <> 'artificial' or v_attempt.kind <> 'normal' then
    raise exception 'No existe un Examen artificial de estudio activo propio.';
  end if;
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
  ) then
    raise exception 'La pregunta ya tiene una respuesta confirmada en este intento.';
  end if;

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
