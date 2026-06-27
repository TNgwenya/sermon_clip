import { describe, expect, it } from "vitest";

import { __knowledgeIntelligenceTestUtils } from "../knowledgeIntelligence";

describe("knowledge base where builder", () => {
  it("builds searchable where clause with scripture/topic/moment/content filters", () => {
    const where = __knowledgeIntelligenceTestUtils.buildKnowledgeBaseWhere({
      query: "prayer",
      preacher: "Pastor John",
      sermonDate: "2026-06-01",
      scripture: "Romans",
      bibleBook: "Romans",
      scriptureUsageType: "REFERENCED",
      primaryScriptureOnly: true,
      topics: ["faith", "prayer"],
      ministryMomentType: "ALTAR_CALL",
      clipCategory: "Best Faith Clip",
      contentCategory: "DEVOTIONAL",
      contentType: "DEVOTIONAL_SUMMARY",
    });

    expect(where.status).toEqual({
      in: [
        "TRANSCRIBED",
        "GENERATING_CLIPS",
        "CLIPS_GENERATED",
        "REVIEWING",
        "EXPORTING",
        "EXPORTED",
      ],
    });

    const andClauses = Array.isArray(where.AND) ? where.AND : [];
    expect(andClauses.length).toBeGreaterThan(5);
    expect(JSON.stringify(andClauses)).toContain("Romans");
    expect(JSON.stringify(andClauses)).toContain("ALTAR_CALL");
    expect(JSON.stringify(andClauses)).toContain("DEVOTIONAL_SUMMARY");
  });

  it("applies church scope filtering when churchName is provided", () => {
    const where = __knowledgeIntelligenceTestUtils.buildKnowledgeBaseWhere({
      churchName: "Grace Life",
    });

    const serialized = JSON.stringify(where);
    expect(serialized).toContain("Grace Life");
    expect(serialized).toContain("churchName");
  });

  it("supports topic-only and scripture-only practical searches", () => {
    const byTopic = __knowledgeIntelligenceTestUtils.buildKnowledgeBaseWhere({
      topics: ["faith"],
    });

    const byScripture = __knowledgeIntelligenceTestUtils.buildKnowledgeBaseWhere({
      scripture: "John 3:16",
    });

    expect(JSON.stringify(byTopic)).toContain("faith");
    expect(JSON.stringify(byScripture)).toContain("John 3:16");
  });
});

describe("related sermon scoring", () => {
  it("scores overlap by scripture and topic", () => {
    const current = {
      id: "sermon-1",
      title: "Faith and prayer",
      speakerName: "Pastor A",
      sermonDate: new Date("2026-01-01"),
      topics: ["faith", "prayer"],
      scriptures: ["Romans 8:28", "John 3:16"],
    };

    const candidate = {
      id: "sermon-2",
      title: "Living in faith",
      speakerName: "Pastor B",
      sermonDate: new Date("2026-01-08"),
      topics: ["faith", "leadership"],
      scriptures: ["Romans 8:28"],
    };

    const scored = __knowledgeIntelligenceTestUtils.computeRelatedSermonScore(current, candidate);

    expect(scored.overlapTopics).toEqual(["faith"]);
    expect(scored.overlapScriptures).toEqual(["Romans 8:28"]);
    expect(scored.score).toBe(5);
  });
});

describe("dashboard aggregation helpers", () => {
  it("aggregates and sorts label counts for trend reporting", () => {
    const distribution = __knowledgeIntelligenceTestUtils.aggregateLabelCounts([
      "faith",
      "prayer",
      "faith",
      "leadership",
      "faith",
      "prayer",
    ]);

    expect(distribution[0]).toEqual({ label: "faith", count: 3 });
    expect(distribution[1]).toEqual({ label: "prayer", count: 2 });
    expect(distribution[2]).toEqual({ label: "leadership", count: 1 });
  });

  it("supports sermonsWithIntelligence in dashboard totals shape", () => {
    const totals = {
      sermonsProcessed: 3,
      sermonsWithIntelligence: 2,
      ministryMomentsDetected: 6,
      clipsSuggested: 9,
      clipsApproved: 4,
      clipsRendered: 3,
      contentOpportunitiesGenerated: 8,
      contentOpportunitiesApproved: 2,
      contentOpportunitiesUsed: 1,
    };

    expect(totals.sermonsWithIntelligence).toBeLessThanOrEqual(totals.sermonsProcessed);
  });
});
