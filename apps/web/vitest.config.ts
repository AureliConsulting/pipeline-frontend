import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
  },
  resolve: {
    alias: {
      // Unit tests run outside the RSC runtime; stub the poison-pill import.
      "server-only": resolve(root, "test/stubs/server-only.ts"),
      "@": resolve(root, "src"),
      "@aureli/shared": resolve(root, "../../packages/shared/src/index.ts"),
    },
  },
});
