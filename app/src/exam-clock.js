export function serverAdjustedNow(serverOffsetMs, deviceNow = Date.now()) {
  return Number.isFinite(serverOffsetMs) ? deviceNow + serverOffsetMs : Number.NaN;
}

export function serverClockOffset(serverNow, requestAt, responseAt) {
  const parsedServerNow = Date.parse(serverNow);
  if (!Number.isFinite(parsedServerNow)) throw new Error("El reloj del servidor no devolvió una hora válida.");
  return parsedServerNow - (requestAt + responseAt) / 2;
}

export async function fetchServerClockOffset(client, deviceNow = Date.now) {
  const requestAt = deviceNow();
  const { data, error } = await client.rpc("get_server_now");
  const responseAt = deviceNow();
  if (error) throw error;
  return serverClockOffset(data, requestAt, responseAt);
}

export function isActiveExam(attempt, serverOffsetMs, deviceNow = Date.now()) {
  if (attempt?.status !== "active") return false;
  if (!Number.isFinite(serverOffsetMs)) return true;
  const deadline = Date.parse(attempt.deadline_at);
  return !Number.isFinite(deadline) || deadline > serverAdjustedNow(serverOffsetMs, deviceNow);
}

export function isExamExpired(attempt, serverOffsetMs, deviceNow = Date.now()) {
  return Boolean(attempt?.deadline_at)
    && !isActiveExam(attempt, serverOffsetMs, deviceNow);
}
