import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

// The app makes zero third-party requests at runtime. Card and banlist data are
// imported from `data/` — banlist and templates are bundled, the large card pool
// is emitted as a same-origin static asset via `?url` and fetched from there.
export default defineConfig({
  base: "./",
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@data": fileURLToPath(new URL("./data", import.meta.url)),
    },
  },
  build: {
    // cards.json is ~4 MB; never inline it into JS.
    assetsInlineLimit: 0,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
});
