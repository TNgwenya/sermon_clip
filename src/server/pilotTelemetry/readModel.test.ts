import { describe, expect, it, vi } from "vitest";

import {
  buildPilotDashboardReadModel,
  loadPilotTelemetryEvidence,
  type PilotTelemetryEvidence,
} from "./readModel";

const at = (minutes: number) => new Date(Date.parse("2026-08-01T10:00:00.000Z") + minutes * 60_000);

function evidence(): PilotTelemetryEvidence {
  return {
    sermons: [{
      id: "db-sermon-tenant-a",
      status: "CLIPS_GENERATED",
      sourceDurationSeconds: 3_600,
      createdAt: at(0),
      processingJobs: [{
        id: "db-processing-job",
        type: "PROCESS_SERMON",
        status: "SUCCEEDED",
        createdAt: at(0),
        startedAt: at(2),
        completedAt: at(20),
        attemptCount: 1,
      }],
      orchestrationJobs: [{
        id: "db-content-stage",
        lane: "CONTENT_WEEK",
        status: "SUCCEEDED",
        createdAt: at(15),
        completedAt: at(28),
        attemptCount: 1,
        deadLetteredAt: null,
        lastFailureCode: null,
      }],
      clipCandidates: [{
        id: "db-clip",
        score: 0.92,
        isAiGenerated: true,
        isManuallyEdited: false,
        status: "APPROVED",
        exportStatus: "COMPLETED",
        exportedAt: at(14),
        exportFreshness: "UP_TO_DATE",
        overlayStatus: "COMPLETED",
        overlayRenderedAt: at(10),
        overlayFreshness: "UP_TO_DATE",
        transcriptSafetyStatus: "REVIEWED",
        transcriptSafetyReviewedAt: at(9),
        createdAt: at(5),
        artifacts: [{
          id: "db-overlay-artifact",
          kind: "OVERLAY",
          status: "READY",
          freshness: "UP_TO_DATE",
          planHash: "sha256-safe-plan",
          generatedAt: at(10),
          createdAt: at(10),
        }],
      }],
      weekDrafts: [{
        id: "db-week",
        status: "READY_FOR_REVIEW",
        createdAt: at(16),
        updatedAt: at(30),
        items: [{ status: "READY_FOR_REVIEW" }],
      }],
    }],
    approvals: [{
      status: "APPROVED",
      createdAt: at(20),
      resolvedAt: at(25),
      weekDraft: { sermonId: "db-sermon-tenant-a" },
    }],
    scheduledPosts: [{
      id: "db-post",
      status: "READY_FOR_MEDIA_TEAM",
      automationMode: "MANUAL",
      workerStatus: "IDLE",
      attemptCount: 0,
      finalPrivacyStatus: null,
      clipIdsJson: ["db-clip"],
      createdAt: at(35),
      contentAssetLinks: [],
    }],
    publishingAudits: [],
    funnelEvents: [{ sermonId: "db-sermon-tenant-a", eventType: "GENERATION_COMPLETED", durationMs: 100, occurredAt: at(30) }],
    supportEvents: [{
      occurredAt: at(40),
      metadataJson: {
        schemaVersion: 1,
        boardCategory: "OPERATIONAL",
        category: "PROCESSING",
        severity: "CRITICAL",
        status: "OPEN",
        minutes: 45,
        incidentDate: "2026-08-01",
        outcome: "ENGINEERING_ESCALATION",
      },
    }],
  };
}

const orchestration = {
  status: "ONLINE" as const,
  pending: 0,
  leased: 0,
  failed: 0,
  deadLetters: 0,
  oldestPendingAt: null,
  lastSeenAt: at(45),
  workerId: "must-not-enter-read-model",
};
const mediaWorker = {
  status: "ONLINE" as const,
  lastSeenAt: at(45).toISOString(),
  workerId: "must-not-enter-read-model",
  ageSeconds: 5,
  details: { objectKey: "must-not-enter-read-model" },
  summary: "Media worker online.",
};
const publishingWorker = {
  status: "ONLINE" as const,
  lastSeenAt: at(45).toISOString(),
  workerId: "must-not-enter-read-model",
  dryRun: true,
  ageSeconds: 5,
  capabilities: null,
  summary: "Publishing worker online in dry run.",
};

describe("pilot telemetry read model", () => {
  it("keeps historical milestone timing conservative and exposes unsupported evidence as unknown", () => {
    const model = buildPilotDashboardReadModel({
      organizationId: "org-tenant-a",
      now: at(60),
      evidence: evidence(),
      orchestration,
      mediaWorker,
      publishingWorker,
      cost: { status: "UNAVAILABLE", message: "No cost evidence." },
    });

    expect(model.sermons[0]).toMatchObject({
      label: "Sermon 1",
      suggestionsMilliseconds: 5 * 60_000,
      brandedPreviewMilliseconds: 10 * 60_000,
      fullContentMilliseconds: 15 * 60_000,
    });
    expect(model.summary.dataQualityFlags.map((flag) => flag.code)).toContain("MISSING_QUALITY_CONTRACT");
    expect(model.gates.find((gate) => gate.key === "tenant-isolation-drill")?.state).toBe("UNKNOWN");
    expect(model.gates.find((gate) => gate.key === "vendor-billing-reconciliation")?.state).toBe("UNKNOWN");
    expect(model.gates.find((gate) => gate.key === "support-load")?.state).toBe("STOP");
    expect(model.stopRecommended).toBe(true);
    expect(model.workflow).toMatchObject({ supportIncidents: 1, supportMinutes: 45, criticalSupportIncidents: 1 });
  });

  it("does not expose raw worker details or database identifiers in aggregate journey evidence", () => {
    const model = buildPilotDashboardReadModel({
      organizationId: "org-tenant-a",
      now: at(60),
      evidence: evidence(),
      orchestration,
      mediaWorker,
      publishingWorker,
      cost: { status: "UNAVAILABLE", message: "No cost evidence." },
    });

    const aggregate = JSON.stringify({ summary: model.summary, queue: model.queue });
    expect(aggregate).not.toContain("db-sermon-tenant-a");
    expect(aggregate).not.toContain("db-processing-job");
    expect(aggregate).not.toContain("must-not-enter-read-model");
  });

  it("does not treat legacy manual POSTED rows as missing governed connector intent", () => {
    const fixture = evidence();
    fixture.scheduledPosts[0].status = "POSTED";
    const model = buildPilotDashboardReadModel({
      organizationId: "org-tenant-a",
      now: at(60),
      evidence: fixture,
      orchestration,
      mediaWorker,
      publishingWorker,
      cost: { status: "UNAVAILABLE", message: "No cost evidence." },
    });

    expect(model.summary.totals.publishedWithoutExplicitIntent).toBe(0);
    expect(model.gates.find((gate) => gate.key === "publication-intent")?.state).toBe("UNKNOWN");
  });

  it("applies the organization and campus scope to every evidence query", async () => {
    const calls: unknown[] = [];
    const findMany = vi.fn(async (args: unknown) => { calls.push(args); return []; });
    await loadPilotTelemetryEvidence({
      organizationId: "org-scope",
      campusId: "campus-scope",
      from: at(0),
      until: at(60),
      db: {
        sermon: { findMany },
        approvalRequest: { findMany },
        scheduledPost: { findMany },
        auditEvent: { findMany },
        contentFunnelEvent: { findMany },
      } as never,
    });

    expect(calls).toHaveLength(6);
    for (const call of calls) {
      expect(call).toEqual(expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org-scope", campusId: "campus-scope" }),
      }));
    }
  });
});
