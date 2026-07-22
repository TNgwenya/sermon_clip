import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/server/actions/weeklyPlan", () => ({
  bulkScheduleWeeklyPlanAction: vi.fn(),
  recordWeeklyPlanPerformanceAction: vi.fn(),
}));

import { WeeklyPlanBuilder } from "@/app/weekly-plan/weekly-plan-builder";

describe("WeeklyPlanBuilder focused flow", () => {
  it("keeps settings and handoffs progressive while preserving source context", () => {
    const markup = renderToStaticMarkup(
      <WeeklyPlanBuilder
        sermons={[{
          id: "sermon-1",
          title: "Grace for the week",
          speakerName: "Pastor A",
          sermonDate: "2030-01-01T00:00:00.000Z",
          centralTheme: "Grace meets people in ordinary life.",
        }]}
        candidates={[{
          id: "asset-1",
          sourceKind: "CONTENT_ASSET",
          sermonId: "sermon-1",
          title: "Grace meets us here",
          caption: "Grace is present in this moment.",
          contentType: "QUOTE_GRAPHIC",
          pointKey: "grace:present",
          suggestedPlatform: "INSTAGRAM",
          qualityScore: 92,
          alreadyScheduled: [],
        }]}
        defaultWeekStart="2030-01-07"
        initialSermonId="sermon-1"
        performance={[]}
        recommendations={[]}
        recentPublishedPosts={[]}
      />,
    );

    expect(markup).toContain("Plan settings");
    expect(markup).toContain("5 posts · Discipleship · 2 platforms");
    expect(markup).not.toMatch(/<details[^>]*open/);
    expect(markup).toContain("Preview &amp; source");
    expect(markup).toContain("/ready-to-post?contentAssetId=asset-1#generated-content-assets");
    expect(markup).toContain("Approve &amp; schedule 1 post");
    expect(markup.match(/button primary/g)).toHaveLength(1);
  });
});
