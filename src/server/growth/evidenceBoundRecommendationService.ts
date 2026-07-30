import { createHash } from "node:crypto";

import type {
  GrowthClipInput,
  GrowthPlatform,
  GrowthRecommendation,
} from "@/lib/growthSystem";
import {
  releaseEvidenceBoundWeeklyRecommendations,
  type AggregatedGrowthEvidence,
  type GrowthEvidenceMetric,
  type GrowthRecommendationTenantScope,
} from "@/server/growth/evidenceBoundRecommendations";

export type GrowthMetricSnapshotInput = GrowthRecommendationTenantScope & {
  platform: string;
  capturedAt: Date;
  engagementRate: number | null;
  reach: number | null;
  watchTimeSeconds: number | null;
  retentionRate: number | null;
  saves: number | null;
  shares: number | null;
  followerGrowth: number | null;
};

export type EvidenceBoundSavedGrowthRecommendation = GrowthRecommendation & {
  evidenceBoundRelease: ReturnType<
    typeof releaseEvidenceBoundWeeklyRecommendations
  >["released"][number];
};

const METRIC_FIELDS: Array<{
  metric: GrowthEvidenceMetric;
  field: keyof Pick<
    GrowthMetricSnapshotInput,
    | "engagementRate"
    | "reach"
    | "watchTimeSeconds"
    | "retentionRate"
    | "saves"
    | "shares"
    | "followerGrowth"
  >;
  unit: AggregatedGrowthEvidence["unit"];
}> = [
  { metric: "ENGAGEMENT_RATE", field: "engagementRate", unit: "PERCENT" },
  { metric: "REACH", field: "reach", unit: "COUNT" },
  { metric: "WATCH_TIME_SECONDS", field: "watchTimeSeconds", unit: "SECONDS" },
  { metric: "COMPLETION_RATE", field: "retentionRate", unit: "PERCENT" },
  { metric: "SAVES", field: "saves", unit: "COUNT" },
  { metric: "SHARES", field: "shares", unit: "COUNT" },
  { metric: "FOLLOWER_GROWTH", field: "followerGrowth", unit: "COUNT" },
];

function normalizeGrowthPlatform(value: string): GrowthPlatform | null {
  const normalized = value.trim().toLowerCase().replace(/[\s_-]+/gu, "");
  if (normalized === "instagram") return "Instagram";
  if (normalized === "facebook") return "Facebook";
  if (normalized === "tiktok") return "TikTok";
  if (normalized === "youtube" || normalized === "youtubeshorts") return "YouTube";
  if (normalized === "threads") return "Threads";
  if (normalized === "x" || normalized === "twitter" || normalized === "x/twitter") return "X / Twitter";
  if (normalized === "website" || normalized === "blog" || normalized === "website/blog") {
    return "Website / Blog";
  }
  return null;
}

function average(values: number[]): number {
  return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}

function evidenceCitationId(input: {
  scope: GrowthRecommendationTenantScope;
  platform: GrowthPlatform;
  metric: GrowthEvidenceMetric;
  windowStart: Date;
  windowEnd: Date;
}): string {
  const digest = createHash("sha256")
    .update(JSON.stringify({
      ...input.scope,
      platform: input.platform,
      metric: input.metric,
      windowStart: input.windowStart.toISOString(),
      windowEnd: input.windowEnd.toISOString(),
    }))
    .digest("hex")
    .slice(0, 24);
  return `growth-evidence:${digest}`;
}

function scopeAllows(
  requestScope: GrowthRecommendationTenantScope,
  item: GrowthRecommendationTenantScope,
): boolean {
  return requestScope.organizationId === item.organizationId
    && (
      requestScope.campusId === null
      || item.campusId === null
      || requestScope.campusId === item.campusId
    );
}

export function aggregateGrowthEvidence(input: {
  scope: GrowthRecommendationTenantScope;
  snapshots: readonly GrowthMetricSnapshotInput[];
}): AggregatedGrowthEvidence[] {
  const grouped = new Map<GrowthPlatform, GrowthMetricSnapshotInput[]>();
  for (const snapshot of input.snapshots) {
    if (!scopeAllows(input.scope, snapshot)) continue;
    const platform = normalizeGrowthPlatform(snapshot.platform);
    if (!platform || Number.isNaN(snapshot.capturedAt.getTime())) continue;
    grouped.set(platform, [...(grouped.get(platform) ?? []), snapshot]);
  }

  const evidence: AggregatedGrowthEvidence[] = [];
  for (const [platform, snapshots] of grouped) {
    const timestamps = snapshots.map((snapshot) => snapshot.capturedAt.getTime());
    const windowStart = new Date(Math.min(...timestamps));
    const windowEnd = new Date(Math.max(...timestamps));
    if (windowStart.getTime() >= windowEnd.getTime()) continue;

    for (const metric of METRIC_FIELDS) {
      const values = snapshots
        .map((snapshot) => snapshot[metric.field])
        .filter((value): value is number => (
          typeof value === "number" && Number.isFinite(value) && value >= 0
        ));
      if (values.length === 0) continue;
      evidence.push({
        organizationId: input.scope.organizationId,
        campusId: input.scope.campusId,
        citationId: evidenceCitationId({
          scope: input.scope,
          platform,
          metric: metric.metric,
          windowStart,
          windowEnd,
        }),
        source: "PLATFORM_ANALYTICS",
        platform,
        metric: metric.metric,
        value: average(values),
        unit: metric.unit,
        sampleSize: values.length,
        aggregation: "AGGREGATED",
        windowStart: windowStart.toISOString(),
        windowEnd: windowEnd.toISOString(),
        capturedAt: windowEnd.toISOString(),
      });
    }
  }

  return evidence.sort((left, right) => (
    left.platform.localeCompare(right.platform)
    || left.metric.localeCompare(right.metric)
  ));
}

export function approvedGrowthClipContentIdentity(clip: GrowthClipInput): string {
  return createHash("sha256")
    .update(JSON.stringify({
      identityVersion: 1,
      clipId: clip.id,
      sermonId: clip.sermon.id,
      title: clip.title.normalize("NFKC").trim(),
      hook: clip.hook.normalize("NFKC").trim(),
      caption: clip.caption.normalize("NFKC").trim(),
      hashtags: Array.isArray(clip.hashtags)
        ? clip.hashtags.filter((item): item is string => typeof item === "string")
        : [],
      status: clip.status,
      exportStatus: clip.exportStatus,
    }))
    .digest("hex");
}

function exactClipHashtags(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function buildEvidenceBoundSavedRecommendations(input: {
  scope: GrowthRecommendationTenantScope;
  evaluatedAt: Date;
  recommendations: readonly GrowthRecommendation[];
  clips: readonly GrowthClipInput[];
  snapshots: readonly GrowthMetricSnapshotInput[];
  minSampleSize?: number;
}): {
  recommendations: EvidenceBoundSavedGrowthRecommendation[];
  blockedCount: number;
  evidence: AggregatedGrowthEvidence[];
} {
  const evidence = aggregateGrowthEvidence({
    scope: input.scope,
    snapshots: input.snapshots,
  });
  const evidenceByPlatform = new Map<GrowthPlatform, AggregatedGrowthEvidence[]>();
  for (const item of evidence) {
    evidenceByPlatform.set(item.platform, [
      ...(evidenceByPlatform.get(item.platform) ?? []),
      item,
    ]);
  }
  const clipsById = new Map(input.clips.map((clip) => [clip.id, clip]));
  const weekStart = input.evaluatedAt.toISOString();
  const weekEnd = new Date(
    input.evaluatedAt.getTime() + 7 * 24 * 60 * 60_000,
  ).toISOString();

  const candidateContext = input.recommendations.flatMap((recommendation) => {
    const clip = clipsById.get(recommendation.sourceClipId);
    const platform = recommendation.platforms.find((item) => (
      (evidenceByPlatform.get(item)?.length ?? 0) > 0
    ));
    if (
      !clip
      || !platform
      || (clip.status !== "APPROVED" && clip.status !== "EXPORTED")
    ) {
      return [];
    }
    const citedEvidence = evidenceByPlatform.get(platform) ?? [];
    const proposalId = `weekly:${recommendation.id}:${platform}`;
    return [{
      recommendation,
      clip,
      platform,
      proposalId,
      candidate: {
        organizationId: input.scope.organizationId,
        campusId: input.scope.campusId,
        proposalId,
        weekStart,
        weekEnd,
        priority: recommendation.priority,
        title: `Prioritize the approved clip “${clip.title}” on ${platform}`,
        approvedAssetId: clip.id,
        approvedRevisionId: `clip-content:${approvedGrowthClipContentIdentity(clip)}`,
        approvedContentIdentity: approvedGrowthClipContentIdentity(clip),
        change: {
          kind: "PRIORITIZE_APPROVED_ASSET" as const,
          platform,
        },
        claims: [{
          claim: `${platform} has sufficient recent aggregate performance evidence to support testing this already-approved clip.`,
          citationIds: citedEvidence.map((item) => item.citationId),
        }],
      },
    }];
  });

  const released = releaseEvidenceBoundWeeklyRecommendations({
    requestScope: input.scope,
    evaluatedAt: input.evaluatedAt.toISOString(),
    candidates: candidateContext.map((item) => item.candidate),
    evidence,
    minSampleSize: input.minSampleSize,
  });
  const releaseByProposal = new Map(
    released.released.map((item) => [item.proposalId, item]),
  );
  const recommendations = candidateContext.flatMap((item) => {
    const evidenceBoundRelease = releaseByProposal.get(item.proposalId);
    if (!evidenceBoundRelease) return [];
    return [{
      ...item.recommendation,
      title: item.clip.title,
      hook: item.clip.hook,
      caption: item.clip.caption,
      cta: "",
      hashtags: exactClipHashtags(item.clip.hashtags),
      platforms: [item.platform],
      postingWindow: "Choose a reviewed publishing window",
      rationale: evidenceBoundRelease.claims.map((claim) => claim.claim),
      guardrails: [
        ...item.recommendation.guardrails,
        "The approved title, hook, caption, Scripture, transcript, and media must remain unchanged.",
      ],
      evidenceBoundRelease,
    }];
  });

  return {
    recommendations,
    blockedCount: input.recommendations.length - recommendations.length,
    evidence,
  };
}

export function evidenceBoundRecommendationMatchesApprovedClip(
  value: unknown,
  clip: GrowthClipInput,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const recommendation = value as Record<string, unknown>;
  const rawRelease = recommendation["evidenceBoundRelease"];
  if (!rawRelease || typeof rawRelease !== "object" || Array.isArray(rawRelease)) {
    return false;
  }
  const release = rawRelease as Record<string, unknown>;
  const rawContentLock = release["contentLock"];
  const rawChange = release["change"];
  if (
    !rawContentLock
    || typeof rawContentLock !== "object"
    || Array.isArray(rawContentLock)
    || !rawChange
    || typeof rawChange !== "object"
    || Array.isArray(rawChange)
    || !Array.isArray(release["claims"])
    || release["claims"].length === 0
    || !Array.isArray(release["citations"])
    || release["citations"].length === 0
  ) {
    return false;
  }
  const contentLock = rawContentLock as Record<string, unknown>;
  const change = rawChange as Record<string, unknown>;
  const expectedHashtags = exactClipHashtags(clip.hashtags);
  return contentLock["policy"] === "PRESERVE_APPROVED_CONTENT_EXACTLY"
    && contentLock["mayAlterTheology"] === false
    && contentLock["requiresApprovedPreviewIdentityAtPublish"] === true
    && contentLock["approvedContentIdentity"]
      === approvedGrowthClipContentIdentity(clip)
    && change["kind"] === "PRIORITIZE_APPROVED_ASSET"
    && recommendation["sourceClipId"] === clip.id
    && recommendation["title"] === clip.title
    && recommendation["hook"] === clip.hook
    && recommendation["caption"] === clip.caption
    && recommendation["cta"] === ""
    && JSON.stringify(recommendation["hashtags"]) === JSON.stringify(expectedHashtags);
}
