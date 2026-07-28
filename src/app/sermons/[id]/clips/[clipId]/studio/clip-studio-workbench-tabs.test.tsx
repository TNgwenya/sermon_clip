import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import {
  __clipStudioWorkbenchTabsTestUtils,
  ClipStudioWorkbenchTabs,
} from "@/app/sermons/[id]/clips/[clipId]/studio/clip-studio-workbench-tabs";

const workbench = (
  <ClipStudioWorkbenchTabs
    edit={<p>Caption editor</p>}
    format={<p>Frame editor</p>}
    branding={<p>Brand editor</p>}
    post={<p>Export handoff</p>}
    advanced={<p>Production diagnostics</p>}
  />
);

describe("Clip Studio inspector navigation", () => {
  it("exposes only the four editing and handoff tabs", () => {
    const markup = renderToStaticMarkup(workbench);

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Clip Studio tools"');
    expect(markup.match(/role="tab"/g)).toHaveLength(4);
    expect(markup).toContain(">Captions</button>");
    expect(markup).toContain(">Frame</button>");
    expect(markup).toContain(">Brand</button>");
    expect(markup).toContain(">Export</button>");
    expect(markup).not.toContain(">Insights</button>");
    expect(markup).not.toContain("Message evidence");
    expect(markup).not.toContain("Style, words and timing");
    expect(markup).toContain('<h2 class="sr-only">Clip inspector</h2>');
  });

  it("keeps tab and panel relationships accessible", () => {
    const markup = renderToStaticMarkup(workbench);

    expect(markup).toContain(
      'id="clip-studio-tab-edit" type="button" class="clip-studio-tab is-active"',
    );
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-controls="clip-studio-panel-edit"');
    expect(markup).toContain(
      'id="clip-studio-panel-edit" class="clip-studio-tab-panel" role="tabpanel" aria-labelledby="clip-studio-tab-edit"',
    );
    expect(markup).toContain('id="clip-studio-tab-post"');
    expect(markup).toContain('aria-controls="clip-studio-panel-post"');
    expect(markup).toContain('aria-labelledby="clip-studio-tab-post"');
  });

  it("wraps arrow navigation across the remaining tabs and supports Home and End", () => {
    const resolveIndex = __clipStudioWorkbenchTabsTestUtils.resolveStudioTabIndex;

    expect(resolveIndex({ key: "ArrowLeft", index: 0, tabCount: 4 })).toBe(3);
    expect(resolveIndex({ key: "ArrowRight", index: 3, tabCount: 4 })).toBe(0);
    expect(resolveIndex({ key: "Home", index: 2, tabCount: 4 })).toBe(0);
    expect(resolveIndex({ key: "End", index: 1, tabCount: 4 })).toBe(3);
    expect(resolveIndex({ key: "Tab", index: 1, tabCount: 4 })).toBeNull();
  });
});
