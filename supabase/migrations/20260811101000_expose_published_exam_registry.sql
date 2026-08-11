create function public.get_published_official_exam_versions()
returns table (
  exam_id text,
  exam_version_id text,
  exam_version_path text
)
language sql
stable
security definer
set search_path = ''
as $$
  select official.exam_id, official.exam_version_id, official.exam_version_path
  from public.official_exam_versions official
  where official.is_published
  order by official.exam_id
$$;

revoke all on function public.get_published_official_exam_versions()
  from public, anon, authenticated;
grant execute on function public.get_published_official_exam_versions()
  to authenticated;
