create function public.get_server_now()
returns timestamptz
language sql
set search_path = ''
as $$
  select clock_timestamp()
$$;

revoke all on function public.get_server_now()
  from public, anon, authenticated;
grant execute on function public.get_server_now()
  to authenticated;
