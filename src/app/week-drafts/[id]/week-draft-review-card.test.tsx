import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  WeekDraftReviewCard,
  type WeekDraftReviewCardModel,
} from "@/app/week-drafts/[id]/week-draft-review-card";

const model: WeekDraftReviewCardModel = {
  draftId: "draft-1",
  draftTitle: "Grace for the week",
  weekLabel: "Week of July 28, 2026",
  itemId: "item-1",
  itemTitle: "Grace meets us here",
  formatLabel: "Short Form Video",
  statusLabel: "In Review",
  currentIndex: 2,
  totalItems: 6,
  decidedItems: 1,
  copy: "Grace meets us before we have the right words.",
  previewUrl: "https://media.example.com/clip.mp4",
  previewKind: "video",
  approvalRequestId: "approval-1",
  eligibleApprovalRole: "PASTOR_APPROVER",
  canRequestApproval: false,
  sourceTypeLabel: "Clip Candidate",
  sourceId: "clip-1",
  sourceRevisionId: null,
  sourceLabel: "Sermon clip",
  sermonTitle: "A Place for Grace",
  speakerName: "Pastor A",
  sourceExcerpt: "Grace meets us in the middle of the road.",
  sourceTimeLabel: "12:05–12:52",
  sourceHref: "/sermons/sermon-1/clips/clip-1/studio",
};

describe("Week Draft pastor review card", () => {
  it("keeps the approval flow focused and preserves source evidence", () => {
    const markup = renderToStaticMarkup(<WeekDraftReviewCard item={model} />);

    expect(markup).toContain("Approve");
    expect(markup).toContain("Edit wording");
    expect(markup).toContain("Leave out");
    expect(markup).toContain("See exact source &amp; context");
    expect(markup).toContain("A Place for Grace");
    expect(markup).toContain("12:05–12:52");
    expect(markup).toContain("Open Advanced Studio");
    expect(markup).toContain("controls");
    expect(markup).toContain("1 of 6 reviewed");
  });

  it("shows a safe setup explanation when governance has not requested approval", () => {
    const markup = renderToStaticMarkup(
      <WeekDraftReviewCard item={{
        ...model,
        statusLabel: "Ready For Review",
        approvalRequestId: null,
      }} />,
    );

    expect(markup).toContain("governed approval request has not been sent yet");
    expect(markup).toContain("/inbox?weekDraftId=draft-1");
  });
});
