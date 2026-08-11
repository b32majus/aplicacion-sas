import { createClient } from "@supabase/supabase-js";
import { loadPublishedCatalog } from "./catalog.js";
import "./styles.css";

const elements = Object.fromEntries([
  "loading-view", "login-view", "catalog-view", "exam-view", "login-form",
  "login-button", "login-error", "logout-button", "catalog-status", "exam-grid",
  "back-button", "exam-title", "exam-count", "exam-duration",
].map((id) => [id, document.getElementById(id)]));

const privateViews = [elements["catalog-view"], elements["exam-view"]];
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const bankBaseUrl = `${import.meta.env.BASE_URL}data/exams/`;

let supabase;
let catalog = [];
let catalogPromise;

function showOnly(view) {
  [elements["loading-view"], elements["login-view"], ...privateViews]
    .forEach((candidate) => { candidate.hidden = candidate !== view; });
}

function showError(element, message) {
  element.textContent = message;
  element.hidden = false;
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (!hours) return `${remainder} min`;
  return remainder ? `${hours} h ${remainder} min` : `${hours} h`;
}

function renderCatalog() {
  elements["exam-grid"].replaceChildren(...catalog.map((exam) => {
    const card = document.createElement("article");
    card.className = "exam-card";

    const heading = document.createElement("h2");
    heading.textContent = exam.title;

    const facts = document.createElement("p");
    facts.className = "card-facts";
    facts.textContent = `${exam.activeCount} Preguntas activas · ${formatDuration(exam.durationMinutes)}`;

    const button = document.createElement("button");
    button.className = "secondary";
    button.type = "button";
    button.textContent = "Elegir examen";
    button.addEventListener("click", () => selectExam(exam.id));

    card.append(heading, facts, button);
    return card;
  }));
  elements["catalog-status"].hidden = true;
  elements["exam-grid"].hidden = false;
}

async function ensureCatalog() {
  if (!catalogPromise) {
    catalogPromise = loadPublishedCatalog(fetch, bankBaseUrl)
      .then((loaded) => {
        catalog = loaded;
        renderCatalog();
        return loaded;
      })
      .catch((error) => {
        catalogPromise = undefined;
        showError(elements["catalog-status"], error.message);
        throw error;
      });
  }
  return catalogPromise;
}

async function showCatalog() {
  window.location.hash = "catalog";
  showOnly(elements["catalog-view"]);
  try {
    await ensureCatalog();
  } catch {
    // The visible catalog status already explains the failure.
  }
}

async function selectExam(id) {
  const exams = await ensureCatalog();
  const exam = exams.find((candidate) => candidate.id === id);
  if (!exam) {
    await showCatalog();
    return;
  }
  elements["exam-title"].textContent = exam.title;
  elements["exam-count"].textContent = exam.activeCount;
  elements["exam-duration"].textContent = formatDuration(exam.durationMinutes);
  window.location.hash = `exam=${encodeURIComponent(exam.id)}`;
  showOnly(elements["exam-view"]);
}

async function routePrivateView() {
  const examId = window.location.hash.match(/^#exam=([^&]+)$/)?.[1];
  if (examId) {
    await selectExam(decodeURIComponent(examId));
  } else {
    await showCatalog();
  }
}

function renderSession(session) {
  elements["logout-button"].hidden = !session;
  elements["login-error"].hidden = true;
  if (!session) {
    showOnly(elements["login-view"]);
    return;
  }
  routePrivateView();
}

async function submitLogin(event) {
  event.preventDefault();
  elements["login-error"].hidden = true;
  elements["login-button"].disabled = true;
  const data = new FormData(elements["login-form"]);
  const { error } = await supabase.auth.signInWithPassword({
    email: data.get("email"),
    password: data.get("password"),
  });
  elements["login-button"].disabled = false;
  if (error) showError(elements["login-error"], "No se pudo iniciar sesión. Revisa tus datos.");
}

async function boot() {
  if (!publishableKey?.startsWith("sb_publishable_")) {
    showOnly(elements["login-view"]);
    showError(elements["login-error"], "La aplicación no tiene configurado el acceso público autorizado.");
    elements["login-button"].disabled = true;
    return;
  }

  supabase = createClient(supabaseUrl, publishableKey);
  elements["login-form"].addEventListener("submit", submitLogin);
  elements["logout-button"].addEventListener("click", () => supabase.auth.signOut());
  elements["back-button"].addEventListener("click", showCatalog);

  const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
    renderSession(session);
  });
  window.addEventListener("pagehide", () => subscription.unsubscribe(), { once: true });

  const { data: { session }, error } = await supabase.auth.getSession();
  if (error) {
    showOnly(elements["login-view"]);
    showError(elements["login-error"], "No se pudo comprobar la sesión. Inténtalo de nuevo.");
    return;
  }
  renderSession(session);
}

boot();
