import { registerSW } from "virtual:pwa-register";

const status = document.getElementById("pwa-status");
const message = document.getElementById("pwa-status-message");
const updateButton = document.getElementById("pwa-update-button");
let updateAvailable = false;

function renderNetworkStatus(online = navigator.onLine) {
  if (updateAvailable) return;
  status.hidden = online;
  updateButton.hidden = true;
  message.textContent = online
    ? ""
    : "Sin conexión. La aplicación puede abrirse, pero el acceso y los datos remotos requieren conexión.";
}

const updateSW = registerSW({
  immediate: true,
  onNeedRefresh() {
    updateAvailable = true;
    status.hidden = false;
    updateButton.hidden = false;
    message.textContent = "Hay una versión nueva. Sincroniza tu avance antes de actualizar la aplicación.";
  },
  onRegisterError() {
    status.hidden = false;
    updateButton.hidden = true;
    message.textContent = "No se pudo activar la instalación de la aplicación. Puedes seguir usando la web.";
  },
});

updateButton.addEventListener("click", () => {
  updateButton.disabled = true;
  message.textContent = "Actualizando la aplicación…";
  updateSW(true);
});
window.addEventListener("online", () => renderNetworkStatus(true));
window.addEventListener("offline", () => renderNetworkStatus(false));
renderNetworkStatus();
