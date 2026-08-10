alter table public.attempts
  add column failed_scope_exam_id text;

alter table public.attempts
  drop constraint attempts_kind_check,
  drop constraint attempts_principal_check,
  drop constraint attempts_strategy_check,
  add constraint attempts_kind_check check (kind in ('normal', 'failed')),
  add constraint attempts_strategy_check check (strategy in ('normal', 'random', 'failed')),
  add constraint attempts_kind_shape_check check (
    (kind = 'normal' and principal and strategy in ('normal', 'random') and failed_scope_exam_id is null)
    or
    (kind = 'failed' and not principal and strategy = 'failed')
  ),
  add constraint attempts_failed_scope_check check (
    failed_scope_exam_id is null or length(failed_scope_exam_id) between 1 and 200
  );

create unique index attempts_one_active_failed_session
  on public.attempts(user_id)
  where status = 'active' and kind = 'failed';

create table public.attempt_question_sources (
  attempt_id uuid not null,
  user_id uuid not null,
  position integer not null check (position >= 0),
  exam_id text not null check (length(exam_id) between 1 and 200),
  exam_version_id text not null check (length(exam_version_id) between 1 and 200),
  exam_version_path text not null check (
    length(exam_version_path) between 1 and 500
    and exam_version_path not like '/%'
    and exam_version_path not like '%..%'
    and exam_version_path like '%.json'
  ),
  question_id text not null check (length(question_id) between 1 and 300),
  primary key (attempt_id, exam_id, question_id),
  unique (attempt_id, position),
  unique (attempt_id, question_id),
  foreign key (attempt_id, user_id) references public.attempts(id, user_id) on delete cascade
);

alter table public.attempt_question_sources enable row level security;
create policy attempt_question_sources_select_own on public.attempt_question_sources
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.attempt_question_sources from anon, authenticated;
grant select on public.attempt_question_sources to authenticated;

create trigger attempt_question_sources_are_immutable
before update or delete on public.attempt_question_sources
for each row execute function public.reject_confirmed_answer_change();

create or replace function public.reject_attempt_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    old.user_id, old.exam_id, old.exam_version_id, old.exam_version_path,
    old.question_ids, old.kind, old.principal, old.strategy, old.failed_scope_exam_id
  ) is distinct from row(
    new.user_id, new.exam_id, new.exam_version_id, new.exam_version_path,
    new.question_ids, new.kind, new.principal, new.strategy, new.failed_scope_exam_id
  ) then
    raise exception 'La identidad fijada del intento no se puede modificar.';
  end if;
  return new;
end;
$$;

alter function public.confirm_normal_answer(uuid, uuid, text, text, text)
  rename to apply_principal_answer;
alter function public.complete_normal_attempt(uuid)
  rename to finish_principal_attempt;

revoke execute on function public.apply_principal_answer(uuid, uuid, text, text, text)
  from public, anon, authenticated;
revoke execute on function public.finish_principal_attempt(uuid)
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
  v_attempt public.attempts;
  v_answer public.attempt_answers;
begin
  if auth.uid() is null then raise exception 'Se requiere autenticación.'; end if;
  select * into v_attempt from public.attempts
  where id = p_attempt_id and user_id = auth.uid();
  if not found or v_attempt.kind <> 'normal' then
    raise exception 'La operación solo admite un Recorrido principal propio.';
  end if;
  select * into v_answer from public.apply_principal_answer(
    p_confirmation_id, p_attempt_id, p_question_id, p_selected_option, p_correct_option
  );
  return v_answer;
end;
$$;

create function public.complete_normal_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts;
  v_summary jsonb;
begin
  if auth.uid() is null then raise exception 'Se requiere autenticación.'; end if;
  select * into v_attempt from public.attempts
  where id = p_attempt_id and user_id = auth.uid();
  if not found or v_attempt.kind <> 'normal' then
    raise exception 'La operación solo admite un Recorrido principal propio.';
  end if;
  select public.finish_principal_attempt(p_attempt_id) into v_summary;
  return v_summary;
end;
$$;

create function public.start_or_resume_failed_attempt(
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
  if found then return v_attempt; end if;

  if jsonb_typeof(p_sources) <> 'array' then
    raise exception 'La cola de Falladas pendientes no es válida.';
  end if;
  select count(*) into v_source_count from jsonb_array_elements(p_sources);
  if v_source_count = 0 or v_source_count > 1000 then
    raise exception 'No hay Falladas pendientes elegibles para este ámbito.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sources) as source(value)
    where nullif(source.value->>'exam_id', '') is null
       or length(source.value->>'exam_id') > 200
       or nullif(source.value->>'exam_version_id', '') is null
       or length(source.value->>'exam_version_id') > 200
       or nullif(source.value->>'exam_version_path', '') is null
       or length(source.value->>'exam_version_path') > 500
       or source.value->>'exam_version_path' like '/%'
       or source.value->>'exam_version_path' like '%..%'
       or source.value->>'exam_version_path' not like '%.json'
       or nullif(source.value->>'question_id', '') is null
       or length(source.value->>'question_id') > 300
       or (p_scope_exam_id is not null and source.value->>'exam_id' <> p_scope_exam_id)
  ) then
    raise exception 'La cola de Falladas pendientes no es válida.';
  end if;

  if (
    select count(*)
    from (
      select source.value->>'exam_id', source.value->>'question_id'
      from jsonb_array_elements(p_sources) as source(value)
      group by source.value->>'exam_id', source.value->>'question_id'
    ) identities
  ) <> v_source_count or (
    select count(distinct source.value->>'question_id')
    from jsonb_array_elements(p_sources) as source(value)
  ) <> v_source_count then
    raise exception 'Cada pregunta puede aparecer una sola vez en la Sesión de falladas.';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(p_sources) as source(value)
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

  if exists (
    select 1
    from (
      select source.value->>'exam_id' as exam_id,
             count(distinct row(source.value->>'exam_version_id', source.value->>'exam_version_path')) as versions
      from jsonb_array_elements(p_sources) as source(value)
      group by source.value->>'exam_id'
    ) exams
    where exams.versions <> 1
  ) then
    raise exception 'Cada examen debe conservar una única versión fijada.';
  end if;

  select array_agg(source.value->>'question_id' order by source.ordinality),
         (array_agg(source.value order by source.ordinality))[1]
  into v_question_ids, v_first_source
  from jsonb_array_elements(p_sources) with ordinality as source(value, ordinality);

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
    attempt_id, user_id, position, exam_id, exam_version_id, exam_version_path, question_id
  )
  select v_attempt.id, v_user_id, source.ordinality - 1,
         source.value->>'exam_id', source.value->>'exam_version_id',
         source.value->>'exam_version_path', source.value->>'question_id'
  from jsonb_array_elements(p_sources) with ordinality as source(value, ordinality);

  return v_attempt;
end;
$$;

create function public.confirm_failed_answer(
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
  where id = p_attempt_id and user_id = v_user_id and status = 'active' and kind = 'failed'
  for update;
  if not found then raise exception 'No existe una Sesión de falladas activa propia.'; end if;

  select * into v_source from public.attempt_question_sources
  where attempt_id = p_attempt_id and user_id = v_user_id and question_id = p_question_id;
  if not found then raise exception 'La pregunta no pertenece a la cola fijada.'; end if;

  select * into v_existing from public.attempt_answers
  where attempt_id = p_attempt_id and question_id = p_question_id
  limit 1;
  if found then raise exception 'La pregunta ya tiene una respuesta confirmada en este intento.'; end if;

  select * into v_progress from public.question_progress
  where user_id = v_user_id and exam_id = v_source.exam_id and question_id = p_question_id
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

create function public.complete_failed_attempt(p_attempt_id uuid)
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
  v_mastered integer;
  v_still_pending jsonb;
begin
  if auth.uid() is null then raise exception 'Se requiere autenticación.'; end if;

  select * into v_attempt from public.attempts
  where id = p_attempt_id and user_id = auth.uid() and kind = 'failed'
  for update;
  if not found then raise exception 'No existe una Sesión de falladas propia.'; end if;

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
    where id = v_attempt.id
    returning * into v_attempt;
  end if;

  select count(*) filter (where is_correct),
         count(*) filter (where not is_correct),
         count(*) filter (where newly_mastered)
  into v_correct, v_wrong, v_mastered
  from public.attempt_answers where attempt_id = v_attempt.id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'exam_id', source.exam_id,
    'question_id', source.question_id
  ) order by source.position) filter (where progress.pending_failure), '[]'::jsonb)
  into v_still_pending
  from public.attempt_question_sources source
  join public.question_progress progress
    on progress.user_id = source.user_id
   and progress.exam_id = source.exam_id
   and progress.question_id = source.question_id
  where source.attempt_id = v_attempt.id;

  return jsonb_build_object(
    'attempt_id', v_attempt.id,
    'correct', v_correct,
    'wrong', v_wrong,
    'accuracy', case when v_correct + v_wrong = 0 then 0
      else round((100.0 * v_correct / (v_correct + v_wrong))::numeric, 1) end,
    'active_seconds', v_attempt.active_seconds,
    'mastered', v_mastered,
    'still_pending', v_still_pending,
    'newly_pending_failures', jsonb_array_length(v_still_pending),
    'newly_mastered', v_mastered,
    'completed_at', v_attempt.completed_at
  );
end;
$$;

revoke execute on function public.start_or_resume_failed_attempt(text, jsonb) from public, anon;
revoke execute on function public.confirm_failed_answer(uuid, uuid, text, text, text) from public, anon;
revoke execute on function public.complete_failed_attempt(uuid) from public, anon;
revoke execute on function public.confirm_normal_answer(uuid, uuid, text, text, text) from public, anon;
revoke execute on function public.complete_normal_attempt(uuid) from public, anon;
grant execute on function public.start_or_resume_failed_attempt(text, jsonb) to authenticated;
grant execute on function public.confirm_failed_answer(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.complete_failed_attempt(uuid) to authenticated;
grant execute on function public.confirm_normal_answer(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.complete_normal_attempt(uuid) to authenticated;
