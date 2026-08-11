create or replace function public.confirm_normal_answer(
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

  select * into v_attempt from public.attempts
  where id = p_attempt_id and user_id = v_user_id and status = 'active'
  for update;
  if not found then raise exception 'No existe un intento activo propio.'; end if;
  if not (p_question_id = any(v_attempt.question_ids)) then
    raise exception 'La pregunta no pertenece a la versión fijada.';
  end if;

  select * into v_existing
  from public.attempt_answers
  where attempt_id = p_attempt_id and question_id = p_question_id
  limit 1;
  if found then raise exception 'La pregunta ya tiene una respuesta confirmada en este intento.'; end if;

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

create or replace function public.complete_normal_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts;
  v_pending integer;
  v_correct integer;
  v_wrong integer;
  v_new_pending integer;
  v_new_mastered integer;
begin
  if auth.uid() is null then raise exception 'Se requiere autenticación.'; end if;

  select * into v_attempt from public.attempts
  where id = p_attempt_id and user_id = auth.uid()
  for update;
  if not found then raise exception 'No existe un intento propio.'; end if;

  if v_attempt.status = 'active' then
    select count(*) into v_pending
    from unnest(v_attempt.question_ids) as questions(question_id)
    where not exists (
      select 1
      from public.attempt_answers answer
      where answer.attempt_id = v_attempt.id and answer.question_id = questions.question_id
    );
    if v_pending <> 0 then raise exception 'Aún quedan preguntas pendientes.'; end if;

    update public.attempts
    set status = 'completed', completed_at = now(), is_paused = false, updated_at = now()
    where id = v_attempt.id
    returning * into v_attempt;
  end if;

  select
    count(*) filter (where is_correct),
    count(*) filter (where not is_correct),
    count(*) filter (where newly_pending_failure),
    count(*) filter (where newly_mastered)
  into v_correct, v_wrong, v_new_pending, v_new_mastered
  from public.attempt_answers where attempt_id = v_attempt.id;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'correct', v_correct,
    'wrong', v_wrong,
    'accuracy', case when v_correct + v_wrong = 0 then 0
      else round((100.0 * v_correct / (v_correct + v_wrong))::numeric, 1) end,
    'active_seconds', v_attempt.active_seconds,
    'newly_pending_failures', v_new_pending,
    'newly_mastered', v_new_mastered,
    'completed_at', v_attempt.completed_at
  );
end;
$$;
