import { defineConfig } from "@playwright/test";

/**
 * E2E tests need a running stack:
 *   1. Supabase project with migrations applied + a test user
 *   2. `npm run dev` (or a deployed URL)
 *   3. A paired runner in mock mode: `python -m aureli_runner run --mock-fast`
 * Set E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD. Tests are skipped when unset
 * (see e2e/primary-flow.spec.ts) so CI without secrets stays green.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  retries: 0,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
