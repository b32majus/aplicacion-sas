create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_id text not null check (length(exam_id) between 1 and 200),
  exam_version_id text not null check (length(exam_version_id) between 1 and 200),
  exam_version_path text not null check (
    length(exam_version_path) between 1 and 500
    and exam_version_path not like '/%'
    and exam_version_path not like '%..%'
    and exam_version_path like '%.json'
  ),
  question_ids text[] not null check (
    cardinality(question_ids) > 0
    and cardinality(question_ids) <= 1000
  ),
  kind text not null default 'normal' check (kind = 'normal'),
  principal boolean not null default true check (principal),
  status text not null default 'active' check (status in ('active', 'completed')),
  current_position integer not null default 0 check (current_position >= 0),
  active_seconds integer not null default 0 check (active_seconds >= 0),
  is_paused boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check (current_position < cardinality(question_ids)),
  check (
    (status = 'active' and completed_at is null)
    or (status = 'completed' and completed_at is not null)
  ),
  unique (id, user_id)
);

create unique index attempts_one_active_principal_normal
  on public.attempts(user_id, exam_id)
  where status = 'active' and kind = 'normal' and principal;
create index attempts_user_exam_history
  on public.attempts(user_id, exam_id, created_at desc);

create table public.attempt_answers (
  id uuid primary key,
  attempt_id uuid not null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  question_id text not null check (length(question_id) between 1 and 300),
  answer_sequence integer not null check (answer_sequence > 0),
  selected_option text not null check (length(selected_option) between 1 and 20),
  correct_option text not null check (length(correct_option) between 1 and 20),
  is_correct boolean not null,
  newly_pending_failure boolean not null default false,
  newly_mastered boolean not null default false,
  confirmed_at timestamptz not null default now(),
  unique (attempt_id, question_id, answer_sequence),
  foreign key (attempt_id, user_id) references public.attempts(id, user_id) on delete cascade,
  check (is_correct = (selected_option = correct_option))
);

create index attempt_answers_attempt_order
  on public.attempt_answers(attempt_id, confirmed_at, id);

create table public.question_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  exam_id text not null check (length(exam_id) between 1 and 200),
  question_id text not null check (length(question_id) between 1 and 300),
  correct_count integer not null default 0 check (correct_count >= 0),
  wrong_count integer not null default 0 check (wrong_count >= 0),
  current_streak integer not null default 0 check (current_streak >= 0),
  mastered boolean not null default false,
  pending_failure boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, exam_id, question_id),
  check (not (mastered and pending_failure))
);

alter table public.profiles enable row level security;
alter table public.attempts enable row level security;
alter table public.attempt_answers enable row level security;
alter table public.question_progress enable row level security;

create policy profiles_select_own on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy attempts_select_own on public.attempts
  for select to authenticated using ((select auth.uid()) = user_id);
create policy attempt_answers_select_own on public.attempt_answers
  for select to authenticated using ((select auth.uid()) = user_id);
create policy question_progress_select_own on public.question_progress
  for select to authenticated using ((select auth.uid()) = user_id);

revoke all on public.profiles from anon, authenticated;
revoke all on public.attempts from anon, authenticated;
revoke all on public.attempt_answers from anon, authenticated;
revoke all on public.question_progress from anon, authenticated;
grant select on public.profiles, public.attempts, public.attempt_answers, public.question_progress to authenticated;

create or replace function public.create_profile_for_auth_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(id) values (new.id) on conflict (id) do nothing;
  return new;
end;
$$;

revoke execute on function public.create_profile_for_auth_user() from public, anon, authenticated;

create trigger create_profile_after_auth_user
after insert on auth.users
for each row execute function public.create_profile_for_auth_user();

insert into public.profiles(id)
select id from auth.users
on conflict (id) do nothing;

create or replace function public.reject_attempt_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(old.user_id, old.exam_id, old.exam_version_id, old.exam_version_path, old.question_ids, old.kind, old.principal)
     is distinct from
     row(new.user_id, new.exam_id, new.exam_version_id, new.exam_version_path, new.question_ids, new.kind, new.principal) then
    raise exception 'La identidad fijada del intento no se puede modificar.';
  end if;
  return new;
end;
$$;

create trigger attempts_keep_pinned_identity
before update on public.attempts
for each row execute function public.reject_attempt_identity_change();

create or replace function public.reject_confirmed_answer_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'Las respuestas confirmadas son inmutables.';
end;
$$;

create trigger attempt_answers_are_immutable
before update or delete on public.attempt_answers
for each row execute function public.reject_confirmed_answer_change();

revoke execute on function public.reject_attempt_identity_change() from public, anon, authenticated;
revoke execute on function public.reject_confirmed_answer_change() from public, anon, authenticated;

create or replace function public.start_or_resume_normal_attempt(
  p_exam_id text,
  p_exam_version_id text,
  p_exam_version_path text,
  p_question_ids text[]
)
returns public.attempts
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
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
     or (select count(distinct question_id) from unnest(p_question_ids) as questions(question_id)) <> cardinality(p_question_ids) then
    raise exception 'El orden de preguntas no es válido.';
  end if;

  insert into public.profiles(id) values (v_user_id) on conflict (id) do nothing;

  select * into v_attempt
  from public.attempts
  where user_id = v_user_id and exam_id = p_exam_id and status = 'active'
    and kind = 'normal' and principal
  for update;

  if found then return v_attempt; end if;

  begin
    insert into public.attempts(user_id, exam_id, exam_version_id, exam_version_path, question_ids)
    values (v_user_id, p_exam_id, p_exam_version_id, p_exam_version_path, p_question_ids)
    returning * into v_attempt;
  exception when unique_violation then
    select * into v_attempt
    from public.attempts
    where user_id = v_user_id and exam_id = p_exam_id and status = 'active'
      and kind = 'normal' and principal;
  end;

  return v_attempt;
end;
$$;

create or replace function public.save_normal_attempt(
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
  v_attempt public.attempts;
begin
  if auth.uid() is null then raise exception 'Se requiere autenticación.'; end if;
  if p_active_seconds < 0 or p_active_seconds > 300 then
    raise exception 'El incremento de tiempo no es válido.';
  end if;

  update public.attempts
  set current_position = p_position,
      active_seconds = active_seconds + p_active_seconds,
      is_paused = p_is_paused,
      updated_at = now()
  where id = p_attempt_id and user_id = auth.uid() and status = 'active'
    and p_position >= 0 and p_position < cardinality(question_ids)
  returning * into v_attempt;

  if not found then raise exception 'No existe un intento activo propio en esa posición.'; end if;
  return v_attempt;
end;
$$;

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
  v_sequence integer;
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

  select count(*) + 1 into v_sequence
  from public.attempt_answers
  where attempt_id = p_attempt_id and question_id = p_question_id;

  insert into public.attempt_answers(
    id, attempt_id, user_id, question_id, answer_sequence,
    selected_option, correct_option, is_correct,
    newly_pending_failure, newly_mastered
  ) values (
    p_confirmation_id, p_attempt_id, v_user_id, p_question_id, v_sequence,
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
    where coalesce((
      select answer.is_correct
      from public.attempt_answers answer
      where answer.attempt_id = v_attempt.id and answer.question_id = questions.question_id
      order by answer.answer_sequence desc
      limit 1
    ), false) is not true;
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

revoke execute on function public.start_or_resume_normal_attempt(text, text, text, text[]) from public, anon;
revoke execute on function public.save_normal_attempt(uuid, integer, integer, boolean) from public, anon;
revoke execute on function public.confirm_normal_answer(uuid, uuid, text, text, text) from public, anon;
revoke execute on function public.complete_normal_attempt(uuid) from public, anon;
grant execute on function public.start_or_resume_normal_attempt(text, text, text, text[]) to authenticated;
grant execute on function public.save_normal_attempt(uuid, integer, integer, boolean) to authenticated;
grant execute on function public.confirm_normal_answer(uuid, uuid, text, text, text) to authenticated;
grant execute on function public.complete_normal_attempt(uuid) to authenticated;
