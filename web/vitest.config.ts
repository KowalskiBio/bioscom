import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "@bioscom/shared": fileURLToPath(new URL("../shared/src/browser.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Several fixtures each launch Vite and Chromium; cap concurrent startup contention.
    maxWorkers: 2,
  },
});
