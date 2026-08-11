alter table public.official_exam_versions
  add constraint official_exam_versions_canonical_path_check
  check (
    exam_version_path = exam_id || '/versions/' || exam_version_id || '.json'
  );

create function public.protect_official_exam_version_content()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Los registros oficiales históricos no se pueden eliminar.';
  end if;
  if row(
    old.exam_id,
    old.exam_version_id,
    old.exam_version_path,
    old.duration_minutes,
    old.question_ids,
    old.answer_key
  ) is distinct from row(
    new.exam_id,
    new.exam_version_id,
    new.exam_version_path,
    new.duration_minutes,
    new.question_ids,
    new.answer_key
  ) then
    raise exception 'El contenido canónico del registro oficial es inmutable.';
  end if;
  return new;
end;
$$;

create trigger official_exam_versions_keep_canonical_content
before update or delete on public.official_exam_versions
for each row execute function public.protect_official_exam_version_content();

revoke all on function public.protect_official_exam_version_content()
  from public, anon, authenticated;
