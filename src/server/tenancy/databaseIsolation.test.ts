import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: mocks.transaction,
  },
}));

import { withDatabaseTenantIsolation } from "@/server/tenancy/databaseIsolation";

describe("database tenant isolation context", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.queryRaw.mockResolvedValue([{ set_config: "" }]);
    mocks.transaction.mockImplementation(async (callback) => callback({
      $queryRaw: mocks.queryRaw,
    }));
  });

  it("sets transaction-local organization and campus context before database work", async () => {
    const operation = vi.fn(async () => "isolated-result");

    await expect(withDatabaseTenantIsolation({
      organizationId: "org-one",
      campusId: "campus-one",
    }, operation)).resolves.toBe("isolated-result");

    expect(mocks.queryRaw).toHaveBeenCalledTimes(1);
    expect(mocks.queryRaw.mock.calls[0]?.slice(1)).toEqual([
      "org-one",
      "campus-one",
    ]);
    expect(operation).toHaveBeenCalledTimes(1);
    expect(mocks.queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      operation.mock.invocationCallOrder[0]!,
    );
  });

  it("rejects an empty organization instead of creating a fail-open context", async () => {
    await expect(withDatabaseTenantIsolation(
      { organizationId: " " },
      async () => undefined,
    )).rejects.toThrow("Organization id is required");

    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
