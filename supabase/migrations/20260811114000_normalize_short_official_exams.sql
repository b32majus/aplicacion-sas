alter table public.official_exam_versions
  add column nominal_question_count integer;

update public.official_exam_versions
set nominal_question_count = cardinality(question_ids);

alter table public.official_exam_versions
  add constraint official_exam_versions_nominal_count_check
  check (
    nominal_question_count is null
    or nominal_question_count > 0
    and nominal_question_count >= cardinality(question_ids)
  );

create or replace function public.protect_official_exam_version_content()
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
    old.answer_key,
    old.nominal_question_count
  ) is distinct from row(
    new.exam_id,
    new.exam_version_id,
    new.exam_version_path,
    new.duration_minutes,
    new.question_ids,
    new.answer_key,
    new.nominal_question_count
  ) then
    raise exception 'El contenido canónico del registro oficial es inmutable.';
  end if;
  return new;
end;
$$;

create function public.calculate_official_exam_score(
  p_correct integer,
  p_wrong integer,
  p_effective_count integer,
  p_nominal_count integer
)
returns numeric
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_score numeric;
begin
  if p_effective_count <= 0 or p_nominal_count < p_effective_count then
    raise exception 'Los recuentos efectivo y nominal no son válidos.';
  end if;
  v_score := (100.0 / p_nominal_count) * (p_correct - p_wrong / 4.0);
  if p_effective_count < p_nominal_count then
    v_score := v_score * p_nominal_count / p_effective_count;
  end if;
  return round(v_score, 2);
end;
$$;

revoke all on function public.calculate_official_exam_score(integer, integer, integer, integer)
  from public, anon, authenticated;

create or replace function public.finish_exam_attempt(p_attempt_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_origin text;
  v_official public.official_exam_versions;
  v_result jsonb;
  v_score numeric(7, 2);
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;

  select origin into v_origin from public.attempts
  where id = p_attempt_id and user_id = v_user_id;
  if v_origin = 'artificial' then
    return public.finish_artificial_exam_attempt(p_attempt_id);
  end if;

  select official.* into v_official
  from public.attempts attempt
  join public.official_exam_versions official
    on official.exam_id = attempt.exam_id
   and official.exam_version_id = attempt.exam_version_id
   and official.exam_version_path = attempt.exam_version_path
   and official.question_ids = attempt.question_ids
   and official.duration_minutes = attempt.duration_minutes
  where attempt.id = p_attempt_id
    and attempt.user_id = v_user_id
    and attempt.kind = 'exam';
  if not found then raise exception 'No existe un Modo examen oficial propio.'; end if;

  v_result := public.finish_exam_attempt_from_official_key(
    p_attempt_id,
    v_official.answer_key
  );
  v_score := public.calculate_official_exam_score(
    (v_result->>'correct')::integer,
    (v_result->>'wrong')::integer,
    cardinality(v_official.question_ids),
    coalesce(v_official.nominal_question_count, cardinality(v_official.question_ids))
  );
  update public.attempts set score = v_score where id = p_attempt_id;
  return jsonb_set(v_result, '{score}', to_jsonb(v_score));
end;
$$;

revoke execute on function public.finish_exam_attempt(uuid) from public, anon;
grant execute on function public.finish_exam_attempt(uuid) to authenticated;
