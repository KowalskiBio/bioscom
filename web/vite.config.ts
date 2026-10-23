import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";

const apiProxy = {
  "/api": "http://127.0.0.1:8003",
  "/ws": { target: "ws://127.0.0.1:8003", ws: true },
};

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "@bioscom/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
  server: { port: 5173, proxy: apiProxy },
  preview: { port: 4173, proxy: apiProxy },
});
