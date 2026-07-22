import { describe, expect, it } from "vitest";

import {
  buildContentAssetHandoffText,
  isVideoClipOpportunityType,
  mapOpportunityTypeToContentAssetType,
  normalizeContentHashtags,
  normalizeSuggestedPostingPlatform,
  resolveVideoClipOpportunityWorkflow,
  VIDEO_CLIP_OPPORTUNITY_TYPES,
} from "@/lib/contentPublishing";

describe("content publishing helpers", () => {
  it("maps generated opportunity types into operational content assets", () => {
    expect(mapOpportunityTypeToContentAssetType("QUOTE_GRAPHIC")).toBe("QUOTE_GRAPHIC");
    expect(mapOpportunityTypeToContentAssetType("CAROUSEL_IDEA")).toBe("CAROUSEL");
    expect(mapOpportunityTypeToContentAssetType("PRAYER_GUIDE")).toBe("PRAYER");
    expect(mapOpportunityTypeToContentAssetType("CAPTION")).toBe("TEXT_POST");
  });

  it("never classifies a video clip brief as a text post", () => {
    for (const opportunityType of VIDEO_CLIP_OPPORTUNITY_TYPES) {
      expect(isVideoClipOpportunityType(opportunityType)).toBe(true);
      expect(mapOpportunityTypeToContentAssetType(opportunityType)).toBe("OTHER");
    }
    expect(isVideoClipOpportunityType("CAPTION")).toBe(false);
  });

  it("blocks an unlinked video brief and sends the user to sermon clip discovery", () => {
    expect(resolveVideoClipOpportunityWorkflow({
      sermonId: "sermon/1",
      opportunityType: "REEL_HOOK",
      relatedClip: null,
    })).toEqual(expect.objectContaining({
      state: "NEEDS_CLIP",
      href: "/sermons/sermon%2F1#up-next",
      actionLabel: "Find or create a sermon clip",
    }));
  });

  it("routes linked candidates through review, Studio, and Ready to Post by real clip state", () => {
    const clip = {
      id: "clip-1",
      sermonId: "sermon-1",
      title: "Faith in the waiting",
      startTimeSeconds: 42,
      endTimeSeconds: 73,
      transcriptSafetyStatus: "TRUSTED" as const,
    };

    expect(resolveVideoClipOpportunityWorkflow({
      sermonId: "sermon-1",
      opportunityType: "SHORT_FORM_CLIP_IDEA",
      relatedClip: { ...clip, status: "SUGGESTED" },
    })).toEqual(expect.objectContaining({
      state: "REVIEW_CLIP",
      href: "/sermons/sermon-1/review#clip-clip-1",
    }));
    expect(resolveVideoClipOpportunityWorkflow({
      sermonId: "sermon-1",
      opportunityType: "YOUTUBE_SHORTS_IDEA",
      relatedClip: { ...clip, status: "APPROVED" },
    })).toEqual(expect.objectContaining({
      state: "EDIT_CLIP",
      href: "/sermons/sermon-1/clips/clip-1/studio",
    }));
    expect(resolveVideoClipOpportunityWorkflow({
      sermonId: "sermon-1",
      opportunityType: "TIKTOK_IDEA",
      relatedClip: { ...clip, status: "EXPORTED" },
    })).toEqual(expect.objectContaining({
      state: "READY_CLIP",
      href: "/ready-to-post?sermonId=sermon-1&clipId=clip-1",
    }));
  });

  it("keeps unsafe or invalid linked clips in pastor review", () => {
    expect(resolveVideoClipOpportunityWorkflow({
      sermonId: "sermon-1",
      opportunityType: "REEL_HOOK",
      relatedClip: {
        id: "clip-unsafe",
        sermonId: "sermon-1",
        title: "Unverified words",
        status: "APPROVED",
        startTimeSeconds: 20,
        endTimeSeconds: 10,
        transcriptSafetyStatus: "REVIEW_REQUIRED",
      },
    })).toEqual(expect.objectContaining({
      state: "REVIEW_CLIP",
      href: "/sermons/sermon-1/review#clip-clip-unsafe",
    }));
  });

  it("does not route a video idea into a clip from another sermon", () => {
    expect(resolveVideoClipOpportunityWorkflow({
      sermonId: "sermon-1",
      opportunityType: "TIKTOK_IDEA",
      relatedClip: {
        id: "clip-other",
        sermonId: "sermon-2",
        title: "Another message",
        status: "EXPORTED",
        startTimeSeconds: 10,
        endTimeSeconds: 30,
        transcriptSafetyStatus: "TRUSTED",
      },
    })).toEqual(expect.objectContaining({
      state: "NEEDS_CLIP",
      href: "/sermons/sermon-1#up-next",
    }));
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
