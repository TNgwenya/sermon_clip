import { describe, expect, it } from "vitest";

import { __teachingVideoExportTestUtils } from "@/server/agents/teachingVideoExportService";

describe("teaching video export contract", () => {
  it("builds exactly one continuous source cut without filters or concatenation", () => {
    const args = __teachingVideoExportTestUtils.buildContinuousTeachingExportArgs({
      sourcePath: "/media/source.mp4",
      outputPath: "/media/teaching.mp4",
      startTimeSeconds: 123.4,
      durationSeconds: 612.5,
    });

    expect(args.filter((value) => value === "-i")).toHaveLength(1);
    expect(args).toEqual(expect.arrayContaining([
      "-i",
      "/media/source.mp4",
      "-ss",
      "123.400",
      "-t",
      "612.500",
      "/media/teaching.mp4",
    ]));
    expect(args.join(" ")).not.toContain("concat");
    expect(args).not.toContain("-filter_complex");
    expect(args).not.toContain("-filter_script");
    expect(args).not.toContain("copy");
  });
});
