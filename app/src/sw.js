import { clientsClaim } from "workbox-core";
import { cleanupOutdatedCaches, createHandlerBoundToURL, precacheAndRoute } from "workbox-precaching";
import { NavigationRoute, registerRoute } from "workbox-routing";

precacheAndRoute(self.__WB_MANIFEST);
cleanupOutdatedCaches();
clientsClaim();

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

const shellUrl = new URL("index.html", self.registration.scope).pathname;
registerRoute(new NavigationRoute(createHandlerBoundToURL(shellUrl), {
  allowlist: [/^\/aplicacion-sas\/(?:index\.html)?$/],
}));
