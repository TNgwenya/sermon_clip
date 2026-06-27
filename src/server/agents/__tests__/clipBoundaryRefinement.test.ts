import { describe, expect, it } from "vitest";

import {
  HARD_MAX_DURATION_SECONDS,
  HARD_MIN_DURATION_SECONDS,
  endsThought,
  refineClipBoundaries,
  startsWithContextDependentReference,
  startsWithUnclearConnector,
  validateFinalClipBoundary,
  validateBoundaryTimes,
} from "../clipBoundaryRefinement";

function makeSegments() {
  return [
    { startTimeSeconds: 0, endTimeSeconds: 10, text: "This morning I want to give you a simple encouragement." },
    { startTimeSeconds: 10, endTimeSeconds: 20, text: "And if your heart feels tired, God has not forgotten you." },
    { startTimeSeconds: 20, endTimeSeconds: 30, text: "He is still working, even when you cannot see it." },
    { startTimeSeconds: 30, endTimeSeconds: 40, text: "So keep praying, keep believing, and keep walking." },
    { startTimeSeconds: 40, endTimeSeconds: 50, text: "Your breakthrough is closer than you think." },
    { startTimeSeconds: 50, endTimeSeconds: 60, text: "Amen." },
  ];
}

describe("clip boundary refinement", () => {
  it("flags invalid ranges when start is not before end", () => {
    const result = validateBoundaryTimes({
      startTimeSeconds: 20,
      endTimeSeconds: 20,
      sermonDurationSeconds: 60,
      transcriptText: "Sample",
    });

    expect(result.isValid).toBe(false);
    expect(result.reasons.join(" ")).toContain("End time must be greater than start time.");
  });

  it("calculates duration from start and end", () => {
    const result = validateBoundaryTimes({
      startTimeSeconds: 5,
      endTimeSeconds: 35.25,
      sermonDurationSeconds: 60,
      transcriptText: "Sample",
    });

    expect(result.durationSeconds).toBe(30.25);
  });

  it("detects connector words at the start", () => {
    expect(startsWithUnclearConnector("And this is the key point.")).toBe(true);
    expect(startsWithUnclearConnector("This is the key point.")).toBe(false);
  });

  it("detects context-dependent references at the start", () => {
    expect(startsWithContextDependentReference("That means obedience has to move first.")).toBe(true);
    expect(startsWithContextDependentReference("It shows us why prayer matters.")).toBe(true);
    expect(startsWithContextDependentReference("In that place God gives grace for the next step.")).toBe(true);
    expect(startsWithContextDependentReference("For that reason we keep praying.")).toBe(true);
    expect(startsWithContextDependentReference("This morning I want to encourage you.")).toBe(false);
  });

  it("treats complete ASR endings without punctuation as completed thoughts", () => {
    expect(endsThought("God gives courage to serve the church so this week choose obedience and pray again")).toBe(true);
  });

  it("does not treat lowercase ASR openings as mid-sentence boundary defects", () => {
    const segments = [
      {
        startTimeSeconds: 0,
        endTimeSeconds: 15,
        text: "god gives every believer a gift to serve the church with courage",
      },
      {
        startTimeSeconds: 15,
        endTimeSeconds: 32,
        text: "so this week choose obedience and pray again because the Lord strengthens his people",
      },
    ];

    const validation = validateFinalClipBoundary({
      startTimeSeconds: 0,
      endTimeSeconds: 32,
      transcriptText: segments.map((segment) => segment.text).join(" "),
      segments,
    });

    expect(validation.quality).toBe("GOOD");
    expect(validation.reasons.map((reason) => reason.code)).not.toContain("STARTS_MID_SENTENCE");
  });

  it("keeps genuinely dangling ASR endings in review", () => {
    const segments = [
      {
        startTimeSeconds: 0,
        endTimeSeconds: 15,
        text: "God gives every believer a gift to serve the church with courage",
      },
      {
        startTimeSeconds: 15,
        endTimeSeconds: 32,
        text: "and this is important because",
      },
    ];

    const validation = validateFinalClipBoundary({
      startTimeSeconds: 0,
      endTimeSeconds: 32,
      transcriptText: segments.map((segment) => segment.text).join(" "),
      segments,
    });

    expect(validation.quality).toBe("NEEDS_REVIEW");
    expect(validation.reasons.map((reason) => reason.code)).toContain("INCOMPLETE_ENDING");
  });

  it("adds a boundary adjustment reason when timing changes", () => {
    const refined = refineClipBoundaries(
      {
        startTimeSeconds: 12,
        endTimeSeconds: 36,
        durationSeconds: 24,
        transcriptText: "",
        reasonSelected: "Strong encouragement",
        riskReasons: [],
      },
      makeSegments(),
    );

    expect(refined.accepted).toBe(true);
    if (refined.accepted) {
      expect(refined.candidate.originalStartTimeSeconds).toBe(12);
      expect(refined.candidate.adjustedStartTimeSeconds).not.toBe(12);
      expect(refined.candidate.boundaryAdjustmentReason.length).toBeGreaterThan(0);
    }
  });

  it("flags overly long clip durations as invalid", () => {
    const result = validateBoundaryTimes({
      startTimeSeconds: 0,
      endTimeSeconds: HARD_MAX_DURATION_SECONDS + 1,
      sermonDurationSeconds: HARD_MAX_DURATION_SECONDS + 1,
      transcriptText: "Sample",
    });

    expect(result.isValid).toBe(false);
    expect(result.reasons.join(" ")).toContain("Clip is too long");
  });

  it("flags overly short clip durations as invalid", () => {
    const result = validateBoundaryTimes({
      startTimeSeconds: 10,
      endTimeSeconds: 10 + HARD_MIN_DURATION_SECONDS - 1,
      sermonDurationSeconds: 100,
      transcriptText: "Sample",
    });

    expect(result.isValid).toBe(false);
    expect(result.reasons.join(" ")).toContain("Clip is too short");
  });

  it("protects arc anchor times while shortening overlong clips", () => {
    const longSegments = Array.from({ length: 18 }, (_, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 10,
      text: index === 14 ? "This is the payoff and application." : `Complete thought ${index}.`,
    }));
    const refined = refineClipBoundaries(
      {
        startTimeSeconds: 0,
        endTimeSeconds: 170,
        durationSeconds: 170,
        transcriptText: "Long clip",
        reasonSelected: "Complete sermon arc",
        riskReasons: [],
        setupStartTime: 5,
        mainPointTime: 60,
        payoffTime: 145,
        applicationTime: 148,
      },
      longSegments,
    );

    expect(refined.accepted).toBe(true);
    if (refined.accepted) {
      expect(refined.candidate.startTimeSeconds).toBe(0);
      expect(refined.candidate.endTimeSeconds).toBe(150);
      expect(refined.candidate.boundaryAdjustmentReason).toContain("preserve");
    }
  });

  it("extends a complete-sentence ending when the claimed payoff or application lands just after it", () => {
    const segments = [
      { startTimeSeconds: 100, endTimeSeconds: 112, text: "Paul tells Timothy that the gift of God must be stirred again." },
      { startTimeSeconds: 112, endTimeSeconds: 124, text: "Fear will always tell you to bury what grace has placed in your hands." },
      { startTimeSeconds: 124, endTimeSeconds: 136, text: "So this week choose one faithful act of service and stir up your gift." },
      { startTimeSeconds: 136, endTimeSeconds: 148, text: "The church is strengthened when every believer obeys God with courage." },
    ];

    const refined = refineClipBoundaries(
      {
        startTimeSeconds: 100,
        endTimeSeconds: 124,
        durationSeconds: 24,
        transcriptText: "",
        reasonSelected: "Strong discipleship clip with a practical application",
        riskReasons: [],
        setupStartTime: 104,
        mainPointTime: 116,
        payoffTime: 126,
        applicationTime: 132,
      },
      segments,
    );

    expect(refined.accepted).toBe(true);
    if (refined.accepted) {
      expect(refined.adjusted).toBe(true);
      expect(refined.candidate.adjustedEndTimeSeconds).toBe(136);
      expect(refined.candidate.durationSeconds).toBe(36);
      expect(refined.candidate.transcriptText).toContain("choose one faithful act");
      expect(refined.candidate.boundaryAdjustmentReason).toContain("payoff or application");
      expect(refined.candidate.boundaryQuality).toBe("GOOD");
    }
  });

  it("extends a clean ending when the next nearby segment contains the spoken landing", () => {
    const segments = [
      { startTimeSeconds: 200, endTimeSeconds: 212, text: "Paul tells Timothy that the gift of God is already inside him." },
      { startTimeSeconds: 212, endTimeSeconds: 224, text: "Fear will try to make obedience feel unsafe." },
      { startTimeSeconds: 224, endTimeSeconds: 236, text: "The Spirit gives power love and discipline." },
      { startTimeSeconds: 236, endTimeSeconds: 248, text: "So this week choose one faithful act of service and stir up your gift." },
    ];

    const refined = refineClipBoundaries(
      {
        startTimeSeconds: 200,
        endTimeSeconds: 236,
        durationSeconds: 36,
        transcriptText: "",
        reasonSelected: "Strong discipleship teaching that needs its application",
        riskReasons: [],
      },
      segments,
    );

    expect(refined.accepted).toBe(true);
    if (refined.accepted) {
      expect(refined.adjusted).toBe(true);
      expect(refined.candidate.adjustedEndTimeSeconds).toBe(248);
      expect(refined.candidate.transcriptText).toContain("So this week choose one faithful act");
      expect(refined.candidate.boundaryAdjustmentReason).toContain("spoken landing or application");
      expect(refined.candidate.boundaryQuality).toBe("GOOD");
    }
  });

  it("does not chase a spoken landing when it would push the clip beyond the target range", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 30, text: "The pastor builds the first part of a long discipleship teaching." },
      { startTimeSeconds: 30, endTimeSeconds: 60, text: "The pastor continues the teaching with scripture and explanation." },
      { startTimeSeconds: 60, endTimeSeconds: 90, text: "The pastor gives another complete thought about courage and obedience." },
      { startTimeSeconds: 90, endTimeSeconds: 110, text: "So this week choose one act of service and stir up the gift." },
    ];

    const refined = refineClipBoundaries(
      {
        startTimeSeconds: 0,
        endTimeSeconds: 90,
        durationSeconds: 90,
        transcriptText: "",
        reasonSelected: "Long teaching clip",
        riskReasons: [],
      },
      segments,
    );

    expect(refined.accepted).toBe(true);
    if (refined.accepted) {
      expect(refined.candidate.adjustedEndTimeSeconds).toBe(90);
      expect(refined.candidate.transcriptText).not.toContain("So this week choose");
    }
  });

  it("does not overextend to a distant claimed arc point beyond the safe extension window", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 30, text: "The Lord gives every believer a gift for the body." },
      { startTimeSeconds: 30, endTimeSeconds: 60, text: "We are responsible to serve faithfully with what grace has placed in our hands." },
      { startTimeSeconds: 60, endTimeSeconds: 90, text: "A distant later point begins a different section of the sermon." },
    ];

    const refined = refineClipBoundaries(
      {
        startTimeSeconds: 0,
        endTimeSeconds: 30,
        durationSeconds: 30,
        transcriptText: "",
        reasonSelected: "Gift teaching",
        riskReasons: [],
        payoffTime: 72,
        applicationTime: 76,
      },
      segments,
    );

    expect(refined.accepted).toBe(true);
    if (refined.accepted) {
      expect(refined.candidate.adjustedEndTimeSeconds).toBe(30);
      expect(refined.candidate.boundaryAdjustmentReason).toContain("safe duration limits");
    }
  });

  it("moves a clean start earlier when a nearby claimed setup or main point sits before the selected range", () => {
    const segments = [
      { startTimeSeconds: 80, endTimeSeconds: 92, text: "Paul reminds Timothy that the gift was already placed within him by God." },
      { startTimeSeconds: 92, endTimeSeconds: 104, text: "The issue is not whether God gave the gift, but whether Timothy will stir it up." },
      { startTimeSeconds: 104, endTimeSeconds: 116, text: "Fear tells you to hide what grace gave you." },
      { startTimeSeconds: 116, endTimeSeconds: 128, text: "So take one step of service this week and stir up the gift." },
    ];

    const refined = refineClipBoundaries(
      {
        startTimeSeconds: 96,
        endTimeSeconds: 128,
        durationSeconds: 32,
        transcriptText: "",
        reasonSelected: "Clear discipleship application about stirring up the gift",
        riskReasons: [],
        setupStartTime: 84,
        mainPointTime: 98,
        payoffTime: 118,
        applicationTime: 124,
      },
      segments,
    );

    expect(refined.accepted).toBe(true);
    if (refined.accepted) {
      expect(refined.adjusted).toBe(true);
      expect(refined.candidate.adjustedStartTimeSeconds).toBe(80);
      expect(refined.candidate.transcriptText).toContain("gift was already placed");
      expect(refined.candidate.boundaryAdjustmentReason).toContain("setup or main sermon point");
      expect(refined.candidate.boundaryQuality).toBe("GOOD");
    }
  });

  it("does not partially backtrack toward a distant claimed setup outside the safe window", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 20, text: "Earlier context belongs to a different section of the sermon." },
      { startTimeSeconds: 20, endTimeSeconds: 40, text: "More earlier context still belongs to the previous section." },
      { startTimeSeconds: 40, endTimeSeconds: 70, text: "God gives every believer a gift to serve the body faithfully." },
      { startTimeSeconds: 70, endTimeSeconds: 100, text: "So serve with courage and take one obedient step this week." },
    ];

    const refined = refineClipBoundaries(
      {
        startTimeSeconds: 50,
        endTimeSeconds: 100,
        durationSeconds: 50,
        transcriptText: "",
        reasonSelected: "Clear application about serving with courage",
        riskReasons: [],
        setupStartTime: 8,
        mainPointTime: 12,
        payoffTime: 82,
        applicationTime: 92,
      },
      segments,
    );

    expect(refined.accepted).toBe(true);
    if (refined.accepted) {
      expect(refined.candidate.adjustedStartTimeSeconds).toBe(40);
      expect(refined.candidate.boundaryAdjustmentReason).toContain("safe duration limits");
    }
  });

  it("moves the start earlier when the selected clip begins with a context-dependent reference", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 10, text: "Paul tells Timothy to stir up the gift of God." },
      { startTimeSeconds: 10, endTimeSeconds: 20, text: "That means obedience cannot wait for perfect confidence." },
      { startTimeSeconds: 20, endTimeSeconds: 30, text: "The Spirit gives power, love, and discipline." },
      { startTimeSeconds: 30, endTimeSeconds: 40, text: "So take one faithful step with what God placed in your hand." },
      { startTimeSeconds: 40, endTimeSeconds: 50, text: "The church is strengthened when every believer serves." },
    ];

    const refined = refineClipBoundaries(
      {
        startTimeSeconds: 10,
        endTimeSeconds: 50,
        durationSeconds: 40,
        transcriptText: "",
        reasonSelected: "Strong discipleship application",
        riskReasons: [],
      },
      segments,
    );

    expect(refined.accepted).toBe(true);
    if (refined.accepted) {
      expect(refined.candidate.adjustedStartTimeSeconds).toBe(0);
      expect(refined.candidate.transcriptText).toContain("Paul tells Timothy");
      expect(refined.candidate.boundaryQuality).toBe("GOOD");
    }
  });

  it("moves the start earlier for prepositional context-dependent openings", () => {
    const segments = [
      { startTimeSeconds: 0, endTimeSeconds: 12, text: "Some of you feel weary because the valley has lasted longer than expected." },
      { startTimeSeconds: 12, endTimeSeconds: 24, text: "In that place God gives grace for the next faithful step." },
      { startTimeSeconds: 24, endTimeSeconds: 38, text: "You can pray again because the Lord has not left you." },
      { startTimeSeconds: 38, endTimeSeconds: 52, text: "So keep walking with courage and serve with what is in your hand." },
    ];

    const refined = refineClipBoundaries(
      {
        startTimeSeconds: 12,
        endTimeSeconds: 52,
        durationSeconds: 40,
        transcriptText: "",
        reasonSelected: "Strong encouragement for weary believers",
        riskReasons: [],
      },
      segments,
    );

    expect(refined.accepted).toBe(true);
    if (refined.accepted) {
      expect(refined.candidate.adjustedStartTimeSeconds).toBe(0);
      expect(refined.candidate.transcriptText).toContain("Some of you feel weary");
      expect(refined.candidate.boundaryQuality).toBe("GOOD");
    }
  });

  it("does not downgrade clean long ministry moments solely for passing 90 seconds", () => {
    const longSegments = Array.from({ length: 12 }, (_, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 10,
      text: `Complete testimony thought ${index}.`,
    }));
    const refined = refineClipBoundaries(
      {
        startTimeSeconds: 0,
        endTimeSeconds: 120,
        durationSeconds: 120,
        transcriptText: "Long but complete testimony.",
        reasonSelected: "Complete testimony arc",
        riskReasons: [],
      },
      longSegments,
    );

    expect(refined.accepted).toBe(true);
    if (refined.accepted) {
      expect(refined.candidate.durationSeconds).toBe(120);
      expect(refined.candidate.boundaryQuality).toBe("GOOD");
    }
  });
});
