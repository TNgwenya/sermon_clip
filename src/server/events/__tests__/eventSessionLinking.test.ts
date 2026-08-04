import { describe, expect, it, vi } from "vitest";

import type { TenantRequestContext } from "@/lib/tenancy/requestHeaders";
import {
  attachEventSessionToSermon,
  EventSessionLinkError,
  resolveEventSessionForIntake,
} from "@/server/events/eventSessionLinking";

const context: TenantRequestContext = {
  organizationId: "org-1",
  campusId: "campus-1",
  actorId: "user-1",
  authenticationMethod: "session",
};

function eventTransaction() {
  return {
    eventSession: {
      findFirst: vi.fn(),
      updateMany: vi.fn(),
    },
    auditEvent: {
      create: vi.fn(),
    },
  };
}

describe("event session intake linking", () => {
  it("does not change ordinary sermon intake when no event session is supplied", async () => {
    const tx = eventTransaction();

    await expect(resolveEventSessionForIntake(tx as never, context, ""))
      .resolves.toBeNull();
    expect(tx.eventSession.findFirst).not.toHaveBeenCalled();
  });

  it("resolves only a planned session in the active tenant and campus", async () => {
    const tx = eventTransaction();
    tx.eventSession.findFirst.mockResolvedValue({
      id: "session-1",
      eventId: "event-1",
      title: "Day 1 evening message",
      priority: 80,
      organizationId: "org-1",
      campusId: "campus-1",
      sermonId: null,
      event: { name: "Kingdom Conference" },
    });

    await expect(resolveEventSessionForIntake(tx as never, context, "session-1"))
      .resolves.toMatchObject({
        id: "session-1",
        eventId: "event-1",
        eventName: "Kingdom Conference",
      });
    expect(tx.eventSession.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        id: "session-1",
        organizationId: "org-1",
        campusId: "campus-1",
        status: "PLANNED",
      },
    }));
  });

  it("atomically links the recording and records the audit event", async () => {
    const tx = eventTransaction();
    tx.eventSession.updateMany.mockResolvedValue({ count: 1 });
    const session = {
      id: "session-1",
      eventId: "event-1",
      eventName: "Kingdom Conference",
      title: "Day 1 evening message",
      priority: 80,
      organizationId: "org-1",
      campusId: "campus-1",
      sermonId: null,
    };

    await attachEventSessionToSermon(tx as never, context, session, "sermon-1");

    expect(tx.eventSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: "session-1",
        organizationId: "org-1",
        sermonId: null,
        status: "PLANNED",
      },
      data: { sermonId: "sermon-1" },
    });
    expect(tx.auditEvent.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        action: "event.session.recording_attached",
        targetId: "session-1",
      }),
    }));
  });

  it("rejects a second recording instead of replacing the first", async () => {
    const tx = eventTransaction();
    tx.eventSession.updateMany.mockResolvedValue({ count: 0 });

    await expect(attachEventSessionToSermon(tx as never, context, {
      id: "session-1",
      eventId: "event-1",
      eventName: "Kingdom Conference",
      title: "Day 1 evening message",
      priority: 80,
      organizationId: "org-1",
      campusId: "campus-1",
      sermonId: null,
    }, "sermon-2")).rejects.toBeInstanceOf(EventSessionLinkError);
    expect(tx.auditEvent.create).not.toHaveBeenCalled();
  });
});
