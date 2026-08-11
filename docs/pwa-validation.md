# Validación de la PWA

La aplicación se instala desde la misma URL de GitHub Pages, `https://b32majus.github.io/aplicacion-sas/`. El service worker conserva solo el shell versionado; Supabase, el catálogo y las versiones de exámenes siguen siendo recursos de red y fuentes canónicas.

## Comprobación manual

1. Abre la URL publicada en Chrome o Edge de escritorio y usa **Instalar aplicación**.
2. Abre la aplicación instalada y confirma que inicia dentro de `/aplicacion-sas/`.
3. Repite desde **Añadir a pantalla de inicio** en un móvil compatible.
4. Con la aplicación ya cargada, corta la red y recarga: debe abrir el shell y mostrar que el acceso y los datos remotos requieren conexión.
5. Publica una revisión nueva, mantén abierta la anterior y confirma que aparece **Actualizar ahora**. Sincroniza el avance antes de pulsarlo.

La instalación nativa y sus menús dependen del navegador y no pueden demostrarse por completo en CI. `npm run test:pwa:e2e` valida registro, scope, control y recarga offline del shell en Chromium; no promete login, catálogo o sincronización indefinidos sin red.
