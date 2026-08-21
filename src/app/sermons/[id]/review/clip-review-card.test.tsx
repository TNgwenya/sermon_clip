import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { buildQuickReviewDisplay, QuickReviewDecisionActions } from "./clip-review-card";

describe("QuickReviewDecisionActions", () => {
  it("shows only the strongest undecided clip in Quick review", () => {
    const display = buildQuickReviewDisplay([
      { id: "already-approved", status: "APPROVED" as const, canPreviewVideo: true },
      { id: "not-playable-yet", status: "SUGGESTED" as const, canPreviewVideo: false },
      { id: "strongest-undecided", status: "SUGGESTED" as const, canPreviewVideo: true },
      { id: "next-undecided", status: "SUGGESTED" as const, canPreviewVideo: true },
    ]);

    expect(display).toEqual([{
      id: "strongest-undecided",
      status: "SUGGESTED",
      canPreviewVideo: true,
    }]);
  });

  it("offers exactly three pastor decisions without a publish action", () => {
    const markup = renderToStaticMarkup(
      <QuickReviewDecisionActions
        sermonId="sermon-1"
        clipId="clip-1"
        clipTitle="Grace in the waiting"
        canApprove
        canReject
        isPending={false}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(markup).toContain("Approve &amp; use");
    expect(markup).toContain("Adjust in Quick Finish");
    expect(markup).toContain("Leave out");
    expect(markup.match(/<(?:button|a)\b/g)).toHaveLength(3);
    expect(markup).toContain("does not publish or send anything");
    expect(markup).not.toContain("Publish now");
    expect(markup).not.toContain("Prepare download");
  });

  it("keeps approval unavailable when the transcript safety gate is closed", () => {
    const markup = renderToStaticMarkup(
      <QuickReviewDecisionActions
        sermonId="sermon-1"
        clipId="clip-1"
        clipTitle="Grace in the waiting"
        canApprove={false}
        canReject
        isPending={false}
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />,
    );

    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Approve &amp; use<\/button>/);
    expect(markup).toContain('href="/sermons/sermon-1/clips/clip-1/studio"');
  });
});
