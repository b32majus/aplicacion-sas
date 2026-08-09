const SCORING_STATUSES = new Set(["valid", "reserve"]);

export function shuffled(items, random = Math.random) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [result[index], result[target]] = [result[target], result[index]];
  }
  return result;
}

export class QuizSession {
  constructor(questions, { mode = "sequential", random = Math.random } = {}) {
    if (!Array.isArray(questions) || questions.length === 0) {
      throw new Error("El intento necesita al menos una pregunta.");
    }
    if (!new Set(["sequential", "random"]).has(mode)) {
      throw new Error(`Modo desconocido: ${mode}`);
    }

    this.mode = mode;
    this.questions = mode === "random" ? shuffled(questions, random) : [...questions];
    this.index = 0;
    this.correctCount = 0;
    this.incorrectCount = 0;
    this.failedIds = [];
    this.answer = null;
    this.finished = false;
  }

  get currentQuestion() {
    return this.finished ? null : this.questions[this.index];
  }

  get progress() {
    return { current: this.index + 1, total: this.questions.length };
  }

  answerCurrent(optionId) {
    if (this.finished) throw new Error("El intento ya ha terminado.");
    if (this.answer) throw new Error("Esta pregunta ya está corregida.");

    const question = this.currentQuestion;
    if (!question.options.some((option) => option.id === optionId)) {
      throw new Error("La opción elegida no existe.");
    }

    const scores = SCORING_STATUSES.has(question.status);
    const isCorrect = optionId === question.correctOption;
    this.answer = { optionId, correctOption: question.correctOption, isCorrect, scores };

    if (scores && isCorrect) this.correctCount += 1;
    if (scores && !isCorrect) {
      this.incorrectCount += 1;
      this.failedIds.push(question.id);
    }
    return this.answer;
  }

  next() {
    if (!this.answer) throw new Error("Responde antes de continuar.");
    if (this.index === this.questions.length - 1) {
      this.finished = true;
      return null;
    }
    this.index += 1;
    this.answer = null;
    return this.currentQuestion;
  }

  failedQuestions(allQuestions = this.questions) {
    const byId = new Map(allQuestions.map((question) => [question.id, question]));
    return this.failedIds.map((id) => byId.get(id)).filter(Boolean);
  }
}
