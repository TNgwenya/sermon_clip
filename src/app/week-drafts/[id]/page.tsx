import { notFound } from "next/navigation";
import Link from "next/link";
import type { Prisma } from "@prisma/client";

import {
  WeekDraftReviewCard,
  type WeekDraftReviewCardModel,
} from "@/app/week-drafts/[id]/week-draft-review-card";
import styles from "@/app/week-drafts/week-drafts.module.css";
import { prisma } from "@/lib/prisma";
import {
  canPersistedTenantCapability,
  requireRequestCapability,
} from "@/server/auth/requestAuthorization";
import {
  loadWorkInbox,
  prismaWorkInboxRepository,
} from "@/server/collaboration/inboxService";
import { tenantResourceScope } from "@/server/tenancy/scope";

export const dynamic = "force-dynamic";

const PASTOR_DECIDED_ITEM_STATUSES = [
  "APPROVED",
  "CHANGES_REQUESTED",
  "SKIPPED",
  "ARCHIVED",
] as const;

function pastorDecisionRecorded(status: string): boolean {
  return PASTOR_DECIDED_ITEM_STATUSES.some((value) => value === status);
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function recordValue(value: Prisma.JsonValue | null): Record<string, Prisma.JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : {};
}

function stringValue(
  value: Prisma.JsonValue | undefined,
  fallback = "",
): string {
  return typeof value === "string" ? value : fallback;
}

function numberValue(value: Prisma.JsonValue | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function timeLabel(start: number | null, end: number | null): string | null {
  if (start === null && end === null) return null;
  const format = (seconds: number) => {
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60);
    return `${minutes}:${String(remainder).padStart(2, "0")}`;
  };
  if (start !== null && end !== null) return `${format(start)}–${format(end)}`;
  return start !== null ? `From ${format(start)}` : `Until ${format(end as number)}`;
}

function sourceHref(input: Readonly<{
  sermonId: string;
  sourceType: string;
  sourceId: string | null;
}>): string {
  if (input.sourceType === "CLIP_CANDIDATE" && input.sourceId) {
    return `/sermons/${input.sermonId}/clips/${input.sourceId}/studio`;
  }
  if (input.sourceType === "CONTENT_ASSET" && input.sourceId) {
    return `/ready-to-post/content-assets/${input.sourceId}/studio`;
  }
  return `/opportunities?sermonId=${encodeURIComponent(input.sermonId)}`;
}

export default async function WeekDraftDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ item?: string; notice?: string; error?: string }>;
}) {
  const { id } = await params;
  const filters = await searchParams;
  const requestContext = await requireRequestCapability("content.read");
  const draft = await prisma.weekDraft.findFirst({
    where: tenantResourceScope(requestContext, id),
    select: {
      id: true,
      campusId: true,
      title: true,
      weekStartsOn: true,
      sermonId: true,
      sermon: {
        select: {
          title: true,
          speakerName: true,
        },
      },
      items: {
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
        select: {
          id: true,
          title: true,
          format: true,
          status: true,
          sourceType: true,
          sourceId: true,
          sourceRevisionId: true,
          provenanceJson: true,
          currentRevision: {
            select: {
              payloadJson: true,
            },
          },
          approvalRequests: {
            where: { status: "PENDING" },
            orderBy: [{ createdAt: "desc" }],
            take: 1,
            select: { id: true },
          },
        },
      },
    },
  });
  if (!draft) notFound();

  const decidedItems = draft.items.filter((item) =>
    pastorDecisionRecorded(item.status)).length;
  const changesRequested = draft.items.filter((item) =>
    item.status === "CHANGES_REQUESTED").length;
  const requestedItemIndex = filters.item
    ? draft.items.findIndex((item) =>
        item.id === filters.item
        && !pastorDecisionRecorded(item.status))
    : -1;
  const firstPendingItemIndex = draft.items.findIndex((item) =>
    !pastorDecisionRecorded(item.status));
  const currentItemIndex = requestedItemIndex >= 0
    ? requestedItemIndex
    : firstPendingItemIndex;
  if (currentItemIndex === -1) {
    return (
      <main className={styles.reviewShell}>
        <header className={styles.reviewHeader}>
          <Link className={styles.advancedLink} href="/week-drafts">
            ← All Week Drafts
          </Link>
          <div>
            <p className="kicker">Week review complete</p>
            <h1>{draft.title}</h1>
          </div>
          <p>
            {changesRequested > 0
              ? `Your pastor review is complete. ${changesRequested} ${
                  changesRequested === 1 ? "piece is" : "pieces are"
                } back with the content team for wording or exclusion changes.`
              : `All ${draft.items.length} pieces have been approved or intentionally left out. The approved content can now move into publishing.`}
          </p>
          <div className="actions-row">
            {changesRequested === 0 ? (
              <Link className="button primary" href="/ready-to-post">
                Continue to publishing
              </Link>
            ) : (
              <Link className="button primary" href="/inbox">
                See team handoffs
              </Link>
            )}
            <Link
              className="button secondary"
              href={changesRequested > 0 ? "/week-drafts" : "/inbox"}
            >
              {changesRequested > 0 ? "Back to Week Drafts" : "Open team Inbox"}
            </Link>
          </div>
        </header>
      </main>
    );
  }
  const currentItem = draft.items[currentItemIndex];
  if (!currentItem) notFound();

  const payload = recordValue(currentItem.currentRevision?.payloadJson ?? null);
  const provenance = recordValue(currentItem.provenanceJson);
  const previewKindValue = stringValue(payload.previewKind, "text");
  const previewKind: WeekDraftReviewCardModel["previewKind"] =
    previewKindValue === "video" || previewKindValue === "image"
      ? previewKindValue
      : "text";
  const start = numberValue(provenance.startTimeSeconds);
  const end = numberValue(provenance.endTimeSeconds);
  const [canRequestApproval, canDecideApproval, inbox] = await Promise.all([
    canPersistedTenantCapability(
      requestContext,
      "approvals.request",
      {
        campusId: draft.campusId,
        resource: { kind: "WEEK_DRAFT", id: draft.id },
      },
    ),
    canPersistedTenantCapability(
      requestContext,
      "approvals.decide",
      {
        campusId: draft.campusId,
        resource: {
          kind: "APPROVAL_REQUEST",
          id: currentItem.approvalRequests[0]?.id ?? currentItem.id,
        },
      },
    ),
    loadWorkInbox(prismaWorkInboxRepository, {
      tenant: {
        organizationId: requestContext.organizationId,
        campusId: draft.campusId,
      },
      actorId: requestContext.actorId,
    }),
  ]);
  const eligibleApproval = canDecideApproval
    ? inbox.approvals.find((approval) =>
        approval.id === currentItem.approvalRequests[0]?.id)
    : null;
  const model: WeekDraftReviewCardModel = {
    draftId: draft.id,
    draftTitle: draft.title,
    weekLabel: `Week of ${draft.weekStartsOn.toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      timeZone: "UTC",
    })}`,
    itemId: currentItem.id,
    itemTitle: currentItem.title,
    formatLabel: humanize(currentItem.format),
    statusLabel: humanize(currentItem.status),
    currentIndex: currentItemIndex + 1,
    totalItems: draft.items.length,
    decidedItems,
    copy: stringValue(payload.copy, stringValue(payload.caption)),
    previewUrl: stringValue(payload.previewUrl) || null,
    previewKind,
    approvalRequestId: currentItem.approvalRequests[0]?.id ?? null,
    eligibleApprovalRole: eligibleApproval?.eligibleRole ?? null,
    canRequestApproval:
      canRequestApproval && currentItem.status === "READY_FOR_REVIEW",
    sourceTypeLabel: humanize(currentItem.sourceType),
    sourceId: currentItem.sourceId,
    sourceRevisionId: currentItem.sourceRevisionId,
    sourceLabel: stringValue(provenance.sourceLabel, humanize(currentItem.sourceType)),
    sermonTitle: stringValue(provenance.sermonTitle, draft.sermon.title),
    speakerName: stringValue(provenance.speakerName, draft.sermon.speakerName),
    sourceExcerpt: stringValue(provenance.sourceExcerpt),
    sourceTimeLabel: timeLabel(start, end),
    sourceHref: sourceHref({
      sermonId: draft.sermonId,
      sourceType: currentItem.sourceType,
      sourceId: currentItem.sourceId,
    }),
  };

  return (
    <main className={styles.reviewShell}>
      {filters.notice ? (
        <p className={styles.successNotice} role="status">{filters.notice}</p>
      ) : null}
      {filters.error ? (
        <p className={styles.errorNotice} role="alert">{filters.error}</p>
      ) : null}
      <WeekDraftReviewCard item={model} />
    </main>
  );
}
