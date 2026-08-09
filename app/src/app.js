import { QuizSession } from "./quiz-core.js";

const DATA_URL = "./public/data/exams/sas-administrativo-2023-turno-libre.json";
const elements = Object.fromEntries([
  "start-view", "quiz-view", "summary-view", "start-button", "load-error", "progress",
  "timer", "correct-count", "incorrect-count", "question-number", "question-status",
  "question-text", "options", "feedback", "next-button", "summary-time",
  "summary-correct", "summary-incorrect", "retry-button", "restart-button",
].map((id) => [id, document.getElementById(id)]));

let questions = [];
let session;
let startedAt;
let elapsedSeconds = 0;
let timerId;

function show(view) {
  [elements["start-view"], elements["quiz-view"], elements["summary-view"]]
    .forEach((element) => { element.hidden = element !== view; });
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, "0");
  const remainder = (seconds % 60).toString().padStart(2, "0");
  return `${minutes}:${remainder}`;
}

function startTimer() {
  clearInterval(timerId);
  startedAt = Date.now();
  elapsedSeconds = 0;
  elements.timer.textContent = "00:00";
  timerId = setInterval(() => {
    elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
    elements.timer.textContent = formatTime(elapsedSeconds);
  }, 1000);
}

function renderQuestion() {
  const question = session.currentQuestion;
  const { current, total } = session.progress;
  elements.progress.textContent = `Pregunta ${current} de ${total}`;
  elements["question-number"].textContent = `Pregunta oficial ${question.number}`;
  elements["question-text"].textContent = question.text;
  elements["correct-count"].textContent = session.correctCount;
  elements["incorrect-count"].textContent = session.incorrectCount;
  elements.feedback.textContent = "";
  elements.feedback.className = "feedback";
  elements["next-button"].hidden = true;

  const special = question.status === "annulled" ? "Anulada · no puntúa" :
    question.status === "reserve" ? "Reserva" : "";
  elements["question-status"].textContent = special;
  elements["question-status"].hidden = !special;
  elements.options.replaceChildren(...question.options.map((option) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "option";
    button.dataset.option = option.id;
    button.innerHTML = `<span>${option.id}</span><span>${option.text}</span>`;
    button.addEventListener("click", () => answer(option.id));
    return button;
  }));
}

function answer(optionId) {
  const result = session.answerCurrent(optionId);
  elements.options.querySelectorAll("button").forEach((button) => {
    button.disabled = true;
    if (button.dataset.option === result.correctOption) button.classList.add("correct");
    if (button.dataset.option === optionId && !result.isCorrect) button.classList.add("incorrect");
  });
  elements["correct-count"].textContent = session.correctCount;
  elements["incorrect-count"].textContent = session.incorrectCount;
  elements.feedback.textContent = !result.scores ? "Pregunta anulada: la respuesta no afecta al resultado." :
    result.isCorrect ? "¡Correcto!" : `Incorrecto. La respuesta correcta es ${result.correctOption}.`;
  elements.feedback.classList.add(result.scores && !result.isCorrect ? "wrong" : "right");
  elements["next-button"].textContent = session.progress.current === session.progress.total ? "Ver resultado" : "Siguiente";
  elements["next-button"].hidden = false;
  elements["next-button"].focus();
}

function begin(selectedQuestions, mode) {
  session = new QuizSession(selectedQuestions, { mode });
  show(elements["quiz-view"]);
  startTimer();
  renderQuestion();
}

function finish() {
  clearInterval(timerId);
  elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
  elements["summary-time"].textContent = `Has completado la sesión en ${formatTime(elapsedSeconds)}.`;
  elements["summary-correct"].textContent = session.correctCount;
  elements["summary-incorrect"].textContent = session.incorrectCount;
  elements["retry-button"].hidden = session.failedIds.length === 0;
  show(elements["summary-view"]);
}

elements["start-button"].addEventListener("click", () => {
  const mode = document.querySelector('input[name="mode"]:checked').value;
  begin(questions, mode);
});
elements["next-button"].addEventListener("click", () => session.next() ? renderQuestion() : finish());
elements["retry-button"].addEventListener("click", () => begin(session.failedQuestions(questions), session.mode));
elements["restart-button"].addEventListener("click", () => show(elements["start-view"]));

fetch(DATA_URL)
  .then((response) => {
    if (!response.ok) throw new Error(`No se pudo cargar el examen (${response.status}).`);
    return response.json();
  })
  .then((exam) => {
    questions = exam.questions;
    elements["start-button"].disabled = false;
  })
  .catch((error) => {
    elements["load-error"].textContent = `${error.message} Abre la aplicación mediante un servidor web local.`;
    elements["load-error"].hidden = false;
  });

elements["start-button"].disabled = true;
