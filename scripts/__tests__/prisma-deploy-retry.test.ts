import { describe, expect, it, vi } from "vitest";

import {
  isRetryableDatabaseConnectionError,
  withDatabaseConnectionRetry,
} from "../prisma-deploy-retry.mjs";

describe("Prisma deploy connection retry classification", () => {
  it.each([
    { code: "P1001", message: "Database is unavailable" },
    { errorCode: "P1002", message: "Database timed out" },
    { code: "P1008", message: "Operation timed out" },
    { code: "P1017", message: "Server closed the connection" },
    new Error("Can't reach database server at `example.neon.tech:5432`"),
    new Error("connect ECONNRESET 192.0.2.10:5432"),
  ])("retries a temporary database connection error", (error) => {
    expect(isRetryableDatabaseConnectionError(error)).toBe(true);
  });

  it("recognizes a retryable connection error nested as a cause", () => {
    const connectionError = Object.assign(new Error("database is waking"), { code: "P1001" });
    const wrapped = new Error("Unable to inspect migration state", { cause: connectionError });

    expect(isRetryableDatabaseConnectionError(wrapped)).toBe(true);
  });

  it.each([
    Object.assign(new Error("Unique constraint failed"), { code: "P2002" }),
    Object.assign(new Error("Failed migrations found in the target database"), { code: "P3009" }),
    new Error("The column `publishedAt` does not exist"),
    new Error("Authentication failed against database server"),
  ])("keeps schema, migration, and authentication failures fatal", (error) => {
    expect(isRetryableDatabaseConnectionError(error)).toBe(false);
  });
});

describe("Prisma deploy connection retry behavior", () => {
  it("recovers from a temporary Neon-style connection failure", async () => {
    const connectionError = Object.assign(new Error("Can't reach database server"), { code: "P1001" });
    const operation = vi.fn()
      .mockRejectedValueOnce(connectionError)
      .mockRejectedValueOnce(connectionError)
      .mockResolvedValue({ hasMigrationTable: true });
    const sleep = vi.fn().mockResolvedValue(undefined);
    const onRetry = vi.fn();

    await expect(withDatabaseConnectionRetry(operation, {
      maxAttempts: 4,
      baseDelayMs: 250,
      maxDelayMs: 1_000,
      sleep,
      onRetry,
    })).resolves.toEqual({ hasMigrationTable: true });

    expect(operation).toHaveBeenCalledTimes(3);
    expect(operation.mock.calls.map(([context]) => context)).toEqual([
      { attempt: 1, maxAttempts: 4 },
      { attempt: 2, maxAttempts: 4 },
      { attempt: 3, maxAttempts: 4 },
    ]);
    expect(sleep.mock.calls).toEqual([[250], [500]]);
    expect(onRetry).toHaveBeenNthCalledWith(1, expect.objectContaining({
      attempt: 1,
      nextAttempt: 2,
      maxAttempts: 4,
      delayMs: 250,
      error: connectionError,
    }));
  });

  it("uses deterministic capped exponential backoff", async () => {
    const connectionError = Object.assign(new Error("database unavailable"), { code: "P1001" });
    const operation = vi.fn()
      .mockRejectedValueOnce(connectionError)
      .mockRejectedValueOnce(connectionError)
      .mockRejectedValueOnce(connectionError)
      .mockResolvedValue("connected");
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withDatabaseConnectionRetry(operation, {
      maxAttempts: 4,
      baseDelayMs: 100,
      maxDelayMs: 250,
      sleep,
    })).resolves.toBe("connected");

    expect(sleep.mock.calls).toEqual([[100], [200], [250]]);
  });

  it("throws a fatal migration error immediately without sleeping", async () => {
    const migrationError = Object.assign(
      new Error("Failed migrations found in the target database"),
      { code: "P3009" },
    );
    const operation = vi.fn().mockRejectedValue(migrationError);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withDatabaseConnectionRetry(operation, { sleep })).rejects.toBe(migrationError);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("rethrows the original connection error after the final attempt", async () => {
    const connectionError = Object.assign(new Error("Can't reach database server"), { code: "P1001" });
    const operation = vi.fn().mockRejectedValue(connectionError);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(withDatabaseConnectionRetry(operation, {
      maxAttempts: 3,
      baseDelayMs: 10,
      maxDelayMs: 10,
      sleep,
    })).rejects.toBe(connectionError);

    expect(operation).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[10], [10]]);
  });
});
