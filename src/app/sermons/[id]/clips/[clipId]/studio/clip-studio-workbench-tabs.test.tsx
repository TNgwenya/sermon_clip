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
  it("opens in a focused Quick Finish mode with four editing and handoff tools", () => {
    const markup = renderToStaticMarkup(workbench);

    expect(markup).toContain('role="tablist"');
    expect(markup).toContain('aria-label="Clip Studio tools"');
    expect(markup.match(/role="tab"/g)).toHaveLength(4);
    expect(markup).toContain("<h2>Quick Finish</h2>");
    expect(markup).toContain("<strong>Words &amp; sound</strong>");
    expect(markup).toContain("<strong>Fit the frame</strong>");
    expect(markup).toContain("<strong>Apply brand</strong>");
    expect(markup).toContain("<strong>Finish</strong>");
    expect(markup).toContain('aria-label="Studio editing mode"');
    expect(markup).toContain('aria-pressed="true"><strong>Quick Finish</strong><small>Guided essentials</small></button>');
    expect(markup).toContain('aria-pressed="false"><strong>Advanced</strong><small>All controls</small></button>');
    expect(markup).not.toContain("<strong>Diagnostics</strong>");
    expect(markup).not.toContain("Production diagnostics</p>");
    expect(markup).toContain('<h2 class="sr-only">Clip inspector</h2>');
    expect(markup).toContain("Quick path · 1 of 4");
    expect(markup).toContain('<h3 id="clip-studio-guidance-title">Check the words and sound</h3>');
    expect(markup).toContain(">Start with captions</button>");
    expect(markup).toContain(">Next: fit the frame");
    expect(markup).toContain("<summary>Keyboard shortcuts ");
    expect(markup).toMatch(/<details class="[^"]+"><summary>Keyboard shortcuts/);
    expect(markup).not.toContain('open=""');
  });

  it("keeps tab and panel relationships accessible", () => {
    const markup = renderToStaticMarkup(workbench);

    expect(markup).toContain(
      'id="clip-studio-tab-edit" type="button" class="clip-studio-tab is-active"',
    );
    expect(markup).toContain('aria-selected="true"');
    expect(markup).toContain('aria-controls="clip-studio-panel-edit"');
    expect(markup).toContain('id="clip-studio-panel-edit" class="clip-studio-tab-panel ');
    expect(markup).toContain('role="tabpanel" aria-labelledby="clip-studio-tab-edit"');
    expect(markup).toContain('id="clip-studio-tab-post"');
    expect(markup).toContain('aria-controls="clip-studio-panel-post"');
    expect(markup).toContain('aria-labelledby="clip-studio-tab-post"');
    expect(markup).toContain(
      'aria-label="Step 1: Words &amp; sound. Captions, opening and natural pacing"',
    );
  });

  it("wraps arrow navigation across the remaining tabs and supports Home and End", () => {
    const resolveIndex = __clipStudioWorkbenchTabsTestUtils.resolveStudioTabIndex;

    expect(resolveIndex({ key: "ArrowLeft", index: 0, tabCount: 4 })).toBe(3);
    expect(resolveIndex({ key: "ArrowRight", index: 3, tabCount: 4 })).toBe(0);
    expect(resolveIndex({ key: "Home", index: 2, tabCount: 4 })).toBe(0);
    expect(resolveIndex({ key: "End", index: 1, tabCount: 4 })).toBe(3);
    expect(resolveIndex({ key: "Tab", index: 1, tabCount: 4 })).toBeNull();
  });

  it("reveals diagnostics only in intentional Advanced Studio mode", () => {
    const shouldIncludeAdvanced = __clipStudioWorkbenchTabsTestUtils.shouldIncludeAdvancedStudioTab;

    expect(shouldIncludeAdvanced({ mode: "quick", hasAdvancedContent: true })).toBe(false);
    expect(shouldIncludeAdvanced({ mode: "advanced", hasAdvancedContent: false })).toBe(false);
    expect(shouldIncludeAdvanced({ mode: "advanced", hasAdvancedContent: true })).toBe(true);
  });

  it("gives Quick Finish outcome labels while Advanced Studio exposes expert hierarchy", () => {
    const presentation = __clipStudioWorkbenchTabsTestUtils.getStudioTabPresentation;

    expect(presentation("quick", "edit")).toEqual({
      label: "Words & sound",
      description: "Captions, opening and natural pacing",
      stepLabel: "Step 1",
    });
    expect(presentation("advanced", "edit")).toEqual({
      label: "Edit & audio",
      description: "Caption timing, layers, hooks and pacing",
      stepLabel: "Creative",
    });
    expect(presentation("advanced", "advanced")).toEqual({
      label: "Diagnostics",
      description: "Tracking, render and quality evidence",
      stepLabel: "Inspect",
    });
  });

  it("keeps current-task guidance distinct from the next guided step", () => {
    const guidance = __clipStudioWorkbenchTabsTestUtils.getStudioGuidance;

    expect(guidance("quick", "edit")).toMatchObject({
      title: "Check the words and sound",
      actionLabel: "Start with captions",
      nextTabId: "format",
      nextLabel: "Next: fit the frame",
    });
    expect(guidance("quick", "post")).toMatchObject({
      title: "Run the final check",
      actionLabel: "Open final checks",
      nextTabId: null,
    });
    expect(guidance("advanced", "advanced")).toMatchObject({
      eyebrow: "Expert inspection",
      actionLabel: "Review diagnostic evidence",
      nextTabId: null,
    });
  });

  it("supports arrow, Home, and End navigation for the editing mode switch", () => {
    const resolveMode = __clipStudioWorkbenchTabsTestUtils.resolveStudioModeIndex;

    expect(resolveMode({ key: "ArrowRight", index: 0 })).toBe(1);
    expect(resolveMode({ key: "ArrowRight", index: 1 })).toBe(0);
    expect(resolveMode({ key: "ArrowUp", index: 0 })).toBe(1);
    expect(resolveMode({ key: "Home", index: 1 })).toBe(0);
    expect(resolveMode({ key: "End", index: 0 })).toBe(1);
    expect(resolveMode({ key: "Enter", index: 0 })).toBeNull();
  });

  it("advertises only shortcuts implemented by this workbench", () => {
    const markup = renderToStaticMarkup(workbench);

    expect(markup).toContain("Previous or next tool");
    expect(markup).toContain("<kbd>Home</kbd> First tool");
    expect(markup).toContain("<kbd>End</kbd> Last tool");
    expect(markup).not.toContain("<kbd>Alt</kbd>");
    expect(markup).not.toContain("<kbd>⌘</kbd>");
  });
});
