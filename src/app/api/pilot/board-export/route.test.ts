import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRequestCapability: vi.fn(),
  getPilotBoardReadModel: vi.fn(),
}));

vi.mock("@/server/auth/requestAuthorization", () => ({
  requireRequestCapability: mocks.requireRequestCapability,
}));
vi.mock("@/server/pilotTelemetry/boardReadModel", () => ({
  getPilotBoardReadModel: mocks.getPilotBoardReadModel,
}));

import { GET } from "./route";

const boardExport = {
  schemaVersion: 1 as const,
  generatedAt: "2026-08-21T10:00:00.000Z",
  scope: "PILOT_COHORT_AGGREGATE" as const,
  privacy: "NO_CHURCH_USER_SERMON_CLIP_POST_OR_FREE_TEXT_IDENTIFIERS" as const,
  evidenceLabel: "INSUFFICIENT_SAMPLE" as const,
  evidenceSummary: "The sample is too small for launch claims.",
  stopState: "CONTINUE_WITH_LIMITS" as const,
  stopConditions: [],
  totals: {
    weeksObserved: 1,
    churchWeeksObserved: 1,
    activeChurches: 1,
    onboardingEvidenceState: "UNKNOWN" as const,
    onboardingObservedChurches: 0,
    onboardingCompleteChurches: 0,
    sermonsStarted: 1,
    suggestionsReady: 1,
    firstBrandedPreviewsReady: 1,
    fullContentSetsReady: 0,
    completedWeeklyWorkflows: 0,
    suggestionReadyRate: 1,
    firstPreviewReadyRate: 1,
    fullContentReadyRate: 0,
    workflowCompletionRate: 0,
    averageSuggestionMinutes: 10,
    suggestionTimingSamples: 1,
    averageFirstPreviewMinutes: 20,
    firstPreviewTimingSamples: 1,
    supportIncidents: 0,
    supportMinutes: 0,
    supportMinutesPerActiveChurch: 0,
    criticalIncidents: 0,
    pastoralAccuracyIncidents: 0,
    privacySecurityIncidents: 0,
  },
  weekly: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRequestCapability.mockResolvedValue({
    organizationId: "org-current",
    campusId: "campus-current",
    actorId: "user-current",
  });
  mocks.getPilotBoardReadModel.mockResolvedValue({
    boardExport,
    csv: "week_start,evidence_label\n2026-08-17,INSUFFICIENT_SAMPLE",
  });
});

describe("pilot board export route", () => {
  it("derives exact tenant scope from persisted authorization and returns private aggregate JSON", async () => {
    const response = await GET(new Request("https://sermonclip.test/api/pilot/board-export?format=json&organizationId=org-attacker"));
    const body = await response.text();

    expect(mocks.requireRequestCapability).toHaveBeenCalledWith("analytics.export");
    expect(mocks.getPilotBoardReadModel).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: "org-current",
      campusId: "campus-current",
    }));
    expect(body).toContain("INSUFFICIENT_SAMPLE");
    expect(body).not.toMatch(/org-current|campus-current|org-attacker|user-current/u);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("x-pilot-evidence")).toBe("directional-not-readiness-proof");
  });

  it("returns the fixed-column aggregate CSV when explicitly requested", async () => {
    const response = await GET(new Request("https://sermonclip.test/api/pilot/board-export?format=csv"));

    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(response.headers.get("content-disposition")).toContain("pilot-board-evidence.csv");
    expect(await response.text()).toContain("week_start,evidence_label");
  });
});
