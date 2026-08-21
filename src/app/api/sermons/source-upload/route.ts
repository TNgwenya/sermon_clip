import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import {
  buildLocalUploadSourceUrl,
  createSermonSchema,
  MAX_UPLOADED_MEDIA_BYTES,
  UPLOADED_MEDIA_TOO_LARGE_MESSAGE,
} from "@/lib/sermonIntake";
import {
  readTenantRequestContext,
  type TenantRequestContext,
} from "@/lib/tenancy/requestHeaders";
import { appendPipelineLog } from "@/server/agents/storage";
import { queueSermonProcessingJob } from "@/server/agents/processing";
import { AuthorizationError } from "@/server/auth/authorization";
import { requirePersistedTenantCapability } from "@/server/auth/requestAuthorization";
import {
  attachEventSessionToSermon,
  EventSessionLinkError,
  resolveEventSessionForIntake,
} from "@/server/events/eventSessionLinking";
import {
  abortS3SourceMultipartUpload,
  completeS3SourceMultipartUpload,
  createS3SourceMultipartUpload,
  expectedMultipartPartCount,
  getS3SourceStorageConfig,
  isS3SourceStorageConfigured,
  listS3SourceParts,
  presignS3SourcePart,
} from "@/server/media/s3SourceStorage";
import { tenantResourceScope, tenantScope } from "@/server/tenancy/scope";

export const runtime = "nodejs";

type UploadAction = "initiate" | "part-url" | "complete";

type JsonObject = Record<string, unknown>;

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function positiveSafeInteger(value: unknown): number | null {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true" || value === "on";
}

function isYouTubeSourceUrl(value: string): boolean {
  try {
    const host = new URL(value).hostname.toLowerCase();
    return host === "youtube.com" || host === "www.youtube.com" || host === "youtu.be";
  } catch {
    return false;
  }
}

function fieldErrorsFromResult(result: ReturnType<typeof createSermonSchema.safeParse>) {
  if (result.success) return undefined;
  const fields = result.error.flatten().fieldErrors;
  return {
    title: fields.title?.[0],
    speakerName: fields.speakerName?.[0],
    churchName: fields.churchName?.[0],
    language: fields.language?.[0],
    sermonStartTimestamp: fields.sermonStartTimestamp?.[0],
    sermonEndTimestamp: fields.sermonEndTimestamp?.[0],
    sermonDate: fields.sermonDate?.[0],
    mediaFile: fields.youtubeUrl?.[0],
    rightsConfirmed: fields.rightsConfirmed?.[0],
  };
}

async function parseBody(request: Request): Promise<JsonObject | null> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as JsonObject
      : null;
  } catch {
    return null;
  }
}

async function authorize(
  request: Request,
  body: JsonObject,
): Promise<TenantRequestContext | NextResponse> {
  let parsedContext: TenantRequestContext;
  try {
    parsedContext = readTenantRequestContext(request.headers);
  } catch {
    return NextResponse.json({ success: false, message: "Authentication is required." }, { status: 401 });
  }

  const action = stringValue(body.action) as UploadAction;
  const mode = stringValue(body.mode);
  const sermonId = stringValue(body.sermonId);
  const createsSermon = action === "initiate" && mode === "create" && !sermonId;
  try {
    return await requirePersistedTenantCapability(
      parsedContext,
      createsSermon ? "sermons.create" : "sermons.update",
      createsSermon || !sermonId
        ? undefined
        : { resource: { kind: "SERMON", id: sermonId } },
    );
  } catch (error) {
    if (!(error instanceof AuthorizationError)) {
      console.error("S3 source upload authorization lookup failed.", error);
      return NextResponse.json(
        { success: false, message: "The service is temporarily unavailable." },
        { status: 503 },
      );
    }
    return NextResponse.json(
      { success: false, message: "You do not have permission to upload this sermon." },
      { status: 403 },
    );
  }
}

type ExistingUpload = NonNullable<
  NonNullable<Awaited<ReturnType<typeof loadSermonForUpload>>>["sourceAsset"]
>;

async function resumableUploadResponse(
  organizationId: string,
  sermonId: string,
  asset: ExistingUpload,
  mode: string,
): Promise<NextResponse | null> {
  const sizeBytes = Number(asset.sizeBytes);
  if (asset.status === "READY") {
    await queueSermonProcessingJob(sermonId, "PROCESS_SERMON");
    return NextResponse.json({
      success: true,
      message: "The recording is already stored safely.",
      createdSermonId: sermonId,
      sourceAssetId: asset.id,
      sourceStored: true,
      originalPreserved: true,
      storedBytes: sizeBytes,
      resumedImport: mode === "recovery",
      ready: true,
      uploadedPartNumbers: [],
      partSizeBytes: asset.partSizeBytes,
    });
  }
  if (!asset.uploadId || (asset.status !== "INITIATED" && asset.status !== "UPLOADING")) {
    return null;
  }

  const parts = await listS3SourceParts({
    bucket: asset.bucket,
    objectKey: asset.objectKey,
    region: asset.region,
    uploadId: asset.uploadId,
    owner: { organizationId, sermonId },
  });
  return NextResponse.json({
    success: true,
    message: parts.length > 0 ? "Resuming the private S3 upload." : "Private S3 upload is ready.",
    createdSermonId: sermonId,
    sourceAssetId: asset.id,
    ready: false,
    uploadedPartNumbers: parts.map((part) => part.partNumber),
    uploadedBytes: parts.reduce((sum, part) => sum + part.sizeBytes, 0),
    partSizeBytes: asset.partSizeBytes,
    partCount: expectedMultipartPartCount(sizeBytes, asset.partSizeBytes),
  });
}

async function loadSermonForUpload(context: TenantRequestContext, sermonId: string) {
  return prisma.sermon.findFirst({
    where: tenantResourceScope(context, sermonId),
    select: {
      id: true,
      title: true,
      campusId: true,
      status: true,
      youtubeUrl: true,
      sourceAsset: {
        select: {
          id: true,
          bucket: true,
          objectKey: true,
          region: true,
          uploadId: true,
          originalFileName: true,
          contentType: true,
          sizeBytes: true,
          partSizeBytes: true,
          status: true,
        },
      },
      processingJobs: {
        orderBy: { updatedAt: "desc" },
        take: 20,
        select: { type: true, status: true },
      },
    },
  });
}

async function initiateUpload(context: TenantRequestContext, body: JsonObject): Promise<NextResponse> {
  const mode = stringValue(body.mode);
  const eventSessionId = stringValue(body.eventSessionId);
  const requestedSermonId = stringValue(body.sermonId);
  const requestedSourceAssetId = stringValue(body.sourceAssetId);
  const fileName = stringValue(body.fileName) || "sermon-media";
  const contentType = stringValue(body.contentType) || "application/octet-stream";
  const fileSize = positiveSafeInteger(body.fileSize);

  if (mode !== "create" && mode !== "recovery") {
    return NextResponse.json({ success: false, message: "Upload mode is invalid." }, { status: 400 });
  }
  if (!fileSize) {
    return NextResponse.json(
      { success: false, message: "The selected recording is empty.", fieldErrors: { mediaFile: "Choose a non-empty recording." } },
      { status: 400 },
    );
  }
  if (fileSize > MAX_UPLOADED_MEDIA_BYTES) {
    return NextResponse.json(
      { success: false, message: UPLOADED_MEDIA_TOO_LARGE_MESSAGE, fieldErrors: { mediaFile: UPLOADED_MEDIA_TOO_LARGE_MESSAGE } },
      { status: 413 },
    );
  }

  let sermon = requestedSermonId
    ? await loadSermonForUpload(context, requestedSermonId)
    : null;
  if (requestedSermonId && !sermon) {
    return NextResponse.json(
      { success: false, message: "The upload session could not be found.", fieldErrors: { mediaFile: "Start the upload again." } },
      { status: 404 },
    );
  }

  if (
    sermon?.sourceAsset
    && sermon.sourceAsset.status === "READY"
    && requestedSourceAssetId === sermon.sourceAsset.id
  ) {
    const assetSize = Number(sermon.sourceAsset.sizeBytes);
    const sameFile = sermon.sourceAsset.originalFileName === fileName
      && assetSize === fileSize
      && sermon.sourceAsset.contentType === contentType;
    if (sameFile) {
      const response = await resumableUploadResponse(
        context.organizationId,
        sermon.id,
        sermon.sourceAsset,
        mode,
      );
      if (response) return response;
    }
  }

  if (mode === "recovery") {
    if (!sermon) {
      return NextResponse.json({ success: false, message: "Recovery sermon is required." }, { status: 400 });
    }
    const failedYouTubeDownload = sermon.processingJobs.some(
      (job) => job.type === "DOWNLOAD_VIDEO" && job.status === "FAILED",
    );
    const hasActiveWork = sermon.processingJobs.some(
      (job) => job.status === "PENDING" || job.status === "RUNNING",
    );
    if (sermon.status !== "FAILED" || !isYouTubeSourceUrl(sermon.youtubeUrl) || !failedYouTubeDownload) {
      return NextResponse.json(
        {
          success: false,
          message: "This sermon is not waiting for a YouTube recovery upload.",
          fieldErrors: { mediaFile: "Refresh the sermon page before trying again." },
        },
        { status: 409 },
      );
    }
    if (hasActiveWork) {
      return NextResponse.json(
        {
          success: false,
          message: "This sermon already has processing work in progress.",
          fieldErrors: { mediaFile: "Wait for the current work to finish, then refresh." },
        },
        { status: 409 },
      );
    }
  } else if (!sermon) {
    const parsed = createSermonSchema.safeParse({
      youtubeUrl: "",
      title: stringValue(body.title),
      speakerName: stringValue(body.speakerName),
      churchName: stringValue(body.churchName),
      language: stringValue(body.language),
      sermonStartTimestamp: stringValue(body.sermonStartTimestamp),
      sermonEndTimestamp: stringValue(body.sermonEndTimestamp),
      includeWorshipMoments: booleanValue(body.includeWorshipMoments),
      sermonDate: stringValue(body.sermonDate),
      rightsConfirmed: booleanValue(body.rightsConfirmed),
      hasUploadedVideo: true,
    });
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, message: "Please correct the highlighted fields.", fieldErrors: fieldErrorsFromResult(parsed) },
        { status: 400 },
      );
    }

    const created = await prisma.$transaction(async (tx) => {
      const eventSession = await resolveEventSessionForIntake(
        tx,
        context,
        eventSessionId,
      );
      const record = await tx.sermon.create({
        data: {
          organizationId: context.organizationId,
          campusId: eventSession?.campusId ?? context.campusId,
          youtubeUrl: buildLocalUploadSourceUrl(fileName),
          title: parsed.data.title,
          speakerName: parsed.data.speakerName,
          churchName: parsed.data.churchName,
          language: parsed.data.language,
          sermonStartSeconds: parsed.data.sermonStartSeconds,
          sermonEndSeconds: parsed.data.sermonEndSeconds,
          analyzeFullRecording: false,
          includeWorshipMoments: parsed.data.includeWorshipMoments,
          sermonDate: parsed.data.sermonDate,
          rightsConfirmed: parsed.data.rightsConfirmed,
          status: "CREATED",
        },
        select: { id: true, title: true, campusId: true },
      });
      await attachEventSessionToSermon(tx, context, eventSession, record.id);
      await tx.auditEvent.create({
        data: {
          organizationId: context.organizationId,
          campusId: eventSession?.campusId ?? context.campusId,
          actorType: "USER",
          actorUserId: context.actorId,
          action: "sermon.created",
          targetType: "Sermon",
          targetId: record.id,
          metadataJson: {
            title: record.title,
            source: "s3-direct-upload",
            ...(eventSession ? {
              eventId: eventSession.eventId,
              eventSessionId: eventSession.id,
            } : {}),
          },
        },
      });
      return {
        ...record,
        eventId: eventSession?.eventId ?? null,
      };
    });
    if (created.eventId) {
      revalidatePath(`/events/${created.eventId}`);
      revalidatePath("/events");
    }
    sermon = {
      ...created,
      status: "CREATED",
      youtubeUrl: buildLocalUploadSourceUrl(fileName),
      sourceAsset: null,
      processingJobs: [],
    };
  }

  if (!sermon) {
    return NextResponse.json({ success: false, message: "The sermon could not be prepared." }, { status: 500 });
  }

  if (sermon.sourceAsset && requestedSourceAssetId === sermon.sourceAsset.id) {
    const assetSize = Number(sermon.sourceAsset.sizeBytes);
    const sameFile = sermon.sourceAsset.originalFileName === fileName
      && assetSize === fileSize
      && sermon.sourceAsset.contentType === contentType;
    if (sameFile) {
      try {
        const response = await resumableUploadResponse(
          context.organizationId,
          sermon.id,
          sermon.sourceAsset,
          mode,
        );
        if (response) return response;
      } catch (error) {
        const code = error && typeof error === "object" && "name" in error
          ? String((error as { name?: unknown }).name ?? "")
          : "";
        if (code !== "NoSuchUpload") throw error;
      }
    }
  }

  if (sermon.sourceAsset?.uploadId) {
    await abortS3SourceMultipartUpload({
      bucket: sermon.sourceAsset.bucket,
      objectKey: sermon.sourceAsset.objectKey,
      region: sermon.sourceAsset.region,
      uploadId: sermon.sourceAsset.uploadId,
      owner: { organizationId: context.organizationId, sermonId: sermon.id },
    }).catch(() => undefined);
  }

  const multipart = await createS3SourceMultipartUpload({
    organizationId: context.organizationId,
    sermonId: sermon.id,
    fileName,
    contentType,
    sizeBytes: fileSize,
  });
  let sourceAsset;
  try {
    sourceAsset = await prisma.sermonSourceAsset.upsert({
      where: { sermonId: sermon.id },
      create: {
        organizationId: context.organizationId,
        campusId: sermon.campusId,
        sermonId: sermon.id,
        bucket: multipart.bucket,
        objectKey: multipart.objectKey,
        region: multipart.region,
        uploadId: multipart.uploadId,
        originalFileName: fileName,
        contentType,
        sizeBytes: BigInt(fileSize),
        partSizeBytes: multipart.partSizeBytes,
        status: "INITIATED",
      },
      update: {
        bucket: multipart.bucket,
        objectKey: multipart.objectKey,
        region: multipart.region,
        uploadId: multipart.uploadId,
        originalFileName: fileName,
        contentType,
        sizeBytes: BigInt(fileSize),
        partSizeBytes: multipart.partSizeBytes,
        etag: null,
        versionId: null,
        completedAt: null,
        status: "INITIATED",
      },
      select: { id: true },
    });
  } catch (error) {
    await abortS3SourceMultipartUpload({
      ...multipart,
      owner: { organizationId: context.organizationId, sermonId: sermon.id },
    }).catch(() => undefined);
    throw error;
  }

  await prisma.auditEvent.create({
    data: {
      organizationId: context.organizationId,
      campusId: sermon.campusId,
      actorType: "USER",
      actorUserId: context.actorId,
      action: "sermon.source_upload_started",
      targetType: "Sermon",
      targetId: sermon.id,
      metadataJson: {
        provider: "AWS_S3",
        bytes: fileSize,
        recovery: mode === "recovery",
      },
    },
  });

  return NextResponse.json({
    success: true,
    message: "Private resumable upload is ready.",
    createdSermonId: sermon.id,
    sourceAssetId: sourceAsset.id,
    ready: false,
    uploadedPartNumbers: [],
    uploadedBytes: 0,
    partSizeBytes: multipart.partSizeBytes,
    partCount: expectedMultipartPartCount(fileSize, multipart.partSizeBytes),
  });
}

async function loadOwnedAsset(context: TenantRequestContext, body: JsonObject) {
  const sermonId = stringValue(body.sermonId);
  const sourceAssetId = stringValue(body.sourceAssetId);
  if (!sermonId || !sourceAssetId) return null;
  return prisma.sermonSourceAsset.findFirst({
    where: {
      id: sourceAssetId,
      sermonId,
      ...tenantScope(context),
    },
    select: {
      id: true,
      sermonId: true,
      campusId: true,
      bucket: true,
      objectKey: true,
      region: true,
      uploadId: true,
      originalFileName: true,
      sizeBytes: true,
      partSizeBytes: true,
      status: true,
      sermon: {
        select: {
          youtubeUrl: true,
        },
      },
    },
  });
}

async function createPartUrl(context: TenantRequestContext, body: JsonObject): Promise<NextResponse> {
  const asset = await loadOwnedAsset(context, body);
  const partNumber = positiveSafeInteger(body.partNumber);
  if (!asset || !asset.uploadId || !partNumber) {
    return NextResponse.json({ success: false, message: "The private upload session was not found." }, { status: 404 });
  }
  if (asset.status !== "INITIATED" && asset.status !== "UPLOADING") {
    return NextResponse.json({ success: false, message: "This private upload is no longer accepting parts." }, { status: 409 });
  }
  const sizeBytes = Number(asset.sizeBytes);
  const partCount = expectedMultipartPartCount(sizeBytes, asset.partSizeBytes);
  if (partNumber > partCount) {
    return NextResponse.json({ success: false, message: "Upload part is outside the recording." }, { status: 400 });
  }

  const uploadUrl = await presignS3SourcePart({
    bucket: asset.bucket,
    objectKey: asset.objectKey,
    region: asset.region,
    uploadId: asset.uploadId,
    partNumber,
    owner: { organizationId: context.organizationId, sermonId: asset.sermonId },
  });
  if (asset.status === "INITIATED") {
    await prisma.sermonSourceAsset.updateMany({
      where: { id: asset.id, status: "INITIATED" },
      data: { status: "UPLOADING" },
    });
  }
  return NextResponse.json({
    success: true,
    message: "Upload part authorized.",
    uploadUrl,
    partNumber,
  });
}

async function completeUpload(context: TenantRequestContext, body: JsonObject): Promise<NextResponse> {
  const asset = await loadOwnedAsset(context, body);
  if (!asset) {
    return NextResponse.json({ success: false, message: "The private upload session was not found." }, { status: 404 });
  }
  if (asset.status === "READY") {
    await queueSermonProcessingJob(asset.sermonId, "PROCESS_SERMON");
    return NextResponse.json({
      success: true,
      message: "Recording is stored safely and processing is queued.",
      createdSermonId: asset.sermonId,
      sourceStored: true,
      originalPreserved: true,
      storedBytes: Number(asset.sizeBytes),
      resumedImport: stringValue(body.mode) === "recovery",
      ready: true,
    });
  }
  if (!asset.uploadId || (asset.status !== "INITIATED" && asset.status !== "UPLOADING")) {
    return NextResponse.json({ success: false, message: "This private upload cannot be completed." }, { status: 409 });
  }

  const sizeBytes = Number(asset.sizeBytes);
  const isYouTubeRecovery = isYouTubeSourceUrl(asset.sermon.youtubeUrl);
  const completed = await completeS3SourceMultipartUpload({
    bucket: asset.bucket,
    objectKey: asset.objectKey,
    region: asset.region,
    uploadId: asset.uploadId,
    sizeBytes,
    partSizeBytes: asset.partSizeBytes,
    owner: { organizationId: context.organizationId, sermonId: asset.sermonId },
  });
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    await tx.sermonSourceAsset.update({
      where: { id: asset.id },
      data: {
        status: "READY",
        uploadId: null,
        etag: completed.etag,
        versionId: completed.versionId,
        completedAt: now,
      },
    });
    await tx.sermon.update({
      where: { id: asset.sermonId },
      data: {
        youtubeUrl: buildLocalUploadSourceUrl(asset.originalFileName),
        sourceVideoPath: null,
        sourceDurationSeconds: null,
      },
    });
    if (isYouTubeRecovery) {
      await tx.processingJob.create({
        data: {
          sermonId: asset.sermonId,
          type: "DOWNLOAD_VIDEO",
          status: "SUCCEEDED",
          startedAt: now,
          completedAt: now,
          logs: "YouTube import was recovered by attaching an owner-provided source video.",
          generationSummary: {
            recovery: {
              version: 1,
              source: "upload",
              durable: true,
              preservedSermonConfiguration: true,
              originalPreserved: true,
            },
          },
        },
      });
    }
    await tx.auditEvent.create({
      data: {
        organizationId: context.organizationId,
        campusId: asset.campusId,
        actorType: "USER",
        actorUserId: context.actorId,
        action: isYouTubeRecovery ? "sermon.source_recovered" : "sermon.source_uploaded",
        targetType: "Sermon",
        targetId: asset.sermonId,
        metadataJson: {
          provider: "AWS_S3",
          bytes: sizeBytes,
          durable: true,
          originalPreserved: true,
          recovery: isYouTubeRecovery,
          previousSource: isYouTubeRecovery ? "youtube" : undefined,
        },
      },
    });
  });

  const queued = await queueSermonProcessingJob(asset.sermonId, "PROCESS_SERMON");
  await appendPipelineLog(
    asset.sermonId,
    isYouTubeRecovery
      ? queued.reusedExisting
        ? "Owner-provided source stored without quality reduction; this sermon import was already queued."
        : "Owner-provided source stored without quality reduction; this same sermon import resumed on the media worker."
      : queued.reusedExisting
        ? "Durable S3 source completed; sermon processing was already queued."
        : "Durable S3 source completed; sermon processing queued for the media worker.",
  );
  revalidatePath("/");
  revalidatePath(`/sermons/${asset.sermonId}`);

  return NextResponse.json({
    success: true,
    message: isYouTubeRecovery
      ? "Original video stored safely. This sermon import has resumed."
      : "Recording stored safely. Processing has started.",
    createdSermonId: asset.sermonId,
    sourceStored: true,
    originalPreserved: true,
    storedBytes: sizeBytes,
    resumedImport: isYouTubeRecovery,
    ready: true,
  });
}

export async function POST(request: Request): Promise<NextResponse> {
  if (!isS3SourceStorageConfigured()) {
    return NextResponse.json(
      {
        success: false,
        code: "DIRECT_SOURCE_UPLOAD_UNAVAILABLE",
        message: "Private direct source storage is not configured.",
      },
      { status: 501 },
    );
  }
  const body = await parseBody(request);
  if (!body) {
    return NextResponse.json({ success: false, message: "Upload request body is invalid." }, { status: 400 });
  }
  const action = stringValue(body.action) as UploadAction;
  if (!["initiate", "part-url", "complete"].includes(action)) {
    return NextResponse.json({ success: false, message: "Upload action is invalid." }, { status: 400 });
  }
  const authorization = await authorize(request, body);
  if (authorization instanceof NextResponse) return authorization;

  try {
    getS3SourceStorageConfig();
    if (action === "initiate") return await initiateUpload(authorization, body);
    if (action === "part-url") return await createPartUrl(authorization, body);
    return await completeUpload(authorization, body);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Private source upload failed.";
    console.error(`Private S3 source upload ${action} failed: ${message}`);
    if (error instanceof EventSessionLinkError) {
      return NextResponse.json(
        {
          success: false,
          message: error.message,
          fieldErrors: { mediaFile: error.message },
        },
        { status: 409 },
      );
    }
    return NextResponse.json(
      {
        success: false,
        message,
        fieldErrors: { mediaFile: "The private upload could not continue. Keep the recording and try again." },
      },
      { status: 502 },
    );
  }
}
