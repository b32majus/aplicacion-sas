import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

const appBase = "/aplicacion-sas/";

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (command === "build") {
    const validPublicConfig = env.VITE_SUPABASE_URL?.startsWith("https://")
      && env.VITE_SUPABASE_PUBLISHABLE_KEY?.startsWith("sb_publishable_");
    if (!validPublicConfig) {
      throw new Error("Falta la configuración pública autorizada de Supabase para el build.");
    }
  }

  return {
    root: "app",
    envDir: process.cwd(),
    base: appBase,
    plugins: [
      VitePWA({
        strategies: "injectManifest",
        srcDir: "src",
        filename: "sw.js",
        injectRegister: false,
        registerType: "prompt",
        injectManifest: {
          globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
        },
        manifest: {
          id: appBase,
          name: "Banco de exámenes SAS",
          short_name: "Exámenes SAS",
          description: "Aplicación privada para practicar exámenes oficiales del SAS",
          lang: "es",
          start_url: appBase,
          scope: appBase,
          display: "standalone",
          background_color: "#f3f0e8",
          theme_color: "#0b5c48",
          icons: [
            {
              src: `${appBase}icons/pwa-192x192.png`,
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: `${appBase}icons/pwa-512x512.png`,
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: `${appBase}icons/maskable-icon-512x512.png`,
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
      }),
    ],
    build: {
      outDir: "../dist",
      emptyOutDir: true,
    },
  };
});
