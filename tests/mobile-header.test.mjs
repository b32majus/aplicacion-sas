import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { chromium } from "@playwright/test";

const root = process.cwd();
const markup = readFileSync(path.join(root, "app/index.html"), "utf8");
const styles = readFileSync(path.join(root, "app/src/styles.css"), "utf8");
const header = markup.match(/<header class="brand">[\s\S]*?<\/header>/)?.[0];

test("La cabecera móvil permite distribuir los controles en varias filas", () => {
  assert.ok(header, "La cabecera debe existir en el HTML real");
  const mobileStyles = styles.slice(styles.indexOf("@media (max-width: 720px)"));
  assert.match(mobileStyles, /\.brand\s*\{[^}]*flex-wrap:\s*wrap\s*;/);
  assert.match(mobileStyles, /\.brand-mark\s*\{[^}]*flex:\s*1\s+1\s+100%\s*;/);
});

test("La cabecera real no recorta acciones en móvil ni escritorio", async (t) => {
  if (!existsSync(chromium.executablePath())) {
    t.skip("Chromium no está instalado en este runner; la aserción CSS anterior sigue activa");
    return;
  }

  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [320, 390, 480, 720, 1280]) {
      await t.test(`viewport ${width}px`, async () => {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        try {
          const visibleHeader = header.replace(/\shidden(?=[\s>])/g, "");
          await page.setContent(`<html lang="es"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style></head><body><main class="shell">${visibleHeader}</main></body></html>`);
          await page.locator("#sync-status").evaluate((el) => { el.textContent = "Sincronizando…"; });
          const metrics = await page.evaluate(() => ({
            viewport: window.innerWidth,
            scroll: document.documentElement.scrollWidth,
            controls: ["dashboard-button", "history-button", "logout-button"].map((id) => {
              const rect = document.getElementById(id).getBoundingClientRect();
              return { id, left: rect.left, right: rect.right, visible: rect.width > 0 && rect.height > 0 };
            }),
          }));
          assert.ok(metrics.scroll <= metrics.viewport, `Desbordamiento horizontal: ${JSON.stringify(metrics)}`);
          for (const ctl of metrics.controls) {
            assert.ok(ctl.visible && ctl.left >= 0 && ctl.right <= width, `Control recortado: ${JSON.stringify(ctl)}, width=${width}`);
          }
        } finally {
          await page.close();
        }
      });
    }
  } finally {
    await browser.close();
  }
});
