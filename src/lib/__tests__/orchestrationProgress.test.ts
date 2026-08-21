import { describe, expect, it } from "vitest";

import { buildCustomerValueMilestones, type CustomerValueEvidence } from "../orchestrationProgress";

const at = (minutes: number) => new Date(Date.UTC(2026, 7, 21, 10, minutes));
const noMedia: CustomerValueEvidence = {
  rankedSuggestionCount: 0,
  priorityPreviewReadyCount: 0,
  priorityPreviewTargetCount: 0,
  firstBrandedPreviewReady: false,
  deferredPreviewCount: 0,
};

describe("customer-value orchestration progress", () => {
  it("surfaces saved ranked suggestions before preview work finishes", () => {
    const milestones = buildCustomerValueMilestones([
      { lane: "INTELLIGENCE", status: "LEASED", createdAt: at(1), completedAt: null },
    ], {
      ...noMedia,
      rankedSuggestionCount: 5,
      priorityPreviewTargetCount: 3,
      deferredPreviewCount: 2,
    });

    expect(milestones.find((milestone) => milestone.key === "suggestions")).toMatchObject({
      state: "ready",
      detail: expect.stringContaining("5 ranked clip suggestions"),
    });
    expect(milestones.find((milestone) => milestone.key === "first-preview")?.state).toBe("waiting");
  });

  it("requires current media evidence before claiming a branded preview or top three", () => {
    const milestones = buildCustomerValueMilestones([
      { lane: "INTELLIGENCE", status: "SUCCEEDED", createdAt: at(1), completedAt: at(2) },
      { lane: "PREVIEW", status: "SUCCEEDED", createdAt: at(2), completedAt: at(3) },
    ], {
      rankedSuggestionCount: 6,
      priorityPreviewReadyCount: 1,
      priorityPreviewTargetCount: 3,
      firstBrandedPreviewReady: false,
      deferredPreviewCount: 3,
    });

    expect(milestones.find((milestone) => milestone.key === "first-preview")).toMatchObject({
      state: "degraded",
      detail: expect.stringContaining("could not be verified"),
    });
    expect(milestones.find((milestone) => milestone.key === "top-three")).toMatchObject({
      state: "degraded",
      detail: expect.stringContaining("1 of 3"),
    });
    expect(milestones.find((milestone) => milestone.key === "full-content")).toMatchObject({
      state: "not-requested",
      detail: expect.stringContaining("3 lower-ranked previews"),
    });
  });

  it("separates first branded readiness, top-three readiness, and optional full content", () => {
    const milestones = buildCustomerValueMilestones([
      { lane: "INTELLIGENCE", status: "SUCCEEDED", createdAt: at(1), completedAt: at(2) },
      { lane: "PREVIEW", status: "SUCCEEDED", createdAt: at(2), completedAt: at(3) },
    ], {
      rankedSuggestionCount: 5,
      priorityPreviewReadyCount: 3,
      priorityPreviewTargetCount: 3,
      firstBrandedPreviewReady: true,
      deferredPreviewCount: 2,
    });

    expect(milestones.find((milestone) => milestone.key === "first-preview")?.state).toBe("ready");
    expect(milestones.find((milestone) => milestone.key === "top-three")?.state).toBe("ready");
    expect(milestones.find((milestone) => milestone.key === "full-content")).toMatchObject({
      state: "not-requested",
      detail: expect.stringContaining("on demand"),
    });
  });

  it("does not let an old failed attempt override a newer successful replay", () => {
    const milestones = buildCustomerValueMilestones([
      { lane: "INTELLIGENCE", status: "FAILED", createdAt: at(1), completedAt: at(2) },
      { lane: "INTELLIGENCE", status: "SUCCEEDED", createdAt: at(3), completedAt: at(4) },
    ]);

    expect(milestones[0].state).toBe("ready");
  });

  it("surfaces dead letters and safety stops without hiding completed suggestions", () => {
    const milestones = buildCustomerValueMilestones([
      {
        lane: "INTELLIGENCE",
        status: "SUCCEEDED",
        createdAt: at(1),
        completedAt: at(2),
      },
      {
        lane: "PREVIEW",
        status: "DEAD_LETTER",
        createdAt: at(3),
        completedAt: null,
        lastFailureCode: "ARTIFACT_INTEGRITY",
      },
    ], {
      ...noMedia,
      rankedSuggestionCount: 4,
      priorityPreviewTargetCount: 3,
      deferredPreviewCount: 1,
    });

    expect(milestones[0].state).toBe("attention");
    expect(milestones.find((milestone) => milestone.key === "suggestions")?.state).toBe("ready");
    expect(milestones.find((milestone) => milestone.key === "first-preview")).toMatchObject({
      state: "attention",
      detail: expect.stringContaining("stopped safely"),
    });
  });

  it("describes a cancelled optional Content Week as stopped rather than finished", () => {
    const milestones = buildCustomerValueMilestones([
      { lane: "CONTENT_WEEK", status: "CANCELLED", createdAt: at(1), completedAt: null },
    ], noMedia);

    expect(milestones.find((milestone) => milestone.key === "full-content")).toMatchObject({
      state: "not-requested",
      detail: expect.stringContaining("stopped"),
    });
  });

  it("does not call the full set ready while optional lower previews remain", () => {
    const milestones = buildCustomerValueMilestones([
      { lane: "CONTENT_WEEK", status: "SUCCEEDED", createdAt: at(1), completedAt: at(2) },
    ], {
      rankedSuggestionCount: 5,
      priorityPreviewReadyCount: 3,
      priorityPreviewTargetCount: 3,
      firstBrandedPreviewReady: true,
      deferredPreviewCount: 2,
    });

    expect(milestones.find((milestone) => milestone.key === "full-content")).toMatchObject({
      state: "degraded",
      detail: expect.stringContaining("on demand"),
    });
  });
});
