import type { GrowthPlatform } from "@/lib/growthSystem";

export type GrowthRecommendationTenantScope = {
  organizationId: string;
  campusId: string | null;
};

export type GrowthEvidenceMetric =
  | "ENGAGEMENT_RATE"
  | "REACH"
  | "WATCH_TIME_SECONDS"
  | "COMPLETION_RATE"
  | "SAVES"
  | "SHARES"
  | "FOLLOWER_GROWTH";

export type AggregatedGrowthEvidence = GrowthRecommendationTenantScope & {
  citationId: string;
  source: "PLATFORM_ANALYTICS" | "SERMONCLIP_ANALYTICS";
  platform: GrowthPlatform;
  metric: GrowthEvidenceMetric;
  value: number;
  unit: "COUNT" | "PERCENT" | "SECONDS";
  sampleSize: number;
  aggregation: "AGGREGATED";
  windowStart: string;
  windowEnd: string;
  capturedAt: string;
  postingWindow?: string | null;
};

export type WeeklyGrowthChange =
  | {
      kind: "PRIORITIZE_APPROVED_ASSET";
      platform: GrowthPlatform;
    }
  | {
      kind: "RESCHEDULE_APPROVED_ASSET";
      platform: GrowthPlatform;
      postingWindow: string;
    }
  | {
      kind: "CHANGE_DISTRIBUTION_CHANNEL";
      fromPlatform: GrowthPlatform;
      toPlatform: GrowthPlatform;
    }
  | {
      kind: "CHANGE_PUBLISHING_FREQUENCY";
      platform: GrowthPlatform;
      postsPerWeek: number;
    }
  | {
      kind: "REUSE_APPROVED_ASSET";
      platform: GrowthPlatform;
      postingWindow: string;
    };

export type WeeklyGrowthRecommendationCandidate =
  GrowthRecommendationTenantScope & {
    proposalId: string;
    weekStart: string;
    weekEnd: string;
    priority: number;
    title: string;
    approvedAssetId: string;
    approvedRevisionId: string;
    approvedContentIdentity: string;
    change: WeeklyGrowthChange;
    claims: Array<{
      claim: string;
      citationIds: string[];
    }>;
  };

export type GrowthRecommendationBlockReason =
  | "DUPLICATE_PROPOSAL_ID"
  | "MISSING_REQUIRED_IDENTITY"
  | "INVALID_WEEK"
  | "INVALID_PRIORITY"
  | "INVALID_APPROVED_CONTENT_IDENTITY"
  | "INVALID_CHANGE"
  | "MISSING_CITATION"
  | "UNKNOWN_CITATION"
  | "TENANT_SCOPE_MISMATCH"
  | "PRIVATE_OR_LOW_SAMPLE_EVIDENCE"
  | "STALE_EVIDENCE"
  | "IRRELEVANT_EVIDENCE";

export type ReleasedWeeklyGrowthRecommendation =
  GrowthRecommendationTenantScope & {
    proposalId: string;
    weekStart: string;
    weekEnd: string;
    priority: number;
    title: string;
    approvedAssetId: string;
    approvedRevisionId: string;
    change: WeeklyGrowthChange;
    claims: Array<{
      claim: string;
      citationIds: string[];
    }>;
    citations: Array<{
      citationId: string;
      source: AggregatedGrowthEvidence["source"];
      platform: GrowthPlatform;
      metric: GrowthEvidenceMetric;
      value: number;
      unit: AggregatedGrowthEvidence["unit"];
      sampleSize: number;
      windowStart: string;
      windowEnd: string;
    }>;
    contentLock: {
      policy: "PRESERVE_APPROVED_CONTENT_EXACTLY";
      approvedContentIdentity: string;
      mayAlterTheology: false;
      requiresApprovedPreviewIdentityAtPublish: true;
      allowedMutationPaths: string[];
      forbiddenMutationPaths: readonly [
        "title",
        "hook",
        "caption",
        "transcript",
        "scripture",
        "media",
      ];
    };
  };

export type EvidenceBoundRecommendationResult = {
  released: ReleasedWeeklyGrowthRecommendation[];
  blocked: Array<{
    proposalId: string;
    reasons: GrowthRecommendationBlockReason[];
  }>;
};

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const METRICS_BY_CHANGE: Record<WeeklyGrowthChange["kind"], Set<GrowthEvidenceMetric>> = {
  PRIORITIZE_APPROVED_ASSET: new Set([
    "ENGAGEMENT_RATE",
    "REACH",
    "WATCH_TIME_SECONDS",
    "COMPLETION_RATE",
    "SAVES",
    "SHARES",
    "FOLLOWER_GROWTH",
  ]),
  RESCHEDULE_APPROVED_ASSET: new Set([
    "ENGAGEMENT_RATE",
    "REACH",
    "WATCH_TIME_SECONDS",
    "COMPLETION_RATE",
  ]),
  CHANGE_DISTRIBUTION_CHANNEL: new Set([
    "ENGAGEMENT_RATE",
    "REACH",
    "WATCH_TIME_SECONDS",
    "COMPLETION_RATE",
    "SAVES",
    "SHARES",
    "FOLLOWER_GROWTH",
  ]),
  CHANGE_PUBLISHING_FREQUENCY: new Set([
    "ENGAGEMENT_RATE",
    "REACH",
    "SAVES",
    "SHARES",
    "FOLLOWER_GROWTH",
  ]),
  REUSE_APPROVED_ASSET: new Set([
    "ENGAGEMENT_RATE",
    "REACH",
    "WATCH_TIME_SECONDS",
    "COMPLETION_RATE",
    "SAVES",
    "SHARES",
  ]),
};

const ALLOWED_MUTATION_PATHS: Record<WeeklyGrowthChange["kind"], string[]> = {
  PRIORITIZE_APPROVED_ASSET: ["queuePriority"],
  RESCHEDULE_APPROVED_ASSET: ["scheduledFor", "postingSlot", "timezone"],
  CHANGE_DISTRIBUTION_CHANNEL: ["platform", "socialAccountId"],
  CHANGE_PUBLISHING_FREQUENCY: ["weeklyPublishingTarget"],
  REUSE_APPROVED_ASSET: ["scheduledFor", "postingSlot", "platform", "socialAccountId"],
};

function tenantContains(
  requestScope: GrowthRecommendationTenantScope,
  itemScope: GrowthRecommendationTenantScope,
): boolean {
  return requestScope.organizationId === itemScope.organizationId
    && (
      requestScope.campusId === null
      || itemScope.campusId === null
      || requestScope.campusId === itemScope.campusId
    );
}

function validDate(value: string): boolean {
  return Boolean(value.trim()) && !Number.isNaN(Date.parse(value));
}

function isEvidenceFresh(
  evidence: AggregatedGrowthEvidence,
  evaluatedAt: Date,
  maxEvidenceAgeDays: number,
): boolean {
  const capturedAt = new Date(evidence.capturedAt);
  if (Number.isNaN(capturedAt.getTime()) || capturedAt > evaluatedAt) {
    return false;
  }
  return evaluatedAt.getTime() - capturedAt.getTime()
    <= maxEvidenceAgeDays * 24 * 60 * 60 * 1_000;
}

function evidenceSupportsChange(
  evidence: AggregatedGrowthEvidence,
  change: WeeklyGrowthChange,
): boolean {
  if (!METRICS_BY_CHANGE[change.kind].has(evidence.metric)) {
    return false;
  }
  if (change.kind === "CHANGE_DISTRIBUTION_CHANNEL") {
    return evidence.platform === change.fromPlatform
      || evidence.platform === change.toPlatform;
  }
  if (change.kind === "PRIORITIZE_APPROVED_ASSET") {
    return evidence.platform === change.platform;
  }
  if (evidence.platform !== change.platform) {
    return false;
  }
  if (
    change.kind === "RESCHEDULE_APPROVED_ASSET"
    || change.kind === "REUSE_APPROVED_ASSET"
  ) {
    return evidence.postingWindow?.trim() === change.postingWindow.trim();
  }
  return true;
}

function isValidChange(change: WeeklyGrowthChange): boolean {
  if (change.kind === "CHANGE_PUBLISHING_FREQUENCY") {
    return Number.isInteger(change.postsPerWeek)
      && change.postsPerWeek >= 1
      && change.postsPerWeek <= 14;
  }
  if (change.kind === "CHANGE_DISTRIBUTION_CHANNEL") {
    return change.fromPlatform !== change.toPlatform;
  }
  if (change.kind === "PRIORITIZE_APPROVED_ASSET") {
    return true;
  }
  return Boolean(change.postingWindow.trim());
}

export function releaseEvidenceBoundWeeklyRecommendations(input: {
  requestScope: GrowthRecommendationTenantScope;
  evaluatedAt: string;
  candidates: readonly WeeklyGrowthRecommendationCandidate[];
  evidence: readonly AggregatedGrowthEvidence[];
  minSampleSize?: number;
  maxEvidenceAgeDays?: number;
}): EvidenceBoundRecommendationResult {
  const evaluatedAt = new Date(input.evaluatedAt);
  const evaluationDateValid = validDate(input.evaluatedAt);
  const minimumSample = Math.max(3, input.minSampleSize ?? 5);
  const maxAgeDays = Math.max(1, input.maxEvidenceAgeDays ?? 35);
  const duplicateProposalIds = new Set<string>();
  const seenProposalIds = new Set<string>();
  for (const candidate of input.candidates) {
    if (seenProposalIds.has(candidate.proposalId)) {
      duplicateProposalIds.add(candidate.proposalId);
    }
    seenProposalIds.add(candidate.proposalId);
  }

  const evidenceById = new Map<string, AggregatedGrowthEvidence>();
  const duplicateCitationIds = new Set<string>();
  for (const item of input.evidence) {
    if (evidenceById.has(item.citationId)) {
      duplicateCitationIds.add(item.citationId);
    } else {
      evidenceById.set(item.citationId, item);
    }
  }

  const blocked: EvidenceBoundRecommendationResult["blocked"] = [];
  const released: ReleasedWeeklyGrowthRecommendation[] = [];
  for (const candidate of input.candidates) {
    const reasons = new Set<GrowthRecommendationBlockReason>();
    if (duplicateProposalIds.has(candidate.proposalId)) {
      reasons.add("DUPLICATE_PROPOSAL_ID");
    }
    if (
      !candidate.proposalId.trim()
      || !candidate.approvedAssetId.trim()
      || !candidate.approvedRevisionId.trim()
      || !candidate.organizationId.trim()
    ) {
      reasons.add("MISSING_REQUIRED_IDENTITY");
    }
    if (!Number.isFinite(candidate.priority)) {
      reasons.add("INVALID_PRIORITY");
    }
    if (
      !evaluationDateValid
      || !validDate(candidate.weekStart)
      || !validDate(candidate.weekEnd)
      || Date.parse(candidate.weekStart) >= Date.parse(candidate.weekEnd)
    ) {
      reasons.add("INVALID_WEEK");
    }
    if (!SHA256_PATTERN.test(candidate.approvedContentIdentity)) {
      reasons.add("INVALID_APPROVED_CONTENT_IDENTITY");
    }
    if (!isValidChange(candidate.change)) {
      reasons.add("INVALID_CHANGE");
    }
    if (!tenantContains(input.requestScope, candidate)) {
      reasons.add("TENANT_SCOPE_MISMATCH");
    }

    const usedEvidence = new Map<string, AggregatedGrowthEvidence>();
    if (candidate.claims.length === 0) {
      reasons.add("MISSING_CITATION");
    }
    for (const claim of candidate.claims) {
      if (!claim.claim.trim() || claim.citationIds.length === 0) {
        reasons.add("MISSING_CITATION");
      }
      for (const citationId of new Set(claim.citationIds)) {
        const citation = evidenceById.get(citationId);
        if (!citationId.trim() || !citation || duplicateCitationIds.has(citationId)) {
          reasons.add("UNKNOWN_CITATION");
          continue;
        }
        if (
          !tenantContains(input.requestScope, citation)
          || !tenantContains(candidate, citation)
        ) {
          reasons.add("TENANT_SCOPE_MISMATCH");
        }
        if (
          citation.aggregation !== "AGGREGATED"
          || !Number.isFinite(citation.value)
          || !Number.isInteger(citation.sampleSize)
          || citation.sampleSize < minimumSample
        ) {
          reasons.add("PRIVATE_OR_LOW_SAMPLE_EVIDENCE");
        }
        if (
          !validDate(citation.windowStart)
          || !validDate(citation.windowEnd)
          || Date.parse(citation.windowStart) >= Date.parse(citation.windowEnd)
          || Date.parse(citation.windowEnd) > Date.parse(citation.capturedAt)
          || Date.parse(citation.windowEnd) > evaluatedAt.getTime()
          || !isEvidenceFresh(citation, evaluatedAt, maxAgeDays)
        ) {
          reasons.add("STALE_EVIDENCE");
        }
        if (!evidenceSupportsChange(citation, candidate.change)) {
          reasons.add("IRRELEVANT_EVIDENCE");
        }
        usedEvidence.set(citationId, citation);
      }
    }
    if (candidate.change.kind === "CHANGE_DISTRIBUTION_CHANNEL") {
      const supportedPlatforms = new Set(
        [...usedEvidence.values()].map((citation) => citation.platform),
      );
      if (
        !supportedPlatforms.has(candidate.change.fromPlatform)
        || !supportedPlatforms.has(candidate.change.toPlatform)
      ) {
        reasons.add("IRRELEVANT_EVIDENCE");
      }
    }

    if (reasons.size > 0) {
      blocked.push({
        proposalId: candidate.proposalId,
        reasons: [...reasons].sort(),
      });
      continue;
    }

    released.push({
      organizationId: candidate.organizationId,
      campusId: candidate.campusId,
      proposalId: candidate.proposalId,
      weekStart: new Date(candidate.weekStart).toISOString(),
      weekEnd: new Date(candidate.weekEnd).toISOString(),
      priority: Math.max(0, Math.min(100, Math.round(candidate.priority))),
      title: candidate.title.trim(),
      approvedAssetId: candidate.approvedAssetId,
      approvedRevisionId: candidate.approvedRevisionId,
      change: structuredClone(candidate.change),
      claims: candidate.claims.map((claim) => ({
        claim: claim.claim.trim(),
        citationIds: [...new Set(claim.citationIds)].sort(),
      })),
      citations: [...usedEvidence.values()]
        .sort((left, right) => left.citationId.localeCompare(right.citationId))
        .map((citation) => ({
          citationId: citation.citationId,
          source: citation.source,
          platform: citation.platform,
          metric: citation.metric,
          value: citation.value,
          unit: citation.unit,
          sampleSize: citation.sampleSize,
          windowStart: new Date(citation.windowStart).toISOString(),
          windowEnd: new Date(citation.windowEnd).toISOString(),
        })),
      contentLock: {
        policy: "PRESERVE_APPROVED_CONTENT_EXACTLY",
        approvedContentIdentity: candidate.approvedContentIdentity,
        mayAlterTheology: false,
        requiresApprovedPreviewIdentityAtPublish: true,
        allowedMutationPaths: [...ALLOWED_MUTATION_PATHS[candidate.change.kind]],
        forbiddenMutationPaths: [
          "title",
          "hook",
          "caption",
          "transcript",
          "scripture",
          "media",
        ],
      },
    });
  }

  return {
    released: released.sort((left, right) => (
      right.priority - left.priority
      || left.proposalId.localeCompare(right.proposalId)
    )),
    blocked: blocked.sort((left, right) => left.proposalId.localeCompare(right.proposalId)),
  };
}
