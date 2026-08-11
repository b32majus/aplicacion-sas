alter function public.sync_active_attempt(uuid, uuid, bigint, jsonb)
  rename to sync_active_attempt_v1;
revoke all on function public.sync_active_attempt_v1(uuid, uuid, bigint, jsonb)
  from public, anon, authenticated;

create function public.bump_attempt_revision_on_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.active_attempt_sync', true) is distinct from 'on'
     and new.revision = old.revision then
    new.revision := old.revision + 1;
  end if;
  return new;
end;
$$;

create trigger attempts_advance_revision
before update on public.attempts
for each row execute function public.bump_attempt_revision_on_update();

create function public.bump_attempt_revision_on_answer()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.active_attempt_sync', true) is distinct from 'on' then
    update public.attempts
    set revision = revision + 1
    where id = new.attempt_id;
  end if;
  return new;
end;
$$;

create trigger attempt_answers_advance_revision
after insert on public.attempt_answers
for each row execute function public.bump_attempt_revision_on_answer();

revoke execute on function public.bump_attempt_revision_on_update()
  from public, anon, authenticated;
revoke execute on function public.bump_attempt_revision_on_answer()
  from public, anon, authenticated;

create function public.sync_active_attempt(
  p_sync_id uuid,
  p_attempt_id uuid,
  p_base_revision bigint,
  p_pending_snapshot jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then raise exception 'Se requiere autenticación.'; end if;
  if p_sync_id is null then raise exception 'La identidad de sincronización es obligatoria.'; end if;

  perform pg_advisory_xact_lock(hashtextextended(p_sync_id::text, 0));
  perform set_config('app.active_attempt_sync', 'on', true);
  return public.sync_active_attempt_v1(
    p_sync_id, p_attempt_id, p_base_revision, p_pending_snapshot
  );
end;
$$;

revoke execute on function public.sync_active_attempt(uuid, uuid, bigint, jsonb)
  from public, anon;
grant execute on function public.sync_active_attempt(uuid, uuid, bigint, jsonb)
  to authenticated;
