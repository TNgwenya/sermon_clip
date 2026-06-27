import type { SermonStatus } from "@prisma/client";

import { prisma } from "@/lib/prisma";

const SERMON_STATUS_FLOW: SermonStatus[] = [
  "CREATED",
  "DOWNLOADING",
  "DOWNLOADED",
  "AUDIO_EXTRACTING",
  "AUDIO_EXTRACTED",
  "TRANSCRIBING",
  "TRANSCRIBED",
  "GENERATING_CLIPS",
  "CLIPS_GENERATED",
  "REVIEWING",
  "EXPORTING",
  "EXPORTED",
  "FAILED",
];

const RETRY_TRANSITIONS: Partial<Record<SermonStatus, SermonStatus>> = {
  DOWNLOADED: "DOWNLOADING",
  AUDIO_EXTRACTED: "AUDIO_EXTRACTING",
  TRANSCRIBED: "TRANSCRIBING",
  CLIPS_GENERATED: "GENERATING_CLIPS",
  EXPORTED: "EXPORTING",
};

const FAILED_RECOVERY_TRANSITIONS: ReadonlySet<SermonStatus> = new Set([
  "CREATED",
  "DOWNLOADING",
  "DOWNLOADED",
  "AUDIO_EXTRACTING",
  "AUDIO_EXTRACTED",
  "TRANSCRIBING",
  "TRANSCRIBED",
  "GENERATING_CLIPS",
  "CLIPS_GENERATED",
  "EXPORTING",
  "EXPORTED",
]);

function statusIndex(status: SermonStatus): number {
  return SERMON_STATUS_FLOW.indexOf(status);
}

export function validateStatusTransition(
  currentStatus: SermonStatus,
  nextStatus: SermonStatus,
): { valid: boolean; reason?: string } {
  if (currentStatus === nextStatus) {
    return { valid: true };
  }

  if (nextStatus === "FAILED") {
    return { valid: true };
  }

  if (currentStatus === "FAILED" && FAILED_RECOVERY_TRANSITIONS.has(nextStatus)) {
    return { valid: true };
  }

  if (RETRY_TRANSITIONS[currentStatus] === nextStatus) {
    return { valid: true };
  }

  if (currentStatus === "CLIPS_GENERATED" && nextStatus === "EXPORTING") {
    return { valid: true };
  }

  const currentIndex = statusIndex(currentStatus);
  const nextIndex = statusIndex(nextStatus);

  if (currentIndex === -1 || nextIndex === -1) {
    return {
      valid: false,
      reason: `Unknown status transition: ${currentStatus} -> ${nextStatus}.`,
    };
  }

  if (nextIndex === currentIndex + 1) {
    return { valid: true };
  }

  return {
    valid: false,
    reason: `Invalid status transition: ${currentStatus} -> ${nextStatus}.`,
  };
}

export async function updateSermonStatus(
  sermonId: string,
  nextStatus: SermonStatus,
): Promise<void> {
  const sermon = await prisma.sermon.findUnique({
    where: { id: sermonId },
    select: { status: true },
  });

  if (!sermon) {
    throw new Error(`Sermon ${sermonId} not found.`);
  }

  const validation = validateStatusTransition(sermon.status, nextStatus);
  if (!validation.valid) {
    throw new Error(validation.reason ?? "Invalid sermon status transition.");
  }

  await prisma.sermon.update({
    where: { id: sermonId },
    data: { status: nextStatus },
  });
}
