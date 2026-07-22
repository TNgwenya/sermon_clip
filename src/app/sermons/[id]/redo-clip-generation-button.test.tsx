import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/server/actions/sermons", () => ({
  redoClipGenerationFromTranscriptAction: vi.fn(),
}));

import {
  __redoClipGenerationButtonTestUtils,
  RedoClipGenerationButton,
} from "@/app/sermons/[id]/redo-clip-generation-button";

function renderButton(
  props: Partial<Parameters<typeof RedoClipGenerationButton>[0]> = {},
): string {
  return renderToStaticMarkup(
    <RedoClipGenerationButton
      sermonId="sermon-1"
      hasTranscriptSegments
      clipCount={4}
      {...props}
    />,
  );
}

describe("RedoClipGenerationButton source range", () => {
  it("offers optional source-timeline start and end controls with safe blank behavior", () => {
    const markup = renderButton();

    expect(markup).toContain("Choose where to search for clips");
    expect(markup).toContain('name="sermonStartTimestamp"');
    expect(markup).toContain('name="sermonEndTimestamp"');
    expect(markup).toContain("MM:SS");
    expect(markup).toContain("H:MM:SS");
    expect(markup).toContain("Leave blank to start at the beginning of the transcript.");
    expect(markup).toContain("Leave blank to search through the end of the transcript.");
    expect(markup).toContain("The video and transcript are not trimmed.");
  });

  it("prefills the existing range and explains it against the source video duration", () => {
    const markup = renderButton({
      defaultStartSeconds: 20 * 60,
      defaultEndSeconds: 55 * 60 + 30,
      durationSeconds: 60 * 60,
    });

    expect(markup).toMatch(/name="sermonStartTimestamp"[^>]*value="20:00"/);
    expect(markup).toMatch(/name="sermonEndTimestamp"[^>]*value="55:30"/);
    expect(markup).toContain("video length: 1:00:00");
    expect(markup).toContain('placeholder="Up to 1:00:00"');
  });

  it("disables range editing when no completed transcript is available", () => {
    const markup = renderButton({ hasTranscriptSegments: false });

    expect(markup).toContain('<fieldset class="redo-range-fieldset" disabled=""');
    expect(markup).toContain("A completed transcript is required before this redo can run.");
  });

  it("keeps invalid or missing stored defaults blank", () => {
    expect(__redoClipGenerationButtonTestUtils.formatOptionalTimestamp(null)).toBe("");
    expect(__redoClipGenerationButtonTestUtils.formatOptionalTimestamp(-1)).toBe("");
    expect(__redoClipGenerationButtonTestUtils.formatSourceDuration(Number.NaN)).toBeNull();
  });
});
