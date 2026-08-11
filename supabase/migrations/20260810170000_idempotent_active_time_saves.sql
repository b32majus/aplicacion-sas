create table public.attempt_save_operations (
  id uuid primary key,
  attempt_id uuid not null,
  user_id uuid not null,
  position integer not null check (position >= 0),
  active_seconds integer not null check (active_seconds between 0 and 300),
  is_paused boolean not null,
  saved_at timestamptz not null default now(),
  foreign key (attempt_id, user_id) references public.attempts(id, user_id) on delete cascade
);

alter table public.attempt_save_operations enable row level security;
revoke all on public.attempt_save_operations from anon, authenticated;

drop function public.save_normal_attempt(uuid, integer, integer, boolean);

create function public.save_normal_attempt(
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
      v_existing.attempt_id,
      v_existing.user_id,
      v_existing.position,
      v_existing.active_seconds,
      v_existing.is_paused
    ) is distinct from row(
      p_attempt_id,
      v_user_id,
      p_position,
      p_active_seconds,
      p_is_paused
    ) then
      raise exception 'La clave idempotente ya pertenece a otro guardado.';
    end if;
    return v_attempt;
  end if;

  if v_attempt.status <> 'active'
     or p_position is null
     or p_position < 0
     or p_position >= cardinality(v_attempt.question_ids) then
    raise exception 'No existe un intento activo propio en esa posición.';
  end if;

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

revoke execute on function public.save_normal_attempt(uuid, uuid, integer, integer, boolean) from public, anon;
grant execute on function public.save_normal_attempt(uuid, uuid, integer, integer, boolean) to authenticated;
