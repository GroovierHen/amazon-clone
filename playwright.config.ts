import { defineConfig, devices } from "@playwright/test";

// `bun run test:e2e` builds and starts the app locally, against the database in
// .env.local. Set E2E_BASE_URL to run the same test against a deployed site.
const deployed = process.env.E2E_BASE_URL;
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  // Not *.spec.ts or *.test.ts: `bun test` would try to run those itself.
  testMatch: "*.e2e.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL: deployed ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: deployed
    ? undefined
    : {
        command: `bun run build && bun --bun next start --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        reuseExistingServer: true,
        timeout: 240_000,
      },
});
