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

test("una respuesta definitiva de deadline retira el retry antiguo y deja avanzar la finalización", async () => {
  const storage = new MemoryStorage();
  const calls = [];
  let finalizations = 0;
  const client = {
    from(table) {
      const data = table === "attempts" ? [{
        id: "exam-attempt",
        exam_id: "exam-A",
        kind: "exam",
        revision: 0,
        status: "active",
        current_position: 0,
        is_paused: false,
      }] : [];
      const builder = {
        select() { return builder; },
        eq() { return builder; },
        order: async () => ({ data, error: null }),
        then(resolve) { return resolve({ data, error: null }); },
      };
      return builder;
    },
    async rpc(_name, payload) {
      calls.push(structuredClone(payload));
      if (calls.length === 1) return { data: null, error: { message: "Failed to fetch" } };
      if (calls.length === 2) {
        return { data: null, error: { message: "El deadline del Modo examen ya ha vencido." } };
      }
      if (payload.p_pending_snapshot.finalize) finalizations += 1;
      return {
        data: {
          attempt: { id: "exam-attempt", exam_id: "exam-A", kind: "exam", revision: 1, status: "completed" },
          answers: [],
          summary: { attempt_id: "exam-attempt" },
        },
        error: null,
      };
    },
  };
  const persistence = new ActiveAttemptPersistence({ client, storage, userId: "user-a" });
  persistence.begin({
    id: "exam-attempt",
    exam_id: "exam-A",
    kind: "exam",
    revision: 0,
    status: "active",
  }, []);
  persistence.queueExamAnswer({ id: "answer-a", questionId: "question-a", selectedOption: "A" }, {
    position: 0,
    isPaused: false,
  });

  await assert.rejects(persistence.sync(), ({ message }) => message === "Failed to fetch");
  persistence.queueFinalization({ position: 0, isPaused: false });
  const result = await persistence.sync();
  persistence.destroy();

  assert.equal(result.attempt.status, "completed");
  assert.equal(finalizations, 1);
  assert.deepEqual(calls.map(({ p_pending_snapshot: snapshot }) => snapshot.finalize), [false, false, true]);
  assert.deepEqual(calls[2].p_pending_snapshot.exam_answers, []);
  assert.equal(calls[1].p_sync_id, calls[0].p_sync_id);
  assert.notEqual(calls[2].p_sync_id, calls[1].p_sync_id);
  assert.equal(storage.values.size, 0);
});
