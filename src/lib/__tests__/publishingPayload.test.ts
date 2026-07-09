import { describe, expect, it } from "vitest";

import { buildCanonicalPlatformPayloads } from "@/lib/publishingPayload";

describe("canonical publishing payloads", () => {
  it("builds differentiated platform payloads from the approved clip copy", () => {
    const payloads = buildCanonicalPlatformPayloads({
      title: "Jesus Meets Us In The Storm",
      hook: "You are not alone in the storm.",
      caption: "God is near when life feels loud.",
      hashtags: ["Faith", "#Hope"],
      intendedAudience: "Young adults",
    });

    expect(payloads.TikTok).toMatchObject({
      platform: "TikTok",
      title: "Jesus Meets Us In The Storm",
      hashtags: ["#Faith", "#Hope"],
      primaryCopyLabel: "Caption",
    });
    expect(payloads.TikTok.caption).toBe(
      "You are not alone in the storm.\n\nGod is near when life feels loud.\n\n#Faith #Hope",
    );
    expect(payloads.Instagram.caption).toBe(
      "God is near when life feels loud.\n\nFor young adults.\n\n#Faith #Hope",
    );
    expect(payloads["YouTube Shorts"]).toMatchObject({
      title: "Jesus Meets Us In The Storm",
      caption: "God is near when life feels loud.\n\n#Faith #Hope",
      primaryCopyLabel: "Title",
    });
    expect(payloads.Facebook.caption).toBe(
      "Jesus Meets Us In The Storm\n\nGod is near when life feels loud.\n\nFor young adults.\n\n#Faith #Hope",
    );
    expect(payloads.Facebook.caption).not.toContain("share with someone");
    expect(new Set(Object.values(payloads).map((payload) => payload.caption)).size).toBe(4);
  });

  it("enforces friendly platform limits before copy enters the scheduler", () => {
    const payloads = buildCanonicalPlatformPayloads({
      title: "A".repeat(120),
      hook: "Hook",
      caption: "B".repeat(2300),
      hashtags: [],
    });

    expect(payloads["YouTube Shorts"].title).toHaveLength(80);
    expect(payloads.TikTok.caption.length).toBeLessThanOrEqual(2200);
    expect(payloads.Instagram.caption.length).toBeLessThanOrEqual(2200);
  });

  it("provides honest adaptation guidance without silently adding a generic call to action", () => {
    const payloads = buildCanonicalPlatformPayloads({
      title: "When grief has no easy answer",
      hook: "Faith does not ask us to pretend this does not hurt.",
      caption: "Lament gives sorrow a faithful place to speak.",
      hashtags: ["Lament", "Grief", "Faith", "Church", "Hope", "Prayer"],
    });

    expect(payloads.TikTok.guidance.rationale).toContain("spoken hook");
    expect(payloads.Instagram.guidance.formatChecks).toHaveLength(2);
    expect(payloads["YouTube Shorts"].guidance.callToAction).toContain("Optional:");
    expect(payloads.Facebook.guidance.callToAction).toContain("church's real next step");
    expect(Object.values(payloads).every((payload) => !payload.caption.includes("Watch and share"))).toBe(true);
    expect(payloads.TikTok.constraints).toMatchObject({
      captionMaxCharacters: 2200,
      recommendedHashtags: { min: 3, max: 5 },
      primaryField: "Caption",
    });
  });

  it("keeps hashtag sets focused for each platform", () => {
    const payloads = buildCanonicalPlatformPayloads({
      title: "A faithful reminder",
      hook: "Grace meets us here.",
      caption: "The good news is still good news.",
      hashtags: ["One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"],
    });

    expect(payloads.TikTok.hashtags).toHaveLength(5);
    expect(payloads.Instagram.hashtags).toHaveLength(8);
    expect(payloads["YouTube Shorts"].hashtags).toHaveLength(3);
    expect(payloads.Facebook.hashtags).toHaveLength(3);
  });

  it("does not repeat the hook when the approved caption already opens with it", () => {
    const payloads = buildCanonicalPlatformPayloads({
      title: "God is near",
      hook: "You are not alone.",
      caption: "You are not alone. God is present in this moment.",
      hashtags: [],
    });

    expect(payloads.TikTok.caption.match(/You are not alone\./g)).toHaveLength(1);
  });

  it("honors saved short and conversational copy without overwriting the approved caption", () => {
    const payloads = buildCanonicalPlatformPayloads({
      title: "Choose faith today",
      hook: "Faith moves before certainty.",
      caption: "The full approved post explains the sermon application in context.",
      shortCaption: "Take the next faithful step.",
      platformCaption: "What faithful step can you take today?",
      hashtags: ["Faith"],
    });

    expect(payloads.TikTok.caption).toContain("Take the next faithful step.");
    expect(payloads.Instagram.caption).toContain("What faithful step can you take today?");
    expect(payloads["YouTube Shorts"].caption).toContain("The full approved post explains");
  });
});
