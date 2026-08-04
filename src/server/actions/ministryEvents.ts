"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import {
  createEventSessionSchema,
  createMinistryEventSchema,
  type CreateEventSessionInput,
  type CreateMinistryEventInput,
  eventDayNumber,
  eventSessionInstant,
  initialMinistryEventStatus,
  parseDateInput,
} from "@/lib/ministryEvents";
import { prisma } from "@/lib/prisma";
import { requirePersistedTenantCapability, requireRequestCapability } from "@/server/auth/requestAuthorization";
import { tenantResourceScope } from "@/server/tenancy/scope";

export type CreateMinistryEventFormState = {
  success: boolean;
  message: string;
  createdEventId?: string;
  fieldErrors?: Partial<Record<
    | "name"
    | "eventType"
    | "theme"
    | "description"
    | "venue"
    | "timezone"
    | "startDate"
    | "endDate"
    | "primaryBrandColor"
    | "secondaryBrandColor",
    string
  >>;
};

export type CreateEventSessionFormState = {
  success: boolean;
  message: string;
  createdSessionId?: string;
  fieldErrors?: Partial<Record<
    | "title"
    | "sessionType"
    | "speakerName"
    | "language"
    | "sessionDate"
    | "startTime"
    | "endTime"
    | "priority"
    | "notes",
    string
  >>;
};

function optional(value: FormDataEntryValue | null): string {
  return String(value ?? "").trim();
}

function eventFieldErrors(
  error: z.ZodError<CreateMinistryEventInput>,
): CreateMinistryEventFormState["fieldErrors"] {
  const fields = error.flatten().fieldErrors;
  return {
    name: fields.name?.[0],
    eventType: fields.eventType?.[0],
    theme: fields.theme?.[0],
    description: fields.description?.[0],
    venue: fields.venue?.[0],
    timezone: fields.timezone?.[0],
    startDate: fields.startDate?.[0],
    endDate: fields.endDate?.[0],
    primaryBrandColor: fields.primaryBrandColor?.[0],
    secondaryBrandColor: fields.secondaryBrandColor?.[0],
  };
}

function sessionFieldErrors(
  error: z.ZodError<CreateEventSessionInput>,
): CreateEventSessionFormState["fieldErrors"] {
  const fields = error.flatten().fieldErrors;
  return {
    title: fields.title?.[0],
    sessionType: fields.sessionType?.[0],
    speakerName: fields.speakerName?.[0],
    language: fields.language?.[0],
    sessionDate: fields.sessionDate?.[0],
    startTime: fields.startTime?.[0],
    endTime: fields.endTime?.[0],
    priority: fields.priority?.[0],
    notes: fields.notes?.[0],
  };
}

export async function createMinistryEventAction(
  _previousState: CreateMinistryEventFormState,
  formData: FormData,
): Promise<CreateMinistryEventFormState> {
  const requestContext = await requireRequestCapability("sermons.create");
  const parsed = createMinistryEventSchema.safeParse({
    name: optional(formData.get("name")),
    eventType: optional(formData.get("eventType")),
    theme: optional(formData.get("theme")),
    description: optional(formData.get("description")),
    venue: optional(formData.get("venue")),
    timezone: optional(formData.get("timezone")),
    startDate: optional(formData.get("startDate")),
    endDate: optional(formData.get("endDate")),
    primaryBrandColor: optional(formData.get("primaryBrandColor")),
    secondaryBrandColor: optional(formData.get("secondaryBrandColor")),
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Please correct the highlighted event details.",
      fieldErrors: eventFieldErrors(parsed.error),
    };
  }

  const startDate = parseDateInput(parsed.data.startDate);
  const endDate = parseDateInput(parsed.data.endDate);
  if (!startDate || !endDate) {
    return {
      success: false,
      message: "Please choose valid event dates.",
      fieldErrors: { startDate: !startDate ? "Choose a valid date." : undefined, endDate: !endDate ? "Choose a valid date." : undefined },
    };
  }

  const event = await prisma.$transaction(async (tx) => {
    const created = await tx.ministryEvent.create({
      data: {
        organizationId: requestContext.organizationId,
        campusId: requestContext.campusId,
        name: parsed.data.name,
        eventType: parsed.data.eventType,
        theme: parsed.data.theme || null,
        description: parsed.data.description || null,
        venue: parsed.data.venue || null,
        timezone: parsed.data.timezone,
        startDate,
        endDate,
        status: initialMinistryEventStatus(parsed.data),
        primaryBrandColor: parsed.data.primaryBrandColor || null,
        secondaryBrandColor: parsed.data.secondaryBrandColor || null,
        createdByUserId: requestContext.actorId,
      },
      select: { id: true, name: true, status: true },
    });

    await tx.auditEvent.create({
      data: {
        organizationId: requestContext.organizationId,
        campusId: requestContext.campusId,
        actorType: "USER",
        actorUserId: requestContext.actorId,
        action: "event.created",
        targetType: "MinistryEvent",
        targetId: created.id,
        metadataJson: {
          name: created.name,
          status: created.status,
          startDate: parsed.data.startDate,
          endDate: parsed.data.endDate,
        },
      },
    });
    return created;
  });

  revalidatePath("/events");
  return {
    success: true,
    message: `${event.name} is ready. Add the programme sessions next.`,
    createdEventId: event.id,
  };
}

export async function addEventSessionAction(
  _previousState: CreateEventSessionFormState,
  formData: FormData,
): Promise<CreateEventSessionFormState> {
  const requestContext = await requireRequestCapability("sermons.create");
  const parsed = createEventSessionSchema.safeParse({
    eventId: optional(formData.get("eventId")),
    title: optional(formData.get("title")),
    sessionType: optional(formData.get("sessionType")),
    speakerName: optional(formData.get("speakerName")),
    language: optional(formData.get("language")),
    sessionDate: optional(formData.get("sessionDate")),
    startTime: optional(formData.get("startTime")),
    endTime: optional(formData.get("endTime")),
    priority: optional(formData.get("priority")) || "50",
    notes: optional(formData.get("notes")),
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Please correct the highlighted session details.",
      fieldErrors: sessionFieldErrors(parsed.error),
    };
  }

  const event = await prisma.ministryEvent.findFirst({
    where: tenantResourceScope(requestContext, parsed.data.eventId),
    select: {
      id: true,
      organizationId: true,
      campusId: true,
      name: true,
      timezone: true,
      startDate: true,
      endDate: true,
      status: true,
    },
  });
  if (!event || event.status === "ARCHIVED") {
    return {
      success: false,
      message: "This event is unavailable or archived.",
    };
  }

  await requirePersistedTenantCapability(requestContext, "sermons.create", {
    campusId: event.campusId,
    resource: { kind: "EVENT", id: event.id },
  });

  const sessionDate = parseDateInput(parsed.data.sessionDate);
  if (!sessionDate || sessionDate < event.startDate || sessionDate > event.endDate) {
    return {
      success: false,
      message: "The session must fall within the event dates.",
      fieldErrors: { sessionDate: "Choose a date within this event." },
    };
  }

  const scheduledStartAt = eventSessionInstant({
    sessionDate: parsed.data.sessionDate,
    time: parsed.data.startTime,
    timezone: event.timezone,
  });
  const scheduledEndAt = parsed.data.endTime
    ? eventSessionInstant({
        sessionDate: parsed.data.sessionDate,
        time: parsed.data.endTime,
        timezone: event.timezone,
      })
    : null;
  if (!scheduledStartAt || (parsed.data.endTime && !scheduledEndAt)) {
    return {
      success: false,
      message: "The session time could not be resolved in the event timezone.",
      fieldErrors: { startTime: !scheduledStartAt ? "Choose a valid local time." : undefined, endTime: parsed.data.endTime && !scheduledEndAt ? "Choose a valid local time." : undefined },
    };
  }

  const dayNumber = eventDayNumber(event.startDate, sessionDate);
  try {
    const session = await prisma.$transaction(async (tx) => {
      const latest = await tx.eventSession.findFirst({
        where: { eventId: event.id, dayNumber },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      const created = await tx.eventSession.create({
        data: {
          organizationId: event.organizationId,
          campusId: event.campusId,
          eventId: event.id,
          title: parsed.data.title,
          sessionType: parsed.data.sessionType,
          speakerName: parsed.data.speakerName || null,
          language: parsed.data.language || null,
          scheduledStartAt,
          scheduledEndAt,
          dayNumber,
          sortOrder: (latest?.sortOrder ?? 0) + 1,
          priority: parsed.data.priority,
          notes: parsed.data.notes || null,
        },
        select: { id: true, title: true },
      });
      await tx.auditEvent.create({
        data: {
          organizationId: event.organizationId,
          campusId: event.campusId,
          actorType: "USER",
          actorUserId: requestContext.actorId,
          action: "event.session.created",
          targetType: "EventSession",
          targetId: created.id,
          metadataJson: {
            eventId: event.id,
            title: created.title,
            dayNumber,
            scheduledStartAt: scheduledStartAt.toISOString(),
          },
        },
      });
      return created;
    });

    revalidatePath(`/events/${event.id}`);
    revalidatePath("/events");
    return {
      success: true,
      message: `${session.title} was added to Day ${dayNumber}.`,
      createdSessionId: session.id,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown session save error.";
    return {
      success: false,
      message: message.includes("Unique constraint")
        ? "Another session was added at the same time. Submit this session once more."
        : "The session could not be saved. Please try again.",
    };
  }
}

const eventStatusSchema = z.enum(["DRAFT", "UPCOMING", "ACTIVE", "COMPLETED", "ARCHIVED"]);

export async function updateMinistryEventStatusAction(formData: FormData): Promise<void> {
  const eventId = optional(formData.get("eventId"));
  const status = eventStatusSchema.safeParse(optional(formData.get("status")));
  if (!eventId || !status.success) return;

  const requestContext = await requireRequestCapability("sermons.update");
  const event = await prisma.ministryEvent.findFirst({
    where: tenantResourceScope(requestContext, eventId),
    select: { id: true, campusId: true, status: true },
  });
  if (!event || event.status === status.data) return;

  await requirePersistedTenantCapability(requestContext, "sermons.update", {
    campusId: event.campusId,
    resource: { kind: "EVENT", id: event.id },
  });
  await prisma.$transaction([
    prisma.ministryEvent.update({
      where: { id: event.id },
      data: { status: status.data },
    }),
    prisma.auditEvent.create({
      data: {
        organizationId: requestContext.organizationId,
        campusId: event.campusId,
        actorType: "USER",
        actorUserId: requestContext.actorId,
        action: "event.status_changed",
        targetType: "MinistryEvent",
        targetId: event.id,
        metadataJson: { from: event.status, to: status.data },
      },
    }),
  ]);
  revalidatePath(`/events/${event.id}`);
  revalidatePath("/events");
}
