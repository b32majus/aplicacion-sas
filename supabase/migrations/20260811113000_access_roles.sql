create table public.app_access_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role in ('participant', 'test', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_access_roles enable row level security;
revoke all on table public.app_access_roles from public, anon, authenticated;

create function public.assign_available_shared_profile_alias(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_alias text;
begin
  if not exists (select 1 from public.profiles where id = p_user_id) then
    return;
  end if;

  lock table public.shared_profile_aliases in exclusive mode;

  if exists (select 1 from public.shared_profile_aliases where user_id = p_user_id) then
    return;
  end if;

  select candidate.alias into v_alias
  from unnest(array['Participante 1', 'Participante 2', 'Participante 3'])
    with ordinality as candidate(alias, position)
  where not exists (
    select 1
    from public.shared_profile_aliases assigned
    where assigned.alias = candidate.alias
  )
  order by candidate.position
  limit 1;

  if v_alias is null then
    raise exception 'El Dashboard compartido admite exactamente tres perfiles.';
  end if;

  insert into public.shared_profile_aliases(user_id, alias) values (p_user_id, v_alias);
end;
$$;

revoke all on function public.assign_available_shared_profile_alias(uuid)
  from public, anon, authenticated;

create or replace function public.assign_shared_profile_alias()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text;
begin
  select access.role into v_role
  from public.app_access_roles access
  where access.user_id = new.id;

  if v_role in ('test', 'admin') then
    return new;
  end if;

  perform public.assign_available_shared_profile_alias(new.id);
  return new;
end;
$$;

revoke all on function public.assign_shared_profile_alias()
  from public, anon, authenticated;

create function public.apply_app_access_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from auth.users where id = old.user_id) then
      perform public.assign_available_shared_profile_alias(old.user_id);
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' then
    if new.user_id is distinct from old.user_id then
      raise exception 'El usuario de un rol de acceso no puede cambiarse.';
    end if;
    new.updated_at := now();
    if new.role is not distinct from old.role then
      return new;
    end if;
  end if;

  if new.role in ('test', 'admin') then
    delete from public.shared_profile_aliases where user_id = new.user_id;
  else
    perform public.assign_available_shared_profile_alias(new.user_id);
  end if;

  return new;
end;
$$;

revoke all on function public.apply_app_access_role()
  from public, anon, authenticated;

create trigger app_access_roles_apply_role
before insert or update or delete on public.app_access_roles
for each row execute function public.apply_app_access_role();

insert into public.app_access_roles(user_id, role)
select id, 'test'
from auth.users;

delete from public.shared_profile_aliases alias
using public.app_access_roles access
where access.user_id = alias.user_id
  and access.role in ('test', 'admin');
