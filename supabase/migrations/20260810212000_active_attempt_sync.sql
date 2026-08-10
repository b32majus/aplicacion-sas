alter table public.attempts
  add column revision bigint not null default 0 check (revision >= 0);

create table public.attempt_sync_operations (
  id uuid primary key,
  attempt_id uuid not null,
  user_id uuid not null,
  base_revision bigint not null check (base_revision >= 0),
  pending_snapshot jsonb not null check (jsonb_typeof(pending_snapshot) = 'object'),
  result_revision bigint not null check (result_revision > base_revision),
  result jsonb not null check (jsonb_typeof(result) = 'object'),
  synced_at timestamptz not null default now(),
  foreign key (attempt_id, user_id) references public.attempts(id, user_id) on delete cascade
);

alter table public.attempt_sync_operations enable row level security;
revoke all on public.attempt_sync_operations from public, anon, authenticated;

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
declare
  v_user_id uuid := auth.uid();
  v_attempt public.attempts;
  v_existing public.attempt_sync_operations;
  v_increment jsonb;
  v_increment_count integer;
  v_confirmation jsonb;
  v_confirmation_count integer;
  v_exam_answer jsonb;
  v_exam_answer_count integer;
  v_existing_answer public.attempt_answers;
  v_answer_sequence integer;
  v_position integer;
  v_is_paused boolean;
  v_finalize boolean;
  v_answers jsonb;
  v_summary jsonb := null;
  v_result jsonb;
begin
  if v_user_id is null then raise exception 'Se requiere autenticación.'; end if;
  if p_sync_id is null then raise exception 'La identidad de sincronización es obligatoria.'; end if;
  if p_base_revision is null or p_base_revision < 0 then
    raise exception 'La revisión base no es válida.';
  end if;
  if jsonb_typeof(p_pending_snapshot) <> 'object' then
    raise exception 'El snapshot pendiente no es válido.';
  end if;

  select * into v_existing
  from public.attempt_sync_operations
  where id = p_sync_id;
  if found then
    if v_existing.user_id <> v_user_id
       or v_existing.attempt_id <> p_attempt_id
       or v_existing.base_revision <> p_base_revision
       or v_existing.pending_snapshot <> p_pending_snapshot then
      raise exception 'La clave idempotente ya pertenece a otra sincronización.';
    end if;
    return v_existing.result;
  end if;

  select * into v_attempt
  from public.attempts
  where id = p_attempt_id and user_id = v_user_id
  for update;
  if not found then raise exception 'No existe un intento propio.'; end if;
  if v_attempt.status <> 'active' then raise exception 'El intento ya no está activo.'; end if;
  if v_attempt.revision <> p_base_revision then
    raise exception 'STALE_ATTEMPT_REVISION: la revisión remota vigente es %.', v_attempt.revision;
  end if;
  if p_pending_snapshot->>'kind' is distinct from v_attempt.kind then
    raise exception 'El tipo del snapshot no coincide con el intento.';
  end if;

  v_position := (p_pending_snapshot->>'position')::integer;
  v_is_paused := (p_pending_snapshot->>'is_paused')::boolean;
  v_finalize := coalesce((p_pending_snapshot->>'finalize')::boolean, false);
  if v_position is null or v_position < 0 or v_position >= cardinality(v_attempt.question_ids)
     or v_is_paused is null then
    raise exception 'El estado pendiente del intento no es válido.';
  end if;
  if jsonb_typeof(p_pending_snapshot->'active_increments') <> 'array' then
    raise exception 'Los incrementos de tiempo pendientes no son válidos.';
  end if;
  select count(*) into v_increment_count
  from jsonb_array_elements(p_pending_snapshot->'active_increments');
  if v_increment_count > 288
     or exists (
       select 1
       from jsonb_array_elements(p_pending_snapshot->'active_increments') increment(value)
       where nullif(increment.value->>'id', '') is null
          or (increment.value->>'seconds')::integer not between 1 and 300
     )
     or (
       select count(distinct increment.value->>'id')
       from jsonb_array_elements(p_pending_snapshot->'active_increments') increment(value)
     ) <> v_increment_count then
    raise exception 'Los incrementos de tiempo pendientes no son válidos.';
  end if;

  if v_attempt.kind = 'exam' and v_increment_count <> 0 then
    raise exception 'El Modo examen no admite incrementos de Tiempo activo.';
  end if;
  if jsonb_typeof(p_pending_snapshot->'study_confirmations') <> 'array'
     or jsonb_typeof(p_pending_snapshot->'exam_answers') <> 'array' then
    raise exception 'Los cambios pendientes no son válidos.';
  end if;
  select count(*) into v_confirmation_count
  from jsonb_array_elements(p_pending_snapshot->'study_confirmations');
  if v_confirmation_count > cardinality(v_attempt.question_ids)
     or exists (
       select 1
       from jsonb_array_elements(p_pending_snapshot->'study_confirmations') confirmation(value)
       where nullif(confirmation.value->>'id', '') is null
          or nullif(confirmation.value->>'question_id', '') is null
          or length(confirmation.value->>'question_id') > 300
          or nullif(confirmation.value->>'selected_option', '') is null
          or length(confirmation.value->>'selected_option') > 20
          or nullif(confirmation.value->>'correct_option', '') is null
          or length(confirmation.value->>'correct_option') > 20
     )
     or (
       select count(distinct confirmation.value->>'id')
       from jsonb_array_elements(p_pending_snapshot->'study_confirmations') confirmation(value)
     ) <> v_confirmation_count
     or (
       select count(distinct confirmation.value->>'question_id')
       from jsonb_array_elements(p_pending_snapshot->'study_confirmations') confirmation(value)
     ) <> v_confirmation_count then
    raise exception 'Las confirmaciones pendientes no son válidas.';
  end if;
  if v_attempt.kind = 'exam' and v_confirmation_count <> 0 then
    raise exception 'El Modo examen no admite confirmaciones de estudio.';
  end if;
  if v_attempt.kind <> 'exam'
     and jsonb_array_length(p_pending_snapshot->'exam_answers') <> 0 then
    raise exception 'El estudio no admite borradores de examen.';
  end if;

  select count(*) into v_exam_answer_count
  from jsonb_array_elements(p_pending_snapshot->'exam_answers');
  if v_exam_answer_count > cardinality(v_attempt.question_ids)
     or exists (
       select 1
       from jsonb_array_elements(p_pending_snapshot->'exam_answers') answer(value)
       where nullif(answer.value->>'id', '') is null
          or nullif(answer.value->>'question_id', '') is null
          or length(answer.value->>'question_id') > 300
          or not (answer.value ? 'selected_option')
          or jsonb_typeof(answer.value->'selected_option') not in ('string', 'null')
          or length(answer.value->>'selected_option') > 20
     )
     or (
       select count(distinct answer.value->>'id')
       from jsonb_array_elements(p_pending_snapshot->'exam_answers') answer(value)
     ) <> v_exam_answer_count
     or (
       select count(distinct answer.value->>'question_id')
       from jsonb_array_elements(p_pending_snapshot->'exam_answers') answer(value)
     ) <> v_exam_answer_count then
    raise exception 'Las respuestas pendientes de examen no son válidas.';
  end if;

  if v_attempt.kind <> 'exam' then
    for v_confirmation in
      select value from jsonb_array_elements(p_pending_snapshot->'study_confirmations')
    loop
      if v_attempt.kind = 'failed' then
        perform public.confirm_failed_answer(
          (v_confirmation->>'id')::uuid,
          p_attempt_id,
          v_confirmation->>'question_id',
          v_confirmation->>'selected_option',
          v_confirmation->>'correct_option'
        );
      else
        perform public.confirm_normal_answer(
          (v_confirmation->>'id')::uuid,
          p_attempt_id,
          v_confirmation->>'question_id',
          v_confirmation->>'selected_option',
          v_confirmation->>'correct_option'
        );
      end if;
    end loop;

    if v_increment_count = 0 then
      perform public.save_normal_attempt(
        p_sync_id, p_attempt_id, v_position, 0, v_is_paused
      );
    else
      for v_increment in
        select value from jsonb_array_elements(p_pending_snapshot->'active_increments')
      loop
        perform public.save_normal_attempt(
          (v_increment->>'id')::uuid,
          p_attempt_id,
          v_position,
          (v_increment->>'seconds')::integer,
          v_is_paused
        );
      end loop;
    end if;

    if v_finalize then
      if v_attempt.kind = 'failed' then
        v_summary := public.complete_failed_attempt(p_attempt_id);
      else
        v_summary := public.complete_normal_attempt(p_attempt_id);
      end if;
    end if;
  else
    if clock_timestamp() >= v_attempt.deadline_at and v_exam_answer_count <> 0 and not v_finalize then
      raise exception 'El deadline del Modo examen ya ha vencido.';
    end if;
    for v_exam_answer in
      select value from jsonb_array_elements(p_pending_snapshot->'exam_answers')
    loop
      if not (v_exam_answer->>'question_id' = any(v_attempt.question_ids)) then
        raise exception 'La pregunta no pertenece al Conjunto puntuable definitivo.';
      end if;

      select * into v_existing_answer
      from public.attempt_answers
      where id = (v_exam_answer->>'id')::uuid;
      if found then
        if v_existing_answer.attempt_id <> p_attempt_id
           or v_existing_answer.user_id <> v_user_id
           or v_existing_answer.question_id <> v_exam_answer->>'question_id'
           or v_existing_answer.selected_option is distinct from v_exam_answer->>'selected_option'
           or v_existing_answer.correct_option is not null
           or v_existing_answer.is_correct is not null then
          raise exception 'La clave idempotente ya pertenece a otro cambio de respuesta.';
        end if;
      elsif clock_timestamp() < v_attempt.deadline_at then
        perform public.save_exam_answer(
          (v_exam_answer->>'id')::uuid,
          p_attempt_id,
          v_exam_answer->>'question_id',
          v_exam_answer->>'selected_option',
          v_position
        );
      else
        select coalesce(max(answer_sequence), 0) + 1 into v_answer_sequence
        from public.attempt_answers
        where attempt_id = p_attempt_id
          and question_id = v_exam_answer->>'question_id';
        insert into public.attempt_answers(
          id, attempt_id, user_id, question_id, answer_sequence,
          selected_option, correct_option, is_correct
        ) values (
          (v_exam_answer->>'id')::uuid,
          p_attempt_id,
          v_user_id,
          v_exam_answer->>'question_id',
          v_answer_sequence,
          v_exam_answer->>'selected_option',
          null,
          null
        );
      end if;
    end loop;

    update public.attempts
    set current_position = v_position, updated_at = now()
    where id = p_attempt_id;
    if v_finalize then
      v_summary := public.finish_exam_attempt(p_attempt_id);
    end if;
  end if;

  update public.attempts
  set revision = revision + 1, updated_at = now()
  where id = p_attempt_id
  returning * into v_attempt;

  select coalesce(jsonb_agg(to_jsonb(answer) order by answer.confirmed_at, answer.id), '[]'::jsonb)
  into v_answers
  from public.attempt_answers answer
  where answer.attempt_id = p_attempt_id;

  v_result := jsonb_build_object(
    'attempt', to_jsonb(v_attempt),
    'answers', v_answers,
    'summary', v_summary
  );
  insert into public.attempt_sync_operations(
    id, attempt_id, user_id, base_revision, pending_snapshot, result_revision, result
  ) values (
    p_sync_id, p_attempt_id, v_user_id, p_base_revision,
    p_pending_snapshot, v_attempt.revision, v_result
  );
  return v_result;
end;
$$;

revoke execute on function public.sync_active_attempt(uuid, uuid, bigint, jsonb)
  from public, anon;
grant execute on function public.sync_active_attempt(uuid, uuid, bigint, jsonb)
  to authenticated;
