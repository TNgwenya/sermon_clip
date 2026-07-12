import { describe, expect, it } from "vitest";

import {
  isSubstantialClipReviewBoard,
  resolveClipVolumeTarget,
  resolveClipReviewAcceptanceFloor,
  shouldReuseClipSuggestionsForTarget,
} from "@/lib/clipVolumeTargets";

describe("clip volume targets", () => {
  it("scales pastor review options by sermon duration", () => {
    expect(resolveClipVolumeTarget(8 * 60)).toMatchObject({
      rangeLabel: "3-10",
      minReviewSuggestions: 3,
      maxReviewSuggestions: 10,
      batchClipLimit: 2,
    });
    expect(resolveClipVolumeTarget(25 * 60)).toMatchObject({
      rangeLabel: "8-20",
      minReviewSuggestions: 8,
      maxReviewSuggestions: 20,
      batchClipLimit: 3,
    });
    expect(resolveClipVolumeTarget(45 * 60)).toMatchObject({
      rangeLabel: "20-32",
      minReviewSuggestions: 20,
      maxReviewSuggestions: 32,
      batchClipLimit: 4,
    });
    expect(resolveClipVolumeTarget(90 * 60)).toMatchObject({
      rangeLabel: "32-42",
      minReviewSuggestions: 32,
      maxReviewSuggestions: 42,
    });
    expect(resolveClipVolumeTarget(150 * 60)).toMatchObject({
      rangeLabel: "42-55",
      minReviewSuggestions: 42,
      maxReviewSuggestions: 55,
    });
  });

  it("only reuses saved suggestions when the target minimum is met", () => {
    expect(shouldReuseClipSuggestionsForTarget({
      existingSuggestionCount: 12,
      target: { minReviewSuggestions: 20 },
    })).toBe(false);
    expect(shouldReuseClipSuggestionsForTarget({
      existingSuggestionCount: 20,
      target: { minReviewSuggestions: 20 },
    })).toBe(true);
    expect(shouldReuseClipSuggestionsForTarget({
      existingSuggestionCount: 20,
      force: true,
      target: { minReviewSuggestions: 20 },
    })).toBe(false);
  });

  it("accepts and reuses a substantial below-target long-sermon review board", () => {
    const longSermonTarget = resolveClipVolumeTarget(77 * 60);

    expect(resolveClipReviewAcceptanceFloor(longSermonTarget.minReviewSuggestions)).toBe(23);
    expect(isSubstantialClipReviewBoard({ suggestionCount: 24, target: longSermonTarget })).toBe(true);
    expect(isSubstantialClipReviewBoard({ suggestionCount: 22, target: longSermonTarget })).toBe(false);
    expect(shouldReuseClipSuggestionsForTarget({
      existingSuggestionCount: 24,
      target: longSermonTarget,
    })).toBe(true);
  });
});
