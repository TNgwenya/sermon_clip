import type {
  ContentRevisionApprovalState,
  TranslationReviewState,
} from "@prisma/client";
import { Prisma } from "@prisma/client";

import type { AppPrismaClient } from "@/lib/prisma";

type RevisionTransaction = Pick<
  AppPrismaClient,
  "$queryRaw" | "contentOpportunityRevision" | "contentAssetRevision"
>;

export type OpportunityRevisionSnapshot = {
  contentOpportunityId: string;
  title: string;
  shortDescription?: string | null;
  content: string;
  structuredContentJson?: Prisma.InputJsonValue;
  sourceTranscriptExcerpt?: string | null;
  sourceTranscriptSegmentIds?: Prisma.InputJsonValue;
  sourceStartTimeSeconds?: number | null;
  sourceEndTimeSeconds?: number | null;
  relatedScripture?: string | null;
  scriptureTranslation?: string | null;
  scriptureVerifiedAt?: Date | null;
  translationReviewState: TranslationReviewState;
  approvalState: ContentRevisionApprovalState;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | null;
};

export type AssetRevisionSnapshot = {
  contentAssetId: string;
  sourceOpportunityRevisionId?: string | null;
  title: string;
  bodyContent?: string | null;
  structuredContentJson?: Prisma.InputJsonValue;
  caption?: string | null;
  hashtagsJson?: Prisma.InputJsonValue;
  callToAction?: string | null;
  metadataJson?: Prisma.InputJsonValue;
  approvalState: ContentRevisionApprovalState;
  createdBy?: string | null;
  approvedBy?: string | null;
  approvedAt?: Date | null;
  renderedAt?: Date | null;
};

async function nextOpportunityRevisionNumber(
  tx: RevisionTransaction,
  contentOpportunityId: string,
): Promise<number> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ContentOpportunity"
    WHERE "id" = ${contentOpportunityId}
    FOR UPDATE
  `);
  const latest = await tx.contentOpportunityRevision.aggregate({
    where: { contentOpportunityId },
    _max: { revisionNumber: true },
  });
  return (latest._max.revisionNumber ?? 0) + 1;
}

async function nextAssetRevisionNumber(
  tx: RevisionTransaction,
  contentAssetId: string,
): Promise<number> {
  await tx.$queryRaw(Prisma.sql`
    SELECT "id"
    FROM "ContentAsset"
    WHERE "id" = ${contentAssetId}
    FOR UPDATE
  `);
  const latest = await tx.contentAssetRevision.aggregate({
    where: { contentAssetId },
    _max: { revisionNumber: true },
  });
  return (latest._max.revisionNumber ?? 0) + 1;
}

export async function createOpportunityRevision(
  tx: RevisionTransaction,
  snapshot: OpportunityRevisionSnapshot,
): Promise<{ id: string; revisionNumber: number }> {
  const revisionNumber = await nextOpportunityRevisionNumber(tx, snapshot.contentOpportunityId);
  return tx.contentOpportunityRevision.create({
    data: {
      ...snapshot,
      revisionNumber,
    },
    select: { id: true, revisionNumber: true },
  });
}

export async function createAssetRevision(
  tx: RevisionTransaction,
  snapshot: AssetRevisionSnapshot,
): Promise<{ id: string; revisionNumber: number }> {
  const revisionNumber = await nextAssetRevisionNumber(tx, snapshot.contentAssetId);
  return tx.contentAssetRevision.create({
    data: {
      ...snapshot,
      revisionNumber,
    },
    select: { id: true, revisionNumber: true },
  });
}
