import { describe, expect, it } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  __clipOverlayTestUtils,
  validateOverlayEligibility,
  type OverlayEligibilityInput,
} from "../clipOverlayService";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function validInput(overrides?: Partial<OverlayEligibilityInput>): OverlayEligibilityInput {
  return {
    status: "APPROVED",
    renderStatus: "COMPLETED",
    overlayStatus: "NOT_RENDERED",
    renderedClipExists: true,
    hasSermonTitle: true,
    hasPastorName: true,
    allowRerender: false,
    ...overrides,
  };
}

// ─── validateOverlayEligibility ───────────────────────────────────────────────

describe("validateOverlayEligibility — successful overlay render eligibility", () => {
  it("allows an approved clip with completed render and metadata present", () => {
    const result = validateOverlayEligibility(validInput());

    expect(result.ok).toBe(true);
  });

  it("allows an exported clip when allowRerender is true", () => {
    const result = validateOverlayEligibility(
      validInput({ status: "EXPORTED", overlayStatus: "COMPLETED", allowRerender: true }),
    );

    expect(result.ok).toBe(true);
  });
});

describe("validateOverlayEligibility — missing rendered clip failure", () => {
  it("blocks when rendered clip file does not exist", () => {
    const result = validateOverlayEligibility(validInput({ renderedClipExists: false }));

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Rendered clip file does not exist");
  });

  it("blocks when renderStatus is not COMPLETED", () => {
    const result = validateOverlayEligibility(validInput({ renderStatus: "NOT_RENDERED" }));

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Rendered clip must be completed");
  });
});

describe("validateOverlayEligibility — missing sermon metadata warning", () => {
  it("blocks when neither sermon title nor pastor name is present", () => {
    const result = validateOverlayEligibility(
      validInput({ hasSermonTitle: false, hasPastorName: false }),
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Sermon title or pastor name is required");
  });

  it("allows when only sermon title is present (no pastor name)", () => {
    const result = validateOverlayEligibility(
      validInput({ hasPastorName: false, hasSermonTitle: true }),
    );

    expect(result.ok).toBe(true);
  });

  it("allows when only pastor name is present (no sermon title)", () => {
    const result = validateOverlayEligibility(
      validInput({ hasSermonTitle: false, hasPastorName: true }),
    );

    expect(result.ok).toBe(true);
  });
});

describe("validateOverlayEligibility — duplicate render prevention", () => {
  it("blocks when overlay is already RENDERING", () => {
    const result = validateOverlayEligibility(validInput({ overlayStatus: "RENDERING" }));

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("already in progress");
  });

  it("blocks completed overlay when allowRerender is false", () => {
    const result = validateOverlayEligibility(
      validInput({ overlayStatus: "COMPLETED", allowRerender: false }),
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("Use regenerate");
  });

  it("allows completed overlay when allowRerender is true", () => {
    const result = validateOverlayEligibility(
      validInput({ overlayStatus: "COMPLETED", allowRerender: true }),
    );

    expect(result.ok).toBe(true);
  });

  it("allows SUGGESTED clips for review preview overlays", () => {
    const result = validateOverlayEligibility(validInput({ status: "SUGGESTED" }));

    expect(result.ok).toBe(true);
  });

  it("blocks REJECTED clips", () => {
    const result = validateOverlayEligibility(validInput({ status: "REJECTED" }));

    expect(result.ok).toBe(false);
    expect(result.reason).toContain("suggested or approved");
  });

  it("does not reuse empty overlay files as completed media", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "overlay-empty-"));
    try {
      const overlayPath = path.join(directory, "clip-overlay.mp4");
      await writeFile(overlayPath, "");

      await expect(__clipOverlayTestUtils.fileHasBytes(overlayPath)).resolves.toBe(false);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts non-empty overlay files for reuse", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "overlay-ready-"));
    try {
      const overlayPath = path.join(directory, "clip-overlay.mp4");
      await writeFile(overlayPath, "video-bytes");

      await expect(__clipOverlayTestUtils.fileHasBytes(overlayPath)).resolves.toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

// ─── escapeDrawtext ───────────────────────────────────────────────────────────

describe("escapeDrawtext", () => {
  const { escapeDrawtext } = __clipOverlayTestUtils;

  it("escapes colons", () => {
    expect(escapeDrawtext("John 3:16")).toBe("John 3\\:16");
  });

  it("escapes single quotes", () => {
    expect(escapeDrawtext("God's Grace")).toBe("God\\'s Grace");
  });

  it("escapes backslashes", () => {
    expect(escapeDrawtext("path\\to")).toBe("path\\\\to");
  });

  it("escapes square brackets", () => {
    expect(escapeDrawtext("text[1]")).toBe("text\\[1\\]");
  });

  it("leaves safe characters unchanged", () => {
    expect(escapeDrawtext("Pastor David")).toBe("Pastor David");
  });

  it("trims leading and trailing whitespace", () => {
    expect(escapeDrawtext("  Pastor David  ")).toBe("Pastor David");
  });
});

// ─── buildOverlayFilter ───────────────────────────────────────────────────────

describe("buildOverlayFilter — metadata persistence", () => {
  const { buildOverlayFilter } = __clipOverlayTestUtils;

  const sermon = {
    title: "Walking by Faith",
    speakerName: "Pastor David",
    churchName: "Grace Church",
    sermonDate: null,
  };

  it("includes pastor name in the filter", () => {
    const filter = buildOverlayFilter(sermon, null);

    expect(filter).toContain("Pastor David");
  });

  it("includes sermon title in the filter", () => {
    const filter = buildOverlayFilter(sermon, null);

    expect(filter).toContain("Walking by Faith");
  });

  it("includes church name in the filter", () => {
    const filter = buildOverlayFilter(sermon, null);

    expect(filter).toContain("Grace Church");
  });

  it("omits the date line when sermonDate is null", () => {
    const filter = buildOverlayFilter(sermon, null);
    // Formatted date should not appear
    expect(filter).not.toContain("January");
    expect(filter).not.toContain("2025");
  });

  it("includes formatted date when sermonDate is provided", () => {
    const filter = buildOverlayFilter(
      { ...sermon, sermonDate: new Date("2025-01-15") },
      null,
    );

    expect(filter).toContain("January 2025");
  });

  it("uses brand primary color when branding is available", () => {
    const filter = buildOverlayFilter(sermon, { primaryBrandColor: "#FF5500" });

    expect(filter).toContain("0xFF5500");
  });

  it("falls back to white text when no branding is set", () => {
    const filter = buildOverlayFilter(sermon, null);

    expect(filter).toContain("0xFFFFFF");
  });

  it("lets burned-in captions override the branding lower third", () => {
    expect(
      __clipOverlayTestUtils.shouldBrandingLowerThirdYieldToCaptions({
        applyCaptionsToClip: true,
        cues: [{ text: "Sermon words", startSeconds: 0, endSeconds: 2 }],
      }),
    ).toBe(true);
    expect(
      __clipOverlayTestUtils.shouldBrandingLowerThirdYieldToCaptions({
        applyCaptionsToClip: false,
        cues: [{ text: "Sermon words", startSeconds: 0, endSeconds: 2 }],
      }),
    ).toBe(false);
  });

  it("includes a drawbox background element", () => {
    const filter = buildOverlayFilter(sermon, null);

    expect(filter).toContain("drawbox");
    expect(filter).toContain("black@0.60");
  });

  it("escapes special characters in text fields", () => {
    const filter = buildOverlayFilter(
      { ...sermon, speakerName: "Pastor O'Brien", title: "Faith: Hope & Love" },
      null,
    );

    expect(filter).toContain("O\\'Brien");
    expect(filter).toContain("Faith\\:");
  });

  it("positions overlay at the lower portion of the frame", () => {
    const filter = buildOverlayFilter(sermon, null);

    // All positions reference h- (bottom-relative) to stay in lower third
    expect(filter).toMatch(/y=h-\d+/);
  });
});

describe("buildHookOverlayFilter", () => {
  const { buildHookOverlayFilter } = __clipOverlayTestUtils;

  it("builds a timed drawtext filter for enabled hook overlays", () => {
    const filter = buildHookOverlayFilter({
      hookOverlay: {
        enabled: true,
        text: "Do not quit now",
        position: "center",
        startSeconds: 0,
        durationSeconds: 6,
        animation: "fade",
        size: "large",
        bold: true,
      },
    });

    expect(filter).toContain("drawtext");
    expect(filter).toContain("Do not quit now");
    expect(filter).toContain("between(t,0.00,6.00)");
    expect(filter).toContain("fontsize=64");
    expect(filter).toContain("alpha='if");
    expect(filter).toContain("(6.00-t)");
  });

  it("animates pan-in hooks with a moving x expression", () => {
    const filter = buildHookOverlayFilter({
      hookOverlay: {
        enabled: true,
        text: "Keep moving",
        position: "top",
        startSeconds: 1,
        durationSeconds: 5,
        animation: "pan-in",
        size: "medium",
        bold: false,
      },
    });

    expect(filter).toContain("x='((w-text_w)/2)-if");
    expect(filter).toContain("*120");
    expect(filter).toContain("shadowx=1:shadowy=1");
  });

  it("animates pop hooks with a vertical settle expression", () => {
    const filter = buildHookOverlayFilter({
      hookOverlay: {
        enabled: true,
        text: "Wake up faith",
        position: "lower",
        startSeconds: 0,
        durationSeconds: 6,
        animation: "pop",
        size: "small",
        bold: true,
      },
    });

    expect(filter).toContain("y='(h-430)+if");
    expect(filter).toContain("*18");
    expect(filter).toContain("fontsize=38");
  });

  it("returns null when hook overlay is disabled", () => {
    expect(buildHookOverlayFilter({ hookOverlay: { enabled: false, text: "Hidden" } })).toBeNull();
  });
});

// ─── formatSermonDate ─────────────────────────────────────────────────────────

describe("formatSermonDate", () => {
  const { formatSermonDate } = __clipOverlayTestUtils;

  it("formats as Month YYYY", () => {
    expect(formatSermonDate(new Date("2025-03-01"))).toBe("March 2025");
  });

  it("formats December correctly", () => {
    expect(formatSermonDate(new Date("2024-12-25"))).toBe("December 2024");
  });
});
