import { describe, expect, it } from "vitest";

import {
  aggregateWeeklyPilotCohort,
  buildPilotBoardExport,
  serializePilotBoardCsv,
  serializePilotBoardJson,
  type PilotChurchWeekObservation,
} from "@/lib/pilotTelemetry/boardExport";

function observation(
  weekStart: string,
  overrides: Partial<PilotChurchWeekObservation> = {},
): PilotChurchWeekObservation {
  return {
    weekStart,
    onboardingComplete: true,
    activeThisWeek: true,
    sermonsStarted: 1,
    suggestionsReady: 1,
    firstBrandedPreviewReady: 1,
    fullContentSetReady: 1,
    weeklyWorkflowCompleted: true,
    suggestionMinutesTotal: 10,
    suggestionTimingSampleCount: 1,
    firstPreviewMinutesTotal: 18,
    firstPreviewTimingSampleCount: 1,
    supportIncidentCount: 0,
    supportMinutes: 0,
    criticalIncidentCount: 0,
    pastoralAccuracyIncidentCount: 0,
    privacySecurityIncidentCount: 0,
    ...overrides,
  };
}

describe("weekly pilot cohort aggregation", () => {
  it("aggregates anonymous church-week observations into rates and operator effort", () => {
    const weekly = aggregateWeeklyPilotCohort([
      observation("2026-08-10", { supportIncidentCount: 1, supportMinutes: 30 }),
      observation("2026-08-10", {
        suggestionsReady: 0,
        firstBrandedPreviewReady: 0,
        fullContentSetReady: 0,
        weeklyWorkflowCompleted: false,
        suggestionMinutesTotal: 0,
        suggestionTimingSampleCount: 0,
        firstPreviewMinutesTotal: 0,
        firstPreviewTimingSampleCount: 0,
        supportIncidentCount: 2,
        supportMinutes: 60,
      }),
    ]);

    expect(weekly).toEqual([expect.objectContaining({
      weekStart: "2026-08-10",
      churchWeeksObserved: 2,
      sermonsStarted: 2,
      suggestionReadyRate: 0.5,
      firstPreviewReadyRate: 0.5,
      workflowCompletionRate: 0.5,
      averageSuggestionMinutes: 10,
      averageFirstPreviewMinutes: 18,
      supportIncidents: 3,
      supportMinutes: 90,
      supportMinutesPerActiveChurch: 45,
    })]);
  });

  it("rejects malformed or negative aggregate input", () => {
    expect(() => aggregateWeeklyPilotCohort([
      observation("not-a-week"),
    ])).toThrow("ISO calendar date");
    expect(() => aggregateWeeklyPilotCohort([
      observation("2026-08-10", { sermonsStarted: -1 }),
    ])).toThrow("non-negative");
  });

  it("keeps missing onboarding evidence unknown instead of reporting completion or failure", () => {
    const weekly = aggregateWeeklyPilotCohort([
      observation("2026-08-10", { onboardingComplete: null }),
    ]);

    expect(weekly[0]).toMatchObject({
      onboardingEvidenceState: "UNKNOWN",
      onboardingObservedChurches: 0,
      onboardingCompleteChurches: 0,
    });
  });
});

describe("privacy-safe board export", () => {
  it("labels small samples as insufficient and makes no launch or SLA claim", () => {
    const report = buildPilotBoardExport({
      observations: [observation("2026-08-10")],
      generatedAt: new Date("2026-08-21T10:00:00.000Z"),
    });

    expect(report.evidenceLabel).toBe("INSUFFICIENT_SAMPLE");
    expect(report.stopState).toBe("CONTINUE_WITH_LIMITS");
    expect(report.evidenceSummary).toContain("too small for launch claims");
    expect(report.privacy).toBe("NO_CHURCH_USER_SERMON_CLIP_POST_OR_FREE_TEXT_IDENTIFIERS");
  });

  it("marks adequate pilot samples directional, never production-validated", () => {
    const observations = ["2026-08-10", "2026-08-17"].flatMap((week) => (
      Array.from({ length: 5 }, () => observation(week))
    ));
    const report = buildPilotBoardExport({ observations });

    expect(report.evidenceLabel).toBe("PILOT_DIRECTIONAL");
    expect(report.stopState).toBe("CONTINUE_PILOT");
    expect(report.evidenceSummary).toContain("not a production SLA");
  });

  it("stops for privacy/security evidence and pauses for pastoral-accuracy evidence", () => {
    const securityReport = buildPilotBoardExport({
      observations: [observation("2026-08-10", { privacySecurityIncidentCount: 1 })],
    });
    const accuracyReport = buildPilotBoardExport({
      observations: [observation("2026-08-10", { pastoralAccuracyIncidentCount: 1 })],
    });

    expect(securityReport.stopState).toBe("STOP_PILOT");
    expect(securityReport.stopConditions.find((condition) => condition.id === "privacy-security-incident"))
      .toMatchObject({ triggered: true, state: "STOP_PILOT" });
    expect(accuracyReport.stopState).toBe("PAUSE_PILOT");
  });

  it("exports only fixed aggregate columns without identities or private text", () => {
    const report = buildPilotBoardExport({
      observations: [observation("2026-08-10")],
      generatedAt: new Date("2026-08-21T10:00:00.000Z"),
    });
    const csv = serializePilotBoardCsv(report);
    const json = serializePilotBoardJson(report);

    expect(csv).toContain("week_start,evidence_label,stop_state");
    expect(csv).not.toMatch(/organization_id|campus_id|church_id|user_id|sermon_id|clip_id|post_id|email|note|title/iu);
    expect(json).not.toMatch(/organizationId|campusId|churchId|userId|sermonId|clipId|postId|email|privateNote/iu);
    expect(json).toContain("INSUFFICIENT_SAMPLE");
  });
});
