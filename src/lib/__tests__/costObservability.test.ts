import { describe, expect, it } from "vitest";

import {
  buildWorkspaceCostObservability,
  calendarMonthWindow,
  formatBytesCompact,
  formatDurationCompact,
  formatEstimatedUsdMicros,
} from "@/lib/costObservability";

describe("cost observability", () => {
  it("separates measured telemetry, stored estimates, and configured allowances", () => {
    const report = buildWorkspaceCostObservability({
      now: new Date("2026-08-21T12:00:00.000Z"),
      sources: [
        {
          sourceDurationSeconds: 7_200,
          sermonStartSeconds: 1_200,
          sermonEndSeconds: 4_800,
          analyzeFullRecording: false,
        },
        {
          sourceDurationSeconds: null,
          sermonStartSeconds: null,
          sermonEndSeconds: null,
          analyzeFullRecording: true,
        },
      ],
      aiInvocations: [
        {
          provider: "openai",
          model: "text-model",
          operation: "sermon-intelligence",
          sermonId: "sermon-1",
          inputTokens: 1_000,
          cachedInputTokens: 200,
          outputTokens: 300,
          totalTokens: 1_300,
          audioDurationSeconds: null,
          estimatedCostMicros: BigInt(12_500),
          providerRequestCount: 1,
          cacheHit: false,
        },
        {
          provider: "openai",
          model: "transcription-model",
          operation: "transcription",
          sermonId: null,
          inputTokens: null,
          cachedInputTokens: null,
          outputTokens: null,
          totalTokens: null,
          audioDurationSeconds: 3_600,
          estimatedCostMicros: null,
          providerRequestCount: 2,
          cacheHit: true,
        },
      ],
      processingJobs: [
        {
          sermonId: "sermon-1",
          jobType: "TRANSCRIBE_AUDIO",
          status: "SUCCEEDED",
          createdAt: new Date("2026-08-03T10:00:00.000Z"),
          startedAt: new Date("2026-08-03T10:02:00.000Z"),
          completedAt: new Date("2026-08-03T10:12:00.000Z"),
          attemptCount: 1,
        },
        {
          sermonId: "sermon-1",
          jobType: "EXPORT_CLIPS",
          status: "FAILED",
          createdAt: new Date("2026-08-03T11:00:00.000Z"),
          startedAt: null,
          completedAt: null,
          attemptCount: 2,
        },
      ],
      entitlements: [
        { key: "ai.tokens.monthly", enabled: true, limitValue: BigInt(2_000) },
        { key: "storage.bytes", enabled: true, limitValue: BigInt(10_000) },
      ],
      usageEvents: [
        { metric: "ai.tokens", quantity: BigInt(1_700) },
      ],
      inventory: [
        { label: "Clips", recordCount: 2, recordsWithSize: 1, knownBytes: BigInt(4_096) },
      ],
    });

    expect(report.window).toEqual(calendarMonthWindow(new Date("2026-08-21T12:00:00.000Z")));
    expect(report.measured).toMatchObject({
      sermonCount: 2,
      sourcesWithKnownDuration: 1,
      sourceDurationSeconds: 7_200,
      boundedSourceCount: 1,
      totalTokens: 1_300,
      transcriptionAudioSeconds: 3_600,
      providerRequestCount: 3,
      sermonAttributedInvocations: 1,
      sermonAttributionCoveragePercent: 50,
      processingJobCount: 2,
      processingJobsWithRunDuration: 1,
      processingRunSeconds: 600,
      processingQueueSeconds: 120,
    });
    expect(report.workloadBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: "sermon-intelligence",
        provider: "openai",
        model: "text-model",
        invocationCount: 1,
        totalTokens: 1_300,
        cacheHitCount: 0,
        costEstimateCoverageCount: 1,
        sermonAttributionCount: 1,
      }),
      expect.objectContaining({
        operation: "transcription",
        invocationCount: 1,
        audioDurationSeconds: 3_600,
        cacheHitCount: 1,
        costEstimateCoverageCount: 0,
        sermonAttributionCount: 0,
      }),
    ]));
    expect(report.processingStageBreakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({
        jobType: "TRANSCRIBE_AUDIO",
        jobCount: 1,
        succeededCount: 1,
        jobsWithRunDuration: 1,
        runDurationSeconds: 600,
        queueDurationSeconds: 120,
      }),
      expect.objectContaining({
        jobType: "EXPORT_CLIPS",
        jobCount: 1,
        failedCount: 1,
        attemptCount: 2,
        jobsWithRunDuration: 0,
      }),
    ]));
    expect(report.estimated).toEqual({
      aiCostMicros: BigInt(12_500),
      aiInvocationsWithCostEstimate: 1,
      potentialAvoidedMediaSeconds: 3_600,
    });
    expect(report.allowances.find((item) => item.metric === "ai.tokens")).toMatchObject({
      used: BigInt(1_700),
      limit: BigInt(2_000),
      status: "WARNING",
    });
    expect(report.allowances.find((item) => item.metric === "storage.bytes")).toMatchObject({
      used: BigInt(0),
      eventCount: 0,
      status: "NO_METER_EVENTS",
    });
    expect(report.warnings.map((warning) => warning.code)).toEqual(expect.arrayContaining([
      "SOURCE_DURATION_COVERAGE",
      "SOURCE_WINDOW_COVERAGE",
      "INVENTORY_METADATA_COVERAGE",
      "AI_ESTIMATE_COVERAGE",
      "PROCESSING_DURATION_COVERAGE",
      "ALLOWANCE_AI_TOKENS",
      "ALLOWANCE_STORAGE_BYTES",
    ]));
  });

  it("does not present unmetered related activity as zero usage", () => {
    const report = buildWorkspaceCostObservability({
      now: new Date("2026-08-01T00:00:00.000Z"),
      sources: [],
      aiInvocations: [{
        provider: "openai",
        model: "text-model",
        operation: "sermon-intelligence",
        sermonId: "sermon-1",
        inputTokens: 10,
        cachedInputTokens: 0,
        outputTokens: 5,
        totalTokens: 15,
        audioDurationSeconds: null,
        estimatedCostMicros: BigInt(50),
        providerRequestCount: 1,
        cacheHit: false,
      }],
      processingJobs: [],
      entitlements: [{ key: "ai.tokens.monthly", enabled: true, limitValue: BigInt(1_000) }],
      usageEvents: [],
      inventory: [],
    });

    expect(report.allowances.find((item) => item.metric === "ai.tokens")?.status).toBe("NO_METER_EVENTS");
    expect(report.allowances.find((item) => item.metric === "ai.tokens")?.message).toContain("Do not read this as zero usage");
  });

  it("formats operator values without adding a price model", () => {
    expect(formatDurationCompact(3_600)).toBe("1.0 hr");
    expect(formatBytesCompact(BigInt(1_572_864))).toBe("1.5 MB");
    expect(formatEstimatedUsdMicros(BigInt(1_234_567))).toBe("$1.23");
  });
});
