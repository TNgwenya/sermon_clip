export const REMOTE_TEST_DATABASE_CONFIRMATION = "USE DEDICATED REMOTE TEST DATABASE";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
const TEST_IDENTITY_PATTERN = /(?:^|[-_.])(test|testing|ci|sandbox)(?:[-_.]|$)/i;

export function assertSafeTestDatabase(input: {
  databaseUrl?: string;
  remoteConfirmation?: string;
}): void {
  const value = input.databaseUrl?.trim();
  if (!value) {
    return;
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Test DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    throw new Error("Test DATABASE_URL must use PostgreSQL.");
  }
  if (LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase())) {
    return;
  }

  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const clearlyTestOnly = TEST_IDENTITY_PATTERN.test(databaseName)
    || TEST_IDENTITY_PATTERN.test(parsed.hostname);
  if (
    !clearlyTestOnly
    || input.remoteConfirmation !== REMOTE_TEST_DATABASE_CONFIRMATION
  ) {
    throw new Error([
      "Refusing to run tests against a remote database that is not explicitly test-only.",
      "Use a loopback PostgreSQL database, or use a remote host/database whose name includes test, ci, or sandbox",
      `and set TEST_DATABASE_CONFIRM='${REMOTE_TEST_DATABASE_CONFIRMATION}'.`,
    ].join(" "));
  }
}
