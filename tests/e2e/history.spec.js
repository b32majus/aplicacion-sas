import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

const bankUrl = new URL("../../app/public/data/exams/", import.meta.url);
const catalog = JSON.parse(await readFile(new URL("catalog.json", bankUrl), "utf8"));
const entryA = catalog.exams.find(({ id }) => id === "sas-administrativo-2021-turno-libre");
const packageA = JSON.parse(await readFile(new URL(entryA.latestPath, bankUrl), "utf8"));
const questionA = packageA.questions.find(({ active }) => active);

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

test("Seam 2: Historial abre A en solo lectura aunque el catálogo vigente sea B", async ({ page }) => {
  const packageB = structuredClone(packageA);
  packageB.title = "Examen actual B";
  packageB.version.id = "version-b-simulada";
  packageB.questions = [structuredClone(questionA)];
  packageB.questions[0].text = "Texto exclusivo de la versión B";
  packageB.scorableSet.count = 1;
  packageB.scorableSet.questionNumbers = [questionA.sourceNumber];
  const catalogB = {
    exams: [{
      id: packageB.id,
      title: packageB.title,
      latestVersion: packageB.version.id,
      latestPath: `${packageB.id}/versions/${packageB.version.id}.json`,
    }],
  };
  const attempt = {
    id: "20000000-0000-4000-8000-000000000088",
    exam_id: packageA.id,
    exam_version_id: packageA.version.id,
    exam_version_path: entryA.latestPath,
    question_ids: [questionA.id],
    kind: "exam",
    strategy: "exam",
    status: "completed",
    created_at: "2026-08-11T08:00:00Z",
    completed_at: "2026-08-11T08:30:00Z",
    active_seconds: 0,
    exam_elapsed_ms: 1_800_000,
    score: 75,
    correct_answers: 0,
    wrong_answers: 1,
    blank_answers: 0,
    answered_questions: 1,
    failed_scope_exam_id: null,
    started_at: "2026-08-11T08:00:00Z",
    deadline_at: "2026-08-11T11:00:00Z",
  };
  const answers = [{
    id: "30000000-0000-4000-8000-000000000088",
    question_id: questionA.id,
    answer_sequence: 1,
    selected_option: questionA.options.find(({ id }) => id !== questionA.correctOption).id,
    correct_option: questionA.correctOption,
    is_correct: false,
    confirmed_at: "2026-08-11T08:01:00Z",
  }];
  const originalAnswers = structuredClone(answers);
  const writes = [];

  await page.route("**/data/exams/catalog.json", (route) => json(route, catalogB));
  await page.route(`**/data/exams/${catalogB.exams[0].latestPath}`, (route) => json(route, packageB));
  await page.route("**/rest/v1/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    if (request.method() !== "GET") {
      writes.push({ method: request.method(), path });
      return json(route, { message: "History must be read-only" }, 500);
    }
    if (path.endsWith("/attempts")) return json(route, [attempt]);
    if (path.endsWith("/question_progress")) return json(route, []);
    if (path.endsWith("/personal_attempt_history")) return json(route, [attempt]);
    if (path.endsWith("/attempt_answers")) return json(route, structuredClone(answers));
    return json(route, { message: `Unexpected history read: ${path}` }, 500);
  });

  await page.goto("#catalog");
  await page.getByLabel("Correo electrónico").fill(process.env.SAS_TEST_EMAIL);
  await page.getByLabel("Contraseña").fill(process.env.SAS_TEST_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Examen actual B" })).toBeVisible();

  await page.getByRole("button", { name: "Historial" }).click();
  await expect(page.getByRole("heading", { name: "Historial" })).toBeVisible();
  await expect(page.getByText("Modo examen · Examen oficial · Finalizado")).toBeVisible();
  await page.getByRole("button", { name: "Abrir en solo lectura" }).click();

  await expect(page.getByRole("heading", { name: packageA.title })).toBeVisible();
  await expect(page.getByText(questionA.text)).toBeVisible();
  await expect(page.getByText(`Versión histórica fijada: ${packageA.version.id}`)).toBeVisible();
  await expect(page.locator("#history-questions input").first()).toBeDisabled();
  await expect(page.getByText("Texto exclusivo de la versión B")).toHaveCount(0);
  expect(writes).toEqual([]);
  expect(answers).toEqual(originalAnswers);
});
