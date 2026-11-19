export async function loadDashboard(client) {
  const { data, error } = await client.rpc("get_dashboard");
  if (error) throw error;
  return data;
}

// Carga del Dashboard por oposición mediante la RPC v2 del servidor: cada
// métrica, examen y pregunta del resultado pertenece exclusivamente a la
// oposición solicitada. La carga legacy get_dashboard se conserva exportada
// para compatibilidad con el frontend antiguo.
export async function loadOppositionDashboard(client, oppositionId) {
  const { data, error } = await client.rpc("get_opposition_dashboard_v2", {
    p_opposition_id: oppositionId,
  });
  if (error) throw error;
  return data;
}

export function percent(value) {
  return `${Number(value || 0).toLocaleString("es-ES", { maximumFractionDigits: 1 })} %`;
}

export function score(value) {
  return value == null
    ? "Sin intentos"
    : Number(value).toLocaleString("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
