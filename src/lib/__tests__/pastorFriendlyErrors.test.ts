import { describe, expect, it } from "vitest";

import { pastorFriendlyError } from "@/lib/pastorFriendlyErrors";

describe("pastorFriendlyError", () => {
  it("summarizes FFmpeg drawtext failures without exposing the full command output", () => {
    expect(pastorFriendlyError("FFmpeg export failed. No such filter: 'drawtext'")).toContain("missing the text overlay filter");
  });

  it("summarizes missing media failures", () => {
    expect(pastorFriendlyError("Rendered clip file does not exist.")).toContain("could not find the video file");
  });
});