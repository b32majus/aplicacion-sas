import { test, expect } from "@playwright/test";

test("deniega la vista privada y completa login, catálogo, examen, restauración y logout", async ({ page }) => {
  await page.goto("#catalog");

  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Exámenes oficiales" })).toBeHidden();
  await expect(page.getByRole("link", { name: /registr/i })).toHaveCount(0);

  await page.getByLabel("Correo electrónico").fill(process.env.SAS_TEST_EMAIL);
  await page.getByLabel("Contraseña").fill(process.env.SAS_TEST_PASSWORD);
  await page.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByRole("heading", { name: "Exámenes oficiales" })).toBeVisible();
  const realCard = page.getByRole("heading", { name: "SAS Administrativo/a 2021 - Turno Libre" }).locator("..");
  await expect(realCard.getByText("150 Preguntas activas · 3 h")).toBeVisible();
  await realCard.getByRole("button", { name: "Elegir examen" }).click();

  await expect(page.getByText("150", { exact: true })).toBeVisible();
  await expect(page.getByText("3 h", { exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("heading", { name: "SAS Administrativo/a 2021 - Turno Libre" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Cerrar sesión" })).toBeVisible();

  await page.getByRole("button", { name: "Cerrar sesión" }).click();
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "SAS Administrativo/a 2021 - Turno Libre" })).toBeHidden();
});

test("el navegador confirma que el proyecto aislado rechaza nuevas altas", async ({ page }) => {
  await page.goto("");
  const result = await page.evaluate(async ({ url, key, email }) => {
    const response = await fetch(`${url}/auth/v1/signup`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: `${crypto.randomUUID()}Aa1!` }),
    });
    return { ok: response.ok, body: await response.text() };
  }, {
    url: process.env.VITE_SUPABASE_URL,
    key: process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    email: process.env.SAS_TEST_EMAIL,
  });
  expect(result.ok).toBe(false);
  expect(result.body).toMatch(/signup|signups|disabled|not allowed/i);
});
