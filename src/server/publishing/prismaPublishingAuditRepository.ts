import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import type {
  PublishingAuditEvent,
  PublishingAuditRepository,
  PublishingHandoffRole,
} from "@/server/publishing/governedConnector";

type PublishingAuditDb = Pick<typeof prisma, "auditEvent">;

const PUBLISHING_AUDIT_ACTION = "publishing.governed_handoff";

function readString(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === "string" ? record[key] as string : "";
}

function readHandoffRole(value: unknown): PublishingHandoffRole | null {
  return value === "PASTOR_APPROVER"
    || value === "COMMUNICATIONS_PREPARER"
    || value === "PUBLISHER"
    ? value
    : null;
}

/** Durable AuditEvent-backed history; it does not alter ScheduledPost state. */
export class PrismaPublishingAuditRepository implements PublishingAuditRepository {
  constructor(private readonly db: PublishingAuditDb = prisma) {}

  async append(event: PublishingAuditEvent): Promise<void> {
    await this.db.auditEvent.create({
      data: {
        organizationId: event.organizationId,
        campusId: event.campusId,
        actorType: "USER",
        actorUserId: event.actorId,
        action: PUBLISHING_AUDIT_ACTION,
        targetType: "ScheduledPost",
        targetId: event.scheduledPostId,
        metadataJson: {
          schemaVersion: 1,
          eventId: event.id,
          intentId: event.intentId,
          handoffRole: event.handoffRole,
          eventType: event.eventType,
          outcome: event.outcome,
          detail: event.detail,
        },
        occurredAt: new Date(event.occurredAt),
      },
    });
  }

  async list(scope: {
    organizationId: string;
    campusId: string | null;
    scheduledPostId?: string;
  }): Promise<PublishingAuditEvent[]> {
    const rows = await this.db.auditEvent.findMany({
      where: {
        organizationId: scope.organizationId,
        campusId: scope.campusId,
        action: PUBLISHING_AUDIT_ACTION,
        targetType: "ScheduledPost",
        ...(scope.scheduledPostId ? { targetId: scope.scheduledPostId } : {}),
      },
      orderBy: { occurredAt: "asc" },
      take: 200,
    });

    return rows.flatMap((row) => {
      if (!row.metadataJson || typeof row.metadataJson !== "object" || Array.isArray(row.metadataJson)) {
        return [];
      }
      const metadata = row.metadataJson as Prisma.JsonObject;
      const role = readHandoffRole(metadata["handoffRole"]);
      const eventType = readString(metadata, "eventType") as PublishingAuditEvent["eventType"];
      if (
        metadata["schemaVersion"] !== 1
        || !role
        || ![
          "INTENT_BLOCKED",
          "PRIVATE_HANDOFF_STAGED",
          "IDEMPOTENT_REPLAY",
          "RECONCILIATION_RECORDED",
        ].includes(eventType)
      ) {
        return [];
      }

      return [{
        id: readString(metadata, "eventId") || row.id,
        organizationId: row.organizationId,
        campusId: row.campusId,
        scheduledPostId: row.targetId ?? "",
        intentId: readString(metadata, "intentId"),
        actorId: row.actorUserId ?? "system",
        handoffRole: role,
        eventType,
        outcome: readString(metadata, "outcome"),
        detail: readString(metadata, "detail"),
        occurredAt: row.occurredAt.toISOString(),
      }];
    });
  }
}

export const __prismaPublishingAuditTestUtils = {
  PUBLISHING_AUDIT_ACTION,
};
