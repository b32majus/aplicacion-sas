import { defineConfig, loadEnv } from "vite";

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
    base: "/aplicacion-sas/",
    build: {
      outDir: "../dist",
      emptyOutDir: true,
    },
  };
});
