import { test, expect } from "@playwright/test";

const accounts = [1, 2, 3].map((number) => ({
  email: process.env[`SAS_TEST_EMAIL${number === 1 ? "" : `_${number}`}`],
  password: process.env[`SAS_TEST_PASSWORD${number === 1 ? "" : `_${number}`}`],
}));

async function authenticate(request, account) {
  const response = await request.post(
    `${process.env.VITE_SUPABASE_URL}/auth/v1/token?grant_type=password`,
    {
      headers: {
        apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        "Content-Type": "application/json",
      },
      data: account,
    },
  );
  expect(response.ok()).toBe(true);
  return response.json();
}

function apiHeaders(accessToken) {
  return {
    apikey: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
}

test("Seam 2: tres usuarios comparten solo agregados fijos y conservan detalle privado", async ({ page, request }) => {
  const sessions = [];
  const dashboards = [];
  for (const account of accounts) {
    const session = await authenticate(request, account);
    sessions.push(session);
    const response = await request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/get_dashboard`, {
      headers: apiHeaders(session.access_token),
      data: {},
    });
    expect(response.ok()).toBe(true);
    dashboards.push(await response.json());
  }

  const shared = dashboards[0].shared;
  expect(shared.profiles.map(({ alias }) => alias)).toEqual([
    "Participante 1", "Participante 2", "Participante 3",
  ]);
  expect(dashboards.map(({ shared: value }) => value)).toEqual([shared, shared, shared]);
  const serialized = JSON.stringify(shared);
  for (const session of sessions) expect(serialized).not.toContain(session.user.id);
  expect(serialized).not.toMatch(/selected_option|correct_option|attempt_id|user_id/i);

  const foreignUserId = sessions[1].user.id;
  for (const table of ["attempts", "attempt_answers", "question_progress"]) {
    const response = await request.get(
      `${process.env.VITE_SUPABASE_URL}/rest/v1/${table}?user_id=eq.${foreignUserId}&select=*`,
      { headers: apiHeaders(sessions[0].access_token) },
    );
    expect(response.ok()).toBe(true);
    expect(await response.json()).toEqual([]);
  }
  const arbitrary = await request.post(`${process.env.VITE_SUPABASE_URL}/rest/v1/rpc/get_dashboard`, {
    headers: apiHeaders(sessions[0].access_token),
    data: { user_id: foreignUserId },
  });
  expect(arbitrary.ok()).toBe(false);

  await page.goto("");
  await page.getByLabel("Correo electrónico").fill(accounts[0].email);
  await page.getByLabel("Contraseña").fill(accounts[0].password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Exámenes oficiales" })).toBeVisible();
  await page.getByRole("button", { name: "Dashboard" }).click();
  await expect(page.getByRole("heading", { name: "Mi actividad global" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Comparación entre participantes" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Participante 1" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Participante 2" })).toBeVisible();
  await expect(page.getByRole("rowheader", { name: "Participante 3" })).toBeVisible();
});
