const STORAGE_VERSION = 1;
const STORAGE_PREFIX = "sas-active-attempt:";
const MAX_ACTIVE_INCREMENTS = 288;

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function isNetworkError(error) {
  return /fetch|network|connection|conexión/i.test(`${error?.message || error || ""}`);
}

function isStaleError(error) {
  return /STALE_ATTEMPT_REVISION/.test(`${error?.message || error || ""}`);
}

function isInactiveError(error) {
  return /intento ya no está activo/i.test(`${error?.message || error || ""}`);
}

function isDeadlineError(error) {
  return /deadline.*vencido/i.test(`${error?.message || error || ""}`);
}

function pendingIsEmpty(pending) {
  return !pending.state_dirty
    && pending.active_increments.length === 0
    && pending.study_confirmations.length === 0
    && pending.exam_answers.length === 0
    && !pending.finalize;
}

function canonicalSnapshot(attempt, answers, context = {}) {
  const snapshot = {
    attempt: clone(attempt),
    answers: clone(answers),
    questions: clone(context.questions || null),
  };
  if (
    snapshot.attempt.kind === "exam"
    && !Number.isFinite(snapshot.attempt.server_clock_offset_ms)
    && Number.isFinite(context.attempt?.server_clock_offset_ms)
  ) {
    snapshot.attempt.server_clock_offset_ms = context.attempt.server_clock_offset_ms;
  }
  if (attempt.kind !== "exam") return snapshot;

  const latest = new Map();
  for (const answer of snapshot.answers) {
    const previous = latest.get(answer.question_id);
    if (!previous || answer.answer_sequence >= previous.answer_sequence) {
      latest.set(answer.question_id, answer);
    }
  }
  snapshot.answers = [...latest.values()];
  return snapshot;
}

export class ActiveAttemptPersistence {
  constructor({ client, storage, userId, onStatus, onReconnect }) {
    this.client = client;
    this.storage = storage;
    this.userId = userId;
    this.onStatus = onStatus;
    this.onReconnect = onReconnect;
    this.storageKey = `${STORAGE_PREFIX}${userId}`;
    this.online = navigator.onLine;
    this.offlineEvent = !navigator.onLine;
    this.conflict = false;
    this.remote = null;
    this.record = this.#load();
    this.syncPromise = null;
    this.inFlightActiveIds = new Set();
    this.handleOffline = () => {
      this.online = false;
      this.offlineEvent = true;
      this.#emit();
    };
    this.handleOnline = () => {
      this.online = true;
      this.offlineEvent = false;
      this.#emit();
      this.onReconnect?.();
    };
    window.addEventListener("offline", this.handleOffline);
    window.addEventListener("online", this.handleOnline);
    this.#emit();
  }

  destroy() {
    window.removeEventListener("offline", this.handleOffline);
    window.removeEventListener("online", this.handleOnline);
  }

  get hasPending() { return Boolean(this.record && !pendingIsEmpty(this.record.pending)); }
  get pendingActiveSeconds() {
    return this.record?.pending.active_increments.reduce((total, item) => total + item.seconds, 0) || 0;
  }

  begin(attempt, answers, context = {}) {
    this.remote = canonicalSnapshot(attempt, answers, context);
    if (!this.record) return this.view();
    if (this.record.attempt_id !== attempt.id) {
      throw new Error("Hay cambios pendientes de otro intento activo. Recupéralos antes de continuar.");
    }
    if (attempt.revision === this.record.base_revision) {
      this.record.canonical = clone(this.remote);
      this.#persist();
    }
    this.#emit();
    return this.view();
  }

  restore({ examId, kind }) {
    if (!this.record) return null;
    const attempt = this.record.canonical.attempt;
    if ((examId && attempt.exam_id !== examId) || (kind && attempt.kind !== kind)) return null;
    this.online = false;
    this.remote = clone(this.record.canonical);
    this.#emit();
    return this.view();
  }

  view() {
    const canonical = this.record?.canonical || this.remote;
    if (!canonical) return null;
    return {
      attempt: clone(canonical.attempt),
      answers: clone(canonical.answers),
      questions: clone(canonical.questions),
      pending: clone(this.record?.pending || null),
    };
  }

  queueStudyConfirmation(payload, state) {
    const record = this.#ensureRecord(state);
    record.pending.study_confirmations = record.pending.study_confirmations
      .filter(({ question_id: questionId }) => questionId !== payload.p_question_id);
    record.pending.study_confirmations.push({
      id: payload.p_confirmation_id,
      question_id: payload.p_question_id,
      selected_option: payload.p_selected_option,
      correct_option: payload.p_correct_option,
    });
    this.#touchState(record, state);
  }

  queueExamAnswer({ id, questionId, selectedOption }, state) {
    const record = this.#ensureRecord(state);
    record.pending.exam_answers = record.pending.exam_answers
      .filter(({ question_id: pendingQuestionId }) => pendingQuestionId !== questionId);
    record.pending.exam_answers.push({ id, question_id: questionId, selected_option: selectedOption });
    this.#touchState(record, state);
  }

  queueState(state) {
    const record = this.#ensureRecord(state);
    this.#touchState(record, state);
  }

  queueActiveSecond(state) {
    const record = this.#ensureRecord(state);
    let increment = record.pending.active_increments.at(-1);
    if (!increment || increment.seconds >= 300 || this.inFlightActiveIds.has(increment.id)) {
      if (record.pending.active_increments.length >= MAX_ACTIVE_INCREMENTS) {
        throw new Error("El corte supera la recuperación temporal admitida. Reconecta antes de continuar.");
      }
      increment = { id: crypto.randomUUID(), seconds: 0 };
      record.pending.active_increments.push(increment);
    }
    increment.seconds += 1;
    record.serial += 1;
    record.pending.position = state.position;
    record.pending.is_paused = state.isPaused;
    this.#persist();
  }

  queueFinalization(state) {
    const record = this.#ensureRecord(state);
    record.pending.finalize = true;
    this.#touchState(record, state);
  }

  async sync() {
    if (!this.hasPending) return null;
    if (this.offlineEvent || !navigator.onLine) {
      this.online = false;
      this.#emit();
      throw new Error("Sin conexión.");
    }
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.#syncLoop().finally(() => { this.syncPromise = null; });
    return this.syncPromise;
  }

  async #syncLoop() {
    let latest = null;
    while (this.hasPending) {
      const sent = clone(this.record.retry || this.record);
      this.inFlightActiveIds = new Set(sent.pending.active_increments.map(({ id }) => id));
      const payload = {
        kind: sent.kind,
        position: sent.pending.position,
        is_paused: sent.pending.is_paused,
        active_increments: sent.pending.active_increments,
        study_confirmations: sent.pending.study_confirmations,
        exam_answers: sent.pending.exam_answers,
        finalize: sent.pending.finalize,
      };
      const { data, error } = await this.client.rpc("sync_active_attempt", {
        p_sync_id: sent.sync_id,
        p_attempt_id: sent.attempt_id,
        p_base_revision: sent.base_revision,
        p_pending_snapshot: payload,
      });
      this.inFlightActiveIds.clear();
      if (error) {
        if (isStaleError(error) || isInactiveError(error)) return this.#recoverCanonical();
        if (isDeadlineError(error) && sent.pending.exam_answers.length > 0) {
          const recovered = await this.#recoverCanonical();
          if (recovered.attempt.status !== "active") return recovered;
          this.queueFinalization({
            position: recovered.attempt.current_position,
            isPaused: recovered.attempt.is_paused,
          });
          continue;
        }
        if (isDeadlineError(error) && this.record.pending.finalize && !sent.pending.finalize) {
          if (this.record.retry?.sync_id === sent.sync_id) {
            this.record.retry = null;
            this.record.sync_id = crypto.randomUUID();
            this.#persist();
          }
          continue;
        }
        if (isNetworkError(error) || !navigator.onLine) {
          this.online = false;
          if (!this.record.retry) {
            this.record.retry = sent;
            this.#persist();
          }
        }
        this.#emit();
        throw error;
      }

      latest = Array.isArray(data) ? data[0] : data;
      this.online = true;
      this.conflict = false;
      this.remote = canonicalSnapshot(latest.attempt, latest.answers, this.remote);
      this.#removeSent(sent, latest);
      if (latest.attempt.status !== "active") {
        this.storage.removeItem(this.storageKey);
        this.record = null;
        break;
      }
    }
    this.#emit();
    return latest;
  }

  async #recoverCanonical() {
    const attemptId = this.record.attempt_id;
    const [{ data: attemptRows, error: attemptError }, { data: answers, error: answersError }] = await Promise.all([
      this.client.from("attempts").select("*").eq("id", attemptId),
      this.client.from("attempt_answers")
        .select("id,question_id,answer_sequence,selected_option,correct_option,is_correct,newly_pending_failure,newly_mastered,confirmed_at")
        .eq("attempt_id", attemptId)
        .order("confirmed_at", { ascending: true }),
    ]);
    if (attemptError) throw attemptError;
    if (answersError) throw answersError;
    const attempt = attemptRows?.[0];
    if (!attempt) throw new Error("El intento remoto más reciente ya no está disponible.");
    this.storage.removeItem(this.storageKey);
    this.record = null;
    this.remote = canonicalSnapshot(attempt, answers, this.remote);
    this.online = true;
    this.conflict = true;
    this.#emit();
    return { attempt, answers, summary: null, conflict: true };
  }

  #removeSent(sent, result) {
    if (!this.record || this.record.attempt_id !== sent.attempt_id) return;
    const current = this.record;
    current.retry = null;
    const removeMatching = (items, sentItems) => {
      const sentById = new Map(sentItems.map((item) => [item.id, JSON.stringify(item)]));
      return items.filter((item) => sentById.get(item.id) !== JSON.stringify(item));
    };
    current.pending.active_increments = removeMatching(
      current.pending.active_increments,
      sent.pending.active_increments,
    );
    current.pending.study_confirmations = removeMatching(
      current.pending.study_confirmations,
      sent.pending.study_confirmations,
    );
    current.pending.exam_answers = removeMatching(current.pending.exam_answers, sent.pending.exam_answers);
    if (current.serial === sent.serial) current.pending.state_dirty = false;
    if (sent.pending.finalize) current.pending.finalize = false;
    current.base_revision = result.attempt.revision;
    current.canonical = canonicalSnapshot(result.attempt, result.answers, current.canonical);
    current.sync_id = crypto.randomUUID();
    if (pendingIsEmpty(current.pending)) {
      this.storage.removeItem(this.storageKey);
      this.record = null;
    } else {
      this.#persist();
    }
  }

  #ensureRecord(state) {
    if (!this.remote) throw new Error("No hay un intento activo preparado para persistir.");
    if (!this.record) {
      this.record = {
        version: STORAGE_VERSION,
        attempt_id: this.remote.attempt.id,
        kind: this.remote.attempt.kind,
        base_revision: this.remote.attempt.revision,
        sync_id: crypto.randomUUID(),
        serial: 0,
        canonical: clone(this.remote),
        pending: {
          position: state.position,
          is_paused: state.isPaused,
          state_dirty: false,
          active_increments: [],
          study_confirmations: [],
          exam_answers: [],
          finalize: false,
        },
      };
    }
    return this.record;
  }

  #touchState(record, state) {
    record.pending.position = state.position;
    record.pending.is_paused = state.isPaused;
    record.pending.state_dirty = true;
    record.serial += 1;
    this.#persist();
  }

  #load() {
    try {
      const record = JSON.parse(this.storage.getItem(this.storageKey) || "null");
      if (!record || record.version !== STORAGE_VERSION || !record.attempt_id
          || !record.canonical?.attempt || !record.pending
          || record.pending.active_increments.length > MAX_ACTIVE_INCREMENTS) return null;
      return record;
    } catch {
      this.storage.removeItem(this.storageKey);
      return null;
    }
  }

  #persist() {
    this.storage.setItem(this.storageKey, JSON.stringify(this.record));
    this.#emit();
  }

  #emit() {
    this.onStatus?.({ online: this.online, pending: this.hasPending, conflict: this.conflict });
  }
}
