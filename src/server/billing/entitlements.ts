import type {
  OrganizationEntitlement,
  Prisma,
  UsageEvent,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

export const METERED_ENTITLEMENT_KEYS = [
  "ai.tokens.monthly",
  "ai.audio_seconds.monthly",
  "media.seconds.monthly",
  "storage.bytes",
  "seats",
  "campuses",
  "social.connections",
] as const;

export type MeteredEntitlementKey = (typeof METERED_ENTITLEMENT_KEYS)[number];

export type UsageReservationInput = Readonly<{
  organizationId: string;
  campusId?: string | null;
  entitlementKey: MeteredEntitlementKey;
  metric: string;
  quantity: bigint;
  idempotencyKey: string;
  sourceType?: string | null;
  sourceId?: string | null;
  metadataJson?: Prisma.InputJsonValue;
  occurredAt?: Date;
}>;

export type UsageReservation = Readonly<{
  usageEvent: UsageEvent;
  usedBefore: bigint;
  usedAfter: bigint;
  limit: bigint | null;
  replayed: boolean;
}>;

export type UsageAvailability = Readonly<{
  used: bigint;
  limit: bigint | null;
  remaining: bigint | null;
}>;

export type EntitlementDenialReason =
  | "INVALID_REQUEST"
  | "ENTITLEMENT_MISSING"
  | "ENTITLEMENT_DISABLED"
  | "ENTITLEMENT_NOT_ACTIVE"
  | "LIMIT_EXCEEDED"
  | "IDEMPOTENCY_CONFLICT";

export class EntitlementError extends Error {
  readonly reason: EntitlementDenialReason;
  readonly limit: bigint | null;
  readonly used: bigint | null;

  constructor(
    reason: EntitlementDenialReason,
    message: string,
    details: Readonly<{ limit?: bigint | null; used?: bigint | null }> = {},
  ) {
    super(message);
    this.name = "EntitlementError";
    this.reason = reason;
    this.limit = details.limit ?? null;
    this.used = details.used ?? null;
  }
}

type EntitlementTransaction = {
  findUsageByIdempotencyKey(idempotencyKey: string): Promise<UsageEvent | null>;
  findEntitlement(
    organizationId: string,
    key: MeteredEntitlementKey,
  ): Promise<OrganizationEntitlement | null>;
  sumUsage(input: {
    organizationId: string;
    metric: string;
    from: Date;
    until: Date;
  }): Promise<bigint>;
  createUsage(input: UsageReservationInput & { occurredAt: Date }): Promise<UsageEvent>;
};

export type EntitlementRepository = {
  withSerializableTransaction<T>(
    operation: (transaction: EntitlementTransaction) => Promise<T>,
  ): Promise<T>;
};

function canonicalId(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized !== value) {
    throw new EntitlementError(
      "INVALID_REQUEST",
      `${label} must be a non-empty canonical identifier.`,
    );
  }
  return normalized;
}

function calendarMonthWindow(occurredAt: Date): { from: Date; until: Date } {
  if (Number.isNaN(occurredAt.getTime())) {
    throw new EntitlementError("INVALID_REQUEST", "Usage time must be valid.");
  }

  return {
    from: new Date(Date.UTC(
      occurredAt.getUTCFullYear(),
      occurredAt.getUTCMonth(),
      1,
    )),
    until: new Date(Date.UTC(
      occurredAt.getUTCFullYear(),
      occurredAt.getUTCMonth() + 1,
      1,
    )),
  };
}

function entitlementIsActive(
  entitlement: OrganizationEntitlement,
  occurredAt: Date,
): boolean {
  return entitlement.effectiveAt <= occurredAt
    && (entitlement.expiresAt === null || entitlement.expiresAt > occurredAt);
}

function assertReplayMatches(
  existing: UsageEvent,
  input: UsageReservationInput,
): void {
  if (
    existing.organizationId !== input.organizationId
    || existing.metric !== input.metric
    || existing.quantity !== input.quantity
  ) {
    throw new EntitlementError(
      "IDEMPOTENCY_CONFLICT",
      "This usage idempotency key was already used for a different reservation.",
    );
  }
}

export function createEntitlementService(repository: EntitlementRepository) {
  async function assertUsageAvailable(
    input: Readonly<{
      organizationId: string;
      entitlementKey: MeteredEntitlementKey;
      metric: string;
      requestedQuantity?: bigint;
      occurredAt?: Date;
    }>,
  ): Promise<UsageAvailability> {
    canonicalId(input.organizationId, "Organization id");
    canonicalId(input.entitlementKey, "Entitlement key");
    canonicalId(input.metric, "Usage metric");
    const requestedQuantity = input.requestedQuantity ?? BigInt(1);
    if (requestedQuantity <= BigInt(0)) {
      throw new EntitlementError(
        "INVALID_REQUEST",
        "Requested usage quantity must be greater than zero.",
      );
    }
    const occurredAt = input.occurredAt ?? new Date();
    const { from, until } = calendarMonthWindow(occurredAt);

    return repository.withSerializableTransaction(async (transaction) => {
      const entitlement = await transaction.findEntitlement(
        input.organizationId,
        input.entitlementKey,
      );
      if (!entitlement) {
        throw new EntitlementError(
          "ENTITLEMENT_MISSING",
          `The organization does not have the ${input.entitlementKey} entitlement.`,
        );
      }
      if (!entitlement.enabled) {
        throw new EntitlementError(
          "ENTITLEMENT_DISABLED",
          `The ${input.entitlementKey} entitlement is disabled.`,
          { limit: entitlement.limitValue },
        );
      }
      if (!entitlementIsActive(entitlement, occurredAt)) {
        throw new EntitlementError(
          "ENTITLEMENT_NOT_ACTIVE",
          `The ${input.entitlementKey} entitlement is not active.`,
          { limit: entitlement.limitValue },
        );
      }

      const used = await transaction.sumUsage({
        organizationId: input.organizationId,
        metric: input.metric,
        from,
        until,
      });
      if (
        entitlement.limitValue !== null
        && used + requestedQuantity > entitlement.limitValue
      ) {
        throw new EntitlementError(
          "LIMIT_EXCEEDED",
          `The ${input.entitlementKey} usage limit would be exceeded.`,
          { limit: entitlement.limitValue, used },
        );
      }
      return {
        used,
        limit: entitlement.limitValue,
        remaining: entitlement.limitValue === null
          ? null
          : entitlement.limitValue - used,
      };
    });
  }

  async function reserveUsage(
    input: UsageReservationInput,
  ): Promise<UsageReservation> {
    canonicalId(input.organizationId, "Organization id");
    canonicalId(input.entitlementKey, "Entitlement key");
    canonicalId(input.metric, "Usage metric");
    canonicalId(input.idempotencyKey, "Idempotency key");
    if (input.campusId !== undefined && input.campusId !== null) {
      canonicalId(input.campusId, "Campus id");
    }
    if (input.quantity <= BigInt(0)) {
      throw new EntitlementError(
        "INVALID_REQUEST",
        "Usage quantity must be greater than zero.",
      );
    }

    const occurredAt = input.occurredAt ?? new Date();
    const { from, until } = calendarMonthWindow(occurredAt);

    return repository.withSerializableTransaction(async (transaction) => {
      const existing = await transaction.findUsageByIdempotencyKey(
        input.idempotencyKey,
      );
      if (existing) {
        assertReplayMatches(existing, input);
        const usedBefore = await transaction.sumUsage({
          organizationId: input.organizationId,
          metric: input.metric,
          from,
          until,
        });
        const entitlement = await transaction.findEntitlement(
          input.organizationId,
          input.entitlementKey,
        );
        return {
          usageEvent: existing,
          usedBefore,
          usedAfter: usedBefore,
          limit: entitlement?.limitValue ?? null,
          replayed: true,
        };
      }

      const entitlement = await transaction.findEntitlement(
        input.organizationId,
        input.entitlementKey,
      );
      if (!entitlement) {
        throw new EntitlementError(
          "ENTITLEMENT_MISSING",
          `The organization does not have the ${input.entitlementKey} entitlement.`,
        );
      }
      if (!entitlement.enabled) {
        throw new EntitlementError(
          "ENTITLEMENT_DISABLED",
          `The ${input.entitlementKey} entitlement is disabled.`,
          { limit: entitlement.limitValue },
        );
      }
      if (!entitlementIsActive(entitlement, occurredAt)) {
        throw new EntitlementError(
          "ENTITLEMENT_NOT_ACTIVE",
          `The ${input.entitlementKey} entitlement is not active.`,
          { limit: entitlement.limitValue },
        );
      }

      const usedBefore = await transaction.sumUsage({
        organizationId: input.organizationId,
        metric: input.metric,
        from,
        until,
      });
      const usedAfter = usedBefore + input.quantity;
      if (
        entitlement.limitValue !== null
        && usedAfter > entitlement.limitValue
      ) {
        throw new EntitlementError(
          "LIMIT_EXCEEDED",
          `The ${input.entitlementKey} usage limit would be exceeded.`,
          {
            limit: entitlement.limitValue,
            used: usedBefore,
          },
        );
      }

      const usageEvent = await transaction.createUsage({
        ...input,
        occurredAt,
      });
      return {
        usageEvent,
        usedBefore,
        usedAfter,
        limit: entitlement.limitValue,
        replayed: false,
      };
    });
  }

  return { assertUsageAvailable, reserveUsage };
}

const prismaEntitlementRepository: EntitlementRepository = {
  withSerializableTransaction(operation) {
    return prisma.$transaction(
      async (transaction) => operation({
        findUsageByIdempotencyKey(idempotencyKey) {
          return transaction.usageEvent.findUnique({
            where: { idempotencyKey },
          });
        },
        findEntitlement(organizationId, key) {
          return transaction.organizationEntitlement.findUnique({
            where: {
              organizationId_key: {
                organizationId,
                key,
              },
            },
          });
        },
        async sumUsage(input) {
          const aggregate = await transaction.usageEvent.aggregate({
            where: {
              organizationId: input.organizationId,
              metric: input.metric,
              occurredAt: {
                gte: input.from,
                lt: input.until,
              },
            },
            _sum: { quantity: true },
          });
          return aggregate._sum.quantity ?? BigInt(0);
        },
        createUsage(input) {
          return transaction.usageEvent.create({
            data: {
              organizationId: input.organizationId,
              campusId: input.campusId ?? null,
              metric: input.metric,
              quantity: input.quantity,
              idempotencyKey: input.idempotencyKey,
              sourceType: input.sourceType ?? null,
              sourceId: input.sourceId ?? null,
              metadataJson: input.metadataJson,
              occurredAt: input.occurredAt,
            },
          });
        },
      }),
      {
        isolationLevel: "Serializable",
      },
    );
  },
};

export const entitlements = createEntitlementService(
  prismaEntitlementRepository,
);

export const __entitlementTestUtils = {
  calendarMonthWindow,
  entitlementIsActive,
};
