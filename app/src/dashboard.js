export async function loadDashboard(client) {
  const { data, error } = await client.rpc("get_dashboard");
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
