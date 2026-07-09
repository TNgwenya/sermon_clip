import type { PostingPlatform } from "@/lib/postingDrafts";

export type PlatformCopyConstraints = {
  titleMaxCharacters: number;
  captionMaxCharacters: number;
  recommendedHashtags: {
    min: number;
    max: number;
  };
  primaryField: "Title" | "Caption";
};

export type PlatformCopyGuidance = {
  rationale: string;
  callToAction: string;
  formatChecks: string[];
};

export type CanonicalPlatformPayload = {
  platform: PostingPlatform;
  title: string;
  caption: string;
  hashtags: string[];
  primaryCopyLabel: "Title" | "Caption";
  primaryCopyText: string;
  /** A shorter alternative for teams that want a lighter caption at upload time. */
  shortCaption: string;
  /** Human guidance for the final platform review. This never silently changes the approved copy. */
  guidance: PlatformCopyGuidance;
  constraints: PlatformCopyConstraints;
};

export type CanonicalPlatformPayloadMap = Record<PostingPlatform, CanonicalPlatformPayload>;

const PLATFORM_ORDER: PostingPlatform[] = ["TikTok", "Instagram", "YouTube Shorts", "Facebook"];

function clamp(value: string, maxLength: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function normalizeForComparison(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function joinUniqueParagraphs(parts: Array<string | null | undefined>): string {
  const seen = new Set<string>();

  return parts
    .map((part) => part?.trim() ?? "")
    .filter((part) => {
      if (!part) {
        return false;
      }

      const comparisonKey = normalizeForComparison(part);
      if (!comparisonKey || seen.has(comparisonKey)) {
        return false;
      }

      seen.add(comparisonKey);
      return true;
    })
    .join("\n\n");
}

function openingIsAlreadyPresent(opening: string, body: string): boolean {
  const normalizedOpening = normalizeForComparison(opening);
  const normalizedBody = normalizeForComparison(body);

  if (!normalizedOpening || !normalizedBody) {
    return false;
  }

  return normalizedBody.startsWith(normalizedOpening)
    || normalizedOpening.startsWith(normalizedBody);
}

function buildOpeningLedCopy(opening: string, body: string): string {
  if (!body) {
    return opening;
  }

  if (openingIsAlreadyPresent(opening, body)) {
    return body;
  }

  return joinUniqueParagraphs([opening, body]);
}

function buildShortCaption(value: string, fallback: string, maxLength = 360): string {
  const source = value.trim() || fallback.trim();
  if (!source) {
    return "";
  }

  const firstParagraph = source.split(/\n\s*\n/)[0]?.trim() || source;
  return clamp(firstParagraph, maxLength);
}

function buildCaptionWithinLimit(input: {
  content: string;
  suffixes?: string[];
  maxLength: number;
}): string {
  const suffix = joinUniqueParagraphs(input.suffixes ?? []);
  if (!suffix) {
    return clamp(input.content, input.maxLength);
  }

  const separatorLength = input.content.trim() ? 2 : 0;
  const contentBudget = Math.max(0, input.maxLength - suffix.length - separatorLength);
  const content = clamp(input.content, contentBudget);
  return clamp(joinUniqueParagraphs([content, suffix]), input.maxLength);
}

function selectHashtags(hashtags: string[], max: number): string[] {
  return hashtags.slice(0, max);
}

function buildAudienceLine(value: string | null | undefined): string {
  const audience = value?.trim();
  return audience ? `For ${audience.toLowerCase()}.` : "";
}

export function normalizePublishingHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return Array.from(new Set(value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith("#") ? item : `#${item.replace(/^#+/, "")}`))));
}

export function buildCanonicalPlatformPayloads(input: {
  title: string;
  hook: string;
  caption: string;
  shortCaption?: string | null;
  platformCaption?: string | null;
  hashtags: unknown;
  intendedAudience?: string | null;
}): CanonicalPlatformPayloadMap {
  const title = input.title.trim() || "Sermon clip";
  const caption = input.caption.trim();
  const hook = input.hook.trim() || title;
  const hashtags = normalizePublishingHashtags(input.hashtags);
  const audienceLine = buildAudienceLine(input.intendedAudience);
  const shortCaption = input.shortCaption?.trim() || buildShortCaption(caption, hook);
  const conversationalCaption = input.platformCaption?.trim() || caption || hook;

  const tiktokHashtags = selectHashtags(hashtags, 5);
  const tiktokBody = buildOpeningLedCopy(hook, shortCaption);
  const tiktokCaption = buildCaptionWithinLimit({
    content: tiktokBody,
    suffixes: [tiktokHashtags.join(" ")],
    maxLength: 2_200,
  });

  const instagramHashtags = selectHashtags(hashtags, 8);
  const instagramCaption = buildCaptionWithinLimit({
    content: conversationalCaption,
    suffixes: [audienceLine, instagramHashtags.join(" ")],
    maxLength: 2_200,
  });

  const youtubeHashtags = selectHashtags(hashtags, 3);
  const youtubeTitle = clamp(title, 80);
  const youtubeCaption = buildCaptionWithinLimit({
    content: caption || hook,
    suffixes: [youtubeHashtags.join(" ")],
    maxLength: 5_000,
  });

  const facebookHashtags = selectHashtags(hashtags, 3);
  const facebookBody = joinUniqueParagraphs([title, caption || hook, audienceLine]);
  const facebookCaption = buildCaptionWithinLimit({
    content: facebookBody,
    suffixes: [facebookHashtags.join(" ")],
    maxLength: 63_206,
  });

  return {
    TikTok: {
      platform: "TikTok",
      title: clamp(title, 100),
      caption: tiktokCaption,
      hashtags: tiktokHashtags,
      primaryCopyLabel: "Caption",
      primaryCopyText: tiktokCaption,
      shortCaption: tiktokBody,
      guidance: {
        rationale: "Leads with the spoken hook and keeps the supporting copy brief for a fast, sound-on feed.",
        callToAction: "Optional: ask one specific reflection question only when this sermon moment naturally invites a response.",
        formatChecks: [
          "Keep the opening line easy to scan before the hashtag line.",
          "Use three to five focused hashtags instead of a long generic list.",
        ],
      },
      constraints: {
        titleMaxCharacters: 100,
        captionMaxCharacters: 2_200,
        recommendedHashtags: { min: 3, max: 5 },
        primaryField: "Caption",
      },
    },
    Instagram: {
      platform: "Instagram",
      title: clamp(title, 100),
      caption: instagramCaption,
      hashtags: instagramHashtags,
      primaryCopyLabel: "Caption",
      primaryCopyText: instagramCaption,
      shortCaption,
      guidance: {
        rationale: "Keeps the fuller ministry context and audience cue, with readable spacing for a Reel caption.",
        callToAction: "Optional: invite people to save or share only when the clip offers a clear takeaway worth returning to.",
        formatChecks: [
          "Keep the message in short paragraphs so it remains readable beside the Reel.",
          "Confirm the chosen cover frame also works in the profile grid.",
        ],
      },
      constraints: {
        titleMaxCharacters: 100,
        captionMaxCharacters: 2_200,
        recommendedHashtags: { min: 3, max: 8 },
        primaryField: "Caption",
      },
    },
    "YouTube Shorts": {
      platform: "YouTube Shorts",
      title: youtubeTitle,
      caption: youtubeCaption,
      hashtags: youtubeHashtags,
      primaryCopyLabel: "Title",
      primaryCopyText: youtubeTitle,
      shortCaption,
      guidance: {
        rationale: "Prioritizes a clear title for discovery, while the description supports the message without repeating that title.",
        callToAction: "Optional: add the church's real full-sermon or next-step link; no generic engagement line has been added.",
        formatChecks: [
          "Review the title as the main promise of the Short before publishing.",
          "Keep the description useful and limit hashtags to the most relevant three.",
        ],
      },
      constraints: {
        titleMaxCharacters: 80,
        captionMaxCharacters: 5_000,
        recommendedHashtags: { min: 0, max: 3 },
        primaryField: "Title",
      },
    },
    Facebook: {
      platform: "Facebook",
      title: clamp(title, 255),
      caption: facebookCaption,
      hashtags: facebookHashtags,
      primaryCopyLabel: "Caption",
      primaryCopyText: facebookCaption,
      shortCaption: joinUniqueParagraphs([title, shortCaption]),
      guidance: {
        rationale: "Adds enough written context for a mixed-age community feed and avoids an automatic, generic share request.",
        callToAction: "Optional: add the church's real next step, such as service details, a discussion prompt, or the full-sermon link.",
        formatChecks: [
          "Read the title and first paragraph together to remove any repeated idea.",
          "Use few or no hashtags when the post is primarily for the church community.",
        ],
      },
      constraints: {
        titleMaxCharacters: 255,
        captionMaxCharacters: 63_206,
        recommendedHashtags: { min: 0, max: 3 },
        primaryField: "Caption",
      },
    },
  };
}

export function listCanonicalPlatformPayloads(input: Parameters<typeof buildCanonicalPlatformPayloads>[0]): CanonicalPlatformPayload[] {
  const payloads = buildCanonicalPlatformPayloads(input);
  return PLATFORM_ORDER.map((platform) => payloads[platform]);
}
