import test from "node:test";
import assert from "node:assert/strict";

import { isActiveExam, isExamExpired, serverAdjustedNow } from "../app/src/exam-clock.js";

test("a device clock ahead cannot unblock study before server-adjusted expiry", () => {
  const realServerNow = Date.parse("2026-08-11T10:00:00Z");
  const deviceNow = realServerNow + 2 * 60 * 60 * 1000;
  const offset = realServerNow - deviceNow;
  const attempt = { status: "active", deadline_at: "2026-08-11T10:05:00Z" };

  assert.equal(serverAdjustedNow(offset, deviceNow), realServerNow);
  assert.equal(isActiveExam(attempt, offset, deviceNow), true);
  assert.equal(isExamExpired(attempt, offset, deviceNow), false);
});

test("a device clock behind does not keep study blocked after server-adjusted expiry", () => {
  const realServerNow = Date.parse("2026-08-11T10:10:00Z");
  const deviceNow = realServerNow - 2 * 60 * 60 * 1000;
  const offset = realServerNow - deviceNow;
  const attempt = { status: "active", deadline_at: "2026-08-11T10:05:00Z" };

  assert.equal(serverAdjustedNow(offset, deviceNow), realServerNow);
  assert.equal(isActiveExam(attempt, offset, deviceNow), false);
  assert.equal(isExamExpired(attempt, offset, deviceNow), true);
});
