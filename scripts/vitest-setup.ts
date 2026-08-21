import { readFileSync } from "node:fs";
import path from "node:path";

import { assertSafeTestDatabase } from "../src/lib/testDatabaseSafety";

function configuredDatabaseUrl(): string | undefined {
  if (process.env.DATABASE_URL?.trim()) {
    return process.env.DATABASE_URL;
  }

  for (const name of [".env.test.local", ".env.test", ".env"]) {
    let contents: string;
    try {
      contents = readFileSync(path.join(process.cwd(), name), "utf8");
    } catch {
      continue;
    }
    const match = contents.match(/^\s*(?:export\s+)?DATABASE_URL\s*=\s*(.*?)\s*$/m);
    if (!match?.[1]) {
      continue;
    }
    const raw = match[1].trim();
    if (
      (raw.startsWith('"') && raw.endsWith('"'))
      || (raw.startsWith("'") && raw.endsWith("'"))
    ) {
      return raw.slice(1, -1);
    }
    return raw;
  }

  return undefined;
}

assertSafeTestDatabase({
  databaseUrl: configuredDatabaseUrl(),
  remoteConfirmation: process.env.TEST_DATABASE_CONFIRM,
});
