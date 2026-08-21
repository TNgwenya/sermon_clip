import { createHash } from "node:crypto";

import { prisma } from "@/lib/prisma";
import { getMediaWorkerHealth, type MediaWorkerHealth } from "@/lib/mediaWorkerHealth";
import { getOrchestrationHealth, type OrchestrationHealth } from "@/lib/orchestrationHealth";
import {
  aggregatePilotJourneyTelemetry,
  evaluatePilotStopConditions,
  type PilotJourneyObservation,
  type PilotJourneyTelemetrySummary,
} from "@/lib/pilotTelemetry/journey";
import { getPublishingServiceHealth, type PublishingServiceHealth } from "@/lib/publishingServiceHealth";
import { getWorkspaceCostSafety, type WorkspaceCostSafetyResult } from "@/lib/workspaceCostSafety";
import {
  validateSupportEffortInput,
  type SanitizedSupportEffortRecord,
  type SupportEffortInput,
} from "@/server/pilotTelemetry/supportEffort";

const PILOT_WINDOW_DAYS = 30;
const PILOT_SERMON_LIMIT = 50;
const MINIMUM_PERCENTILE_SAMPLE = 5;

type PilotClipRecord = {
  id: string;
  score: number;
  isAiGenerated: boolean;
  isManuallyEdited: boolean;
  status: string;
  exportStatus: string;
  exportedAt: Date | null;
  exportFreshness: string;
  overlayStatus: string;
  overlayRenderedAt: Date | null;
  overlayFreshness: string;
  transcriptSafetyStatus: string;
  transcriptSafetyReviewedAt: Date | null;
  createdAt: Date;
  artifacts: Array<{
    id: string;
    kind: string;
    status: string;
    freshness: string;
    planHash: string | null;
    generatedAt: Date | null;
    createdAt: Date;
  }>;
};

export type PilotSermonEvidenceRecord = {
  id: string;
  status: string;
  sourceDurationSeconds: number | null;
  createdAt: Date;
  processingJobs: Array<{
    id: string;
    type: string;
    status: string;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
    attemptCount: number;
  }>;
  orchestrationJobs: Array<{
    id: string;
    lane: string;
    status: string;
    createdAt: Date;
    completedAt: Date | null;
    attemptCount: number;
    deadLetteredAt: Date | null;
    lastFailureCode: string | null;
  }>;
  clipCandidates: PilotClipRecord[];
  weekDrafts: Array<{
    id: string;
    status: string;
    createdAt: Date;
    updatedAt: Date;
    items: Array<{ status: string }>;
  }>;
};

export type PilotApprovalEvidenceRecord = {
  status: string;
  createdAt: Date;
  resolvedAt: Date | null;
  weekDraft: { sermonId: string };
};

export type PilotScheduledPostEvidenceRecord = {
  id: string;
  status: string;
  automationMode: string;
  workerStatus: string;
  attemptCount: number;
  finalPrivacyStatus: string | null;
  clipIdsJson: unknown;
  createdAt: Date;
  contentAssetLinks: Array<{ contentAsset: { sermonId: string } }>;
};

export type PilotPublishingAuditEvidenceRecord = {
  targetId: string | null;
  metadataJson: unknown;
  occurredAt: Date;
};

export type PilotFunnelEvidenceRecord = {
  sermonId: string | null;
  eventType: string;
  durationMs: number | null;
  occurredAt: Date;
};

export type PilotSupportEvidenceRecord = {
  metadataJson: unknown;
  occurredAt: Date;
};

export type PilotTelemetryEvidence = {
  sermons: PilotSermonEvidenceRecord[];
  approvals: PilotApprovalEvidenceRecord[];
  scheduledPosts: PilotScheduledPostEvidenceRecord[];
  publishingAudits: PilotPublishingAuditEvidenceRecord[];
  funnelEvents: PilotFunnelEvidenceRecord[];
  supportEvents: PilotSupportEvidenceRecord[];
};

export type PilotGateState = "PASS" | "WATCH" | "STOP" | "UNKNOWN";

export type PilotLaunchGate = {
  key: string;
  label: string;
  state: PilotGateState;
  evidence: string;
  action: string;
};

export type PilotSermonJourneyView = {
  routeId: string;
  label: string;
  admittedAt: Date;
  workflowStatus: string;
  sourceMinutes: number | null;
  suggestionsMilliseconds: number | null;
  brandedPreviewMilliseconds: number | null;
  fullContentMilliseconds: number | null;
  retryCount: number;
  deadLetterCount: number;
  fallbackUsed: boolean;
  reworkCount: number;
  approvedClipCount: number;
  exportedClipCount: number;
  pendingApprovalCount: number;
  resolvedApprovalCount: number;
  scheduledPostCount: number;
  publishedPostCount: number;
  blockedHandoffCount: number;
  dataQualityFlags: string[];
};

export type PilotDashboardReadModel = {
  status: "AVAILABLE";
  generatedAt: Date;
  evidenceWindow: { from: Date; until: Date; maximumSermons: number };
  evidenceNotice: string;
  summary: PilotJourneyTelemetrySummary;
  stopAssessment: ReturnType<typeof evaluatePilotStopConditions>;
  gates: PilotLaunchGate[];
  stopRecommended: boolean;
  stopReasons: string[];
  sermons: PilotSermonJourneyView[];
  queue: {
    orchestration: Pick<OrchestrationHealth, "status" | "pending" | "leased" | "failed" | "deadLetters" | "oldestPendingAt" | "lastSeenAt">;
    mediaWorker: Pick<MediaWorkerHealth, "status" | "lastSeenAt" | "ageSeconds" | "summary">;
    publishingWorker: Pick<PublishingServiceHealth, "status" | "lastSeenAt" | "dryRun" | "ageSeconds" | "summary">;
  };
  workflow: {
    approvalRequests: number;
    approvalsPending: number;
    approvalsResolved: number;
    approvedClips: number;
    exportedClips: number;
    scheduledPosts: number;
    publishedPosts: number;
    automaticPosts: number;
    governedHandoffs: number;
    blockedHandoffs: number;
    funnelEvents: number;
    funnelCompletions: number;
    supportIncidents: number;
    supportMinutes: number;
    criticalSupportIncidents: number;
    unresolvedSupportIncidents: number;
  };
  cost: WorkspaceCostSafetyResult;
  limitations: string[];
};

export type PilotDashboardResult =
  | PilotDashboardReadModel
  | { status: "UNAVAILABLE"; message: string };

type PilotTelemetryDb = {
  sermon: { findMany(args: unknown): Promise<PilotSermonEvidenceRecord[]> };
  approvalRequest: { findMany(args: unknown): Promise<PilotApprovalEvidenceRecord[]> };
  scheduledPost: { findMany(args: unknown): Promise<PilotScheduledPostEvidenceRecord[]> };
  auditEvent: { findMany(args: unknown): Promise<PilotPublishingAuditEvidenceRecord[]> };
  contentFunnelEvent: { findMany(args: unknown): Promise<PilotFunnelEvidenceRecord[]> };
};

function pseudonymousKey(scope: string, value: string): string {
  return `${scope}_${createHash("sha256").update(`${scope}:${value}`).digest("hex").slice(0, 20)}`;
}

function campusWhere(campusId: string | null): Record<string, string> {
  return campusId ? { campusId } : {};
}

export async function loadPilotTelemetryEvidence(input: {
  organizationId: string;
  campusId: string | null;
  from: Date;
  until: Date;
  db?: PilotTelemetryDb;
}): Promise<PilotTelemetryEvidence> {
  const db = input.db ?? (prisma as unknown as PilotTelemetryDb);
  const tenant = { organizationId: input.organizationId, ...campusWhere(input.campusId) };
  const createdAt = { gte: input.from, lt: input.until };
  const [sermons, approvals, scheduledPosts, publishingAudits, funnelEvents, supportEvents] = await Promise.all([
    db.sermon.findMany({
      where: { ...tenant, createdAt },
      orderBy: { createdAt: "desc" },
      take: PILOT_SERMON_LIMIT,
      select: {
        id: true,
        status: true,
        sourceDurationSeconds: true,
        createdAt: true,
        processingJobs: {
          select: { id: true, type: true, status: true, createdAt: true, startedAt: true, completedAt: true, attemptCount: true },
        },
        orchestrationJobs: {
          select: { id: true, lane: true, status: true, createdAt: true, completedAt: true, attemptCount: true, deadLetteredAt: true, lastFailureCode: true },
        },
        clipCandidates: {
          select: {
            id: true,
            score: true,
            isAiGenerated: true,
            isManuallyEdited: true,
            status: true,
            exportStatus: true,
            exportedAt: true,
            exportFreshness: true,
            overlayStatus: true,
            overlayRenderedAt: true,
            overlayFreshness: true,
            transcriptSafetyStatus: true,
            transcriptSafetyReviewedAt: true,
            createdAt: true,
            artifacts: {
              select: { id: true, kind: true, status: true, freshness: true, planHash: true, generatedAt: true, createdAt: true },
            },
          },
        },
        weekDrafts: {
          select: { id: true, status: true, createdAt: true, updatedAt: true, items: { select: { status: true } } },
        },
      },
    }),
    db.approvalRequest.findMany({
      where: { ...tenant, createdAt, weekDraft: { sermon: { organizationId: input.organizationId } } },
      select: { status: true, createdAt: true, resolvedAt: true, weekDraft: { select: { sermonId: true } } },
    }),
    db.scheduledPost.findMany({
      where: { ...tenant, createdAt },
      select: {
        id: true,
        status: true,
        automationMode: true,
        workerStatus: true,
        attemptCount: true,
        finalPrivacyStatus: true,
        clipIdsJson: true,
        createdAt: true,
        contentAssetLinks: { select: { contentAsset: { select: { sermonId: true } } } },
      },
    }),
    db.auditEvent.findMany({
      where: {
        ...tenant,
        action: "publishing.governed_handoff",
        targetType: "ScheduledPost",
        occurredAt: createdAt,
      },
      select: { targetId: true, metadataJson: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
      take: 500,
    }),
    db.contentFunnelEvent.findMany({
      where: { ...tenant, occurredAt: createdAt },
      select: { sermonId: true, eventType: true, durationMs: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
      take: 1_000,
    }),
    db.auditEvent.findMany({
      where: {
        ...tenant,
        action: "pilot.support_effort.recorded",
        targetType: "PilotSupportEffort",
        occurredAt: createdAt,
      },
      select: { metadataJson: true, occurredAt: true },
      orderBy: { occurredAt: "asc" },
      take: 2_000,
    }) as unknown as Promise<PilotSupportEvidenceRecord[]>,
  ]);
  return { sermons, approvals, scheduledPosts, publishingAudits, funnelEvents, supportEvents };
}

function stringsFromJson(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function auditCategory(value: unknown): { eventType: string; outcome: string; intentKey: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record["schemaVersion"] !== 1 || typeof record["eventType"] !== "string") return null;
  return {
    eventType: record["eventType"],
    outcome: typeof record["outcome"] === "string" ? record["outcome"] : "",
    intentKey: typeof record["intentId"] === "string" ? record["intentId"] : "",
  };
}

function supportCategory(row: PilotSupportEvidenceRecord): SanitizedSupportEffortRecord | null {
  if (!row.metadataJson || typeof row.metadataJson !== "object" || Array.isArray(row.metadataJson)) return null;
  const metadata = row.metadataJson as Record<string, unknown>;
  if (metadata["schemaVersion"] !== 1) return null;
  try {
    const validated = validateSupportEffortInput({
      boardCategory: metadata["boardCategory"] ?? "OPERATIONAL",
      category: metadata["category"],
      severity: metadata["severity"],
      status: metadata["status"],
      minutes: metadata["minutes"],
      incidentDate: metadata["incidentDate"],
      outcome: metadata["outcome"],
    } as SupportEffortInput);
    return { ...validated, occurredAt: row.occurredAt.toISOString() };
  } catch {
    return null;
  }
}

function mapProcessingStatus(status: string): "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" {
  return status === "RUNNING" || status === "SUCCEEDED" || status === "FAILED" ? status : "PENDING";
}

function mapOrchestrationStatus(status: string): PilotJourneyObservation["orchestrationJobs"][number]["status"] {
  return ["PENDING", "LEASED", "SUCCEEDED", "FAILED", "CANCELLED", "DEAD_LETTER"].includes(status)
    ? status as PilotJourneyObservation["orchestrationJobs"][number]["status"]
    : "FAILED";
}

function isCurrentReadyArtifact(artifact: PilotClipRecord["artifacts"][number], kind: string): boolean {
  return artifact.kind === kind && artifact.status === "READY" && artifact.freshness === "UP_TO_DATE";
}

function isFullSetReady(draft: PilotSermonEvidenceRecord["weekDrafts"][number]): boolean {
  return draft.status !== "DRAFT" && draft.status !== "ARCHIVED" && draft.items.length > 0;
}

function postsBySermon(evidence: PilotTelemetryEvidence): Map<string, PilotScheduledPostEvidenceRecord[]> {
  const clipToSermon = new Map<string, string>();
  for (const sermon of evidence.sermons) {
    for (const clip of sermon.clipCandidates) clipToSermon.set(clip.id, sermon.id);
  }
  const result = new Map<string, PilotScheduledPostEvidenceRecord[]>();
  for (const post of evidence.scheduledPosts) {
    const sermonIds = new Set([
      ...stringsFromJson(post.clipIdsJson).map((clipId) => clipToSermon.get(clipId)).filter((id): id is string => Boolean(id)),
      ...post.contentAssetLinks.map((link) => link.contentAsset.sermonId),
    ]);
    for (const sermonId of sermonIds) result.set(sermonId, [...(result.get(sermonId) ?? []), post]);
  }
  return result;
}

export function buildPilotJourneyObservations(input: {
  organizationId: string;
  evidence: PilotTelemetryEvidence;
}): { observations: PilotJourneyObservation[]; blockedBySermon: Map<string, number> } {
  const evidence = input.evidence;
  const posts = postsBySermon(evidence);
  const postToSermon = new Map<string, string>();
  for (const [sermonId, rows] of posts) for (const post of rows) postToSermon.set(post.id, sermonId);
  const auditByPost = new Map<string, Array<ReturnType<typeof auditCategory> extends infer T ? Exclude<T, null> : never>>();
  for (const row of evidence.publishingAudits) {
    if (!row.targetId) continue;
    const category = auditCategory(row.metadataJson);
    if (category) auditByPost.set(row.targetId, [...(auditByPost.get(row.targetId) ?? []), category]);
  }
  const blockedBySermon = new Map<string, number>();

  const observations = evidence.sermons.map((sermon): PilotJourneyObservation => {
    const sermonPosts = posts.get(sermon.id) ?? [];
    const sermonAudits = sermonPosts.flatMap((post) => auditByPost.get(post.id) ?? []);
    const explicitIntentCount = new Set(sermonAudits
      .filter((audit) => audit.eventType === "PRIVATE_HANDOFF_STAGED" || audit.eventType === "IDEMPOTENT_REPLAY")
      .map((audit, index) => audit.intentKey || `event-${index}`)).size;
    const blockedWithoutApproval = sermonAudits.filter((audit) => (
      audit.eventType === "INTENT_BLOCKED" && audit.outcome.includes("APPROVAL")
    )).length;
    blockedBySermon.set(sermon.id, sermonAudits.filter((audit) => audit.eventType === "INTENT_BLOCKED").length);
    const publishedWithoutIntent = sermonPosts.filter((post) => (
      post.status === "POSTED"
      && post.automationMode === "AUTOMATIC"
      && !(auditByPost.get(post.id) ?? []).some((audit) => (
        audit.eventType === "PRIVATE_HANDOFF_STAGED" || audit.eventType === "IDEMPOTENT_REPLAY"
      ))
    )).length;
    const rankedClips = [...sermon.clipCandidates].sort((left, right) => right.score - left.score);
    const suggestionsReadyAt = rankedClips.map((clip) => clip.createdAt).sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
    const previewArtifacts = rankedClips.flatMap((clip, index) => {
      const artifact = clip.artifacts.find((row) => isCurrentReadyArtifact(row, "OVERLAY") && Boolean(row.planHash));
      return artifact ? [{
        artifactKey: pseudonymousKey("artifact", artifact.id),
        kind: "BRANDED_REVIEW_PREVIEW" as const,
        requestedAt: null,
        readyAt: clip.overlayRenderedAt ?? artifact.generatedAt ?? artifact.createdAt,
        durable: true,
        playable: clip.overlayStatus === "COMPLETED",
        brandVerified: true,
        freshness: clip.overlayFreshness === "UP_TO_DATE" ? "CURRENT" as const : "STALE" as const,
        rank: index + 1,
      }] : [];
    });
    const contentRequest = sermon.orchestrationJobs
      .filter((job) => job.lane === "CONTENT_WEEK")
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.createdAt
      ?? sermon.processingJobs.filter((job) => job.type === "GENERATE_CONTENT_OPPORTUNITIES")
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0]?.createdAt
      ?? null;
    const readyDraft = sermon.weekDrafts.filter(isFullSetReady).sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null;
    const provenanceArtifacts = sermon.clipCandidates.flatMap((clip) => clip.artifacts)
      .filter((artifact) => artifact.status === "READY" && Boolean(artifact.planHash));
    const requiresReview = sermon.clipCandidates.some((clip) => clip.transcriptSafetyStatus === "REVIEW_REQUIRED");
    const funnelRework = evidence.funnelEvents.filter((event) => event.sermonId === sermon.id && event.eventType === "EDITED").length;

    return {
      sermonKey: pseudonymousKey("sermon", sermon.id),
      churchKey: pseudonymousKey("church", input.organizationId),
      admittedAt: sermon.createdAt,
      processingJobs: sermon.processingJobs.map((job) => ({
        jobKey: pseudonymousKey("job", job.id),
        type: job.type,
        status: mapProcessingStatus(job.status),
        createdAt: job.createdAt,
        startedAt: job.startedAt,
        completedAt: job.completedAt,
        attemptCount: job.attemptCount,
      })),
      orchestrationJobs: sermon.orchestrationJobs.map((job) => ({
        jobKey: pseudonymousKey("stage", job.id),
        lane: job.lane as PilotJourneyObservation["orchestrationJobs"][number]["lane"],
        status: mapOrchestrationStatus(job.status),
        createdAt: job.createdAt,
        completedAt: job.completedAt,
        attemptCount: job.attemptCount,
        deadLetteredAt: job.deadLetteredAt,
      })),
      artifacts: [
        ...(suggestionsReadyAt ? [{
          artifactKey: pseudonymousKey("suggestions", sermon.id),
          kind: "RANKED_SUGGESTIONS" as const,
          readyAt: suggestionsReadyAt,
          durable: true,
        }] : []),
        ...previewArtifacts,
        ...(readyDraft && contentRequest ? [{
          artifactKey: pseudonymousKey("week", readyDraft.id),
          kind: "CONTENT_WEEK_SET" as const,
          requestedAt: contentRequest,
          // updatedAt is a conservative observed-ready timestamp. createdAt
          // can precede the transaction that promotes a draft for review.
          readyAt: readyDraft.updatedAt,
          durable: true,
        }] : contentRequest ? [{
          artifactKey: pseudonymousKey("week", sermon.id),
          kind: "CONTENT_WEEK_SET" as const,
          requestedAt: contentRequest,
          readyAt: null,
          durable: false,
        }] : []),
      ],
      quality: sermon.clipCandidates.length === 0 ? null : {
        // Clip rows pre-date the Phase 5 quality contract in some environments.
        // Existing clip evidence can describe fallback/review/provenance, but it
        // cannot prove that the complete contract was evaluated and retained.
        contractPresent: false,
        automationMode: sermon.clipCandidates.some((clip) => !clip.isAiGenerated) ? "MANUAL_REVIEW_ONLY" : "FULL",
        fallbackMode: sermon.clipCandidates.some((clip) => !clip.isAiGenerated) ? "BASIC_TIME_BASED" : "NONE",
        manualReviewRequired: requiresReview,
        manualReviewCompleted: !requiresReview || sermon.clipCandidates
          .filter((clip) => clip.transcriptSafetyStatus === "REVIEW_REQUIRED")
          .every((clip) => ["APPROVED", "REJECTED", "EXPORTED"].includes(clip.status)),
        safetyCorrectionCount: sermon.clipCandidates.filter((clip) => clip.transcriptSafetyStatus === "REVIEWED" && clip.transcriptSafetyReviewedAt).length,
        provenanceCheckCount: provenanceArtifacts.length,
        provenanceFailureCount: provenanceArtifacts.filter((artifact) => artifact.freshness !== "UP_TO_DATE").length,
      },
      publishing: {
        approvedExportCount: sermon.clipCandidates.filter((clip) => (
          ["APPROVED", "EXPORTED"].includes(clip.status)
          && clip.exportStatus === "COMPLETED"
          && clip.exportFreshness === "UP_TO_DATE"
        )).length,
        explicitPublishIntentCount: explicitIntentCount,
        publishAttemptCount: sermonPosts.reduce((total, post) => total + Math.max(post.status === "POSTED" ? 1 : 0, post.attemptCount), 0),
        publishedCount: sermonPosts.filter((post) => post.status === "POSTED").length,
        blockedWithoutApprovalCount: blockedWithoutApproval,
        publishedWithoutExplicitIntentCount: publishedWithoutIntent,
      },
      rework: {
        explicitReplayCount: 0,
        forceRegenerationCount: 0,
        artifactInvalidationCount: funnelRework + sermon.clipCandidates.filter((clip) => clip.isManuallyEdited).length
          + sermon.clipCandidates.flatMap((clip) => clip.artifacts).filter((artifact) => artifact.freshness !== "UP_TO_DATE").length,
      },
    };
  });
  return { observations, blockedBySermon };
}

function gate(input: Omit<PilotLaunchGate, "action"> & { action?: string }): PilotLaunchGate {
  return { ...input, action: input.action ?? "Keep collecting scoped pilot evidence." };
}

export function buildPilotDashboardReadModel(input: {
  organizationId: string;
  now: Date;
  evidence: PilotTelemetryEvidence;
  orchestration: OrchestrationHealth;
  mediaWorker: MediaWorkerHealth;
  publishingWorker: PublishingServiceHealth;
  cost: WorkspaceCostSafetyResult;
}): PilotDashboardReadModel {
  const { observations, blockedBySermon } = buildPilotJourneyObservations({ organizationId: input.organizationId, evidence: input.evidence });
  const summary = aggregatePilotJourneyTelemetry(observations, { minimumPercentileSampleSize: MINIMUM_PERCENTILE_SAMPLE });
  const stopAssessment = evaluatePilotStopConditions(summary, {
    minimumSermons: MINIMUM_PERCENTILE_SAMPLE,
    maximumDeadLetterSermonRate: 0,
    maximumFallbackSermonRate: 0.2,
    maximumProvenanceFailureRate: 0,
    maximumPublishedWithoutExplicitIntent: 0,
    maximumFirstBrandedP90Milliseconds: 30 * 60_000,
  });
  const journeyByKey = new Map(summary.sermons.map((sermon) => [sermon.sermonKey, sermon]));
  const approvalsBySermon = new Map<string, PilotApprovalEvidenceRecord[]>();
  for (const approval of input.evidence.approvals) {
    const sermonId = approval.weekDraft.sermonId;
    approvalsBySermon.set(sermonId, [...(approvalsBySermon.get(sermonId) ?? []), approval]);
  }
  const linkedPosts = postsBySermon(input.evidence);
  const ordered = [...input.evidence.sermons].sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
  const sermons = ordered.map((record, index): PilotSermonJourneyView => {
    const journey = journeyByKey.get(pseudonymousKey("sermon", record.id))!;
    const approvals = approvalsBySermon.get(record.id) ?? [];
    const posts = linkedPosts.get(record.id) ?? [];
    return {
      routeId: record.id,
      label: `Sermon ${index + 1}`,
      admittedAt: record.createdAt,
      workflowStatus: record.status,
      sourceMinutes: record.sourceDurationSeconds === null ? null : Math.round(record.sourceDurationSeconds / 60),
      suggestionsMilliseconds: journey.suggestionsReady.milliseconds,
      brandedPreviewMilliseconds: journey.firstPlayableBrandedClip.milliseconds,
      fullContentMilliseconds: journey.fullRequestedContent.milliseconds,
      retryCount: journey.retryCount,
      deadLetterCount: journey.deadLetterCount,
      fallbackUsed: journey.fallbackUsed,
      reworkCount: journey.reworkCount,
      approvedClipCount: record.clipCandidates.filter((clip) => ["APPROVED", "EXPORTED"].includes(clip.status)).length,
      exportedClipCount: record.clipCandidates.filter((clip) => clip.exportStatus === "COMPLETED" && clip.exportFreshness === "UP_TO_DATE").length,
      pendingApprovalCount: approvals.filter((approval) => approval.status === "PENDING").length,
      resolvedApprovalCount: approvals.filter((approval) => ["APPROVED", "CHANGES_REQUESTED"].includes(approval.status)).length,
      scheduledPostCount: posts.length,
      publishedPostCount: posts.filter((post) => post.status === "POSTED").length,
      blockedHandoffCount: blockedBySermon.get(record.id) ?? 0,
      dataQualityFlags: journey.dataQualityFlags,
    };
  });
  const unsafeApprovedClips = input.evidence.sermons.flatMap((sermon) => sermon.clipCandidates)
    .filter((clip) => ["APPROVED", "EXPORTED"].includes(clip.status) && clip.transcriptSafetyStatus === "REVIEW_REQUIRED").length;
  const approvedClips = sermons.reduce((total, sermon) => total + sermon.approvedClipCount, 0);
  const publishedPosts = input.evidence.scheduledPosts.filter((post) => post.status === "POSTED").length;
  const automaticPosts = input.evidence.scheduledPosts.filter((post) => post.automationMode === "AUTOMATIC").length;
  const automaticPublished = input.evidence.scheduledPosts.filter((post) => post.automationMode === "AUTOMATIC" && post.status === "POSTED").length;
  const supportRecords = input.evidence.supportEvents.flatMap((row) => {
    const parsed = supportCategory(row);
    return parsed ? [parsed] : [];
  });
  const criticalSupport = supportRecords.filter((record) => record.severity === "CRITICAL").length;
  const unresolvedCriticalSupport = supportRecords.filter((record) => record.severity === "CRITICAL" && record.status !== "RESOLVED").length;
  const unresolvedSupport = supportRecords.filter((record) => record.status !== "RESOLVED").length;
  const unidentifiedDeadLetters = input.evidence.sermons.flatMap((sermon) => sermon.orchestrationJobs)
    .filter((job) => job.status === "DEAD_LETTER" && !job.lastFailureCode).length;
  const gates: PilotLaunchGate[] = [
    gate({
      key: "tenant-isolation-drill",
      label: "Cross-tenant denial drill",
      state: "UNKNOWN",
      evidence: "This read model contains no durable result from the isolation drill.",
      action: "Run and record the approved isolated tenant-denial test before cohort expansion.",
    }),
    gate({
      key: "restore-drill",
      label: "Backup and restore drill",
      state: "UNKNOWN",
      evidence: "Restore-drill completion is not stored in current operational records.",
      action: "Complete the isolated restore drill and retain its signed operator record.",
    }),
    gate({
      key: "pastoral-safety",
      label: "Pastoral safety before approval",
      state: unsafeApprovedClips > 0 ? "STOP" : approvedClips > 0 ? "PASS" : "UNKNOWN",
      evidence: unsafeApprovedClips > 0
        ? `${unsafeApprovedClips} approved or exported clip(s) still require transcript review.`
        : approvedClips > 0 ? `${approvedClips} approved clip(s) have no unresolved transcript-review marker.` : "No approved clip sample exists in this window.",
      action: unsafeApprovedClips > 0 ? "Stop affected publishing and complete pastoral review before replay." : undefined,
    }),
    gate({
      key: "publication-intent",
      label: "No publication without explicit intent",
      state: summary.totals.publishedWithoutExplicitIntent > 0 ? "STOP" : automaticPosts > 0 ? "PASS" : "UNKNOWN",
      evidence: summary.totals.publishedWithoutExplicitIntent > 0
        ? `${summary.totals.publishedWithoutExplicitIntent} automatic published post(s) lack governed intent evidence.`
        : automaticPosts > 0 ? "No observed automatic publication lacks governed handoff evidence." : "No automatic connector execution sample exists in this window; manual POSTED rows do not prove governed intent.",
      action: summary.totals.publishedWithoutExplicitIntent > 0 ? "Stop connector use and reconcile each affected post." : undefined,
    }),
    gate({
      key: "manual-pilot-publishing",
      label: "Pilot publishing remains manual",
      state: automaticPublished > 0 ? "STOP" : automaticPosts > 0 ? "WATCH" : input.evidence.scheduledPosts.length > 0 ? "PASS" : "UNKNOWN",
      evidence: automaticPublished > 0
        ? `${automaticPublished} automatic post(s) reached POSTED.`
        : automaticPosts > 0 ? `${automaticPosts} automatic schedule(s) exist; none reached POSTED.`
          : input.evidence.scheduledPosts.length > 0 ? "Observed schedules remain manual." : "No scheduled-post evidence exists.",
      action: automaticPublished > 0 ? "Disable pilot connector execution and investigate before continuing." : undefined,
    }),
    gate({
      key: "dead-letter-recovery",
      label: "Reasoned dead-letter recovery",
      state: summary.totals.deadLetters > 0 ? "STOP" : summary.denominators.sermons >= MINIMUM_PERCENTILE_SAMPLE ? "PASS" : "UNKNOWN",
      evidence: summary.totals.deadLetters > 0
        ? `${summary.totals.deadLetters} dead-lettered job(s), including ${unidentifiedDeadLetters} without a reason code.`
        : `${summary.denominators.sermons} sermon journey(s) observed with no dead letter.`,
      action: summary.totals.deadLetters > 0 ? "Do not replay blindly; classify, correct, and then use the scoped replay path." : undefined,
    }),
    gate({
      key: "provenance",
      label: "Current artefact provenance",
      state: summary.totals.provenanceFailures > 0 ? "STOP" : summary.totals.provenanceChecks >= MINIMUM_PERCENTILE_SAMPLE ? "PASS" : "UNKNOWN",
      evidence: summary.totals.provenanceFailures > 0
        ? `${summary.totals.provenanceFailures} of ${summary.totals.provenanceChecks} checked artefact(s) are stale.`
        : `${summary.totals.provenanceChecks} current artefact provenance check(s) are available.`,
      action: summary.totals.provenanceFailures > 0 ? "Regenerate from the approved plan before export or handoff." : undefined,
    }),
    gate({
      key: "workers",
      label: "Required worker signals",
      state: input.mediaWorker.status !== "ONLINE" || (input.orchestration.status !== "ONLINE" && input.orchestration.status !== "DISABLED") ? "WATCH" : "PASS",
      evidence: `Media ${input.mediaWorker.status}; orchestration ${input.orchestration.status}; publishing ${input.publishingWorker.status}.`,
      action: "Treat stale or missing workers as a Sunday intake stop until a fresh heartbeat is visible.",
    }),
    gate({
      key: "support-load",
      label: "Support and incident load",
      state: unresolvedCriticalSupport > 0 ? "STOP" : criticalSupport > 0 || unresolvedSupport > 0 ? "WATCH" : supportRecords.length > 0 ? "PASS" : "UNKNOWN",
      evidence: supportRecords.length === 0
        ? "No valid support-effort records exist in this window; this is not proof of zero support."
        : `${supportRecords.length} incident(s), ${supportRecords.reduce((total, record) => total + record.minutes, 0)} minute(s), ${unresolvedSupport} unresolved, ${criticalSupport} critical.`,
      action: unresolvedCriticalSupport > 0 ? "Pause expansion until every critical incident is contained, communicated, and resolved." : undefined,
    }),
    gate({
      key: "vendor-billing-reconciliation",
      label: "Usage reconciled to vendor billing",
      state: "UNKNOWN",
      evidence: "Application usage and AI estimates are measured, but no provider-invoice import or cash-charge reconciliation exists.",
      action: "Compare pilot usage to vendor invoices before approving pricing or a higher-volume cohort.",
    }),
  ];
  const stopReasons = gates.filter((item) => item.state === "STOP").map((item) => item.evidence);
  const workflow = {
    approvalRequests: input.evidence.approvals.length,
    approvalsPending: input.evidence.approvals.filter((approval) => approval.status === "PENDING").length,
    approvalsResolved: input.evidence.approvals.filter((approval) => ["APPROVED", "CHANGES_REQUESTED"].includes(approval.status)).length,
    approvedClips,
    exportedClips: sermons.reduce((total, sermon) => total + sermon.exportedClipCount, 0),
    scheduledPosts: input.evidence.scheduledPosts.length,
    publishedPosts,
    automaticPosts,
    governedHandoffs: input.evidence.publishingAudits.filter((audit) => {
      const category = auditCategory(audit.metadataJson);
      return category?.eventType === "PRIVATE_HANDOFF_STAGED" || category?.eventType === "IDEMPOTENT_REPLAY";
    }).length,
    blockedHandoffs: input.evidence.publishingAudits.filter((audit) => auditCategory(audit.metadataJson)?.eventType === "INTENT_BLOCKED").length,
    funnelEvents: input.evidence.funnelEvents.length,
    funnelCompletions: input.evidence.funnelEvents.filter((event) => event.eventType === "GENERATION_COMPLETED").length,
    supportIncidents: supportRecords.length,
    supportMinutes: supportRecords.reduce((total, record) => total + record.minutes, 0),
    criticalSupportIncidents: criticalSupport,
    unresolvedSupportIncidents: unresolvedSupport,
  };
  const from = new Date(input.now.getTime() - PILOT_WINDOW_DAYS * 24 * 60 * 60 * 1_000);
  return {
    status: "AVAILABLE",
    generatedAt: input.now,
    evidenceWindow: { from, until: input.now, maximumSermons: PILOT_SERMON_LIMIT },
    evidenceNotice: "Operational pilot evidence only. It is not a production SLA, a launch-readiness proof, or a broad-market benchmark.",
    summary,
    stopAssessment,
    gates,
    stopRecommended: stopAssessment.stopRecommended || stopReasons.length > 0,
    stopReasons,
    sermons,
    queue: {
      orchestration: {
        status: input.orchestration.status,
        pending: input.orchestration.pending,
        leased: input.orchestration.leased,
        failed: input.orchestration.failed,
        deadLetters: input.orchestration.deadLetters,
        oldestPendingAt: input.orchestration.oldestPendingAt,
        lastSeenAt: input.orchestration.lastSeenAt,
      },
      mediaWorker: {
        status: input.mediaWorker.status,
        lastSeenAt: input.mediaWorker.lastSeenAt,
        ageSeconds: input.mediaWorker.ageSeconds,
        summary: input.mediaWorker.summary,
      },
      publishingWorker: {
        status: input.publishingWorker.status,
        lastSeenAt: input.publishingWorker.lastSeenAt,
        dryRun: input.publishingWorker.dryRun,
        ageSeconds: input.publishingWorker.ageSeconds,
        summary: input.publishingWorker.summary,
      },
    },
    workflow,
    cost: input.cost,
    limitations: [
      "Queue delay is known only where ProcessingJob.startedAt exists; orchestration completion is never substituted.",
      "A branded preview is counted only when a current, playable OVERLAY artefact has a plan hash. Older preview rows may therefore remain unknown.",
      "Content Week completion requires a non-draft Week Draft with at least one durable item and an observed request timestamp; updatedAt is conservative and can include later edits.",
      "Isolation drills, restore drills, and customer outcomes are not durably recorded here and remain unknown.",
      "Support totals include only valid allowlisted support-effort events. No records means unknown capture completeness, not zero operator work.",
      "UsageEvent and AI cost estimates are application evidence, not vendor invoices or settled cash charges; billing reconciliation remains unknown.",
      "Worker heartbeats are service-wide signals; only job, approval, publishing, funnel, cost, and media evidence are tenant scoped.",
    ],
  };
}

export async function getPilotDashboardReadModel(input: {
  organizationId: string;
  campusId: string | null;
  now?: Date;
}): Promise<PilotDashboardResult> {
  const now = input.now ?? new Date();
  const from = new Date(now.getTime() - PILOT_WINDOW_DAYS * 24 * 60 * 60 * 1_000);
  try {
    const [evidence, orchestration, mediaWorker, publishingWorker, cost] = await Promise.all([
      loadPilotTelemetryEvidence({ ...input, from, until: now }),
      getOrchestrationHealth(input.organizationId, now),
      getMediaWorkerHealth(now),
      getPublishingServiceHealth(now),
      getWorkspaceCostSafety(input.organizationId, now),
    ]);
    return buildPilotDashboardReadModel({ organizationId: input.organizationId, now, evidence, orchestration, mediaWorker, publishingWorker, cost });
  } catch {
    return {
      status: "UNAVAILABLE",
      message: "Pilot telemetry could not be read. Do not interpret this as zero activity or a passing launch gate.",
    };
  }
}

export const PILOT_TELEMETRY_READ_POLICY = {
  windowDays: PILOT_WINDOW_DAYS,
  sermonLimit: PILOT_SERMON_LIMIT,
  minimumPercentileSample: MINIMUM_PERCENTILE_SAMPLE,
  capability: "billing.read" as const,
};
