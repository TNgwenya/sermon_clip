import { describe, expect, it } from "vitest";

import {
  REMOTE_TEST_DATABASE_CONFIRMATION,
  assertSafeTestDatabase,
} from "@/lib/testDatabaseSafety";

describe("test database safety", () => {
  it.each([
    "postgresql://postgres:postgres@localhost:5432/sermon_clip_test",
    "postgresql://postgres:postgres@127.0.0.1:5432/sermon_clip_test",
    "postgresql://postgres:postgres@[::1]:5432/sermon_clip_test",
  ])("allows a loopback test database: %s", (databaseUrl) => {
    expect(() => assertSafeTestDatabase({ databaseUrl })).not.toThrow();
  });

  it("rejects the configured production-style remote database by default", () => {
    expect(() => assertSafeTestDatabase({
      databaseUrl: "postgresql://app:secret@production.example/neondb",
    })).toThrow(/Refusing to run tests against a remote database/);
  });

  it("still rejects a production-named remote database with confirmation", () => {
    expect(() => assertSafeTestDatabase({
      databaseUrl: "postgresql://app:secret@production.example/neondb",
      remoteConfirmation: REMOTE_TEST_DATABASE_CONFIRMATION,
    })).toThrow(/Refusing to run tests against a remote database/);
  });

  it("allows an explicitly confirmed dedicated remote test database", () => {
    expect(() => assertSafeTestDatabase({
      databaseUrl: "postgresql://app:secret@db.example/sermon_clip_test",
      remoteConfirmation: REMOTE_TEST_DATABASE_CONFIRMATION,
    })).not.toThrow();
  });
});
