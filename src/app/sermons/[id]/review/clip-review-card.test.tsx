import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  buildPastorFacingClipTitle,
  buildPastorFacingInsight,
  buildQuickReviewDisplay,
  QuickReviewDecisionActions,
} from "./clip-review-card";

describe("QuickReviewDecisionActions", () => {
  it("shows the strongest undecided clip even when its preview is not ready", () => {
    const display = buildQuickReviewDisplay([
      { id: "already-approved", status: "APPROVED" as const, canPreviewVideo: true },
      { id: "not-playable-yet", status: "SUGGESTED" as const, canPreviewVideo: false },
      { id: "next-undecided", status: "SUGGESTED" as const, canPreviewVideo: true },
    ]);

    expect(display).toEqual([{
      id: "not-playable-yet",
      status: "SUGGESTED",
      canPreviewVideo: false,
    }]);
  });

  it("replaces generated word piles and technical rationale with pastor-facing fallbacks", () => {
    expect(buildPastorFacingClipTitle({
      title: "Need Stay Understand Need Obey",
      hook: "You do not know what God has for you.",
      transcriptText: "Stay faithful in the waiting.",
    })).toBe("You do not know what God has for you");

    expect(buildPastorFacingInsight("Deterministic top-up selected candidate. Boundary adjusted 3.0-9.0s."))
      .toBe("This moment carries a clear message that is ready for your review.");
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
