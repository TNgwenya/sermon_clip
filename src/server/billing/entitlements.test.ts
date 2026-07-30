import type {
  OrganizationEntitlement,
  UsageEvent,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import {
  createEntitlementService,
  EntitlementError,
  type EntitlementRepository,
} from "@/server/billing/entitlements";

const NOW = new Date("2026-07-29T12:00:00.000Z");

function entitlement(
  overrides: Partial<OrganizationEntitlement> = {},
): OrganizationEntitlement {
  return {
    id: "entitlement_one",
    organizationId: "org_one",
    key: "ai.tokens.monthly",
    enabled: true,
    limitValue: BigInt(1_000),
    valueJson: null,
    source: "PLAN",
    effectiveAt: new Date("2026-07-01T00:00:00.000Z"),
    expiresAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function repository(options: {
  entitlement?: OrganizationEntitlement | null;
  existing?: UsageEvent | null;
  used?: bigint;
} = {}): {
  repository: EntitlementRepository;
  created: UsageEvent[];
} {
  const created: UsageEvent[] = [];
  return {
    created,
    repository: {
      async withSerializableTransaction(operation) {
        return operation({
          async findUsageByIdempotencyKey() {
            return options.existing ?? null;
          },
          async findEntitlement() {
            return options.entitlement === undefined
              ? entitlement()
              : options.entitlement;
          },
          async sumUsage() {
            return options.used ?? BigInt(0);
          },
          async createUsage(input) {
            const event: UsageEvent = {
              id: "usage_one",
              organizationId: input.organizationId,
              campusId: input.campusId ?? null,
              metric: input.metric,
              quantity: input.quantity,
              sourceType: input.sourceType ?? null,
              sourceId: input.sourceId ?? null,
              idempotencyKey: input.idempotencyKey,
              metadataJson: (input.metadataJson ?? null) as UsageEvent["metadataJson"],
              occurredAt: input.occurredAt,
              createdAt: input.occurredAt,
            };
            created.push(event);
            return event;
          },
        });
      },
    },
  };
}

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org_one",
    campusId: "campus_one",
    entitlementKey: "ai.tokens.monthly" as const,
    metric: "ai.tokens",
    quantity: BigInt(250),
    idempotencyKey: "ai:invocation:one",
    occurredAt: NOW,
    ...overrides,
  };
}

describe("organization entitlement service", () => {
  it("checks availability before an expensive operation begins", async () => {
    const service = createEntitlementService(repository({
      used: BigInt(500),
    }).repository);

    await expect(service.assertUsageAvailable({
      organizationId: "org_one",
      entitlementKey: "ai.tokens.monthly",
      metric: "ai.tokens",
      requestedQuantity: BigInt(250),
      occurredAt: NOW,
    })).resolves.toEqual({
      used: BigInt(500),
      limit: BigInt(1_000),
      remaining: BigInt(500),
    });
  });

  it("reserves metered usage below the active limit", async () => {
    const store = repository({ used: BigInt(500) });
    const service = createEntitlementService(store.repository);

    await expect(service.reserveUsage(reservation())).resolves.toMatchObject({
      usedBefore: BigInt(500),
      usedAfter: BigInt(750),
      limit: BigInt(1_000),
      replayed: false,
    });
    expect(store.created).toHaveLength(1);
  });

  it("fails closed when an entitlement is absent or disabled", async () => {
    const missing = createEntitlementService(repository({
      entitlement: null,
    }).repository);
    const disabled = createEntitlementService(repository({
      entitlement: entitlement({ enabled: false }),
    }).repository);

    await expect(missing.reserveUsage(reservation())).rejects.toMatchObject({
      reason: "ENTITLEMENT_MISSING",
    });
    await expect(disabled.reserveUsage(reservation())).rejects.toMatchObject({
      reason: "ENTITLEMENT_DISABLED",
    });
  });

  it("rejects usage that would exceed the configured limit", async () => {
    const service = createEntitlementService(repository({
      used: BigInt(900),
    }).repository);

    await expect(service.reserveUsage(reservation())).rejects.toMatchObject({
      reason: "LIMIT_EXCEEDED",
      limit: BigInt(1_000),
      used: BigInt(900),
    });
  });

  it("returns an idempotent replay without creating another event", async () => {
    const existing: UsageEvent = {
      id: "usage_existing",
      organizationId: "org_one",
      campusId: "campus_one",
      metric: "ai.tokens",
      quantity: BigInt(250),
      sourceType: null,
      sourceId: null,
      idempotencyKey: "ai:invocation:one",
      metadataJson: null,
      occurredAt: NOW,
      createdAt: NOW,
    };
    const store = repository({ existing, used: BigInt(750) });
    const service = createEntitlementService(store.repository);

    await expect(service.reserveUsage(reservation())).resolves.toMatchObject({
      usageEvent: existing,
      usedBefore: BigInt(750),
      usedAfter: BigInt(750),
      replayed: true,
    });
    expect(store.created).toHaveLength(0);
  });

  it("rejects idempotency-key reuse across organizations or metrics", async () => {
    const existing: UsageEvent = {
      id: "usage_existing",
      organizationId: "org_other",
      campusId: null,
      metric: "media.seconds",
      quantity: BigInt(1),
      sourceType: null,
      sourceId: null,
      idempotencyKey: "ai:invocation:one",
      metadataJson: null,
      occurredAt: NOW,
      createdAt: NOW,
    };
    const service = createEntitlementService(repository({ existing }).repository);

    await expect(service.reserveUsage(reservation())).rejects.toBeInstanceOf(
      EntitlementError,
    );
    await expect(service.reserveUsage(reservation())).rejects.toMatchObject({
      reason: "IDEMPOTENCY_CONFLICT",
    });
  });

  it("rejects non-positive usage quantities", async () => {
    const service = createEntitlementService(repository().repository);

    await expect(service.reserveUsage(reservation({
      quantity: BigInt(0),
    }))).rejects.toMatchObject({ reason: "INVALID_REQUEST" });
  });
});
