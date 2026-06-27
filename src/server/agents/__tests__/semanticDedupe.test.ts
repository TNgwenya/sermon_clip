import { describe, expect, it } from "vitest";

import { semanticDedupeCandidates, semanticSimilarity } from "@/server/agents/semanticDedupe";

const strongClip = {
  title: "God Has Not Forgotten You",
  hook: "God has not forgotten you.",
  transcriptText: "God has not forgotten you. He is still working, even when you cannot see it.",
  startTimeSeconds: 10,
  endTimeSeconds: 60,
  durationSeconds: 50,
  score: 8,
  finalQualityScore: 8.6,
  hookScore: 8,
  boundaryQualityScore: 9,
  arcCompletenessScore: 8,
  visualConfidenceScore: 8,
  smartClipCategory: "Best Faith Clip",
  clipType: "inspirational",
};

describe("semantic dedupe", () => {
  it("detects duplicate main ideas even with different timestamps", () => {
    const similar = {
      ...strongClip,
      title: "God Still Remembers You",
      hook: "God still remembers the promise.",
      startTimeSeconds: 70,
      endTimeSeconds: 120,
      finalQualityScore: 7.2,
    };

    expect(semanticSimilarity(strongClip, similar)).toBeGreaterThan(0.2);
    const result = semanticDedupeCandidates([similar, strongClip], { similarityThreshold: 0.2 });

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].title).toBe("God Has Not Forgotten You");
    expect(result.duplicates[0].dedupeReason).toContain("Similar");
  });

  it("keeps separate ideas", () => {
    const result = semanticDedupeCandidates([
      strongClip,
      {
        ...strongClip,
        title: "Serve The City",
        hook: "The church is called to serve the city.",
        transcriptText: "The church is called to serve the city with compassion and practical love.",
        startTimeSeconds: 130,
        endTimeSeconds: 180,
      },
    ]);

    expect(result.kept).toHaveLength(2);
  });

  it("dedupes a longer clip that repeats the same core sermon point", () => {
    const concise = {
      ...strongClip,
      title: "Use What God Placed In You",
      hook: "God already placed a gift in you.",
      transcriptText: "God already placed a gift in you. Do not bury it because fear got loud. Use what God gave you this week.",
      startTimeSeconds: 300,
      endTimeSeconds: 355,
      durationSeconds: 55,
      smartClipCategory: "Best Application Clip",
      clipType: "teaching",
      finalQualityScore: 8.7,
    };
    const longerSamePoint = {
      ...strongClip,
      title: "Stir Up Your Gift",
      hook: "Do not bury the gift God gave you.",
      transcriptText: [
        "Some of you have been waiting for confidence before you serve.",
        "God already placed a gift in you and the church needs what is in your hand.",
        "Do not bury it because fear got loud.",
        "Use what God gave you this week and take one faithful step.",
      ].join(" "),
      startTimeSeconds: 360,
      endTimeSeconds: 455,
      durationSeconds: 95,
      smartClipCategory: "Best Application Clip",
      clipType: "teaching",
      finalQualityScore: 8.1,
    };

    const result = semanticDedupeCandidates([longerSamePoint, concise]);

    expect(semanticSimilarity(concise, longerSamePoint)).toBeGreaterThanOrEqual(0.62);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].title).toBe("Use What God Placed In You");
    expect(result.duplicates[0].dedupeReason).toContain("Similar");
  });

  it("dedupes repeated ministry ideas even when church language uses synonyms", () => {
    const giftLanguage = {
      ...strongClip,
      title: "Use Your Gift",
      hook: "God placed a gift in your hand.",
      transcriptText: "God placed a gift in your hand, and the church needs you to serve with courage this week.",
      startTimeSeconds: 240,
      endTimeSeconds: 295,
      durationSeconds: 55,
      smartClipCategory: "Best Discipleship Clip",
      clipType: "teaching",
      finalQualityScore: 8.8,
    };
    const callingLanguage = {
      ...strongClip,
      title: "Step Into Your Calling",
      hook: "Do not hide from the assignment God gave you.",
      transcriptText: "Do not hide from the calling God gave you. Step into the assignment with boldness and serve the body faithfully.",
      startTimeSeconds: 620,
      endTimeSeconds: 675,
      durationSeconds: 55,
      smartClipCategory: "Best Discipleship Clip",
      clipType: "teaching",
      finalQualityScore: 8.2,
    };

    const result = semanticDedupeCandidates([callingLanguage, giftLanguage]);

    expect(semanticSimilarity(giftLanguage, callingLanguage)).toBeGreaterThanOrEqual(0.62);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].title).toBe("Use Your Gift");
    expect(result.duplicates[0].dedupeReason).toContain("Similar");
  });

  it("dedupes long clips that share the same landing application after different setup", () => {
    const sharedLanding = [
      "So this week choose one act of obedience and serve with what God placed in your hand.",
      "Do not wait for another confirmation when God has already spoken clearly.",
      "The church grows stronger when every believer brings their gift.",
    ].join(" ");
    const testimonySetup = Array.from(
      { length: 18 },
      (_, index) => `Testimony setup ${index} describes pressure, delay, and disappointment before the pastor reaches the application.`,
    ).join(" ");
    const scriptureSetup = Array.from(
      { length: 18 },
      (_, index) => `Scripture setup ${index} explains Timothy, spiritual gifts, and courage before the pastor reaches the application.`,
    ).join(" ");
    const testimonyClip = {
      ...strongClip,
      title: "Serve With What God Placed In Your Hand",
      hook: "Delay does not cancel the gift God placed in you.",
      transcriptText: `${testimonySetup} ${sharedLanding}`,
      startTimeSeconds: 120,
      endTimeSeconds: 250,
      durationSeconds: 130,
      smartClipCategory: "Best Discipleship Clip",
      clipType: "testimony",
      finalQualityScore: 8.7,
    };
    const scriptureClip = {
      ...strongClip,
      title: "Use Your Gift This Week",
      hook: "Paul tells Timothy to stir up the gift.",
      transcriptText: `${scriptureSetup} ${sharedLanding}`,
      startTimeSeconds: 420,
      endTimeSeconds: 550,
      durationSeconds: 130,
      smartClipCategory: "Best Discipleship Clip",
      clipType: "teaching",
      finalQualityScore: 8.2,
    };

    const result = semanticDedupeCandidates([scriptureClip, testimonyClip]);

    expect(semanticSimilarity(testimonyClip, scriptureClip)).toBeGreaterThanOrEqual(0.62);
    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].title).toBe("Serve With What God Placed In Your Hand");
    expect(result.duplicates[0].dedupeReason).toContain("Similar");
  });

  it("keeps different applications even when they share church language", () => {
    const result = semanticDedupeCandidates([
      {
        ...strongClip,
        title: "Use Your Gift",
        hook: "God placed a gift in your hand.",
        transcriptText: "God placed a gift in your hand so serve the church with courage this week.",
        smartClipCategory: "Best Application Clip",
        clipType: "teaching",
      },
      {
        ...strongClip,
        title: "Forgive Again",
        hook: "Forgiveness is obedience before it is a feeling.",
        transcriptText: "Forgive again because grace has already met you. The church becomes healthier when mercy leads the conversation.",
        smartClipCategory: "Best Application Clip",
        clipType: "teaching",
        startTimeSeconds: 500,
        endTimeSeconds: 555,
      },
    ]);

    expect(result.kept).toHaveLength(2);
  });

  it("dedupes overlapping candidates with the same payoff", () => {
    const servingPayoff = "So this week serve with what God placed in your hand because the church needs your gift.";
    const result = semanticDedupeCandidates([
      {
        ...strongClip,
        title: "Serve With Your Gift",
        hook: "God placed a gift in your hand.",
        transcriptText: `Paul tells Timothy to stir up the gift. ${servingPayoff}`,
        landingSentence: servingPayoff,
        startTimeSeconds: 100,
        endTimeSeconds: 170,
        durationSeconds: 70,
        finalQualityScore: 8.1,
        smartClipCategory: "Best Discipleship Clip",
      },
      {
        ...strongClip,
        title: "Use What God Gave",
        hook: "The church needs what God placed in you.",
        transcriptText: `Do not wait for confidence before you obey. ${servingPayoff}`,
        landingSentence: servingPayoff,
        startTimeSeconds: 118,
        endTimeSeconds: 172,
        durationSeconds: 54,
        finalQualityScore: 8.5,
        smartClipCategory: "Best Discipleship Clip",
      },
    ]);

    expect(result.kept).toHaveLength(1);
    expect(result.duplicates[0]?.dedupeReason).toMatch(/Same landing|Similar|Overlapping/);
  });

  it("preserves overlapping candidates with different applications", () => {
    const result = semanticDedupeCandidates([
      {
        ...strongClip,
        title: "Serve With Your Gift",
        hook: "God placed a gift in your hand.",
        transcriptText: "God placed a gift in your hand. So this week serve the church with courage and use what God gave you.",
        landingSentence: "So this week serve the church with courage and use what God gave you.",
        startTimeSeconds: 200,
        endTimeSeconds: 270,
        durationSeconds: 70,
        smartClipCategory: "Best Discipleship Clip",
        clipType: "teaching",
        arcType: "PROBLEM_TRUTH_APPLICATION",
      },
      {
        ...strongClip,
        title: "Forgive Again With Grace",
        hook: "Forgiveness is obedience before it is a feeling.",
        transcriptText: "Forgiveness is obedience before it is a feeling. So this week forgive again because grace has already met you.",
        landingSentence: "So this week forgive again because grace has already met you.",
        startTimeSeconds: 220,
        endTimeSeconds: 285,
        durationSeconds: 65,
        smartClipCategory: "Best Encouragement Clip",
        clipType: "pastoral",
        arcType: "CORRECTION_EXPLANATION_CALL",
      },
    ]);

    expect(result.kept.map((clip) => clip.title).sort()).toEqual([
      "Forgive Again With Grace",
      "Serve With Your Gift",
    ]);
    expect(result.duplicates).toHaveLength(0);
  });

  it("chooses the stronger clean-boundary representative inside a true duplicate cluster", () => {
    const landingSentence = "Use what God gave you this week and serve the body with courage.";
    const result = semanticDedupeCandidates([
      {
        ...strongClip,
        title: "Use Your Gift",
        hook: "Use what God gave you.",
        transcriptText: `The gift is not for hiding. ${landingSentence}`,
        landingSentence,
        startTimeSeconds: 500,
        endTimeSeconds: 560,
        durationSeconds: 60,
        finalQualityScore: 8,
        boundaryQuality: "NEEDS_REVIEW" as const,
        boundaryQualityScore: 5.8,
      },
      {
        ...strongClip,
        title: "Use What God Gave",
        hook: "Use what God gave you.",
        transcriptText: `The gift is not for hiding. ${landingSentence}`,
        landingSentence,
        startTimeSeconds: 504,
        endTimeSeconds: 560,
        durationSeconds: 56,
        finalQualityScore: 8.5,
        boundaryQuality: "GOOD" as const,
        boundaryQualityScore: 9,
      },
    ]);

    expect(result.kept).toHaveLength(1);
    expect(result.kept[0].title).toBe("Use What God Gave");
    expect(result.duplicates[0]?.representative.boundaryQuality).toBe("GOOD");
  });

  it("dedupes deterministically", () => {
    const candidates = [
      {
        ...strongClip,
        title: "Use Your Gift",
        hook: "Use what God gave you.",
        transcriptText: "Use what God gave you this week and serve the body with courage.",
        landingSentence: "Use what God gave you this week and serve the body with courage.",
        startTimeSeconds: 20,
        endTimeSeconds: 70,
        durationSeconds: 50,
      },
      {
        ...strongClip,
        title: "Use What God Gave",
        hook: "Use what God gave you.",
        transcriptText: "Use what God gave you this week and serve the body with courage.",
        landingSentence: "Use what God gave you this week and serve the body with courage.",
        startTimeSeconds: 24,
        endTimeSeconds: 72,
        durationSeconds: 48,
      },
    ];

    const first = semanticDedupeCandidates(candidates);
    const second = semanticDedupeCandidates(candidates);

    expect(first.kept.map((clip) => clip.title)).toEqual(second.kept.map((clip) => clip.title));
    expect(first.duplicates.map((item) => item.dedupeReason)).toEqual(second.duplicates.map((item) => item.dedupeReason));
  });
});
