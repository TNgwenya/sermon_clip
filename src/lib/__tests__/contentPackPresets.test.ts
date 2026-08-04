import { describe, expect, it } from "vitest";

import { getContentPackPreset } from "@/lib/contentPackPresets";

describe("event content pack preset", () => {
  it("includes a focused same-day event deliverable set", () => {
    const preset = getContentPackPreset("SAME_DAY_EVENT_PACK");

    expect(preset?.label).toBe("Same-day event pack");
    expect(preset?.quantities).toMatchObject({
      SHORT_FORM_CLIP_IDEA: 3,
      QUOTE_GRAPHIC: 2,
      SERMON_SUMMARY: 1,
      NEXT_SERVICE_PROMOTION: 1,
    });
  });
});
