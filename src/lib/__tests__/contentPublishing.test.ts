import { describe, expect, it } from "vitest";

import {
  buildContentAssetHandoffText,
  mapOpportunityTypeToContentAssetType,
  normalizeContentHashtags,
  normalizeSuggestedPostingPlatform,
} from "@/lib/contentPublishing";

describe("content publishing helpers", () => {
  it("maps generated opportunity types into operational content assets", () => {
    expect(mapOpportunityTypeToContentAssetType("QUOTE_GRAPHIC")).toBe("QUOTE_GRAPHIC");
    expect(mapOpportunityTypeToContentAssetType("CAROUSEL_IDEA")).toBe("CAROUSEL");
    expect(mapOpportunityTypeToContentAssetType("PRAYER_GUIDE")).toBe("PRAYER");
    expect(mapOpportunityTypeToContentAssetType("CAPTION")).toBe("TEXT_POST");
  });

  it("normalizes a suggested platform without treating unknown handoffs as automatic", () => {
    expect(normalizeSuggestedPostingPlatform("Instagram, Facebook")).toBe("INSTAGRAM");
    expect(normalizeSuggestedPostingPlatform("YouTube Shorts")).toBe("YOUTUBE_SHORTS");
    expect(normalizeSuggestedPostingPlatform("WhatsApp Status")).toBeNull();
  });

  it("builds clean copy for a manual publishing handoff", () => {
    expect(normalizeContentHashtags("faith, #hope faith")).toEqual(["#faith", "#hope"]);
    expect(buildContentAssetHandoffText({
      caption: "Choose faith today.",
      hashtags: ["faith", "#hope"],
      callToAction: "Watch the full sermon.",
    })).toBe("Choose faith today.\n\n#faith #hope\n\nWatch the full sermon.");
  });
});
