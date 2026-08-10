import test from "node:test";
import assert from "node:assert/strict";

import { ActiveAttemptPersistence } from "../app/src/active-attempt-persistence.js";

class MemoryStorage {
  values = new Map();

  getItem(key) { return this.values.get(key) ?? null; }
  setItem(key, value) { this.values.set(key, value); }
  removeItem(key) { this.values.delete(key); }
}

Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: { onLine: true },
});
Object.defineProperty(globalThis, "window", {
  configurable: true,
  value: new EventTarget(),
});

function pendingFailedSession() {
  const storage = new MemoryStorage();
  const persistence = new ActiveAttemptPersistence({
    client: {},
    storage,
    userId: "user-a",
  });
  persistence.begin({
    id: "attempt-a",
    exam_id: "exam-A",
    kind: "failed",
    revision: 0,
  }, []);
  persistence.queueState({ position: 0, isPaused: false });
  persistence.destroy();
  return storage;
}

function restoreFrom(storage, filters) {
  const persistence = new ActiveAttemptPersistence({
    client: {},
    storage,
    userId: "user-a",
  });
  const restored = persistence.restore(filters);
  persistence.destroy();
  return restored;
}

test("restore aplica los filtros opcionales de examen y tipo de forma independiente", () => {
  const storage = pendingFailedSession();

  assert.equal(restoreFrom(storage, { kind: "failed" }).attempt.id, "attempt-a");
  assert.equal(restoreFrom(storage, { kind: "failed", examId: "exam-B" }), null);
  assert.equal(restoreFrom(storage, { kind: "normal" }), null);
});
