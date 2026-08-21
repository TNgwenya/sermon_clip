import { describe, expect, it } from "vitest";

import {
  buildPilotBoardReadModel,
  type PilotBoardReadModel,
} from "@/server/pilotTelemetry/boardReadModel";
import type { PilotTelemetryEvidence } from "@/server/pilotTelemetry/readModel";

const at = (iso: string) => new Date(iso);

function sermon(input: { id: string; admitted: string; includeFullSet?: boolean }) {
  const admittedAt = at(input.admitted);
  const afterMinutes = (minutes: number) => new Date(admittedAt.getTime() + minutes * 60_000);
  return {
    id: input.id,
    status: "EXPORTED",
    sourceDurationSeconds: 3_600,
    createdAt: admittedAt,
    processingJobs: [{
      id: `${input.id}-processing`,
      type: "PROCESS_SERMON",
      status: "SUCCEEDED",
      createdAt: admittedAt,
      startedAt: afterMinutes(1),
      completedAt: afterMinutes(30),
      attemptCount: 1,
    }],
    orchestrationJobs: input.includeFullSet ? [{
      id: `${input.id}-content-job`,
      lane: "CONTENT_WEEK",
      status: "SUCCEEDED",
      createdAt: afterMinutes(12),
      completedAt: afterMinutes(30),
      attemptCount: 1,
      deadLetteredAt: null,
      lastFailureCode: null,
    }] : [],
    clipCandidates: [{
      id: `${input.id}-clip`,
      score: 9,
      isAiGenerated: true,
      isManuallyEdited: false,
      status: "EXPORTED",
      exportStatus: "COMPLETED",
      exportedAt: afterMinutes(20),
      exportFreshness: "UP_TO_DATE",
      overlayStatus: "COMPLETED",
      overlayRenderedAt: afterMinutes(10),
      overlayFreshness: "UP_TO_DATE",
      transcriptSafetyStatus: "TRUSTED",
      transcriptSafetyReviewedAt: null,
      createdAt: afterMinutes(5),
      artifacts: [{
        id: `${input.id}-overlay`,
        kind: "OVERLAY",
        status: "READY",
        freshness: "UP_TO_DATE",
        planHash: "verified-plan",
        generatedAt: afterMinutes(10),
        createdAt: afterMinutes(9),
      }],
    }],
    weekDrafts: input.includeFullSet ? [{
      id: `${input.id}-week`,
      status: "READY_FOR_REVIEW",
      createdAt: afterMinutes(25),
      updatedAt: afterMinutes(30),
      items: [{ status: "DRAFT" }],
    }] : [],
  };
}

function support(input: {
  incidentDate: string;
  severity: "MEDIUM" | "CRITICAL";
  boardCategory?: "PASTORAL_ACCURACY" | "PRIVACY_SECURITY" | "OPERATIONAL";
}) {
  return {
    occurredAt: at(`${input.incidentDate}T12:00:00.000Z`),
    metadataJson: {
      schemaVersion: 1,
      category: "REVIEW",
      severity: input.severity,
      status: "RESOLVED",
      minutes: 30,
      incidentDate: input.incidentDate,
      outcome: "OPERATOR_ASSISTED",
      ...(input.boardCategory ? { boardCategory: input.boardCategory } : {}),
    },
  };
}

function evidence(): PilotTelemetryEvidence {
  return {
    sermons: [
      sermon({ id: "raw-sermon-one", admitted: "2026-08-18T09:00:00.000Z", includeFullSet: true }),
      sermon({ id: "raw-sermon-two", admitted: "2026-08-19T09:00:00.000Z" }),
    ],
    approvals: [],
    scheduledPosts: [],
    publishingAudits: [],
    funnelEvents: [],
    supportEvents: [
      support({ incidentDate: "2026-08-18", severity: "CRITICAL", boardCategory: "PASTORAL_ACCURACY" }),
      support({ incidentDate: "2026-08-25", severity: "MEDIUM", boardCategory: "PRIVACY_SECURITY" }),
      { occurredAt: at("2026-08-20T10:00:00.000Z"), metadataJson: { schemaVersion: 1, category: "free form" } },
    ],
  } as PilotTelemetryEvidence;
}

function build(fixture = evidence()): PilotBoardReadModel {
  return buildPilotBoardReadModel({
    scope: {
      organizationId: "raw-org-current",
      campusId: "raw-campus-current",
      evidenceScopedToCurrentTenant: true,
    },
    from: at("2026-08-17T00:00:00.000Z"),
    until: at("2026-08-31T00:00:00.000Z"),
    generatedAt: at("2026-08-31T12:00:00.000Z"),
    evidence: fixture,
  });
}

describe("pilot board read model", () => {
  it("builds one anonymous row per current-tenant week with truthful journey timing", () => {
    const model = build();

    expect(model.observations).toHaveLength(2);
    expect(model.observations[0]).toMatchObject({
      weekStart: "2026-08-17",
      onboardingComplete: null,
      activeThisWeek: true,
      sermonsStarted: 2,
      suggestionsReady: 2,
      suggestionMinutesTotal: 10,
      suggestionTimingSampleCount: 2,
      firstBrandedPreviewReady: 2,
      firstPreviewMinutesTotal: 20,
      firstPreviewTimingSampleCount: 2,
      fullContentSetReady: 1,
      fullContentMinutesTotal: 18,
      fullContentTimingSampleCount: 1,
      weeklyWorkflowCompleted: true,
    });
    expect(model.observations[1]).toMatchObject({
      weekStart: "2026-08-24",
      sermonsStarted: 0,
      activeThisWeek: true,
    });
    expect(model.dataQuality.onboardingEvidenceAvailable).toBe(false);
    expect(model.boardExport.weekly[0]).toMatchObject({
      onboardingEvidenceState: "UNKNOWN",
      onboardingObservedChurches: 0,
      onboardingCompleteChurches: 0,
    });
    expect(model.limitations.join(" ")).toContain("remain unknown");
  });

  it("counts only valid allowlisted support events and explicit board classes", () => {
    const model = build();

    expect(model.observations[0]).toMatchObject({
      supportIncidentCount: 1,
      supportMinutes: 30,
      criticalIncidentCount: 1,
      pastoralAccuracyIncidentCount: 1,
      privacySecurityIncidentCount: 0,
    });
    expect(model.observations[1]).toMatchObject({
      supportIncidentCount: 1,
      privacySecurityIncidentCount: 1,
    });
    expect(model.dataQuality.ignoredSupportEvents).toBe(1);
  });

  it("generates the existing board export and CSV with insufficient-sample labels", () => {
    const model = build();

    expect(model.boardExport).toMatchObject({
      scope: "PILOT_COHORT_AGGREGATE",
      evidenceLabel: "INSUFFICIENT_SAMPLE",
      stopState: "STOP_PILOT",
    });
    expect(model.csv.split("\n")[0]).toContain("evidence_label");
    expect(model.csv).toContain("INSUFFICIENT_SAMPLE");
  });

  it("does not expose raw or pseudonymous tenant, sermon, clip, or post identifiers", () => {
    const serialized = JSON.stringify(build());
    expect(serialized).not.toMatch(/raw-org-current|raw-campus-current|raw-sermon|sermon_[a-f0-9]|church_[a-f0-9]/u);
    expect(serialized).not.toContain("verified-plan");
  });

  it("rejects an unverified or invalid current-tenant scope", () => {
    expect(() => buildPilotBoardReadModel({
      scope: {
        organizationId: "raw-org-current",
        campusId: null,
        evidenceScopedToCurrentTenant: false,
      } as never,
      from: at("2026-08-17T00:00:00.000Z"),
      until: at("2026-08-31T00:00:00.000Z"),
      generatedAt: at("2026-08-31T00:00:00.000Z"),
      evidence: evidence(),
    })).toThrow("current organization and campus only");
  });
});
