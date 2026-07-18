import { describe, expect, it } from "vitest";

import {
  buildClipRepairPrompt,
  buildClipSelectionSystemPrompt,
  buildClipSelectionUserPrompt,
} from "@/server/ai/clipPrompt";

describe("clip selection prompt", () => {
  it("requires a sermon takeaway instead of generic motivation", () => {
    const prompt = buildClipSelectionSystemPrompt();

    expect(prompt).toContain("Every selected clip must have a real sermon takeaway");
    expect(prompt).toContain("Avoid generic motivational");
    expect(prompt).toContain("Ministry payoff quality score");
    expect(prompt).toContain("Prefer diversity over a single exceptional ministry-climax clip");
  });

  it("forbids setup-only introductions and requires a landing sentence", () => {
    const prompt = buildClipSelectionSystemPrompt();

    expect(prompt).toContain("Never select a setup-only introduction");
    expect(prompt).toContain("exact spoken landing sentence");
    expect(prompt).toContain("If you cannot point to that landing sentence");
    expect(prompt).toContain("landingSentence");
    expect(prompt).toContain("reasonSelected field must quote or closely paraphrase distinctive words");
    expect(prompt).toContain("Do not treat generic theology");
    expect(prompt).toContain("we will see how believers should respond");
    expect(prompt).toContain("only counts as a landing when the same spoken sentence carries personal pastoral payoff");
  });

  it("requests grounded, non-repetitive content-package alternatives", () => {
    const prompt = buildClipSelectionSystemPrompt();

    expect(prompt).toContain("For every clip, include captionPackage");
    expect(prompt).toContain("two or three distinct titleOptions and hookOptions");
    expect(prompt).toContain("short caption should stay under 140 characters");
    expect(prompt).toContain("never add false urgency");
    expect(prompt).toContain("Do not repeat the same sentence across fields");
    expect(prompt).toContain('"ctaOptions"');
    expect(prompt).toContain("Write captions directly to the viewer");
    expect(prompt).toContain("four to eight focused optionalHashtags");
    expect(prompt).toContain("Never return a transcript fragment");
    expect(prompt).toContain("#fyp");
  });

  it("preserves local-language wording and forbids unverified translations", () => {
    const prompt = buildClipSelectionSystemPrompt();

    expect(prompt).toContain("preserve the original transcript wording");
    expect(prompt).toContain("Do not invent, silently translate");
    expect(prompt).toContain("Never present an English summary or inferred meaning as an exact translation");
    expect(prompt).toContain("languageHints.englishMeaning");
    expect(prompt).toContain("Missing English ministry vocabulary is not proof");
  });

  it("asks the model to explain the landing phrase in each selected clip", () => {
    const prompt = buildClipSelectionUserPrompt(
      {
        title: "Faith That Keeps Walking",
        speakerName: "Pastor Test",
        churchName: "Test Church",
        language: "English",
      },
      [
        {
          windowId: "prompt-window",
          startTimeSeconds: 0,
          endTimeSeconds: 90,
          durationSeconds: 90,
          transcriptText: "Today I want to talk about faith. God calls us to trust him, so this week choose prayer again.",
          segments: [
            {
              segmentIndex: 0,
              startTimeSeconds: 0,
              endTimeSeconds: 90,
              text: "Today I want to talk about faith. God calls us to trust him, so this week choose prayer again.",
            },
          ],
          segmentLines: ["0: [0.0 - 90.0] Today I want to talk about faith. God calls us to trust him, so this week choose prayer again."],
          wordCount: 20,
          meaningfulSegmentCount: 1,
          openingHookScore: 7.8,
          ministryPayoffScore: 8.9,
          windowQualityScore: 8,
          windowQualityWarnings: [],
        },
      ],
      3,
    );

    expect(prompt).toContain("Do not choose a window just because it introduces an important topic.");
    expect(prompt).toContain("reasonSelected must name the exact landing sentence or phrase");
    expect(prompt).toContain("Set landingSentence to the exact spoken sentence or phrase");
    expect(prompt).toContain("Make reasonSelected evidence-based");
    expect(prompt).toContain("Reject clips whose final sentence only points to a later answer");
    expect(prompt).toContain("Opening hook quality: 7.8/10");
    expect(prompt).toContain("Ministry payoff quality: 8.9/10");
  });

  it("does not include placeholder zero timestamp examples", () => {
    const prompt = buildClipSelectionSystemPrompt();

    expect(prompt).not.toContain('"windowId": "window-1"');
    expect(prompt).not.toContain('"startTimeSeconds": 0');
    expect(prompt).not.toContain('"endTimeSeconds": 0');
    expect(prompt).toContain("Do not invent startTimeSeconds");
  });

  it("repair prompt includes valid batch windows and segment indexes", () => {
    const prompt = buildClipRepairPrompt(
      "{\"clips\":[]}",
      "clips.0.windowId: unknown window ID",
      [
        {
          windowId: "window-4-10120-10210",
          startTimeSeconds: 10120,
          endTimeSeconds: 10210,
          durationSeconds: 90,
          transcriptText: "God gives courage. Choose obedience today.",
          segments: [
            { segmentIndex: 0, startTimeSeconds: 10120, endTimeSeconds: 10140, text: "God gives courage." },
            { segmentIndex: 1, startTimeSeconds: 10140, endTimeSeconds: 10210, text: "Choose obedience today." },
          ],
          segmentLines: [
            "0: [10120.0 - 10140.0] God gives courage.",
            "1: [10140.0 - 10210.0] Choose obedience today.",
          ],
          wordCount: 6,
          meaningfulSegmentCount: 2,
          windowQualityScore: 8,
          windowQualityWarnings: [],
        },
      ],
    );

    expect(prompt).toContain("window-4-10120-10210");
    expect(prompt).toContain("Valid segment indexes: 0-1");
    expect(prompt).toContain("clips.0.windowId: unknown window ID");
    expect(prompt).toContain("Allowed arcType values");
  });
});
