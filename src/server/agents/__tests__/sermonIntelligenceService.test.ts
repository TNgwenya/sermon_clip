import { describe, expect, it } from "vitest";

import {
  aiSermonIntelligenceSchema,
  aiScriptureRefSchema,
  aiStructureSectionSchema,
  aiTopicTagSchema,
  MINISTRY_TOPICS,
  normalizeScriptureUsageType,
  normalizeStructureSectionType,
  parseSermonIntelligenceResponse,
  scriptureUsageTypes,
  structureSectionTypes,
} from "@/server/ai/sermonIntelligenceSchema";

// ─── Schema validation tests ───────────────────────────────────────────────────

describe("aiScriptureRefSchema", () => {
  it("accepts a valid READ scripture", () => {
    const result = aiScriptureRefSchema.safeParse({
      reference: "John 3:16",
      book: "John",
      chapter: 3,
      verseStart: 16,
      usageType: "READ",
      isPrimary: true,
      frequencyCount: 2,
      confidenceScore: 0.95,
      transcriptEvidence: "For God so loved the world...",
    });

    expect(result.success).toBe(true);
  });

  it("accepts an IMPLIED scripture with minimal fields", () => {
    const result = aiScriptureRefSchema.safeParse({
      reference: "Romans 8",
      usageType: "IMPLIED",
      confidenceScore: 0.55,
    });

    expect(result.success).toBe(true);
  });

  it("normalizes common usageType variants", () => {
    expect(aiScriptureRefSchema.safeParse({
      reference: "Psalm 23",
      usageType: "spoken",
      confidenceScore: 0.8,
    })).toMatchObject({
      success: true,
      data: {
        usageType: "QUOTED",
      },
    });
    expect(normalizeScriptureUsageType("cited")).toBe("REFERENCED");
    expect(normalizeScriptureUsageType("alluded")).toBe("IMPLIED");
  });

  it("rejects unknown usageType", () => {
    const result = aiScriptureRefSchema.safeParse({
      reference: "Psalm 23",
      usageType: "PREACHED_FROM",
      confidenceScore: 0.8,
    });

    expect(result.success).toBe(false);
  });

  it("rejects confidence score above 1", () => {
    const result = aiScriptureRefSchema.safeParse({
      reference: "Genesis 1:1",
      usageType: "QUOTED",
      confidenceScore: 1.5,
    });

    expect(result.success).toBe(false);
  });

  it("rejects missing reference", () => {
    const result = aiScriptureRefSchema.safeParse({
      usageType: "READ",
      confidenceScore: 0.9,
    });

    expect(result.success).toBe(false);
  });
});

describe("aiStructureSectionSchema", () => {
  it("accepts a valid section", () => {
    const result = aiStructureSectionSchema.safeParse({
      sectionType: "INTRODUCTION",
      title: "Opening remarks",
      orderIndex: 0,
      startTimeSeconds: 0,
      endTimeSeconds: 180,
      confidenceScore: 0.9,
      transcriptExcerpt: "Good morning, today we look at...",
    });

    expect(result.success).toBe(true);
  });

  it("accepts a section without timestamps", () => {
    const result = aiStructureSectionSchema.safeParse({
      sectionType: "PRAYER",
      orderIndex: 5,
      confidenceScore: 0.75,
    });

    expect(result.success).toBe(true);
  });

  it("rejects unknown sectionType", () => {
    const result = aiStructureSectionSchema.safeParse({
      sectionType: "OFFERING",
      orderIndex: 3,
      confidenceScore: 0.7,
    });

    expect(result.success).toBe(false);
  });

  it("normalizes common AI section type variants", () => {
    const result = aiStructureSectionSchema.safeParse({
      sectionType: "opening remarks",
      orderIndex: 0,
      confidenceScore: 0.8,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sectionType).toBe("INTRODUCTION");
    }
  });
});

describe("normalizeStructureSectionType", () => {
  it("maps known aliases to supported enum values", () => {
    expect(normalizeStructureSectionType("call to action")).toBe("APPLICATION");
    expect(normalizeStructureSectionType("salvation invitation")).toBe("ALTAR_CALL");
    expect(normalizeStructureSectionType("announcements")).toBe("ANNOUNCEMENT");
    expect(normalizeStructureSectionType("main teaching")).toBe("EXPLANATION");
    expect(normalizeStructureSectionType("practical application")).toBe("APPLICATION");
    expect(normalizeStructureSectionType("conclusion")).toBe("CLOSING");
  });
});

describe("aiTopicTagSchema", () => {
  it("accepts a valid topic", () => {
    const result = aiTopicTagSchema.safeParse({
      topic: "faith",
      confidenceScore: 0.88,
      evidence: "The preacher repeatedly emphasised trusting God...",
    });

    expect(result.success).toBe(true);
  });

  it("rejects confidence below 0", () => {
    const result = aiTopicTagSchema.safeParse({
      topic: "grace",
      confidenceScore: -0.1,
    });

    expect(result.success).toBe(false);
  });
});

describe("aiSermonIntelligenceSchema", () => {
  function makeValidPayload() {
    return {
      title: "Walking in Faith",
      summary: "A two-sentence summary of the sermon.",
      centralTheme: "Trusting God even in uncertainty.",
      shortOverview: "Pastor John teaches on daily faith.",
      keyTakeaways: ["Trust God in trials.", "Faith requires action."],
      confidenceScore: 0.87,
      scriptures: [
        {
          reference: "Hebrews 11:1",
          usageType: "READ",
          isPrimary: true,
          frequencyCount: 1,
          confidenceScore: 0.95,
        },
      ],
      structureSections: [
        {
          sectionType: "INTRODUCTION",
          orderIndex: 0,
          confidenceScore: 0.9,
        },
        {
          sectionType: "APPLICATION",
          orderIndex: 1,
          confidenceScore: 0.85,
        },
      ],
      topics: [
        {
          topic: "faith",
          confidenceScore: 0.92,
        },
      ],
    };
  }

  it("accepts a fully valid payload", () => {
    const result = aiSermonIntelligenceSchema.safeParse(makeValidPayload());
    expect(result.success).toBe(true);
  });

  it("accepts ministry moments in the shared sermon analysis response", () => {
    const result = aiSermonIntelligenceSchema.safeParse({
      ...makeValidPayload(),
      ministryMoments: [{
        momentType: "PRAYER_MOMENT",
        title: "Prayer for courage",
        description: "The pastor leads the church in prayer.",
        startTimeSeconds: 120,
        endTimeSeconds: 165,
        confidenceScore: 0.9,
        transcriptExcerpt: "Lord, give us courage to obey you.",
        whyDetected: "The timestamped transcript contains a direct congregational prayer.",
        suggestedAudience: "People needing courage",
        suggestedUsage: "Prayer clip",
        clipCategory: "Best Prayer Clip",
      }],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.ministryMoments).toHaveLength(1);
    }
  });

  it("parses a valid response body", () => {
    expect(parseSermonIntelligenceResponse(JSON.stringify(makeValidPayload()))).toMatchObject({
      title: "Walking in Faith",
      confidenceScore: 0.87,
    });
  });

  it("reports the exact path, received enum, and allowed values", () => {
    const payload = makeValidPayload();
    payload.structureSections[0] = {
      ...payload.structureSections[0],
      sectionType: "OFFERING",
    };

    expect(() => parseSermonIntelligenceResponse(JSON.stringify(payload))).toThrow(
      /structureSections\[0\]\.sectionType: invalid_value; received="OFFERING"; expected=\["INTRODUCTION".*"OTHER"\]/,
    );
  });

  it("bounds invalid JSON and received values in diagnostics", () => {
    const invalidJson = `not-json-${"x".repeat(1_000)}-PRIVATE-TAIL`;
    let invalidJsonMessage = "";
    try {
      parseSermonIntelligenceResponse(invalidJson);
    } catch (error) {
      invalidJsonMessage = error instanceof Error ? error.message : String(error);
    }

    expect(invalidJsonMessage).toContain("JSON validation failed at <root>");
    expect(invalidJsonMessage).not.toContain("PRIVATE-TAIL");
    expect(invalidJsonMessage.length).toBeLessThanOrEqual(1_800);

    const payload = makeValidPayload();
    payload.keyTakeaways = Array.from(
      { length: 50 },
      (_, index) => index === 49 ? "PRIVATE-TAIL" : `takeaway-${index}`,
    );
    let schemaMessage = "";
    try {
      parseSermonIntelligenceResponse(JSON.stringify(payload));
    } catch (error) {
      schemaMessage = error instanceof Error ? error.message : String(error);
    }

    expect(schemaMessage).toContain("keyTakeaways: too_big");
    expect(schemaMessage).toContain("received=");
    expect(schemaMessage).toContain("expected=array <= 10");
    expect(schemaMessage).not.toContain("PRIVATE-TAIL");
    expect(schemaMessage.length).toBeLessThanOrEqual(1_800);
  });

  it("rejects empty title", () => {
    const payload = { ...makeValidPayload(), title: "" };
    const result = aiSermonIntelligenceSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects empty keyTakeaways", () => {
    const payload = { ...makeValidPayload(), keyTakeaways: [] };
    const result = aiSermonIntelligenceSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects empty topics", () => {
    const payload = { ...makeValidPayload(), topics: [] };
    const result = aiSermonIntelligenceSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("rejects confidenceScore above 1", () => {
    const payload = { ...makeValidPayload(), confidenceScore: 1.01 };
    const result = aiSermonIntelligenceSchema.safeParse(payload);
    expect(result.success).toBe(false);
  });

  it("allows empty scriptures array", () => {
    const payload = { ...makeValidPayload(), scriptures: [] };
    const result = aiSermonIntelligenceSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });

  it("allows empty structureSections array", () => {
    const payload = { ...makeValidPayload(), structureSections: [] };
    const result = aiSermonIntelligenceSchema.safeParse(payload);
    expect(result.success).toBe(true);
  });
});

// ─── Controlled list tests ─────────────────────────────────────────────────────

describe("MINISTRY_TOPICS", () => {
  it("includes common ministry categories", () => {
    expect(MINISTRY_TOPICS).toContain("faith");
    expect(MINISTRY_TOPICS).toContain("salvation");
    expect(MINISTRY_TOPICS).toContain("grace");
    expect(MINISTRY_TOPICS).toContain("prayer");
    expect(MINISTRY_TOPICS).toContain("Holy Spirit");
  });

  it("has no duplicate entries", () => {
    const set = new Set(MINISTRY_TOPICS);
    expect(set.size).toBe(MINISTRY_TOPICS.length);
  });
});

describe("scriptureUsageTypes", () => {
  it("contains the four expected types", () => {
    expect(scriptureUsageTypes).toContain("READ");
    expect(scriptureUsageTypes).toContain("QUOTED");
    expect(scriptureUsageTypes).toContain("REFERENCED");
    expect(scriptureUsageTypes).toContain("IMPLIED");
    expect(scriptureUsageTypes).toHaveLength(4);
  });
});

describe("structureSectionTypes", () => {
  it("contains expected section types", () => {
    expect(structureSectionTypes).toContain("INTRODUCTION");
    expect(structureSectionTypes).toContain("ALTAR_CALL");
    expect(structureSectionTypes).toContain("CLOSING");
    expect(structureSectionTypes).toContain("OTHER");
  });
});
