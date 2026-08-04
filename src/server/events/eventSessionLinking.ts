import type { AppPrismaClient } from "@/lib/prisma";
import type { TenantRequestContext } from "@/lib/tenancy/requestHeaders";

type EventSessionLinkTransaction = Pick<
  AppPrismaClient,
  "eventSession" | "auditEvent"
>;

export class EventSessionLinkError extends Error {
  readonly code = "EVENT_SESSION_LINK_FAILED";

  constructor(message: string) {
    super(message);
    this.name = "EventSessionLinkError";
  }
}

export type ResolvedEventSessionIntake = {
  id: string;
  eventId: string;
  eventName: string;
  title: string;
  priority: number;
  organizationId: string;
  campusId: string | null;
  sermonId: string | null;
};

export async function resolveEventSessionForIntake(
  tx: EventSessionLinkTransaction,
  context: TenantRequestContext,
  eventSessionId: string | null | undefined,
): Promise<ResolvedEventSessionIntake | null> {
  const id = eventSessionId?.trim();
  if (!id) return null;

  const session = await tx.eventSession.findFirst({
    where: {
      id,
      organizationId: context.organizationId,
      ...(context.campusId ? { campusId: context.campusId } : {}),
      status: "PLANNED",
    },
    select: {
      id: true,
      eventId: true,
      title: true,
      priority: true,
      organizationId: true,
      campusId: true,
      sermonId: true,
      event: { select: { name: true } },
    },
  });

  if (!session) {
    throw new EventSessionLinkError(
      "This conference session is unavailable or you do not have permission to add its recording.",
    );
  }
  if (session.sermonId) {
    throw new EventSessionLinkError(
      "This conference session already has a recording. Open the existing session instead.",
    );
  }

  return {
    id: session.id,
    eventId: session.eventId,
    eventName: session.event.name,
    title: session.title,
    priority: session.priority,
    organizationId: session.organizationId,
    campusId: session.campusId,
    sermonId: session.sermonId,
  };
}

export async function attachEventSessionToSermon(
  tx: EventSessionLinkTransaction,
  context: TenantRequestContext,
  session: ResolvedEventSessionIntake | null,
  sermonId: string,
): Promise<void> {
  if (!session) return;

  const linked = await tx.eventSession.updateMany({
    where: {
      id: session.id,
      organizationId: context.organizationId,
      sermonId: null,
      status: "PLANNED",
    },
    data: { sermonId },
  });

  if (linked.count !== 1) {
    throw new EventSessionLinkError(
      "Another recording was attached to this conference session. Open the event dashboard to continue.",
    );
  }

  await tx.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      campusId: session.campusId,
      actorType: "USER",
      actorUserId: context.actorId,
      action: "event.session.recording_attached",
      targetType: "EventSession",
      targetId: session.id,
      metadataJson: {
        eventId: session.eventId,
        sermonId,
        sessionTitle: session.title,
      },
    },
  });
}
