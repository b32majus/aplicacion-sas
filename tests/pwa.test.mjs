import test from "node:test";
import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";

const outDir = resolve(".cache/pwa-test-dist");

test("el build PWA publica shell y rutas instalables bajo /aplicacion-sas/ sin cachear el Banco", async (t) => {
  t.after(() => rm(outDir, { recursive: true, force: true }));
  await build({
    configFile: resolve("vite.config.js"),
    mode: "production",
    build: { outDir, emptyOutDir: true },
  });

  const manifest = JSON.parse(await readFile(resolve(outDir, "manifest.webmanifest"), "utf8"));
  assert.equal(manifest.id, "/aplicacion-sas/");
  assert.equal(manifest.start_url, "/aplicacion-sas/");
  assert.equal(manifest.scope, "/aplicacion-sas/");
  assert.equal(manifest.display, "standalone");
  assert.deepEqual(manifest.icons.map(({ sizes }) => sizes), ["192x192", "512x512", "512x512"]);
  assert.equal(manifest.icons.every(({ type }) => type === "image/png"), true);
  assert.equal(manifest.icons.every(({ src }) => src.startsWith("/aplicacion-sas/icons/")), true);

  const index = await readFile(resolve(outDir, "index.html"), "utf8");
  assert.match(index, /href="\/aplicacion-sas\/manifest\.webmanifest"/);
  assert.match(index, /src="\/aplicacion-sas\/assets\/index-[^"]+\.js"/);

  const serviceWorker = await readFile(resolve(outDir, "sw.js"), "utf8");
  assert.match(serviceWorker, /index\.html/);
  assert.match(serviceWorker, /manifest\.webmanifest/);
  assert.match(serviceWorker, /icons\/pwa-192x192\.png/);
  assert.match(serviceWorker, /SKIP_WAITING/);
  assert.doesNotMatch(serviceWorker, /catalog\.json|data\/exams|supabase/);
});
