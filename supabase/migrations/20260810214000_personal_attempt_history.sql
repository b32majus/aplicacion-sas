create view public.personal_attempt_history
with (security_invoker = true)
as
select
  attempt.id,
  attempt.user_id,
  attempt.created_at,
  coalesce(attempt.completed_at, attempt.abandoned_at) as ended_at,
  attempt.exam_id,
  attempt.exam_version_id,
  attempt.exam_version_path,
  attempt.question_ids,
  attempt.kind,
  attempt.strategy,
  attempt.status,
  attempt.failed_scope_exam_id,
  attempt.active_seconds,
  attempt.started_at,
  attempt.deadline_at,
  attempt.exam_elapsed_ms,
  attempt.score,
  coalesce(attempt.correct_answers, answer_metrics.correct_answers, 0) as correct_answers,
  coalesce(attempt.wrong_answers, answer_metrics.wrong_answers, 0) as wrong_answers,
  attempt.blank_answers,
  coalesce(answer_metrics.answered_questions, 0) as answered_questions
from public.attempts attempt
left join lateral (
  select
    count(*) filter (where latest.is_correct) as correct_answers,
    count(*) filter (where latest.is_correct is false) as wrong_answers,
    count(*) filter (where latest.selected_option is not null) as answered_questions
  from (
    select distinct on (answer.question_id)
      answer.question_id,
      answer.selected_option,
      answer.is_correct
    from public.attempt_answers answer
    where answer.attempt_id = attempt.id
    order by answer.question_id, answer.answer_sequence desc
  ) latest
) answer_metrics on true;

revoke all on public.personal_attempt_history from public, anon, authenticated;
grant select on public.personal_attempt_history to authenticated;
