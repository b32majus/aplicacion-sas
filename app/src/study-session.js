function latestByQuestion(answers) {
  const latest = new Map();
  for (const answer of [...answers].sort((left, right) => (
    left.answer_sequence - right.answer_sequence
      || String(left.confirmed_at).localeCompare(String(right.confirmed_at))
  ))) {
    latest.set(answer.question_id, answer);
  }
  return latest;
}

export function formatActiveTime(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainder = seconds % 60;
  if (hours) return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  if (minutes) return `${minutes} min ${String(remainder).padStart(2, "0")} s`;
  return `${remainder} s`;
}

export class NormalStudySession {
  constructor(exam, attempt, answers = []) {
    if (exam.id !== attempt.exam_id || exam.version?.id !== attempt.exam_version_id) {
      throw new Error("El intento no coincide con su versión fijada.");
    }

    const activeById = new Map(
      (exam.questions || []).filter(({ active }) => active).map((question) => [question.id, question]),
    );
    if (
      !Array.isArray(attempt.question_ids)
      || attempt.question_ids.length === 0
      || attempt.question_ids.length !== activeById.size
      || attempt.question_ids.some((id) => !activeById.has(id))
      || new Set(attempt.question_ids).size !== attempt.question_ids.length
    ) {
      throw new Error("El intento no conserva un orden de preguntas válido.");
    }

    this.attempt = { ...attempt };
    this.questions = attempt.question_ids.map((id) => activeById.get(id));
    this.index = Math.min(Math.max(attempt.current_position || 0, 0), this.questions.length - 1);
    this.answers = [...answers];
    this.provisional = new Map();
    this.justConfirmedId = null;
  }

  get currentQuestion() { return this.questions[this.index]; }
  get latestAnswers() { return latestByQuestion(this.answers); }
  get pendingIds() {
    const latest = this.latestAnswers;
    return this.questions
      .filter(({ id }) => !latest.has(id))
      .map(({ id }) => id);
  }
  get isResolved() { return this.pendingIds.length === 0; }

  stateFor(questionId) {
    const answer = this.latestAnswers.get(questionId);
    if (!answer) return "pending";
    return answer.is_correct ? "correct" : "incorrect";
  }

  select(optionId) {
    if (!this.currentQuestion.options.some(({ id }) => id === optionId)) {
      throw new Error("La opción elegida no existe.");
    }
    if (this.latestAnswers.has(this.currentQuestion.id) || this.justConfirmedId === this.currentQuestion.id) {
      throw new Error("Esta respuesta ya está corregida.");
    }
    this.provisional.set(this.currentQuestion.id, optionId);
  }

  get selectedOption() { return this.provisional.get(this.currentQuestion.id) || null; }

  applyConfirmation(answer) {
    const duplicate = this.answers.find(({ id }) => id === answer.id);
    if (!duplicate) this.answers.push(answer);
    this.provisional.delete(answer.question_id);
    this.justConfirmedId = answer.question_id;
  }

  goTo(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.questions.length) {
      throw new Error("La posición de estudio no es válida.");
    }
    this.index = index;
    this.justConfirmedId = null;
    return this.currentQuestion;
  }

  nextPending() {
    if (this.isResolved) return null;
    for (let offset = 1; offset <= this.questions.length; offset += 1) {
      const candidate = (this.index + offset) % this.questions.length;
      if (this.stateFor(this.questions[candidate].id) === "pending") return this.goTo(candidate);
    }
    return null;
  }
}

export class ExamSession {
  constructor(exam, attempt, answers = []) {
    if (attempt.kind !== "exam" || exam.id !== attempt.exam_id || exam.version?.id !== attempt.exam_version_id) {
      throw new Error("El intento de examen no coincide con su versión fijada.");
    }

    const activeQuestions = (exam.questions || []).filter(({ active }) => active);
    const activeById = new Map(activeQuestions.map((question) => [question.id, question]));
    if (
      !Array.isArray(attempt.question_ids)
      || attempt.question_ids.length !== activeQuestions.length
      || attempt.question_ids.some((id) => !activeById.has(id))
      || new Set(attempt.question_ids).size !== attempt.question_ids.length
    ) {
      throw new Error("El intento no conserva el Conjunto puntuable definitivo.");
    }

    this.attempt = { ...attempt };
    this.questions = attempt.question_ids.map((id) => activeById.get(id));
    this.index = Math.min(Math.max(attempt.current_position || 0, 0), this.questions.length - 1);
    this.answers = [...answers];
    this.selections = new Map();
    for (const [questionId, answer] of latestByQuestion(answers)) {
      if (answer.correct_option === null) this.selections.set(questionId, answer.selected_option);
    }
    this.locked = false;
  }

  get currentQuestion() { return this.questions[this.index]; }
  get selectedOption() { return this.selections.get(this.currentQuestion.id) || null; }
  get answeredCount() {
    return this.questions.filter(({ id }) => Boolean(this.selections.get(id))).length;
  }

  stateFor(questionId) { return this.selections.get(questionId) ? "answered" : "pending"; }

  select(optionId) {
    if (this.locked) throw new Error("El Modo examen ya está bloqueado.");
    if (!this.currentQuestion.options.some(({ id }) => id === optionId)) {
      throw new Error("La opción elegida no existe.");
    }
    this.selections.set(this.currentQuestion.id, optionId);
  }

  clear() {
    if (this.locked) throw new Error("El Modo examen ya está bloqueado.");
    this.selections.set(this.currentQuestion.id, null);
  }

  recordSaved(answer) {
    if (!this.answers.some(({ id }) => id === answer.id)) this.answers.push(answer);
  }

  goTo(index) {
    if (!Number.isInteger(index) || index < 0 || index >= this.questions.length) {
      throw new Error("La posición de examen no es válida.");
    }
    this.index = index;
    return this.currentQuestion;
  }
}
