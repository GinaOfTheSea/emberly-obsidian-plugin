import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({ test: { include: ["tests/**/*.test.ts"] }, resolve: {
  alias: {
    obsidian: fileURLToPath(new URL("../tests/helpers/obsidian-mock.ts", import.meta.url)),
    "@emberly/dataplane": fileURLToPath(new URL("../src/emberly-engine/adapter/dataplane.ts", import.meta.url)),
  },
} });
