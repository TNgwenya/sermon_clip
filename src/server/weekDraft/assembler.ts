import { Prisma } from "@prisma/client";
import type {
  ContentAssetType,
  ContentOpportunityType,
  WeekDraftItemFormat,
  WeekDraftProvenanceType,
} from "@prisma/client";

import { prisma, type AppPrismaClient } from "@/lib/prisma";
import {
  createWeekDraft,
  transitionWeekDraftItemStatus,
  transitionWeekDraftStatus,
  type WeekDraftItemInput,
} from "@/server/weekDraft/service";
import {
  weekDraftTenantWhere,
  type WeekDraftTenantContext,
} from "@/server/weekDraft/domain";

export const DEFAULT_WEEK_DRAFT_ITEM_COUNT = 6;
export const AUTO_WEEK_DRAFT_ITEM_COUNTS = [5, 6, 7] as const;
const DEFAULT_MINIMUM_FORMATS = 3;

export type AutomaticWeekDraftConfig = Readonly<{
  targetItemCount?: (typeof AUTO_WEEK_DRAFT_ITEM_COUNTS)[number];
  preferredFormats?: readonly WeekDraftItemFormat[];
}>;

export type WeekDraftSourceCandidate = Readonly<{
  format: WeekDraftItemFormat;
  title: string;
  payload: Prisma.InputJsonValue;
  sourceType: WeekDraftProvenanceType;
  sourceId: string;
  sourceRevisionId?: string | null;
  provenance: Prisma.InputJsonValue;
  strength: number;
  lineageKey: string;
}>;

type AssemblyTransaction = Parameters<typeof createWeekDraft>[0];

export type AutomaticWeekDraftResult = Readonly<{
  id: string;
  created: boolean;
  itemCount: number;
  formatCount: number;
}>;

export type AutomaticWeekDraftAttemptResult =
  | Readonly<{ status: "CREATED" | "REUSED"; draft: AutomaticWeekDraftResult }>
  | Readonly<{ status: "WAITING_FOR_SOURCES"; draft: null }>;

export class AutomaticWeekDraftError extends Error {
  readonly code: "INVALID_INPUT" | "NOT_FOUND" | "NO_SOURCES";

  constructor(
    code: "INVALID_INPUT" | "NOT_FOUND" | "NO_SOURCES",
    message: string,
  ) {
    super(message);
    this.name = "AutomaticWeekDraftError";
    this.code = code;
  }
}

function asInputJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function targetCount(config: AutomaticWeekDraftConfig): number {
  const value = config.targetItemCount ?? DEFAULT_WEEK_DRAFT_ITEM_COUNT;
  if (!AUTO_WEEK_DRAFT_ITEM_COUNTS.includes(
    value as (typeof AUTO_WEEK_DRAFT_ITEM_COUNTS)[number],
  )) {
    throw new AutomaticWeekDraftError(
      "INVALID_INPUT",
      "Automatic Week Drafts support a focused default mix of 5, 6, or 7 total items.",
    );
  }
  return value;
}

export function nextAutomaticWeekStart(now = new Date()): Date {
  const date = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  ));
  const daysUntilMonday = (8 - date.getUTCDay()) % 7 || 7;
  date.setUTCDate(date.getUTCDate() + daysUntilMonday);
  return date;
}

function preferredFormatBonus(
  candidate: WeekDraftSourceCandidate,
  preferredFormats: readonly WeekDraftItemFormat[],
): number {
  const index = preferredFormats.indexOf(candidate.format);
  return index === -1 ? 0 : Math.max(1, preferredFormats.length - index) * 8;
}

function compareCandidates(
  left: WeekDraftSourceCandidate,
  right: WeekDraftSourceCandidate,
  preferredFormats: readonly WeekDraftItemFormat[],
): number {
  const strengthDifference =
    right.strength + preferredFormatBonus(right, preferredFormats)
    - (left.strength + preferredFormatBonus(left, preferredFormats));
  return strengthDifference || left.title.localeCompare(right.title)
    || left.sourceId.localeCompare(right.sourceId);
}

/**
 * Selects a focused automatic content mix. The 5–7 boundary applies only here;
 * the underlying Week Draft service intentionally keeps manual drafts unlimited.
 */
export function selectAutomaticWeekDraftMix(
  candidates: readonly WeekDraftSourceCandidate[],
  config: AutomaticWeekDraftConfig = {},
): readonly WeekDraftSourceCandidate[] {
  const limit = targetCount(config);
  const preferredFormats = config.preferredFormats ?? [];
  const uniqueCandidates = [...new Map(
    candidates.map((candidate) => [
      `${candidate.sourceType}:${candidate.sourceId}:${candidate.format}`,
      candidate,
    ]),
  ).values()].sort((left, right) =>
    compareCandidates(left, right, preferredFormats));

  const selected: WeekDraftSourceCandidate[] = [];
  const selectedSourceIds = new Set<string>();
  const selectedLineages = new Set<string>();
  const selectedFormats = new Set<WeekDraftItemFormat>();
  const availableFormatCount = new Set(
    uniqueCandidates.map((candidate) => candidate.format),
  ).size;
  const diversityTarget = Math.min(
    DEFAULT_MINIMUM_FORMATS,
    availableFormatCount,
    limit,
  );

  for (const preferredFormat of preferredFormats) {
    const candidate = uniqueCandidates.find((item) =>
      item.format === preferredFormat
      && !selectedSourceIds.has(`${item.sourceType}:${item.sourceId}`)
      && !selectedLineages.has(item.lineageKey));
    if (!candidate || selected.length >= limit) {
      continue;
    }
    selected.push(candidate);
    selectedFormats.add(candidate.format);
    selectedSourceIds.add(`${candidate.sourceType}:${candidate.sourceId}`);
    selectedLineages.add(candidate.lineageKey);
  }

  for (const candidate of uniqueCandidates) {
    if (selectedFormats.size >= diversityTarget) {
      break;
    }
    if (
      selectedFormats.has(candidate.format)
      || selectedSourceIds.has(`${candidate.sourceType}:${candidate.sourceId}`)
      || selectedLineages.has(candidate.lineageKey)
    ) {
      continue;
    }
    selected.push(candidate);
    selectedFormats.add(candidate.format);
    selectedSourceIds.add(`${candidate.sourceType}:${candidate.sourceId}`);
    selectedLineages.add(candidate.lineageKey);
  }

  for (const candidate of uniqueCandidates) {
    if (selected.length >= limit) {
      break;
    }
    const sourceKey = `${candidate.sourceType}:${candidate.sourceId}`;
    if (
      selectedSourceIds.has(sourceKey)
      || selectedLineages.has(candidate.lineageKey)
    ) {
      continue;
    }
    selected.push(candidate);
    selectedFormats.add(candidate.format);
    selectedSourceIds.add(sourceKey);
    selectedLineages.add(candidate.lineageKey);
  }

  return selected;
}

function formatForAsset(assetType: ContentAssetType): WeekDraftItemFormat {
  const directFormats: Partial<Record<ContentAssetType, WeekDraftItemFormat>> = {
    QUOTE_GRAPHIC: "QUOTE_GRAPHIC",
    SCRIPTURE_GRAPHIC: "SCRIPTURE_GRAPHIC",
    CAROUSEL: "CAROUSEL",
    TEXT_POST: "TEXT_POST",
    DEVOTIONAL: "DEVOTIONAL",
    PRAYER: "PRAYER",
    SERMON_RECAP: "SERMON_RECAP",
    STORY: "STORY",
    GUIDE: "GUIDE",
    EMAIL: "EMAIL",
    NEWSLETTER: "NEWSLETTER",
    BLOG: "BLOG",
    OTHER: "OTHER",
  };
  return directFormats[assetType]
    ?? (assetType === "DISCUSSION" ? "GUIDE" : "TEXT_POST");
}

function formatForOpportunity(
  opportunityType: ContentOpportunityType,
): WeekDraftItemFormat {
  switch (opportunityType) {
    case "SHORT_FORM_CLIP_IDEA":
    case "REEL_HOOK":
    case "YOUTUBE_SHORTS_IDEA":
    case "TIKTOK_IDEA":
      return "SHORT_FORM_VIDEO";
    case "QUOTE_GRAPHIC":
      return "QUOTE_GRAPHIC";
    case "SCRIPTURE_GRAPHIC":
      return "SCRIPTURE_GRAPHIC";
    case "CAROUSEL_IDEA":
      return "CAROUSEL";
    case "DEVOTIONAL_SUMMARY":
      return "DEVOTIONAL";
    case "PRAYER_GUIDE":
      return "PRAYER";
    case "SERMON_SUMMARY":
    case "SUNDAY_RECAP":
      return "SERMON_RECAP";
    case "ENGAGEMENT_STORY_SET":
      return "STORY";
    case "DEVOTIONAL_GUIDE":
    case "SMALL_GROUP_GUIDE":
    case "FAMILY_DISCUSSION_GUIDE":
    case "YOUTH_DISCUSSION_GUIDE":
    case "DISCUSSION_QUESTIONS":
    case "SMALL_GROUP_QUESTIONS":
    case "REFLECTION_QUESTIONS":
    case "FAMILY_DISCUSSION_QUESTIONS":
    case "YOUTH_DISCUSSION_QUESTIONS":
      return "GUIDE";
    case "EMAIL_RECAP":
      return "EMAIL";
    case "NEWSLETTER_SUMMARY":
      return "NEWSLETTER";
    case "BLOG_DRAFT_OUTLINE":
    case "ARTICLE_OUTLINE":
      return "BLOG";
    default:
      return "TEXT_POST";
  }
}

function normalizeWeekStart(value: Date): Date {
  if (Number.isNaN(value.getTime())) {
    throw new AutomaticWeekDraftError(
      "INVALID_INPUT",
      "Choose a valid start date for the Week Draft.",
    );
  }
  return new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  ));
}

function formatCount(items: readonly { format: WeekDraftItemFormat }[]): number {
  return new Set(items.map((item) => item.format)).size;
}

async function loadSourceCandidates(
  tx: AssemblyTransaction,
  tenant: WeekDraftTenantContext,
  sermon: Readonly<{
    id: string;
    title: string;
    speakerName: string;
  }>,
): Promise<readonly WeekDraftSourceCandidate[]> {
  const [clips, opportunities, assets] = await Promise.all([
    tx.clipCandidate.findMany({
      where: {
        sermonId: sermon.id,
        sermon: weekDraftTenantWhere(tenant),
        status: { not: "REJECTED" },
        transcriptSafetyStatus: { not: "REVIEW_REQUIRED" },
        riskLevel: { not: "HIGH" },
        duplicateOfClipId: null,
        AND: [
          {
            OR: [
              { remotePreviewUrl: { not: null } },
              {
                renderStatus: "COMPLETED",
                renderedFilePath: { not: null },
              },
            ],
          },
          {
            OR: [
              {
                postReadyStatus: {
                  in: ["POST_READY", "GOOD_NEEDS_REVIEW"],
                },
              },
              {
                postReadyStatus: null,
                qualityLabel: {
                  in: ["POST_READY", "GOOD_NEEDS_REVIEW"],
                },
              },
              {
                postReadyStatus: null,
                qualityLabel: null,
                status: { in: ["APPROVED", "EXPORTED"] },
              },
            ],
          },
        ],
      },
      orderBy: [
        { finalQualityScore: "desc" },
        { overallPostScore: "desc" },
        { score: "desc" },
        { createdAt: "asc" },
      ],
      take: 20,
      select: {
        id: true,
        title: true,
        hook: true,
        caption: true,
        hashtags: true,
        transcriptText: true,
        startTimeSeconds: true,
        endTimeSeconds: true,
        remotePreviewUrl: true,
        finalQualityScore: true,
        overallPostScore: true,
        score: true,
        reasonSelected: true,
        status: true,
      },
    }),
    tx.contentOpportunity.findMany({
      where: {
        sermonId: sermon.id,
        ...weekDraftTenantWhere(tenant),
        status: { notIn: ["REJECTED", "ARCHIVED"] },
      },
      orderBy: [
        { confidenceScore: "desc" },
        { updatedAt: "desc" },
      ],
      take: 30,
      select: {
        id: true,
        title: true,
        opportunityType: true,
        bodyContent: true,
        editedContent: true,
        approvedContent: true,
        structuredContentJson: true,
        sourceTranscriptExcerpt: true,
        sourceStartTimeSeconds: true,
        sourceEndTimeSeconds: true,
        relatedScripture: true,
        confidenceScore: true,
        status: true,
        approvedRevisionId: true,
        suggestedPlatform: true,
        aiReason: true,
      },
    }),
    tx.contentAsset.findMany({
      where: {
        sermonId: sermon.id,
        ...weekDraftTenantWhere(tenant),
        status: { not: "ARCHIVED" },
      },
      orderBy: [{ updatedAt: "desc" }],
      take: 30,
      select: {
        id: true,
        title: true,
        assetType: true,
        status: true,
        bodyContent: true,
        caption: true,
        hashtagsJson: true,
        callToAction: true,
        structuredContentJson: true,
        currentRevisionId: true,
        approvedRevisionId: true,
        contentOpportunityId: true,
        currentRevision: {
          select: {
            id: true,
            title: true,
            bodyContent: true,
            caption: true,
            hashtagsJson: true,
            callToAction: true,
          },
        },
        files: {
          orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
          take: 1,
          select: {
            id: true,
            publicUrl: true,
            mimeType: true,
          },
        },
        contentOpportunity: {
          select: {
            sourceTranscriptExcerpt: true,
            sourceStartTimeSeconds: true,
            sourceEndTimeSeconds: true,
            relatedScripture: true,
          },
        },
      },
    }),
  ]);

  const clipCandidates: WeekDraftSourceCandidate[] = clips.map((clip) => ({
    format: "SHORT_FORM_VIDEO",
    title: clip.title,
    payload: asInputJson({
      version: 1,
      title: clip.title,
      hook: clip.hook,
      copy: clip.caption,
      hashtags: clip.hashtags,
      previewUrl: clip.remotePreviewUrl?.trim()
        || `/api/clips/${clip.id}/preview`,
      previewKind: "video",
    }),
    sourceType: "CLIP_CANDIDATE",
    sourceId: clip.id,
    provenance: asInputJson({
      version: 1,
      sermonId: sermon.id,
      sermonTitle: sermon.title,
      speakerName: sermon.speakerName,
      sourceLabel: "Sermon clip",
      sourceExcerpt: clip.transcriptText,
      startTimeSeconds: clip.startTimeSeconds,
      endTimeSeconds: clip.endTimeSeconds,
      reasonSelected: clip.reasonSelected,
    }),
    strength: 400
      + (clip.finalQualityScore ?? clip.overallPostScore ?? clip.score ?? 0)
      + (clip.status === "APPROVED" || clip.status === "EXPORTED" ? 20 : 0),
    lineageKey: `clip:${clip.id}`,
  }));

  const opportunityCandidates: WeekDraftSourceCandidate[] =
    opportunities.map((opportunity) => ({
      format: formatForOpportunity(opportunity.opportunityType),
      title: opportunity.title,
      payload: asInputJson({
        version: 1,
        title: opportunity.title,
        copy: opportunity.approvedContent
          || opportunity.editedContent
          || opportunity.bodyContent,
        structuredContent: opportunity.structuredContentJson,
        relatedScripture: opportunity.relatedScripture,
        suggestedPlatform: opportunity.suggestedPlatform,
        previewKind: "text",
      }),
      sourceType: "CONTENT_OPPORTUNITY",
      sourceId: opportunity.id,
      sourceRevisionId: opportunity.approvedRevisionId,
      provenance: asInputJson({
        version: 1,
        sermonId: sermon.id,
        sermonTitle: sermon.title,
        speakerName: sermon.speakerName,
        sourceLabel: "Sermon content idea",
        sourceExcerpt: opportunity.sourceTranscriptExcerpt,
        startTimeSeconds: opportunity.sourceStartTimeSeconds,
        endTimeSeconds: opportunity.sourceEndTimeSeconds,
        relatedScripture: opportunity.relatedScripture,
        selectionReason: opportunity.aiReason,
      }),
      strength: 300
        + (opportunity.confidenceScore ?? 0) * 100
        + (opportunity.status === "APPROVED" ? 30 : 0),
      lineageKey: `opportunity:${opportunity.id}`,
    }));

  const assetCandidates: WeekDraftSourceCandidate[] = assets.map((asset) => {
    const revision = asset.currentRevision;
    const previewFile = asset.files[0];
    return {
      format: formatForAsset(asset.assetType),
      title: revision?.title || asset.title,
      payload: asInputJson({
        version: 1,
        title: revision?.title || asset.title,
        copy: revision?.bodyContent || asset.bodyContent || "",
        caption: revision?.caption || asset.caption,
        hashtags: revision?.hashtagsJson || asset.hashtagsJson,
        callToAction: revision?.callToAction || asset.callToAction,
        structuredContent: asset.structuredContentJson,
        previewUrl: previewFile
          ? previewFile.publicUrl?.trim()
            || `/api/content-assets/${asset.id}/files/${previewFile.id}`
          : null,
        previewKind: previewFile?.mimeType.startsWith("video/")
          ? "video"
          : previewFile?.mimeType.startsWith("image/")
            ? "image"
            : "text",
      }),
      sourceType: "CONTENT_ASSET",
      sourceId: asset.id,
      sourceRevisionId: revision?.id || asset.currentRevisionId,
      provenance: asInputJson({
        version: 1,
        sermonId: sermon.id,
        sermonTitle: sermon.title,
        speakerName: sermon.speakerName,
        sourceLabel: "Prepared content asset",
        sourceExcerpt: asset.contentOpportunity?.sourceTranscriptExcerpt,
        startTimeSeconds: asset.contentOpportunity?.sourceStartTimeSeconds,
        endTimeSeconds: asset.contentOpportunity?.sourceEndTimeSeconds,
        relatedScripture: asset.contentOpportunity?.relatedScripture,
      }),
      strength: 350
        + (asset.status === "READY" || asset.status === "SCHEDULED" ? 45 : 0)
        + (asset.approvedRevisionId ? 25 : 0),
      lineageKey: asset.contentOpportunityId
        ? `opportunity:${asset.contentOpportunityId}`
        : `asset:${asset.id}`,
    };
  });

  return [...clipCandidates, ...assetCandidates, ...opportunityCandidates];
}

function toWeekDraftItem(
  candidate: WeekDraftSourceCandidate,
): WeekDraftItemInput {
  return {
    format: candidate.format,
    title: candidate.title,
    payload: candidate.payload,
    sourceType: candidate.sourceType,
    sourceId: candidate.sourceId,
    sourceRevisionId: candidate.sourceRevisionId,
    provenance: candidate.provenance,
  };
}

export async function assembleAutomaticWeekDraft(
  input: Readonly<{
    tenant: WeekDraftTenantContext;
    sermonId: string;
    weekStartsOn: Date;
    timezone: string;
    createdByUserId?: string | null;
    config?: AutomaticWeekDraftConfig;
  }>,
  client: AppPrismaClient = prisma,
): Promise<AutomaticWeekDraftResult> {
  const sermonId = input.sermonId.trim();
  const timezone = input.timezone.trim();
  if (!sermonId || !timezone) {
    throw new AutomaticWeekDraftError(
      "INVALID_INPUT",
      "A sermon and timezone are required.",
    );
  }
  const weekStartsOn = normalizeWeekStart(input.weekStartsOn);
  targetCount(input.config ?? {});

  return client.$transaction(async (rawTransaction) => {
    const tx = rawTransaction as unknown as AssemblyTransaction;
    const sermon = await tx.sermon.findFirst({
      where: {
        id: sermonId,
        ...weekDraftTenantWhere(input.tenant),
      },
      select: {
        id: true,
        title: true,
        speakerName: true,
        campusId: true,
      },
    });
    if (!sermon) {
      throw new AutomaticWeekDraftError(
        "NOT_FOUND",
        "The selected sermon does not belong to this workspace.",
      );
    }

    const tenant: WeekDraftTenantContext = {
      organizationId: input.tenant.organizationId,
      campusId: input.tenant.campusId ?? sermon.campusId,
    };
    const idempotencyKey = [
      tenant.organizationId,
      tenant.campusId ?? "organization",
      sermon.id,
      weekStartsOn.toISOString().slice(0, 10),
    ].join(":");
    // pg_advisory_xact_lock returns PostgreSQL `void`. `$queryRaw` attempts to
    // deserialize that value and Prisma rejects it as an unsupported column
    // type, even though the lock was acquired. Execute the statement without
    // asking Prisma to materialize a result row.
    await tx.$executeRaw(Prisma.sql`
      SELECT pg_advisory_xact_lock(hashtextextended(${idempotencyKey}, 0))
    `);

    const existing = await tx.weekDraft.findFirst({
      where: {
        organizationId: tenant.organizationId,
        campusId: tenant.campusId ?? null,
        sermonId: sermon.id,
        weekStartsOn,
      },
      select: {
        id: true,
        items: { select: { format: true } },
      },
    });
    if (existing) {
      return {
        id: existing.id,
        created: false,
        itemCount: existing.items.length,
        formatCount: formatCount(existing.items),
      };
    }

    const candidates = await loadSourceCandidates(tx, tenant, sermon);
    const selected = selectAutomaticWeekDraftMix(
      candidates,
      input.config,
    );
    if (selected.length < AUTO_WEEK_DRAFT_ITEM_COUNTS[0]) {
      throw new AutomaticWeekDraftError(
        "NO_SOURCES",
        "This sermon needs at least five distinct, review-safe source pieces before Sermon Clip can assemble a faithful Week Draft.",
      );
    }

    const created = await createWeekDraft(tx, {
      tenant,
      sermonId: sermon.id,
      title: `${sermon.title} · Week of ${weekStartsOn.toLocaleDateString(
        "en-US",
        { month: "short", day: "numeric", timeZone: "UTC" },
      )}`,
      weekStartsOn,
      timezone,
      createdByUserId: input.createdByUserId,
      items: selected.map(toWeekDraftItem),
    });

    for (const itemId of created.itemIds) {
      await transitionWeekDraftItemStatus(tx, {
        tenant,
        weekDraftItemId: itemId,
        status: "READY_FOR_REVIEW",
      });
    }
    await transitionWeekDraftStatus(tx, {
      tenant,
      weekDraftId: created.id,
      status: "READY_FOR_REVIEW",
    });

    return {
      id: created.id,
      created: true,
      itemCount: created.itemIds.length,
      formatCount: formatCount(selected),
    };
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}

/**
 * Best-effort bridge from sermon processing into the canonical Week Draft.
 * A sermon may finish before five safe sources exist; that state is returned
 * explicitly so a later content-completion event (or the dashboard action)
 * can retry the same idempotent assembly.
 */
export async function assembleWeekDraftAfterContentCompletion(
  sermonId: string,
  options: Readonly<{ now?: Date }> = {},
  client: AppPrismaClient = prisma,
): Promise<AutomaticWeekDraftAttemptResult> {
  const sermon = await client.sermon.findUnique({
    where: { id: sermonId },
    select: {
      id: true,
      organizationId: true,
      campusId: true,
      organization: { select: { timezone: true } },
      campus: { select: { timezone: true } },
    },
  });
  if (!sermon?.organizationId) {
    throw new AutomaticWeekDraftError(
      "NOT_FOUND",
      "The completed sermon is not attached to an active workspace.",
    );
  }

  try {
    const draft = await assembleAutomaticWeekDraft({
      tenant: {
        organizationId: sermon.organizationId,
        campusId: sermon.campusId,
      },
      sermonId: sermon.id,
      weekStartsOn: nextAutomaticWeekStart(options.now),
      timezone: sermon.campus?.timezone
        || sermon.organization?.timezone
        || "UTC",
      createdByUserId: null,
    }, client);
    return {
      status: draft.created ? "CREATED" : "REUSED",
      draft,
    };
  } catch (error) {
    if (
      error instanceof AutomaticWeekDraftError
      && error.code === "NO_SOURCES"
    ) {
      return { status: "WAITING_FOR_SOURCES", draft: null };
    }
    throw error;
  }
}
