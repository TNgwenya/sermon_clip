import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ClipStudioCoverFrame } from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-cover-frame";

describe("ClipStudioCoverFrame", () => {
  it("labels the checked opening frame as the unsaved default", () => {
    const markup = renderToStaticMarkup(
      <ClipStudioCoverFrame
        clipId="clip-1"
        durationSeconds={60}
        localMediaAvailable={false}
      />,
    );

    expect(markup).toContain("Opening selected by default");
    expect(markup).not.toContain("Not chosen yet");
    expect(markup).toMatch(/type="radio"[^>]*checked=""/);
  });
});
