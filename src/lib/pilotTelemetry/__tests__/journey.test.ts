import { describe, expect, it } from "vitest";

import { makePilotJourneyFixture } from "../__fixtures__/journeys";
import {
  aggregatePilotJourneyTelemetry,
  evaluatePilotStopConditions,
  type PilotJourneyObservation,
} from "../journey";

describe("pilot journey telemetry", () => {
  it("withholds percentiles below an explicit sample minimum", () => {
    const summary = aggregatePilotJourneyTelemetry([
      makePilotJourneyFixture({ index: 1 }),
      makePilotJourneyFixture({ index: 2 }),
    ], { minimumPercentileSampleSize: 5 });

    expect(summary.evidenceScope).toBe("PILOT_EVIDENCE_NOT_READINESS_PROOF");
    expect(summary.denominators).toMatchObject({ sermons: 2, churches: 2 });
    expect(summary.durations.firstPlayableBrandedClip).toEqual({
      state: "INSUFFICIENT",
      sampleSize: 2,
      minimumSampleSize: 5,
      p50Milliseconds: null,
      p90Milliseconds: null,
    });
  });

  it("reports percentiles only when the evidence minimum is met", () => {
    const summary = aggregatePilotJourneyTelemetry(
      [10, 20, 30, 40, 50].map((brandedMinutes, index) => makePilotJourneyFixture({
        index: index + 1,
        brandedMinutes,
        suggestionMinutes: Math.max(5, brandedMinutes - 5),
      })),
      { minimumPercentileSampleSize: 5 },
    );

    expect(summary.durations.firstPlayableBrandedClip).toMatchObject({
      state: "KNOWN",
      sampleSize: 5,
      p50Milliseconds: 30 * 60_000,
      p90Milliseconds: 50 * 60_000,
    });
  });

  it("never infers queue delay from orchestration completion", () => {
    const fixture = makePilotJourneyFixture({ index: 1 });
    fixture.processingJobs[0].startedAt = null;
    const summary = aggregatePilotJourneyTelemetry([fixture], { minimumPercentileSampleSize: 2 });

    expect(summary.sermons[0].queueDelay).toMatchObject({ state: "UNKNOWN", source: "NONE" });
    expect(summary.sermons[0].dataQualityFlags).toContain("MISSING_QUEUE_START");
  });

  it("counts legacy processing retries as well as orchestration retries", () => {
    const fixture = makePilotJourneyFixture({ index: 1, attemptCount: 2 });
    fixture.processingJobs[0].attemptCount = 3;

    const summary = aggregatePilotJourneyTelemetry([fixture], { minimumPercentileSampleSize: 2 });

    expect(summary.sermons[0].retryCount).toBe(3);
    expect(summary.stages.find((stage) => stage.stage === "PROCESSING:PROCESS_SERMON"))
      .toMatchObject({ retryCount: 2 });
    expect(summary.stages.find((stage) => stage.stage === "INTELLIGENCE"))
      .toMatchObject({ retryCount: 1 });
  });

  it("requires durable, playable, current, brand-verified artifact evidence", () => {
    const fixture = makePilotJourneyFixture({ index: 1 });
    const branded = fixture.artifacts.find((artifact) => artifact.kind === "BRANDED_REVIEW_PREVIEW")!;
    branded.brandVerified = false;
    const summary = aggregatePilotJourneyTelemetry([fixture], { minimumPercentileSampleSize: 2 });

    expect(summary.sermons[0].firstPlayableBrandedClip.state).toBe("UNKNOWN");
    expect(summary.sermons[0].dataQualityFlags).toContain("BRANDED_ARTIFACT_NOT_VERIFIED");
  });

  it("does not turn successful stage completion into milestone readiness", () => {
    const fixture = makePilotJourneyFixture({ index: 1, contentMinutes: 90 });
    fixture.artifacts = fixture.artifacts.filter((artifact) => (
      artifact.kind !== "RANKED_SUGGESTIONS" && artifact.kind !== "CONTENT_WEEK_SET"
    ));
    const summary = aggregatePilotJourneyTelemetry([fixture], { minimumPercentileSampleSize: 2 });

    expect(summary.sermons[0].suggestionsReady.state).toBe("UNKNOWN");
    expect(summary.sermons[0].fullRequestedContent.state).toBe("UNKNOWN");
    expect(summary.sermons[0].dataQualityFlags).toEqual(expect.arrayContaining([
      "MISSING_SUGGESTION_READY_EVIDENCE",
      "MISSING_FULL_SET_READY_EVIDENCE",
    ]));
  });

  it("separates requested full-content denominators from all sermons", () => {
    const summary = aggregatePilotJourneyTelemetry([
      makePilotJourneyFixture({ index: 1, contentMinutes: 90 }),
      makePilotJourneyFixture({ index: 2, contentMinutes: null }),
    ], { minimumPercentileSampleSize: 2 });

    expect(summary.denominators).toMatchObject({ sermons: 2, sermonsRequestingFullContent: 1 });
    expect(summary.sermons[0].fullRequestedContent).toMatchObject({
      state: "KNOWN",
      milliseconds: 71 * 60_000,
    });
    expect(summary.sermons[1].fullRequestedContent.state).toBe("NOT_REQUESTED");
    expect(summary.durations.fullRequestedContent).toMatchObject({
      state: "INSUFFICIENT",
      sampleSize: 1,
    });
  });

  it("aggregates retry, dead-letter, fallback, rework, safety, and provenance evidence with named denominators", () => {
    const first = makePilotJourneyFixture({ index: 1, attemptCount: 3, orchestrationStatus: "DEAD_LETTER", fallbackMode: "BASIC_TIME_BASED" });
    first.rework = { explicitReplayCount: 1, forceRegenerationCount: 1, artifactInvalidationCount: 2 };
    first.quality = { ...first.quality!, safetyCorrectionCount: 2, provenanceCheckCount: 4, provenanceFailureCount: 1 };
    const second = makePilotJourneyFixture({ index: 2 });
    const summary = aggregatePilotJourneyTelemetry([first, second], { minimumPercentileSampleSize: 2 });

    expect(summary.totals).toMatchObject({
      retries: 2,
      deadLetters: 1,
      fallbackSermons: 1,
      reworkActions: 4,
      safetyCorrections: 2,
      provenanceChecks: 7,
      provenanceFailures: 1,
    });
    expect(summary.rates.sermonsUsingFallback).toMatchObject({ denominatorKind: "SERMONS", numerator: 1, denominator: 2, value: 0.5 });
    expect(summary.rates.provenanceFailures).toMatchObject({ denominatorKind: "PROVENANCE_CHECKS", numerator: 1, denominator: 7 });
    expect(summary.rates.sermonsWithSafetyCorrections).toMatchObject({
      denominatorKind: "SERMONS_WITH_QUALITY_EVIDENCE",
      numerator: 1,
      denominator: 2,
      value: 0.5,
    });
    expect(summary.stages.find((stage) => stage.stage === "INTELLIGENCE")).toMatchObject({ deadLetterCount: 1, retryCount: 2 });
  });

  it("does not mistake an idempotent publishing retry for a missing intent", () => {
    const fixture = makePilotJourneyFixture({ index: 1 });
    fixture.publishing = {
      approvedExportCount: 1,
      explicitPublishIntentCount: 1,
      publishAttemptCount: 2,
      publishedCount: 1,
      blockedWithoutApprovalCount: 0,
      publishedWithoutExplicitIntentCount: 0,
    };

    const summary = aggregatePilotJourneyTelemetry([fixture], { minimumPercentileSampleSize: 2 });

    expect(summary.rates.publishAttemptsWithoutExplicitIntent).toMatchObject({
      numerator: 0,
      denominator: 2,
      denominatorKind: "PUBLISH_ATTEMPTS",
      value: 0,
    });
    expect(summary.totals.publishedWithoutExplicitIntent).toBe(0);
  });

  it("rejects accidental raw content even when supplied through an untyped adapter", () => {
    const unsafe = {
      ...makePilotJourneyFixture({ index: 1 }),
      transcriptText: "must never enter telemetry",
    } as PilotJourneyObservation;
    expect(() => aggregatePilotJourneyTelemetry([unsafe], { minimumPercentileSampleSize: 2 }))
      .toThrow("rejects raw-content field");
  });

  it("produces stop inputs without claiming launch readiness", () => {
    const first = makePilotJourneyFixture({ index: 1 });
    first.publishing = {
      approvedExportCount: 0,
      explicitPublishIntentCount: 0,
      publishAttemptCount: 1,
      publishedCount: 1,
      blockedWithoutApprovalCount: 0,
      publishedWithoutExplicitIntentCount: 1,
    };
    const summary = aggregatePilotJourneyTelemetry([first], { minimumPercentileSampleSize: 3 });
    const result = evaluatePilotStopConditions(summary, {
      minimumSermons: 5,
      maximumDeadLetterSermonRate: 0.1,
      maximumFallbackSermonRate: 0.2,
      maximumProvenanceFailureRate: 0,
      maximumPublishedWithoutExplicitIntent: 0,
      maximumFirstBrandedP90Milliseconds: 30 * 60_000,
    });

    expect(result).toMatchObject({
      evidenceScope: "PILOT_EVIDENCE_NOT_READINESS_PROOF",
      readinessConclusion: "NOT_PROVIDED",
      stopRecommended: true,
    });
    expect(result.conditions.find((condition) => condition.key === "MINIMUM_SAMPLE")?.state).toBe("INSUFFICIENT");
    expect(result.conditions.find((condition) => condition.key === "PUBLISH_WITHOUT_INTENT")?.state).toBe("BREACHED");
    expect(result.conditions.find((condition) => condition.key === "FIRST_BRANDED_P90")?.state).toBe("INSUFFICIENT");
    expect(result.conditions.find((condition) => condition.key === "DEAD_LETTERS")?.state).toBe("INSUFFICIENT");
  });
});
