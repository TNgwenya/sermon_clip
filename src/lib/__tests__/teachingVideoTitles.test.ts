import { describe, expect, it } from "vitest";

import {
  assessTeachingVideoTitle,
  selectBestTeachingVideoTitle,
  TEACHING_VIDEO_TITLE_MIN_SCORE,
} from "@/lib/teachingVideoTitles";

describe("teaching video title quality", () => {
  it("accepts a catchy, relevant viewer-life question", () => {
    const assessment = assessTeachingVideoTitle(
      "Could What You’re Watching Be Holding You Back?",
    );

    expect(assessment.passes).toBe(true);
    expect(assessment.score).toBeGreaterThanOrEqual(TEACHING_VIDEO_TITLE_MIN_SCORE);
    expect(assessment.signals).toEqual(expect.arrayContaining([
      "DIRECT_QUESTION",
      "VIEWER_CENTERED",
      "CURIOSITY_OR_STAKES",
      "NON_CLICKBAIT",
    ]));
  });

  it("rejects an accurate but passive, non-viewer-centred label", () => {
    const assessment = assessTeachingVideoTitle(
      "What Influences Your Eyes Directs Your Life",
    );

    expect(assessment.passes).toBe(false);
    expect(assessment.problems).toContain("NOT_A_DIRECT_QUESTION");
  });

  it("rejects sensational clickbait even when it addresses the viewer", () => {
    const assessment = assessTeachingVideoTitle(
      "You Won’t Believe What Is Secretly Ruining Your Life!!!",
    );

    expect(assessment.passes).toBe(false);
    expect(assessment.problems).toContain("CLICKBAIT_OR_HYPE");
  });

  it("selects the strongest passing option from distinct AI suggestions", () => {
    const selected = selectBestTeachingVideoTitle([
      "Learning About Focus and the Christian Life",
      "What Are You Focused On?",
      "Could What You’re Watching Be Holding You Back?",
    ]);

    expect(selected?.title).toBe(
      "Could What You’re Watching Be Holding You Back?",
    );
    expect(selected?.passes).toBe(true);
  });
});
