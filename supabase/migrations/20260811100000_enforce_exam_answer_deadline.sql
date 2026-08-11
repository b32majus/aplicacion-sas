create function public.enforce_exam_answer_deadline()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_attempt public.attempts;
begin
  select * into v_attempt
  from public.attempts
  where id = new.attempt_id
  for update;

  if v_attempt.kind = 'exam'
     and new.correct_option is null
     and new.is_correct is null
     and clock_timestamp() >= v_attempt.deadline_at then
    raise exception 'El deadline del Modo examen ya ha vencido.';
  end if;
  return new;
end;
$$;

create trigger attempt_answers_enforce_exam_deadline
before insert on public.attempt_answers
for each row execute function public.enforce_exam_answer_deadline();

revoke execute on function public.enforce_exam_answer_deadline()
  from public, anon, authenticated;
