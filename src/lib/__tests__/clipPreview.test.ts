import { describe, expect, it } from "vitest";

import { listBestPreviewCandidates } from "@/lib/clipPreview";

describe("clip preview helpers", () => {
  it("orders best preview candidates from most polished to plain render", () => {
    expect(
      listBestPreviewCandidates({
        renderedFilePath: "/tmp/rendered.mp4",
        overlayVideoPath: "/tmp/overlay.mp4",
        captionedVideoPath: "/tmp/captioned.mp4",
        exportedFilePath: "/tmp/exported.mp4",
      }),
    ).toEqual([
      "/tmp/exported.mp4",
      "/tmp/captioned.mp4",
      "/tmp/overlay.mp4",
      "/tmp/rendered.mp4",
    ]);
  });

  it("skips missing preview paths", () => {
    expect(
      listBestPreviewCandidates({
        renderedFilePath: "/tmp/rendered.mp4",
        overlayVideoPath: null,
        captionedVideoPath: undefined,
        exportedFilePath: "",
      }),
    ).toEqual(["/tmp/rendered.mp4"]);
  });
});
