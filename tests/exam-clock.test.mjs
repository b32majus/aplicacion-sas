import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  fetchServerClockOffset,
  isActiveExam,
  isExamExpired,
  serverAdjustedNow,
  serverClockOffset,
} from "../app/src/exam-clock.js";

test("a device clock ahead cannot unblock study before server-adjusted expiry", () => {
  const realServerNow = Date.parse("2026-08-11T10:00:00Z");
  const requestAt = realServerNow + 2 * 60 * 60 * 1000;
  const responseAt = requestAt + 200;
  const deviceNow = responseAt;
  const offset = serverClockOffset("2026-08-11T10:00:00.100Z", requestAt, responseAt);
  const attempt = { status: "active", deadline_at: "2026-08-11T10:05:00Z" };

  assert.equal(serverAdjustedNow(offset, deviceNow), realServerNow + 200);
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

test("fresh-device clock discovery keeps a server-active exam blocked with an ahead device", async () => {
  const serverNow = "2026-08-11T10:00:00Z";
  const deviceTimes = [
    Date.parse("2026-08-11T12:00:00Z"),
    Date.parse("2026-08-11T12:00:00.200Z"),
  ];
  const client = {
    async rpc(name) {
      assert.equal(name, "get_server_now");
      return { data: serverNow, error: null };
    },
  };

  const offset = await fetchServerClockOffset(client, () => deviceTimes.shift());
  const attempt = { status: "active", deadline_at: "2026-08-11T10:05:00Z" };

  assert.equal(offset, -7_200_100);
  assert.equal(isActiveExam(attempt, offset, Date.parse("2026-08-11T12:00:01Z")), true);
});

test("fresh-device clock discovery releases an expired exam with a behind device", async () => {
  const deviceTimes = [
    Date.parse("2026-08-11T08:00:00Z"),
    Date.parse("2026-08-11T08:00:00.200Z"),
  ];
  const client = {
    async rpc() {
      return { data: "2026-08-11T10:10:00Z", error: null };
    },
  };

  const offset = await fetchServerClockOffset(client, () => deviceTimes.shift());
  const attempt = { status: "active", deadline_at: "2026-08-11T10:05:00Z" };

  assert.equal(isActiveExam(attempt, offset, Date.parse("2026-08-11T08:00:01Z")), false);
  assert.equal(isExamExpired(attempt, offset, Date.parse("2026-08-11T08:00:01Z")), true);
});

test("an unknown or failed server clock fails closed without using device time", async () => {
  const attempt = { status: "active", deadline_at: "2026-08-11T10:05:00Z" };
  const client = {
    async rpc() {
      return { data: null, error: new Error("clock unavailable") };
    },
  };

  await assert.rejects(fetchServerClockOffset(client), /clock unavailable/);
  assert.equal(isActiveExam(attempt, Number.NaN, Date.parse("2026-08-11T12:00:00Z")), true);
  assert.equal(isExamExpired(attempt, Number.NaN, Date.parse("2026-08-11T12:00:00Z")), false);
  assert.equal(Number.isNaN(serverAdjustedNow(Number.NaN)), true);
});

test("a persisted numeric offset remains authoritative offline", () => {
  const attempt = { status: "active", deadline_at: "2026-08-11T10:05:00Z" };
  const persistedOffset = -2 * 60 * 60 * 1000;

  assert.equal(isActiveExam(attempt, persistedOffset, Date.parse("2026-08-11T12:00:00Z")), true);
});

test("refreshStatuses establishes its own server clock before reading active attempts", async () => {
  const source = await readFile(new URL("../app/src/app.js", import.meta.url), "utf8");
  const start = source.indexOf("async function refreshStatuses()");
  const end = source.indexOf("\nfunction renderCatalog()", start);
  const refreshSource = source.slice(start, end);

  assert.match(refreshSource, /examServerOffsetMs = Number\.NaN/);
  assert.match(refreshSource, /await fetchServerClockOffset\(supabase\)/);
  assert.ok(refreshSource.indexOf("fetchServerClockOffset") < refreshSource.indexOf('.from("attempts")'));
  assert.doesNotMatch(source, /server_clock_offset_ms \|\| 0/);
});

test("the server clock RPC exposes only clock_timestamp to authenticated users", async () => {
  const sql = await readFile(
    new URL("../supabase/migrations/20260811106000_expose_server_clock.sql", import.meta.url),
    "utf8",
  );

  assert.match(sql, /create function public\.get_server_now\(\)/i);
  assert.match(sql, /returns timestamptz/i);
  assert.match(sql, /select clock_timestamp\(\)/i);
  assert.doesNotMatch(sql, /security definer/i);
  assert.match(sql, /revoke all on function public\.get_server_now\(\)[\s\S]*from public, anon, authenticated/i);
  assert.match(sql, /grant execute on function public\.get_server_now\(\)[\s\S]*to authenticated/i);
});
