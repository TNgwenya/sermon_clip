import { createHash } from "node:crypto";

import { Prisma } from "@prisma/client";
import type {
  WeekDraftItemFormat,
  WeekDraftItemStatus,
  WeekDraftProvenanceType,
  WeekDraftStatus,
} from "@prisma/client";

import type { AppPrismaClient } from "@/lib/prisma";
import {
  assertWeekDraftProvenance,
  assertWeekDraftItemStatusTransition,
  assertWeekDraftStatusTransition,
  normalizeWeekDraftItemOrder,
  weekDraftTenantWhere,
  type WeekDraftTenantContext,
} from "@/server/weekDraft/domain";

type WeekDraftTransaction = Pick<
  AppPrismaClient,
  | "$queryRaw"
  | "membership"
  | "campus"
  | "sermon"
  | "clipCandidate"
  | "contentOpportunity"
  | "contentAsset"
  | "aiInvocation"
  | "weekDraft"
  | "weekDraftItem"
  | "weekDraftItemRevision"
  | "approvalRequest"
>;

export class WeekDraftServiceError extends Error {
  readonly code:
    | "NOT_FOUND"
    | "INVALID_INPUT"
    | "MEMBERSHIP_REQUIRED"
    | "SOURCE_NOT_FOUND";

  constructor(
    code:
      | "NOT_FOUND"
      | "INVALID_INPUT"
      | "MEMBERSHIP_REQUIRED"
      | "SOURCE_NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "WeekDraftServiceError";
    this.code = code;
  }
}

export type WeekDraftItemInput = Readonly<{
  format: WeekDraftItemFormat;
  title: string;
  payload: Prisma.InputJsonValue;
  sourceType: WeekDraftProvenanceType;
  sourceId?: string | null;
  sourceRevisionId?: string | null;
  provenance?: Prisma.InputJsonValue;
  assigneeUserId?: string | null;
  dueAt?: Date | null;
}>;

export type CreateWeekDraftInput = Readonly<{
  tenant: WeekDraftTenantContext;
  sermonId: string;
  title: string;
  weekStartsOn: Date;
  timezone: string;
  dueAt?: Date | null;
  createdByUserId?: string | null;
  items: readonly WeekDraftItemInput[];
}>;

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(",")}}`;
}

export function hashWeekDraftPayload(payload: Prisma.InputJsonValue): string {
  return createHash("sha256").update(stableJson(payload)).digest("hex");
}

function assertText(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new WeekDraftServiceError("INVALID_INPUT", `${label} is required.`);
  }
  return normalized;
}

async function requireActiveTenantMembership(
  tx: WeekDraftTransaction,
  tenant: WeekDraftTenantContext,
  userId: string,
): Promise<void> {
  const membership = await tx.membership.findFirst({
    where: {
      organizationId: tenant.organizationId,
      userId,
      status: "ACTIVE",
      ...(tenant.campusId
        ? { OR: [{ campusId: null }, { campusId: tenant.campusId }] }
        : { campusId: null }),
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      user: { status: "ACTIVE" },
    },
    select: { id: true },
  });
  if (!membership) {
    throw new WeekDraftServiceError(
      "MEMBERSHIP_REQUIRED",
      "The selected user does not have an active membership in this workspace.",
    );
  }
}

async function requireTenantCampus(
  tx: WeekDraftTransaction,
  tenant: WeekDraftTenantContext,
): Promise<void> {
  if (!tenant.campusId) {
    return;
  }
  const campus = await tx.campus.findFirst({
    where: {
      id: tenant.campusId,
      organizationId: tenant.organizationId,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!campus) {
    throw new WeekDraftServiceError(
      "NOT_FOUND",
      "The selected campus is not active in this organization.",
    );
  }
}

async function requireProvenanceSource(
  tx: WeekDraftTransaction,
  tenant: WeekDraftTenantContext,
  item: WeekDraftItemInput,
): Promise<void> {
  assertWeekDraftProvenance(item);
  if (item.sourceType === "MANUAL") {
    return;
  }

  const sourceId = item.sourceId as string;
  let source: { id: string } | null = null;
  if (item.sourceType === "CLIP_CANDIDATE") {
    source = await tx.clipCandidate.findFirst({
      where: {
        id: sourceId,
        sermon: weekDraftTenantWhere(tenant),
      },
      select: { id: true },
    });
  } else if (item.sourceType === "CONTENT_OPPORTUNITY") {
    source = await tx.contentOpportunity.findFirst({
      where: {
        id: sourceId,
        ...weekDraftTenantWhere(tenant),
      },
      select: { id: true },
    });
  } else if (item.sourceType === "CONTENT_ASSET") {
    source = await tx.contentAsset.findFirst({
      where: {
        id: sourceId,
        ...weekDraftTenantWhere(tenant),
      },
      select: { id: true },
    });
  } else if (item.sourceType === "AI_GENERATED") {
    source = await tx.aiInvocation.findFirst({
      where: {
        id: sourceId,
        ...weekDraftTenantWhere(tenant),
      },
      select: { id: true },
    });
  }

  if (!source) {
    throw new WeekDraftServiceError(
      "SOURCE_NOT_FOUND",
      "The source content does not belong to the active tenant.",
    );
  }
}

export async function createWeekDraft(
  tx: WeekDraftTransaction,
  input: CreateWeekDraftInput,
): Promise<{
  id: string;
  itemIds: readonly string[];
}> {
  const title = assertText(input.title, "Week Draft title");
  const timezone = assertText(input.timezone, "Week Draft timezone");
  const sermonId = assertText(input.sermonId, "Source sermon");

  await requireTenantCampus(tx, input.tenant);
  const sermon = await tx.sermon.findFirst({
    where: {
      id: sermonId,
      ...weekDraftTenantWhere(input.tenant),
    },
    select: { id: true },
  });
  if (!sermon) {
    throw new WeekDraftServiceError(
      "NOT_FOUND",
      "The source sermon does not belong to the active tenant.",
    );
  }
  if (input.createdByUserId) {
    await requireActiveTenantMembership(tx, input.tenant, input.createdByUserId);
  }

  for (const item of input.items) {
    assertText(item.title, "Week Draft item title");
    await requireProvenanceSource(tx, input.tenant, item);
    if (item.assigneeUserId) {
      await requireActiveTenantMembership(tx, input.tenant, item.assigneeUserId);
    }
  }

  const draft = await tx.weekDraft.create({
    data: {
      organizationId: input.tenant.organizationId,
      campusId: input.tenant.campusId ?? null,
      sermonId,
      title,
      weekStartsOn: input.weekStartsOn,
      timezone,
      dueAt: input.dueAt ?? null,
      createdByUserId: input.createdByUserId ?? null,
    },
    select: { id: true },
  });

  const itemIds: string[] = [];
  for (const [index, item] of input.items.entries()) {
    const draftItem = await tx.weekDraftItem.create({
      data: {
        organizationId: input.tenant.organizationId,
        campusId: input.tenant.campusId ?? null,
        weekDraftId: draft.id,
        format: item.format,
        title: item.title.trim(),
        sortOrder: (index + 1) * 1_024,
        sourceType: item.sourceType,
        sourceId: item.sourceId ?? null,
        sourceRevisionId: item.sourceRevisionId ?? null,
        provenanceJson: item.provenance ?? Prisma.JsonNull,
        assigneeUserId: item.assigneeUserId ?? null,
        dueAt: item.dueAt ?? null,
      },
      select: { id: true },
    });
    const revision = await tx.weekDraftItemRevision.create({
      data: {
        organizationId: input.tenant.organizationId,
        campusId: input.tenant.campusId ?? null,
        weekDraftItemId: draftItem.id,
        revisionNumber: 1,
        payloadJson: item.payload,
        contentHash: hashWeekDraftPayload(item.payload),
        sourceType: item.sourceType,
        sourceId: item.sourceId ?? null,
        sourceRevisionId: item.sourceRevisionId ?? null,
        provenanceJson: item.provenance ?? Prisma.JsonNull,
        createdByUserId: input.createdByUserId ?? null,
      },
      select: { id: true },
    });
    await tx.weekDraftItem.update({
      where: { id: draftItem.id },
      data: { currentRevisionId: revision.id },
    });
    itemIds.push(draftItem.id);
  }

  return { id: draft.id, itemIds };
}

export async function appendWeekDraftItemRevision(
  tx: WeekDraftTransaction,
  input: Readonly<{
    tenant: WeekDraftTenantContext;
    weekDraftItemId: string;
    payload: Prisma.InputJsonValue;
    createdByUserId?: string | null;
    provenance?: Prisma.InputJsonValue;
  }>,
): Promise<{ id: string; revisionNumber: number }> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "WeekDraftItem"
    WHERE "id" = ${input.weekDraftItemId}
      AND "organizationId" = ${input.tenant.organizationId}
    FOR UPDATE
  `);
  const item = await tx.weekDraftItem.findFirst({
    where: {
      id: input.weekDraftItemId,
      ...weekDraftTenantWhere(input.tenant),
    },
    select: {
      id: true,
      weekDraftId: true,
      sourceType: true,
      sourceId: true,
      sourceRevisionId: true,
    },
  });
  if (!item) {
    throw new WeekDraftServiceError(
      "NOT_FOUND",
      "The Week Draft item does not belong to the active tenant.",
    );
  }
  if (input.createdByUserId) {
    await requireActiveTenantMembership(tx, input.tenant, input.createdByUserId);
  }

  const latest = await tx.weekDraftItemRevision.aggregate({
    where: { weekDraftItemId: item.id },
    _max: { revisionNumber: true },
  });
  const revisionNumber = (latest._max.revisionNumber ?? 0) + 1;
  const revision = await tx.weekDraftItemRevision.create({
    data: {
      organizationId: input.tenant.organizationId,
      campusId: input.tenant.campusId ?? null,
      weekDraftItemId: item.id,
      revisionNumber,
      payloadJson: input.payload,
      contentHash: hashWeekDraftPayload(input.payload),
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      sourceRevisionId: item.sourceRevisionId,
      provenanceJson: input.provenance ?? Prisma.JsonNull,
      createdByUserId: input.createdByUserId ?? null,
    },
    select: { id: true, revisionNumber: true },
  });

  const now = new Date();
  await tx.approvalRequest.updateMany({
    where: {
      organizationId: input.tenant.organizationId,
      weekDraftItemId: item.id,
      status: "PENDING",
    },
    data: { status: "SUPERSEDED", resolvedAt: now },
  });
  await tx.weekDraftItem.update({
    where: { id: item.id },
    data: {
      currentRevisionId: revision.id,
      approvedRevisionId: null,
      status: "DRAFT",
    },
  });
  await tx.weekDraft.update({
    where: { id: item.weekDraftId },
    data: { version: { increment: 1 }, status: "DRAFT" },
  });

  return revision;
}

export async function reorderWeekDraftItems(
  tx: WeekDraftTransaction,
  input: Readonly<{
    tenant: WeekDraftTenantContext;
    weekDraftId: string;
    orderedItemIds: readonly string[];
  }>,
): Promise<void> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "WeekDraft"
    WHERE "id" = ${input.weekDraftId}
      AND "organizationId" = ${input.tenant.organizationId}
    FOR UPDATE
  `);
  const draft = await tx.weekDraft.findFirst({
    where: {
      id: input.weekDraftId,
      ...weekDraftTenantWhere(input.tenant),
    },
    select: {
      id: true,
      items: {
        select: { id: true },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      },
    },
  });
  if (!draft) {
    throw new WeekDraftServiceError(
      "NOT_FOUND",
      "The Week Draft does not belong to the active tenant.",
    );
  }

  const nextOrder = normalizeWeekDraftItemOrder(input.orderedItemIds);
  const existingIds = new Set(draft.items.map((item) => item.id));
  if (
    existingIds.size !== nextOrder.size
    || [...nextOrder.keys()].some((id) => !existingIds.has(id))
  ) {
    throw new WeekDraftServiceError(
      "INVALID_INPUT",
      "Reordering requires every item in the Week Draft exactly once.",
    );
  }

  let temporaryOrder = -1;
  for (const itemId of nextOrder.keys()) {
    await tx.weekDraftItem.update({
      where: { id: itemId },
      data: { sortOrder: temporaryOrder },
    });
    temporaryOrder -= 1;
  }
  for (const [itemId, sortOrder] of nextOrder) {
    await tx.weekDraftItem.update({
      where: { id: itemId },
      data: { sortOrder },
    });
  }
  await tx.weekDraft.update({
    where: { id: draft.id },
    data: { version: { increment: 1 } },
  });
}

export async function transitionWeekDraftStatus(
  tx: WeekDraftTransaction,
  input: Readonly<{
    tenant: WeekDraftTenantContext;
    weekDraftId: string;
    status: WeekDraftStatus;
  }>,
): Promise<void> {
  const draft = await tx.weekDraft.findFirst({
    where: {
      id: input.weekDraftId,
      ...weekDraftTenantWhere(input.tenant),
    },
    select: { id: true, status: true },
  });
  if (!draft) {
    throw new WeekDraftServiceError(
      "NOT_FOUND",
      "The Week Draft does not belong to the active tenant.",
    );
  }

  assertWeekDraftStatusTransition(draft.status, input.status);
  await tx.weekDraft.update({
    where: { id: draft.id },
    data: { status: input.status },
  });
}

export async function transitionWeekDraftItemStatus(
  tx: WeekDraftTransaction,
  input: Readonly<{
    tenant: WeekDraftTenantContext;
    weekDraftItemId: string;
    status: WeekDraftItemStatus;
  }>,
): Promise<void> {
  const item = await tx.weekDraftItem.findFirst({
    where: {
      id: input.weekDraftItemId,
      ...weekDraftTenantWhere(input.tenant),
    },
    select: { id: true, status: true },
  });
  if (!item) {
    throw new WeekDraftServiceError(
      "NOT_FOUND",
      "The Week Draft item does not belong to the active tenant.",
    );
  }

  assertWeekDraftItemStatusTransition(item.status, input.status);
  await tx.weekDraftItem.update({
    where: { id: item.id },
    data: { status: input.status },
  });
}
