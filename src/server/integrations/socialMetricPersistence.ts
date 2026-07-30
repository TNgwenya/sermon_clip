import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

export type SocialMetricSnapshotUpsertInput = Omit<
  Prisma.SocialMetricSnapshotUncheckedCreateInput,
  "id" | "organizationId" | "campusId" | "createdAt" | "dedupeKey" | "capturedAt" | "predictionResults"
> & {
  dedupeKey: string;
  capturedAt: Date;
};

/**
 * Keeps one observation per metric identity/day while refreshing cumulative
 * values on repeated same-day syncs. Upsert preserves the row id so prediction
 * results that reference an existing snapshot remain intact.
 */
export async function upsertSocialMetricSnapshots(
  snapshots: SocialMetricSnapshotUpsertInput[],
  scope: Readonly<{ organizationId: string; campusId: string | null }>,
): Promise<number> {
  if (snapshots.length === 0) return 0;

  await prisma.$transaction(snapshots.map(({ dedupeKey, ...values }) => (
    prisma.socialMetricSnapshot.upsert({
      where: {
        organizationId_dedupeKey: {
          organizationId: scope.organizationId,
          dedupeKey,
        },
      },
      create: {
        organizationId: scope.organizationId,
        campusId: scope.campusId,
        dedupeKey,
        ...values,
      },
      update: {
        ...values,
        campusId: scope.campusId,
      },
    })
  )));
  return snapshots.length;
}
