import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

// tsconfigPaths resolves each source file's "@/..." imports against the
// nearest tsconfig.json's own "paths" — required because apps/hub and
// apps/api both use a bare "@/" alias pointing at their own src/, which a
// single hardcoded vitest alias can't disambiguate. Added 2026-09-12 while
// writing the first tests that actually exercise apps/hub/apps/api source
// (the prior 4 e2e tests import modules that no longer exist and don't run
// at all — see decision.md, 2026-09-12, "test suite was already broken").
export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
