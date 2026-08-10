alter table public.attempts
  add column strategy text not null default 'normal'
    check (strategy in ('normal', 'random')),
  add column abandoned_at timestamptz;

alter table public.attempts drop constraint attempts_status_check;
alter table public.attempts drop constraint attempts_check1;
alter table public.attempts
  add constraint attempts_status_check check (status in ('active', 'completed', 'abandoned')),
  add constraint attempts_finished_state_check check (
    (status = 'active' and completed_at is null and abandoned_at is null)
    or (status = 'completed' and completed_at is not null and abandoned_at is null)
    or (status = 'abandoned' and completed_at is null and abandoned_at is not null)
  );

create or replace function public.reject_attempt_identity_change()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if row(
    old.user_id, old.exam_id, old.exam_version_id, old.exam_version_path,
    old.question_ids, old.kind, old.principal, old.strategy
  ) is distinct from row(
    new.user_id, new.exam_id, new.exam_version_id, new.exam_version_path,
    new.question_ids, new.kind, new.principal, new.strategy
  ) then
    raise exception 'La identidad fijada del intento no se puede modificar.';
  end if;
  return new;
end;
$$;

create function public.start_or_replace_principal_attempt(
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
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  if p_exam_id is null or p_exam_version_id is null or p_exam_version_path is null then
    raise exception 'La versión del examen es obligatoria.';
  end if;
  if p_exam_version_path like '/%' or p_exam_version_path like '%..%' or p_exam_version_path not like '%.json' then
    raise exception 'La ruta de versión no es válida.';
  end if;
  if p_strategy is null or p_strategy not in ('normal', 'random') then
    raise exception 'La estrategia principal no es válida.';
  end if;
  if coalesce(cardinality(p_question_ids), 0) = 0
     or cardinality(p_question_ids) > 1000
     or (select count(distinct question_id) from unnest(p_question_ids) as questions(question_id))
        <> cardinality(p_question_ids) then
    raise exception 'El orden de preguntas no es válido.';
  end if;

  insert into public.profiles(id) values (v_user_id) on conflict (id) do nothing;
  perform 1 from public.profiles where id = v_user_id for update;

  select * into v_attempt
  from public.attempts
  where user_id = v_user_id and exam_id = p_exam_id and status = 'active'
    and kind = 'normal' and principal
  for update;

  if found and v_attempt.strategy = p_strategy then return v_attempt; end if;
  if found and not p_replace_active then
    raise exception 'Ya existe un recorrido principal activo con otra estrategia.';
  end if;
  if found then
    update public.attempts
    set status = 'abandoned', abandoned_at = now(), is_paused = false, updated_at = now()
    where id = v_attempt.id;
  end if;

  insert into public.attempts(
    user_id, exam_id, exam_version_id, exam_version_path, question_ids, strategy
  ) values (
    v_user_id, p_exam_id, p_exam_version_id, p_exam_version_path, p_question_ids, p_strategy
  ) returning * into v_attempt;

  return v_attempt;
end;
$$;

create or replace function public.start_or_resume_normal_attempt(
  p_exam_id text,
  p_exam_version_id text,
  p_exam_version_path text,
  p_question_ids text[]
)
returns public.attempts
language sql
security definer
set search_path = ''
as $$
  select public.start_or_replace_principal_attempt(
    p_exam_id,
    p_exam_version_id,
    p_exam_version_path,
    p_question_ids,
    'normal',
    false
  );
$$;

revoke execute on function public.start_or_replace_principal_attempt(text, text, text, text[], text, boolean)
  from public, anon;
grant execute on function public.start_or_replace_principal_attempt(text, text, text, text[], text, boolean)
  to authenticated;
