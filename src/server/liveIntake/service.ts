import { prisma } from "@/lib/prisma";
import { buildLocalUploadSourceUrl } from "@/lib/sermonIntake";
import { queueSermonProcessingJob } from "@/server/agents/processing";
import {
  assertS3SourceObjectOwnedBy,
  type ReadyS3SourceAsset,
} from "@/server/media/s3SourceStorage";
import { createCloudflareLiveInput, liveIntakeProviderReady } from "./cloudflareStream";

type TenantScope = { organizationId: string; campusId: string | null; actorId?: string | null };

/**
 * The transfer worker supplies this only after it has finished a private,
 * byte-verified copy into the configured source bucket. It deliberately does
 * not contain the provider's temporary MP4 URL.
 */
export type MaterializedLiveRecordingSource = ReadyS3SourceAsset & {
  originalFileName: string;
  contentType: string;
};

export async function provisionLiveIntake(scope: TenantScope, label: string) {
  if (!liveIntakeProviderReady()) throw new Error("Live streaming is not enabled on this server yet. Add the scoped Stream API token first.");
  const existing = await prisma.liveIntake.findFirst({
    where: { organizationId: scope.organizationId, campusId: scope.campusId },
    select: { id: true, status: true },
  });
  if (existing?.status === "READY") throw new Error("This church already has a live stream. Rotate its key instead of creating another.");

  const created = await createCloudflareLiveInput(label);
  const intake = existing
    ? await prisma.liveIntake.update({ where: { id: existing.id }, data: { provider: "CLOUDFLARE_STREAM", providerInputId: created.providerInputId, label, status: "READY", lastError: null, disabledAt: null, rotatedAt: new Date() } })
    : await prisma.liveIntake.create({ data: { organizationId: scope.organizationId, campusId: scope.campusId, provider: "CLOUDFLARE_STREAM", providerInputId: created.providerInputId, label, status: "READY", createdByUserId: scope.actorId ?? null } });
  await prisma.auditEvent.create({ data: { organizationId: scope.organizationId, campusId: scope.campusId, actorType: "USER", actorUserId: scope.actorId ?? null, action: "live_intake.provisioned", targetType: "LiveIntake", targetId: intake.id, metadataJson: { provider: intake.provider, providerInputId: intake.providerInputId } } });
  // The stream key is returned once to the authenticated church admin and is never stored in our database.
  return { intake, ingestUrl: created.ingestUrl, streamKey: created.streamKey };
}

export async function receiveCompletedLiveRecording(input: { providerInputId: string; providerRecordingId: string; title?: string; durationSeconds?: number; sourceUrl?: string }) {
  const intake = await prisma.liveIntake.findUnique({ where: { providerInputId: input.providerInputId } });
  if (!intake || intake.status !== "READY") return { accepted: false, reason: "input_not_active" };
  const existing = await prisma.liveRecording.findUnique({ where: { liveIntakeId_providerRecordingId: { liveIntakeId: intake.id, providerRecordingId: input.providerRecordingId } } });
  if (existing) return { accepted: true, duplicate: true, recordingId: existing.id };
  // A recorded provider asset is durable, but source materialisation must happen in the intake lane.
  // Do not queue processing until a private source URL is available to the existing durable-storage adapter.
  const recording = await prisma.liveRecording.create({ data: { organizationId: intake.organizationId, liveIntakeId: intake.id, providerRecordingId: input.providerRecordingId, title: input.title?.slice(0, 180) || "Sunday live recording", durationSeconds: input.durationSeconds, sourceUrl: input.sourceUrl ?? null, status: "RECEIVED" } });
  await prisma.liveIntake.update({ where: { id: intake.id }, data: { lastStreamEndedAt: new Date(), lastError: null } });
  return { accepted: true, duplicate: false, recordingId: recording.id };
}

/**
 * Called only by the trusted materialisation worker after it has copied the
 * provider recording into tenant-owned private S3 storage. The draft Sermon
 * is intentionally created here, after the storage copy succeeds, so a
 * failed provider transfer never appears as a sermon awaiting review.
 *
 * `source.sermonId` must be the ID used when the worker built the private S3
 * object key. It is not accepted from a browser or provider callback.
 */
export async function createAndQueueMaterializedLiveRecording(input: {
  recordingId: string;
  sermonId: string;
  sourceAsset: MaterializedLiveRecordingSource;
}) {
  const recordingId = input.recordingId.trim();
  const sermonId = input.sermonId.trim();
  if (!recordingId || !sermonId) throw new Error("A live recording and allocated sermon ID are required.");
  if (input.sourceAsset.status !== "READY") throw new Error("A live recording source must be private and ready before queueing.");
  const byteSize = Number(input.sourceAsset.sizeBytes);
  if (!Number.isSafeInteger(byteSize) || byteSize <= 0) {
    throw new Error("A live recording source must have a positive verified byte size.");
  }

  const result = await prisma.$transaction(async (tx) => {
    // The unique live-recording/sermon relationship makes this durable, while
    // this short lock keeps concurrent delivery retries from creating two
    // draft sermons before the unique constraint can arbitrate.
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(hashtextextended(${`live-recording:${recordingId}`}, 0))::text AS "lock"
    `;
    const recording = await tx.liveRecording.findUnique({
      where: { id: recordingId },
      include: {
        liveIntake: { select: { id: true, organizationId: true, campusId: true, status: true } },
        sermon: { select: { id: true } },
      },
    });
    if (!recording || recording.status === "FAILED") {
      throw new Error("This live recording is not available for materialisation.");
    }
    if (recording.liveIntake.status !== "READY") {
      throw new Error("This live recording belongs to an inactive church stream.");
    }
    if (recording.sermonId && recording.sermonId !== sermonId) {
      throw new Error("This live recording is already linked to a different sermon.");
    }
    if (recording.sermon) return { sermonId: recording.sermon.id, created: false };

    assertS3SourceObjectOwnedBy(
      { organizationId: recording.organizationId, sermonId },
      input.sourceAsset.objectKey,
    );

    const organization = await tx.organization.findUnique({
      where: { id: recording.organizationId },
      select: {
        id: true,
        name: true,
        defaultLanguage: true,
        brandingSettings: { select: { churchName: true } },
        automationSettings: { select: { defaultLanguage: true, defaultSpeakerName: true } },
      },
    });
    if (!organization) throw new Error("The live recording church no longer exists.");

    const language = organization.automationSettings?.defaultLanguage?.trim()
      || organization.defaultLanguage.trim()
      || "en";
    const churchName = organization.brandingSettings?.churchName?.trim()
      || organization.name.trim()
      || "Church";
    const speakerName = organization.automationSettings?.defaultSpeakerName?.trim()
      || "Speaker to be confirmed";
    const title = recording.title?.trim().slice(0, 180) || "Sunday live recording";

    await tx.sermon.create({
      data: {
        id: sermonId,
        organizationId: recording.organizationId,
        campusId: recording.liveIntake.campusId,
        youtubeUrl: buildLocalUploadSourceUrl(input.sourceAsset.originalFileName),
        title,
        speakerName,
        churchName,
        language,
        sourceDurationSeconds: recording.durationSeconds ?? undefined,
        analyzeFullRecording: true,
        rightsConfirmed: true,
        sermonDate: recording.receivedAt,
        status: "CREATED",
      },
    });
    await tx.sermonSourceAsset.create({
      data: {
        organizationId: recording.organizationId,
        campusId: recording.liveIntake.campusId,
        sermonId,
        bucket: input.sourceAsset.bucket,
        objectKey: input.sourceAsset.objectKey,
        region: input.sourceAsset.region,
        originalFileName: input.sourceAsset.originalFileName,
        contentType: input.sourceAsset.contentType || "video/mp4",
        sizeBytes: BigInt(byteSize),
        partSizeBytes: 0,
        versionId: input.sourceAsset.versionId ?? null,
        completedAt: new Date(),
        status: "READY",
      },
    });
    await tx.liveRecording.update({
      where: { id: recording.id },
      data: { sermonId },
    });
    await tx.auditEvent.create({
      data: {
        organizationId: recording.organizationId,
        campusId: recording.liveIntake.campusId,
        actorType: "SYSTEM",
        action: "live_recording.materialized",
        targetType: "LiveRecording",
        targetId: recording.id,
        metadataJson: {
          sermonId,
          provider: "CLOUDFLARE_STREAM",
          durationSeconds: recording.durationSeconds,
          byteSize,
        },
      },
    });
    return { sermonId, created: true };
  });

  // Queue outside the transaction: queueing may use the durable outbox and
  // has its own idempotency. A failure leaves the linked, source-ready record
  // in RECEIVED state so the trusted worker can safely resume it.
  return queueMaterializedLiveRecording(recordingId, result.sermonId, result.created);
}

/** Called only by the trusted materialisation worker after private storage is READY. */
export async function queueMaterializedLiveRecording(recordingId: string, sermonId: string, created = false) {
  const recording = await prisma.liveRecording.findUnique({
    where: { id: recordingId },
    include: { liveIntake: true },
  });
  if (!recording || recording.status === "FAILED") throw new Error("This live recording is not ready to queue.");
  if (recording.sermonId !== sermonId) throw new Error("Materialized sermon does not match this live recording.");
  const sermon = await prisma.sermon.findFirst({
    where: { id: sermonId, organizationId: recording.organizationId, sourceAsset: { is: { status: "READY" } } },
    select: { id: true },
  });
  if (!sermon) throw new Error("Materialized sermon is outside the live recording church or its source is not ready.");
  if (recording.status === "QUEUED") return { recording, sermonId, created, queued: false, reusedExisting: true };

  const job = await queueSermonProcessingJob(sermonId, "PROCESS_SERMON");
  const queued = await prisma.liveRecording.updateMany({
    where: { id: recording.id, organizationId: recording.organizationId, sermonId, status: { in: ["RECEIVED", "MATERIALIZING"] } },
    data: { status: "QUEUED", queuedAt: new Date(), failureReason: null },
  });
  // A concurrent delivery may have performed the same idempotent queue call.
  // Its processing job remains the single durable workflow.
  return { recording, sermonId, created, queued: queued.count === 1, reusedExisting: job.reusedExisting };
}

/** Resume after a queue outage without downloading or uploading the source again. */
export async function resumeMaterializedLiveRecording(recordingId: string, organizationId: string): Promise<string | null> {
  const recording = await prisma.liveRecording.findUnique({ where: { id: recordingId }, select: { organizationId: true, sermonId: true } });
  if (!recording || recording.organizationId !== organizationId) throw new Error("Live recording is outside the requested church.");
  if (!recording.sermonId) return null;
  await queueMaterializedLiveRecording(recordingId, recording.sermonId);
  return recording.sermonId;
}
