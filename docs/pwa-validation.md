# Soporte PWA opcional

La experiencia soportada es abrir `https://b32majus.github.io/aplicacion-sas/` en
el navegador e iniciar sesión. La instalación nativa móvil, de escritorio o en
modo standalone no es un requisito de producto ni una puerta de aceptación.

El manifest y el service worker existentes pueden conservarse para resiliencia
del navegador. El service worker conserva solo el shell versionado; Supabase, el
catálogo y las versiones de exámenes siguen siendo recursos de red y fuentes
canónicas.

## Comprobación manual

1. Abre la URL publicada y confirma que carga dentro de `/aplicacion-sas/` y permite llegar al login.
2. Con la aplicación ya cargada, corta la red y recarga: el shell puede abrir y debe indicar que el acceso y los datos remotos requieren conexión.
3. Los checks estructurales existentes pueden seguir validando manifest, registro, scope y shell offline.

No se exige validación manual de instalación, standalone ni actualización de una
PWA instalada. `npm run test:pwa:e2e` sigue siendo un check estructural útil; no
promete login, catálogo o sincronización indefinidos sin red.
