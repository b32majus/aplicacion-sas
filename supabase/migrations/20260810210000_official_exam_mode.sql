alter table public.attempts
  add column duration_minutes integer,
  add column started_at timestamptz,
  add column deadline_at timestamptz;

alter table public.attempts
  drop constraint attempts_kind_check,
  drop constraint attempts_strategy_check,
  drop constraint attempts_kind_shape_check,
  add constraint attempts_kind_check check (kind in ('normal', 'failed', 'exam')),
  add constraint attempts_strategy_check check (strategy in ('normal', 'random', 'failed', 'exam')),
  add constraint attempts_kind_shape_check check (
    (kind = 'normal' and principal and strategy in ('normal', 'random') and failed_scope_exam_id is null
      and duration_minutes is null and started_at is null and deadline_at is null)
    or
    (kind = 'failed' and not principal and strategy = 'failed'
      and duration_minutes is null and started_at is null and deadline_at is null)
    or
    (kind = 'exam' and not principal and strategy = 'exam' and failed_scope_exam_id is null
      and duration_minutes between 1 and 1440 and started_at is not null and deadline_at is not null
      and deadline_at = started_at + make_interval(mins => duration_minutes))
  );

create unique index attempts_one_active_exam
  on public.attempts(user_id)
  where status = 'active' and kind = 'exam';

create or replace function public.reject_attempt_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    old.user_id, old.exam_id, old.exam_version_id, old.exam_version_path,
    old.question_ids, old.kind, old.principal, old.strategy, old.failed_scope_exam_id,
    old.duration_minutes, old.started_at, old.deadline_at
  ) is distinct from row(
    new.user_id, new.exam_id, new.exam_version_id, new.exam_version_path,
    new.question_ids, new.kind, new.principal, new.strategy, new.failed_scope_exam_id,
    new.duration_minutes, new.started_at, new.deadline_at
  ) then
    raise exception 'La identidad fijada del intento no se puede modificar.';
  end if;
  return new;
end;
$$;

create function public.start_or_resume_exam_attempt(
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
  v_now timestamptz := clock_timestamp();
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  if p_exam_id is null or p_exam_version_id is null or p_exam_version_path is null then
    raise exception 'La versión del examen es obligatoria.';
  end if;
  if p_exam_version_path like '/%' or p_exam_version_path like '%..%' or p_exam_version_path not like '%.json' then
    raise exception 'La ruta de versión no es válida.';
  end if;
  if coalesce(cardinality(p_question_ids), 0) = 0
     or cardinality(p_question_ids) > 1000
     or (select count(distinct question_id) from unnest(p_question_ids) as questions(question_id))
        <> cardinality(p_question_ids) then
    raise exception 'El Conjunto puntuable definitivo no es válido.';
  end if;
  if p_duration_minutes is null or p_duration_minutes not between 1 and 1440 then
    raise exception 'La duración oficial no es válida.';
  end if;

  insert into public.profiles(id) values (v_user_id) on conflict (id) do nothing;
  perform 1 from public.profiles where id = v_user_id for update;

  select * into v_attempt
  from public.attempts
  where user_id = v_user_id and status = 'active' and kind = 'exam'
  for update;
  if found then
    return to_jsonb(v_attempt) || jsonb_build_object('server_now', v_now);
  end if;

  insert into public.attempts(
    user_id, exam_id, exam_version_id, exam_version_path, question_ids,
    kind, principal, strategy, duration_minutes, started_at, deadline_at
  ) values (
    v_user_id, p_exam_id, p_exam_version_id, p_exam_version_path, p_question_ids,
    'exam', false, 'exam', p_duration_minutes, v_now,
    v_now + make_interval(mins => p_duration_minutes)
  ) returning * into v_attempt;

  return to_jsonb(v_attempt) || jsonb_build_object('server_now', v_now);
end;
$$;

revoke execute on function public.start_or_resume_exam_attempt(text, text, text, text[], integer)
  from public, anon;
grant execute on function public.start_or_resume_exam_attempt(text, text, text, text[], integer)
  to authenticated;

alter table public.attempt_answers
  alter column selected_option drop not null,
  alter column correct_option drop not null,
  alter column is_correct drop not null;

create function public.save_exam_answer(
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

  select * into v_attempt
  from public.attempts
  where id = p_attempt_id and user_id = v_user_id and status = 'active' and kind = 'exam'
  for update;
  if not found then raise exception 'No existe un Modo examen activo propio.'; end if;
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

revoke execute on function public.save_exam_answer(uuid, uuid, text, text, integer)
  from public, anon;
grant execute on function public.save_exam_answer(uuid, uuid, text, text, integer)
  to authenticated;

alter table public.attempts
  add column score numeric(7, 2),
  add column correct_answers integer,
  add column wrong_answers integer,
  add column blank_answers integer,
  add column exam_elapsed_ms bigint,
  add column new_personal_record boolean;

create function public.finish_exam_attempt(
  p_attempt_id uuid,
  p_answer_key jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
  v_question_id text;
  v_selected_option text;
  v_correct_option text;
  v_is_correct boolean;
  v_progress public.question_progress;
  v_sequence integer;
  v_newly_pending boolean;
  v_newly_mastered boolean;
  v_correct integer := 0;
  v_wrong integer := 0;
  v_blank integer := 0;
  v_score numeric(7, 2);
  v_elapsed_ms bigint;
  v_previous_best numeric(7, 2);
  v_new_record boolean;
  v_completed_at timestamptz;
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;

  select * into v_attempt
  from public.attempts
  where id = p_attempt_id and user_id = v_user_id and kind = 'exam'
  for update;
  if not found then raise exception 'No existe un Modo examen propio.'; end if;

  if v_attempt.status = 'completed' then
    return jsonb_build_object(
      'attempt_id', v_attempt.id,
      'correct', v_attempt.correct_answers,
      'wrong', v_attempt.wrong_answers,
      'blank', v_attempt.blank_answers,
      'score', v_attempt.score,
      'elapsed_ms', v_attempt.exam_elapsed_ms,
      'new_personal_record', v_attempt.new_personal_record,
      'completed_at', v_attempt.completed_at
    );
  end if;
  if v_attempt.status <> 'active' then raise exception 'El Modo examen no está activo.'; end if;

  if jsonb_typeof(p_answer_key) <> 'object'
     or (select count(*) from jsonb_object_keys(p_answer_key)) <> cardinality(v_attempt.question_ids)
     or exists (
       select 1 from unnest(v_attempt.question_ids) as questions(question_id)
       where not (p_answer_key ? questions.question_id)
          or jsonb_typeof(p_answer_key -> questions.question_id) <> 'string'
          or length(p_answer_key ->> questions.question_id) not between 1 and 20
     )
     or exists (
       select 1 from jsonb_object_keys(p_answer_key) as answers(question_id)
       where not (answers.question_id = any(v_attempt.question_ids))
     ) then
    raise exception 'La plantilla definitiva no coincide con el Conjunto puntuable definitivo.';
  end if;

  foreach v_question_id in array v_attempt.question_ids loop
    v_correct_option := p_answer_key ->> v_question_id;
    select answer.selected_option into v_selected_option
    from public.attempt_answers answer
    where answer.attempt_id = v_attempt.id
      and answer.question_id = v_question_id
      and answer.correct_option is null
    order by answer.answer_sequence desc
    limit 1;

    v_is_correct := v_selected_option is not null and v_selected_option = v_correct_option;
    if v_selected_option is null then
      v_blank := v_blank + 1;
    elsif v_is_correct then
      v_correct := v_correct + 1;
    else
      v_wrong := v_wrong + 1;
    end if;

    select * into v_progress
    from public.question_progress
    where user_id = v_user_id and exam_id = v_attempt.exam_id and question_id = v_question_id
    for update;
    if not found then
      insert into public.question_progress(user_id, exam_id, question_id)
      values (v_user_id, v_attempt.exam_id, v_question_id)
      returning * into v_progress;
    end if;

    v_newly_pending := false;
    v_newly_mastered := false;
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

    select coalesce(max(answer_sequence), 0) + 1 into v_sequence
    from public.attempt_answers
    where attempt_id = v_attempt.id and question_id = v_question_id;
    insert into public.attempt_answers(
      id, attempt_id, user_id, question_id, answer_sequence,
      selected_option, correct_option, is_correct,
      newly_pending_failure, newly_mastered
    ) values (
      gen_random_uuid(), v_attempt.id, v_user_id, v_question_id, v_sequence,
      v_selected_option, v_correct_option, v_is_correct,
      v_newly_pending, v_newly_mastered
    );
  end loop;

  v_score := round(
    (100.0 / cardinality(v_attempt.question_ids)) * (v_correct - v_wrong / 4.0),
    2
  );
  v_completed_at := clock_timestamp();
  v_elapsed_ms := greatest(0, floor(
    extract(epoch from (least(v_completed_at, v_attempt.deadline_at) - v_attempt.started_at)) * 1000
  ))::bigint;
  select max(score) into v_previous_best
  from public.attempts
  where user_id = v_user_id and exam_id = v_attempt.exam_id
    and kind = 'exam' and status = 'completed';
  v_new_record := v_previous_best is null or v_score > v_previous_best;

  update public.attempts
  set status = 'completed', completed_at = v_completed_at, updated_at = v_completed_at,
      score = v_score, correct_answers = v_correct, wrong_answers = v_wrong,
      blank_answers = v_blank, exam_elapsed_ms = v_elapsed_ms,
      new_personal_record = v_new_record, is_paused = false
  where id = v_attempt.id
  returning * into v_attempt;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'correct', v_correct,
    'wrong', v_wrong,
    'blank', v_blank,
    'score', v_score,
    'elapsed_ms', v_elapsed_ms,
    'new_personal_record', v_new_record,
    'completed_at', v_attempt.completed_at
  );
end;
$$;

revoke execute on function public.finish_exam_attempt(uuid, jsonb) from public, anon;
grant execute on function public.finish_exam_attempt(uuid, jsonb) to authenticated;

create function public.reject_interactive_answer_during_exam()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (
    select 1
    from public.attempts target
    where target.id = new.attempt_id and target.kind <> 'exam'
  ) and exists (
    select 1
    from public.attempts exam
    where exam.user_id = new.user_id
      and exam.kind = 'exam'
      and exam.status = 'active'
      and exam.deadline_at > clock_timestamp()
  ) then
    raise exception 'No se admiten respuestas de estudio mientras existe un Modo examen activo.';
  end if;
  return new;
end;
$$;

create trigger attempt_answers_block_study_during_exam
before insert on public.attempt_answers
for each row execute function public.reject_interactive_answer_during_exam();

revoke execute on function public.reject_interactive_answer_during_exam()
  from public, anon, authenticated;
