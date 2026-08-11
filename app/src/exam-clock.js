export function serverAdjustedNow(serverOffsetMs, deviceNow = Date.now()) {
  return deviceNow + (Number.isFinite(serverOffsetMs) ? serverOffsetMs : 0);
}

export function isActiveExam(attempt, serverOffsetMs, deviceNow = Date.now()) {
  return Boolean(
    attempt?.status === "active"
    && Date.parse(attempt.deadline_at) > serverAdjustedNow(serverOffsetMs, deviceNow),
  );
}

export function isExamExpired(attempt, serverOffsetMs, deviceNow = Date.now()) {
  return Boolean(attempt?.deadline_at)
    && !isActiveExam(attempt, serverOffsetMs, deviceNow);
}
