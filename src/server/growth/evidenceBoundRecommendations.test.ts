import { describe, expect, it } from "vitest";

import {
  releaseEvidenceBoundWeeklyRecommendations,
  type AggregatedGrowthEvidence,
  type WeeklyGrowthRecommendationCandidate,
} from "./evidenceBoundRecommendations";

const scope = {
  organizationId: "org-grace",
  campusId: "campus-central",
};

function evidence(
  overrides: Partial<AggregatedGrowthEvidence> = {},
): AggregatedGrowthEvidence {
  return {
    ...scope,
    citationId: "metric-instagram-evening",
    source: "PLATFORM_ANALYTICS",
    platform: "Instagram",
    metric: "ENGAGEMENT_RATE",
    value: 7.4,
    unit: "PERCENT",
    sampleSize: 12,
    aggregation: "AGGREGATED",
    windowStart: "2026-07-01T00:00:00.000Z",
    windowEnd: "2026-07-28T00:00:00.000Z",
    capturedAt: "2026-07-28T08:00:00.000Z",
    postingWindow: "Wednesday 18:00–20:00",
    ...overrides,
  };
}

function candidate(
  overrides: Partial<WeeklyGrowthRecommendationCandidate> = {},
): WeeklyGrowthRecommendationCandidate {
  return {
    ...scope,
    proposalId: "rec-week-31-evening",
    weekStart: "2026-08-03T00:00:00.000Z",
    weekEnd: "2026-08-10T00:00:00.000Z",
    priority: 82,
    title: "Try the stronger Instagram evening window",
    approvedAssetId: "asset-1",
    approvedRevisionId: "revision-approved-3",
    approvedContentIdentity: "b".repeat(64),
    change: {
      kind: "RESCHEDULE_APPROVED_ASSET",
      platform: "Instagram",
      postingWindow: "Wednesday 18:00–20:00",
    },
    claims: [{
      claim: "Recent Instagram posts received stronger aggregate engagement in the evening window.",
      citationIds: ["metric-instagram-evening"],
    }],
    ...overrides,
  };
}

describe("evidence-bound weekly growth recommendations", () => {
  it("releases a deterministic, cited distribution recommendation", () => {
    const result = releaseEvidenceBoundWeeklyRecommendations({
      requestScope: scope,
      evaluatedAt: "2026-07-29T09:00:00.000Z",
      candidates: [candidate()],
      evidence: [evidence()],
    });

    expect(result.blocked).toEqual([]);
    expect(result.released).toHaveLength(1);
    expect(result.released[0]).toMatchObject({
      proposalId: "rec-week-31-evening",
      citations: [{
        citationId: "metric-instagram-evening",
        sampleSize: 12,
      }],
      contentLock: {
        policy: "PRESERVE_APPROVED_CONTENT_EXACTLY",
        mayAlterTheology: false,
        requiresApprovedPreviewIdentityAtPublish: true,
        allowedMutationPaths: ["scheduledFor", "postingSlot", "timezone"],
      },
    });
    expect(result.released[0].claims).toEqual([{
      claim: "Recent Instagram posts received stronger aggregate engagement in the evening window.",
      citationIds: ["metric-instagram-evening"],
    }]);
    expect(result.released[0].contentLock.forbiddenMutationPaths).toContain("scripture");
    expect(result.released[0].contentLock.forbiddenMutationPaths).toContain("caption");
  });

  it("blocks recommendations whose citations belong to another church", () => {
    const result = releaseEvidenceBoundWeeklyRecommendations({
      requestScope: scope,
      evaluatedAt: "2026-07-29T09:00:00.000Z",
      candidates: [candidate()],
      evidence: [evidence({ organizationId: "org-other" })],
    });

    expect(result.released).toEqual([]);
    expect(result.blocked[0].reasons).toContain("TENANT_SCOPE_MISMATCH");
  });

  it("blocks uncited claims and unknown citations", () => {
    const result = releaseEvidenceBoundWeeklyRecommendations({
      requestScope: scope,
      evaluatedAt: "2026-07-29T09:00:00.000Z",
      candidates: [
        candidate({ claims: [{ claim: "Post more.", citationIds: [] }] }),
        candidate({
          proposalId: "unknown-citation",
          claims: [{ claim: "Post later.", citationIds: ["missing"] }],
        }),
      ],
      evidence: [evidence()],
    });

    expect(result.blocked).toEqual([
      {
        proposalId: "rec-week-31-evening",
        reasons: ["MISSING_CITATION"],
      },
      {
        proposalId: "unknown-citation",
        reasons: ["UNKNOWN_CITATION"],
      },
    ]);
  });

  it("blocks low-sample and stale evidence to protect privacy and confidence", () => {
    const result = releaseEvidenceBoundWeeklyRecommendations({
      requestScope: scope,
      evaluatedAt: "2026-07-29T09:00:00.000Z",
      candidates: [candidate()],
      evidence: [evidence({
        sampleSize: 1,
        capturedAt: "2026-01-01T00:00:00.000Z",
      })],
    });

    expect(result.blocked[0].reasons).toEqual(expect.arrayContaining([
      "PRIVATE_OR_LOW_SAMPLE_EVIDENCE",
      "STALE_EVIDENCE",
    ]));
  });

  it("rejects metric evidence that does not support the proposed operation", () => {
    const result = releaseEvidenceBoundWeeklyRecommendations({
      requestScope: scope,
      evaluatedAt: "2026-07-29T09:00:00.000Z",
      candidates: [candidate()],
      evidence: [evidence({ metric: "FOLLOWER_GROWTH", unit: "COUNT" })],
    });

    expect(result.blocked[0].reasons).toContain("IRRELEVANT_EVIDENCE");
  });

  it("allows only bounded schedule metadata changes for publishing frequency", () => {
    const result = releaseEvidenceBoundWeeklyRecommendations({
      requestScope: scope,
      evaluatedAt: "2026-07-29T09:00:00.000Z",
      candidates: [candidate({
        change: {
          kind: "CHANGE_PUBLISHING_FREQUENCY",
          platform: "Instagram",
          postsPerWeek: 4,
        },
      })],
      evidence: [evidence()],
    });

    expect(result.released[0].contentLock.allowedMutationPaths).toEqual([
      "weeklyPublishingTarget",
    ]);
    expect(result.released[0].contentLock.approvedContentIdentity).toBe("b".repeat(64));
  });

  it("blocks unsafe publishing-frequency values", () => {
    const result = releaseEvidenceBoundWeeklyRecommendations({
      requestScope: scope,
      evaluatedAt: "2026-07-29T09:00:00.000Z",
      candidates: [candidate({
        change: {
          kind: "CHANGE_PUBLISHING_FREQUENCY",
          platform: "Instagram",
          postsPerWeek: 50,
        },
      })],
      evidence: [evidence()],
    });

    expect(result.blocked[0].reasons).toContain("INVALID_CHANGE");
  });

  it("requires comparative evidence for both sides of a channel change", () => {
    const channelCandidate = candidate({
      change: {
        kind: "CHANGE_DISTRIBUTION_CHANNEL",
        fromPlatform: "Facebook",
        toPlatform: "Instagram",
      },
      claims: [{
        claim: "Compare recent Facebook and Instagram aggregate engagement.",
        citationIds: ["facebook", "instagram"],
      }],
    });
    const onlyInstagram = releaseEvidenceBoundWeeklyRecommendations({
      requestScope: scope,
      evaluatedAt: "2026-07-29T09:00:00.000Z",
      candidates: [channelCandidate],
      evidence: [evidence({ citationId: "instagram" })],
    });
    const bothPlatforms = releaseEvidenceBoundWeeklyRecommendations({
      requestScope: scope,
      evaluatedAt: "2026-07-29T09:00:00.000Z",
      candidates: [channelCandidate],
      evidence: [
        evidence({ citationId: "instagram" }),
        evidence({
          citationId: "facebook",
          platform: "Facebook",
          value: 2.1,
        }),
      ],
    });

    expect(onlyInstagram.blocked[0].reasons).toEqual(expect.arrayContaining([
      "IRRELEVANT_EVIDENCE",
      "UNKNOWN_CITATION",
    ]));
    expect(bothPlatforms.released).toHaveLength(1);
  });
});
