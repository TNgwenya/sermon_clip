import { defineConfig, devices } from "@playwright/test";

const externalBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
const baseURL = externalBaseUrl || "http://localhost:3010";
const adminPassword = process.env.SCHEDULER_ADMIN_PASSWORD?.trim();
const localDatabaseUrl =
  process.env.PLAYWRIGHT_DATABASE_URL?.trim()
  || "postgresql://postgres:postgres@localhost:5432/sermon_clip_codex_test";
const inheritedEnvironment = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  expect: {
    timeout: 15_000,
  },
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...(adminPassword
      ? { httpCredentials: { username: "admin", password: adminPassword } }
      : {}),
  },
  webServer: externalBaseUrl
    ? undefined
    : {
        command: "npm run dev",
        env: {
          ...inheritedEnvironment,
          DATABASE_URL: localDatabaseUrl,
          PORT: "3010",
        },
        url: `${baseURL}/health`,
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
