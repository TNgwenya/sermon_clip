import { describe, expect, it } from "vitest";

import {
  buildCanonicalPlatformPayloads,
  normalizePublishingHashtags,
} from "@/lib/publishingPayload";

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
      "You are not alone in the storm.\nGod is near when life feels loud.\n\n#Faith #Hope",
    );
    expect(payloads.Instagram.caption).toBe(
      "You are not alone in the storm.\n\nGod is near when life feels loud.\n\n#Faith #Hope",
    );
    expect(payloads["YouTube Shorts"]).toMatchObject({
      title: "Jesus Meets Us In The Storm",
      caption: "God is near when life feels loud.\n\n#Faith #Hope",
      primaryCopyLabel: "Title",
    });
    expect(payloads.Facebook.caption).toContain("God is near when life feels loud.");
    expect(payloads.Facebook.caption).toContain("#Faith");
    expect(payloads.Facebook.caption).not.toContain(payloads.Facebook.title);
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
    expect(payloads.Instagram.hashtags).toHaveLength(5);
    expect(payloads["YouTube Shorts"].hashtags).toHaveLength(3);
    expect(payloads.Facebook.hashtags).toHaveLength(1);
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

  it("does not repeat a short caption that only rephrases the hook", () => {
    const payloads = buildCanonicalPlatformPayloads({
      title: "Faith before certainty",
      hook: "Faith moves before certainty.",
      caption: "Obedience can begin before every answer is visible.",
      shortCaption: "Faith moves before we have certainty.",
      hashtags: ["Faith"],
    });

    expect(payloads.TikTok.caption).toContain("Faith moves before certainty.");
    expect(payloads.TikTok.caption).not.toContain("Faith moves before we have certainty.");
  });

  it("sanitizes hashtags case-insensitively and rejects spam or invalid tags", () => {
    expect(normalizePublishingHashtags([
      "Faith",
      "#faith",
      "#Hope_and_Healing",
      "#HOPE_AND_HEALING",
      "#fyp",
      "viral",
      "#two words",
      "#Prayer!",
      "#",
      "",
    ])).toEqual([
      "#Faith",
      "#Hope_and_Healing",
    ]);
  });

  it("keeps the substantive approved caption in the Instagram adaptation", () => {
    const payloads = buildCanonicalPlatformPayloads({
      title: "Choose the faithful step",
      hook: "Faith moves before certainty.",
      caption: "God has already placed something in your hand. Choose one faithful act of obedience this week.",
      platformCaption: "What faithful step can you take today?",
      hashtags: ["Faith", "Discipleship"],
    });

    expect(payloads.Instagram.caption).toContain(
      "God has already placed something in your hand. Choose one faithful act of obedience this week.",
    );
    expect(payloads.Instagram.caption).toContain("What faithful step can you take today?");
  });

  it("does not repeat the separately supplied Facebook title in its caption", () => {
    const payloads = buildCanonicalPlatformPayloads({
      title: "Grace meets us in the storm",
      hook: "You are not alone in this storm.",
      caption: "God remains present when life feels loud and uncertain.",
      hashtags: ["Faith", "Hope"],
    });

    expect(payloads.Facebook.title).toBe("Grace meets us in the storm");
    expect(payloads.Facebook.caption).not.toContain("Grace meets us in the storm");
    expect(payloads.Facebook.caption).toContain("God remains present when life feels loud and uncertain.");
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
