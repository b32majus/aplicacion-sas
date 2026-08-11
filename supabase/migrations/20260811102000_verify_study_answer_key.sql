create function public.verify_official_study_answer_key()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_attempt public.attempts;
  v_correct_option text;
begin
  select * into v_attempt
  from public.attempts
  where id = new.attempt_id;

  if v_attempt.origin <> 'official' or v_attempt.kind = 'exam' then
    return new;
  end if;

  if v_attempt.kind = 'normal' then
    select official.answer_key ->> new.question_id into v_correct_option
    from public.official_exam_versions official
    where official.exam_id = v_attempt.exam_id
      and official.exam_version_id = v_attempt.exam_version_id
      and official.exam_version_path = v_attempt.exam_version_path
      and new.question_id = any(official.question_ids);
  else
    select official.answer_key ->> source.source_question_id into v_correct_option
    from public.attempt_question_sources source
    join public.official_exam_versions official
      on official.exam_id = source.exam_id
     and official.exam_version_id = source.exam_version_id
     and official.exam_version_path = source.exam_version_path
     and source.source_question_id = any(official.question_ids)
    where source.attempt_id = v_attempt.id
      and source.question_id = new.question_id;
  end if;

  if v_correct_option is null or new.correct_option is distinct from v_correct_option then
    raise exception 'La respuesta correcta no coincide con la versión oficial fijada.';
  end if;
  return new;
end;
$$;

create trigger attempt_answers_verify_official_study_key
before insert on public.attempt_answers
for each row execute function public.verify_official_study_answer_key();

revoke all on function public.verify_official_study_answer_key()
  from public, anon, authenticated;
