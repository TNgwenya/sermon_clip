import type { PilotJourneyObservation } from "../journey";

const minute = 60_000;

export function makePilotJourneyFixture(input: {
  index: number;
  queueMinutes?: number;
  suggestionMinutes?: number;
  brandedMinutes?: number;
  contentMinutes?: number | null;
  attemptCount?: number;
  orchestrationStatus?: "SUCCEEDED" | "DEAD_LETTER";
  fallbackMode?: "NONE" | "BASIC_TIME_BASED" | "MANUAL_ONLY";
}): PilotJourneyObservation {
  const admittedAt = new Date(Date.UTC(2026, 7, 1 + input.index, 8, 0));
  const after = (minutes: number) => new Date(admittedAt.getTime() + minutes * minute);
  const queueMinutes = input.queueMinutes ?? 2;
  const suggestionMinutes = input.suggestionMinutes ?? 12;
  const brandedMinutes = input.brandedMinutes ?? 18;
  const contentRequested = input.contentMinutes !== null && input.contentMinutes !== undefined;
  return {
    sermonKey: `sermon-${input.index}`,
    churchKey: `church-${(input.index % 2) + 1}`,
    admittedAt,
    processingJobs: [{
      jobKey: `processing-${input.index}`,
      type: "PROCESS_SERMON",
      status: "SUCCEEDED",
      createdAt: admittedAt,
      startedAt: after(queueMinutes),
      completedAt: after(brandedMinutes),
      attemptCount: 1,
    }],
    orchestrationJobs: [
      {
        jobKey: `intelligence-${input.index}`,
        lane: "INTELLIGENCE",
        status: input.orchestrationStatus ?? "SUCCEEDED",
        createdAt: after(5),
        completedAt: input.orchestrationStatus === "DEAD_LETTER" ? null : after(suggestionMinutes),
        attemptCount: input.attemptCount ?? 1,
        deadLetteredAt: input.orchestrationStatus === "DEAD_LETTER" ? after(suggestionMinutes) : null,
      },
      ...(contentRequested ? [{
        jobKey: `content-week-${input.index}`,
        lane: "CONTENT_WEEK" as const,
        status: "SUCCEEDED" as const,
        createdAt: after(brandedMinutes + 1),
        completedAt: after(input.contentMinutes!),
        attemptCount: 1,
      }] : []),
    ],
    artifacts: [
      {
        artifactKey: `suggestions-${input.index}`,
        kind: "RANKED_SUGGESTIONS",
        readyAt: after(suggestionMinutes),
        durable: true,
      },
      {
        artifactKey: `brand-${input.index}`,
        kind: "BRANDED_REVIEW_PREVIEW",
        readyAt: after(brandedMinutes),
        durable: true,
        playable: true,
        brandVerified: true,
        freshness: "CURRENT",
        rank: 1,
      },
      ...(contentRequested ? [{
        artifactKey: `content-set-${input.index}`,
        kind: "CONTENT_WEEK_SET" as const,
        requestedAt: after(brandedMinutes + 1),
        readyAt: after(input.contentMinutes!),
        durable: true,
      }] : []),
    ],
    quality: {
      contractPresent: true,
      automationMode: input.fallbackMode && input.fallbackMode !== "NONE" ? "MANUAL_REVIEW_ONLY" : "FULL",
      fallbackMode: input.fallbackMode ?? "NONE",
      manualReviewRequired: Boolean(input.fallbackMode && input.fallbackMode !== "NONE"),
      manualReviewCompleted: false,
      safetyCorrectionCount: 0,
      provenanceCheckCount: 3,
      provenanceFailureCount: 0,
    },
    publishing: {
      approvedExportCount: 0,
      explicitPublishIntentCount: 0,
      publishAttemptCount: 0,
      publishedCount: 0,
      blockedWithoutApprovalCount: 0,
      publishedWithoutExplicitIntentCount: 0,
    },
    rework: {
      explicitReplayCount: 0,
      forceRegenerationCount: 0,
      artifactInvalidationCount: 0,
    },
  };
}
