import { expect, test } from "@playwright/test";

test("el shell instalado conserva el subpath y carga sin red sin prometer datos offline", async ({ context, page }) => {
  await page.goto("");
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  expect(scope).toBe("http://127.0.0.1:4191/aplicacion-sas/");

  await page.reload();
  await expect(page.getByRole("heading", { name: "Iniciar sesión" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page).toHaveTitle("Banco de exámenes · SAS");
  await page.evaluate(() => window.dispatchEvent(new Event("offline")));
  await expect(page.getByText(/datos remotos requieren conexión/)).toBeVisible();
  await context.setOffline(false);
});
