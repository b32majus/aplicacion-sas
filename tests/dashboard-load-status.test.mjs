import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../app/src/app.js", import.meta.url), "utf8");
const definition = source.match(/function dashboardLoadStatus\(error\) \{[\s\S]*?\n\}/);
const messageFor = definition ? runInNewContext("(" + definition[0] + ")") : null;

test("Dashboard muestra acceso exclusivo sin presentar una avería al no participante", () => {
  assert.equal(typeof messageFor, "function");
  assert.equal(
    messageFor({ message: "El perfil no pertenece al Dashboard compartido." }),
    "El Dashboard comparativo está disponible exclusivamente para los tres participantes. Tu perfil no forma parte de esta comparación.",
  );
});

test("Dashboard sigue informando de errores técnicos genuinos", () => {
  assert.equal(messageFor({ message: "Error de red." }), "No se pudo cargar el Dashboard. Error de red.");
  assert.equal(messageFor({}), "No se pudo cargar el Dashboard. Inténtalo de nuevo más tarde.");
});

test("El controlador del Dashboard utiliza el mensaje contextual", () => {
  assert.match(source, /showError\(elements\["dashboard-status"\], dashboardLoadStatus\(error\)\);/);
});
