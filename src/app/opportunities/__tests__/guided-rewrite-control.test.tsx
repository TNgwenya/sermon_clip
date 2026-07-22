import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { GuidedRewriteControl } from "@/app/opportunities/guided-rewrite-control";

function render(opportunityType: Parameters<typeof GuidedRewriteControl>[0]["opportunityType"]) {
  return renderToStaticMarkup(
    <GuidedRewriteControl
      opportunityId="opportunity-1"
      opportunityType={opportunityType}
      selectedVariant="SHORTER"
      disabled={false}
      pending={false}
      notice=""
      onVariantChange={vi.fn()}
      onRequest={vi.fn()}
    />,
  );
}

describe("guided rewrite review control", () => {
  it("stays collapsed, offers every bounded direction, and explains review-only behavior", () => {
    const markup = render("FACEBOOK_POST_IDEA");

    expect(markup).toContain("<details class=\"opportunity-guided-rewrite\">");
    expect(markup).not.toContain("<details class=\"opportunity-guided-rewrite\" open=\"\"");
    expect(markup).toContain("Make it shorter");
    expect(markup).toContain("Make it warmer");
    expect(markup).toContain("Make it more practical");
    expect(markup).toContain("Adapt for youth");
    expect(markup).toContain("Adapt for leaders");
    expect(markup).toContain("never approves or publishes content");
    expect(markup).toContain("Create review suggestion");
  });

  it.each([
    ["QUOTE_GRAPHIC", "pastor quotes"],
    ["SCRIPTURE_GRAPHIC", "Scripture"],
  ] as const)("replaces controls with a manual verification notice for %s", (opportunityType, label) => {
    const markup = render(opportunityType);

    expect(markup).toContain("Exact wording protected");
    expect(markup).toContain(`Guided rewrites are off for ${label}`);
    expect(markup).not.toContain("<select");
    expect(markup).not.toContain("Create review suggestion");
  });
});
