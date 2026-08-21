import { describe, expect, it, vi } from "vitest";

import type { PublishingAuditEvent } from "@/server/publishing/governedConnector";
import {
  __prismaPublishingAuditTestUtils,
  PrismaPublishingAuditRepository,
} from "@/server/publishing/prismaPublishingAuditRepository";

const event: PublishingAuditEvent = {
  id: "event-1",
  organizationId: "org-1",
  campusId: "campus-1",
  scheduledPostId: "post-1",
  intentId: "intent-1",
  actorId: "publisher-1",
  handoffRole: "PUBLISHER",
  eventType: "RECONCILIATION_RECORDED",
  outcome: "FAILED",
  detail: "Check the platform before retrying.",
  occurredAt: "2026-08-21T10:00:00.000Z",
};

describe("PrismaPublishingAuditRepository", () => {
  it("persists connector history in the existing AuditEvent model", async () => {
    const create = vi.fn().mockResolvedValue({ id: "audit-1" });
    const repository = new PrismaPublishingAuditRepository({
      auditEvent: { create },
    } as never);

    await repository.append(event);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        organizationId: "org-1",
        campusId: "campus-1",
        actorUserId: "publisher-1",
        action: __prismaPublishingAuditTestUtils.PUBLISHING_AUDIT_ACTION,
        targetType: "ScheduledPost",
        targetId: "post-1",
        metadataJson: expect.objectContaining({
          intentId: "intent-1",
          outcome: "FAILED",
        }),
      }),
    });
  });

  it("queries history with exact church, campus, and scheduled-post scope", async () => {
    const findMany = vi.fn().mockResolvedValue([{
      id: "audit-1",
      organizationId: "org-1",
      campusId: "campus-1",
      actorUserId: "publisher-1",
      targetId: "post-1",
      occurredAt: new Date(event.occurredAt),
      metadataJson: {
        schemaVersion: 1,
        eventId: event.id,
        intentId: event.intentId,
        handoffRole: event.handoffRole,
        eventType: event.eventType,
        outcome: event.outcome,
        detail: event.detail,
      },
    }]);
    const repository = new PrismaPublishingAuditRepository({
      auditEvent: { findMany },
    } as never);

    const events = await repository.list({
      organizationId: "org-1",
      campusId: "campus-1",
      scheduledPostId: "post-1",
    });

    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        organizationId: "org-1",
        campusId: "campus-1",
        targetId: "post-1",
      }),
    }));
    expect(events).toEqual([event]);
  });
});
