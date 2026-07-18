import { describe, expect, it } from "vitest";

import {
  getOpportunityOutcome,
  rankOpportunitiesForValue,
  summarizeOpportunityValue,
  type OpportunityValueItem,
} from "@/lib/opportunityValue";

function item(
  id: string,
  status: string,
  confidenceScore: number | null,
  createdAt = "2026-07-18T10:00:00.000Z",
): OpportunityValueItem {
  return { id, status, confidenceScore, createdAt };
}

describe("getOpportunityOutcome", () => {
  it("maps representative post, discipleship, invitation, and planning types", () => {
    expect(getOpportunityOutcome({ category: "SOCIAL", opportunityType: "QUOTE_GRAPHIC" })).toBe("POST_NOW");
    expect(getOpportunityOutcome({ category: "SOCIAL", opportunityType: "SMALL_GROUP_GUIDE" })).toBe("EQUIP_PEOPLE");
    expect(getOpportunityOutcome({ category: "PROMOTION", opportunityType: "EVENT_FOLLOW_UP_CONTENT" })).toBe("INVITE_PEOPLE");
    expect(getOpportunityOutcome({ category: "WRITTEN", opportunityType: "CONTENT_CALENDAR_PLAN" })).toBe("PLAN_CONTENT");
    expect(getOpportunityOutcome({ category: "RECAP", opportunityType: "SERMON_SUMMARY" })).toBe("EXTEND_MESSAGE");
  });

  it("falls back to category and then to extending the message", () => {
    expect(getOpportunityOutcome({ category: "PROMOTION", opportunityType: "FUTURE_TYPE" })).toBe("INVITE_PEOPLE");
    expect(getOpportunityOutcome({ category: "FUTURE_CATEGORY", opportunityType: "FUTURE_TYPE" })).toBe("EXTEND_MESSAGE");
  });
});

describe("rankOpportunitiesForValue", () => {
  it("prioritizes prepared assets, then workflow status, confidence, recency, and ID", () => {
    const ranked = rankOpportunitiesForValue([
      item("draft", "DRAFT", 1),
      item("review-low", "NEEDS_REVIEW", 0.5),
      item("approved-low", "APPROVED", 0.1),
      item("prepared-draft", "DRAFT", null),
      item("review-high", "NEEDS_REVIEW", 0.9),
      item("approved-high", "APPROVED", 0.8),
      item("approved-newer-b", "APPROVED", 0.8, "2026-07-18T12:00:00.000Z"),
      item("approved-newer-a", "APPROVED", 0.8, "2026-07-18T12:00:00.000Z"),
      item("used", "USED", 1),
    ], ["prepared-draft"]);

    expect(ranked.map(({ id }) => id)).toEqual([
      "prepared-draft",
      "approved-newer-a",
      "approved-newer-b",
      "approved-high",
      "approved-low",
      "review-high",
      "review-low",
      "draft",
      "used",
    ]);
  });

  it("excludes rejected and archived opportunities", () => {
    const ranked = rankOpportunitiesForValue([
      item("active", "NEEDS_REVIEW", 0.8),
      item("rejected", "REJECTED", 1),
      item("archived", "ARCHIVED", 1),
    ], ["rejected"]);

    expect(ranked.map(({ id }) => id)).toEqual(["active"]);
  });

  it("places null and non-finite confidence after finite confidence within a status", () => {
    const ranked = rankOpportunitiesForValue([
      item("null", "NEEDS_REVIEW", null),
      item("nan", "NEEDS_REVIEW", Number.NaN),
      item("finite", "NEEDS_REVIEW", 0),
    ], []);

    expect(ranked[0]?.id).toBe("finite");
    expect(ranked.slice(1).map(({ id }) => id)).toEqual(["nan", "null"]);
  });

  it("does not mutate the source array", () => {
    const source = [
      item("review", "NEEDS_REVIEW", 0.5),
      item("approved", "APPROVED", 0.5),
    ];

    rankOpportunitiesForValue(source, []);

    expect(source.map(({ id }) => id)).toEqual(["review", "approved"]);
  });
});

describe("summarizeOpportunityValue", () => {
  it("counts exclusive workflow states and deduplicates items and prepared IDs", () => {
    const summary = summarizeOpportunityValue([
      item("ready", "APPROVED", 0.8),
      item("ready", "APPROVED", 0.8),
      item("approved", "APPROVED", 0.7),
      item("review", "NEEDS_REVIEW", 0.9),
      item("review", "NEEDS_REVIEW", 0.9),
      item("draft", "DRAFT", 1),
      item("rejected-ready", "REJECTED", 1),
      item("archived", "ARCHIVED", 1),
    ], ["ready", "ready", "rejected-ready", "missing"]);

    expect(summary).toEqual({
      needsReview: 2,
      approvedToPrepare: 1,
      readyAssets: 1,
    });
  });
});
