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
const LOW_VALUE_HASHTAGS = new Set([
  "fyp",
  "foryou",
  "foryoupage",
  "viral",
  "trending",
  "explorepage",
]);
const BROAD_HASHTAGS = new Set([
  "christian",
  "church",
  "faith",
  "hope",
  "preaching",
  "sermon",
  "sermonclip",
]);

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

function comparisonTokens(value: string): string[] {
  return normalizeForComparison(value)
    .split(" ")
    .filter((token) => token.length > 1);
}

function copyIsNearDuplicate(left: string, right: string): boolean {
  const leftTokens = new Set(comparisonTokens(left));
  const rightTokens = new Set(comparisonTokens(right));
  if (leftTokens.size === 0 || rightTokens.size === 0) {
    return false;
  }

  const overlap = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  const containment = overlap / Math.min(leftTokens.size, rightTokens.size);
  const union = new Set([...leftTokens, ...rightTokens]).size;
  const similarity = union > 0 ? overlap / union : 0;
  return containment >= 0.72 || similarity >= 0.68;
}

function joinUniqueParagraphs(parts: Array<string | null | undefined>): string {
  const accepted: Array<{ key: string; value: string }> = [];

  for (const part of parts) {
    const value = part?.trim() ?? "";
    const key = normalizeForComparison(value);
    if (
      !key
      || accepted.some((existing) => (
        existing.key === key || copyIsNearDuplicate(existing.key, key)
      ))
    ) {
      continue;
    }

    accepted.push({ key, value });
  }

  return accepted.map(({ value }) => value).join("\n\n");
}

function openingIsAlreadyPresent(opening: string, body: string): boolean {
  const normalizedOpening = normalizeForComparison(opening);
  const normalizedBody = normalizeForComparison(body);
  if (!normalizedOpening || !normalizedBody) {
    return false;
  }

  return normalizedBody.startsWith(normalizedOpening)
    || normalizedOpening.startsWith(normalizedBody)
    || copyIsNearDuplicate(normalizedOpening, normalizedBody);
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

function hashtagKey(value: string): string {
  return value.replace(/^#/, "").toLocaleLowerCase();
}

function rankHashtags(hashtags: string[], context: string, max: number): string[] {
  const normalizedContext = normalizeForComparison(context).replace(/\s+/g, "");
  return hashtags
    .map((hashtag, index) => {
      const key = hashtagKey(hashtag).replace(/_/g, "");
      const mentioned = key.length >= 4 && normalizedContext.includes(key);
      return {
        hashtag,
        index,
        score: (mentioned ? 3 : 0) + (BROAD_HASHTAGS.has(key) ? -1 : 0),
      };
    })
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, max)
    .map(({ hashtag }) => hashtag);
}

function hashtagsNotAlreadyInCopy(content: string, hashtags: string[]): string[] {
  const existing = new Set(
    (content.match(/#[\p{L}\p{N}_]+/gu) ?? []).map((hashtag) => hashtagKey(hashtag)),
  );
  return hashtags.filter((hashtag) => !existing.has(hashtagKey(hashtag)));
}

function cleanSocialCopy(value: string): string {
  const paragraphs = value
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/g)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph && !/^(?:#[\p{L}\p{N}_]+\s*)+$/u.test(paragraph))
    .map((paragraph) => {
      const sentences = paragraph.match(/[^.!?]+[.!?]+(?:[”"']+)?|[^.!?]+$/g) ?? [paragraph];
      return sentences
        .map((sentence) => sentence.trim())
        .filter((sentence) => !/^(?:in\s+)?(?:this|the)\s+(?:clip|sermon moment)\b/i.test(sentence))
        .filter((sentence) => !/^the\s+(?:speaker|pastor|preacher)\b/i.test(sentence))
        .map((sentence) => sentence.replace(/^it is (a|an)\s+/i, (_match, article: string) => `${article[0].toUpperCase()}${article.slice(1)} `))
        .join(" ")
        .trim();
    })
    .filter(Boolean);

  return joinUniqueParagraphs(paragraphs);
}

function firstSentence(value: string): string {
  return value.match(/^.*?[.!?](?:[”"']+)?(?=\s|$)/)?.[0]?.trim() || value.trim();
}

function looksLikeResponsePrompt(value: string): boolean {
  const normalized = value.trim();
  return normalized.endsWith("?")
    || /^(?:what|how|where|when|who|which|will|can|do|are|would|take|share|save|join|pray|reflect|tell)\b/i.test(normalized);
}

export function normalizePublishingHashtags(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const hashtags: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      continue;
    }

    const token = item.trim().replace(/^#+/, "");
    if (!token || !/^[\p{L}\p{N}_]+$/u.test(token)) {
      continue;
    }

    const key = token.toLocaleLowerCase();
    if (LOW_VALUE_HASHTAGS.has(key) || seen.has(key)) {
      continue;
    }

    seen.add(key);
    hashtags.push(`#${token}`);
  }

  return hashtags;
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
  const caption = cleanSocialCopy(input.caption);
  const hook = input.hook.trim() || title;
  const rawShortCaption = cleanSocialCopy(input.shortCaption?.trim() || buildShortCaption(caption, hook));
  const conversationalCaption = cleanSocialCopy(input.platformCaption?.trim() || "");
  const responsePrompt = looksLikeResponsePrompt(conversationalCaption) ? conversationalCaption : "";
  const platformContext = [title, hook, caption, conversationalCaption, input.intendedAudience]
    .filter(Boolean)
    .join(" ");
  const hashtags = normalizePublishingHashtags(input.hashtags);

  const tiktokHashtags = rankHashtags(hashtags, platformContext, 5);
  const distinctShortCaption = openingIsAlreadyPresent(hook, rawShortCaption) ? "" : rawShortCaption;
  const fallbackTakeaway = firstSentence(conversationalCaption || caption);
  const tiktokBody = joinUniqueParagraphs([
    hook,
    distinctShortCaption || (!openingIsAlreadyPresent(hook, fallbackTakeaway) ? fallbackTakeaway : ""),
    responsePrompt,
  ]).replace(/\n\n/g, "\n");
  const tiktokCaption = buildCaptionWithinLimit({
    content: tiktokBody,
    suffixes: [hashtagsNotAlreadyInCopy(tiktokBody, tiktokHashtags).join(" ")],
    maxLength: 2_200,
  });

  const instagramHashtags = rankHashtags(hashtags, platformContext, 5);
  const instagramSubstance = responsePrompt ? caption || hook : conversationalCaption || caption || hook;
  const instagramBody = joinUniqueParagraphs([hook, instagramSubstance, responsePrompt]);
  const instagramCaption = buildCaptionWithinLimit({
    content: instagramBody,
    suffixes: [hashtagsNotAlreadyInCopy(instagramBody, instagramHashtags).join(" ")],
    maxLength: 2_200,
  });

  const youtubeHashtags = rankHashtags(hashtags, platformContext, 3);
  const youtubeTitle = clamp(title, 80);
  const youtubeBody = joinUniqueParagraphs([
    responsePrompt ? "" : conversationalCaption,
    caption || hook,
    responsePrompt,
  ]);
  const youtubeCaption = buildCaptionWithinLimit({
    content: youtubeBody,
    suffixes: [hashtagsNotAlreadyInCopy(youtubeBody, youtubeHashtags).join(" ")],
    maxLength: 5_000,
  });

  const facebookHashtags = rankHashtags(hashtags, platformContext, 1);
  const facebookBody = joinUniqueParagraphs([
    responsePrompt ? "" : conversationalCaption,
    caption || hook,
    responsePrompt,
  ]);
  const facebookCaption = buildCaptionWithinLimit({
    content: facebookBody,
    suffixes: [hashtagsNotAlreadyInCopy(facebookBody, facebookHashtags).join(" ")],
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
        rationale: "Leads with the spoken hook, one clear takeaway, and a focused hashtag set for a fast, sound-on feed.",
        callToAction: "Optional: ask one specific reflection question only when this sermon moment naturally invites a response.",
        formatChecks: [
          "Keep the opening line easy to scan before the hashtag line.",
          "Use three to five sermon-specific hashtags instead of generic reach bait.",
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
      shortCaption: rawShortCaption,
      guidance: {
        rationale: "Opens with the hook, keeps the approved ministry substance, and uses a natural response prompt only when one was supplied.",
        callToAction: "Optional: invite people to save or share only when the clip offers a clear takeaway worth returning to.",
        formatChecks: [
          "Keep the message in short paragraphs so it remains readable beside the Reel.",
          "Use two to five focused hashtags and confirm the cover frame works in the profile grid.",
        ],
      },
      constraints: {
        titleMaxCharacters: 100,
        captionMaxCharacters: 2_200,
        recommendedHashtags: { min: 2, max: 5 },
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
      shortCaption: rawShortCaption,
      guidance: {
        rationale: "Prioritizes a clear, specific title for discovery and a non-repeating description grounded in the sermon moment.",
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
      shortCaption: rawShortCaption || firstSentence(facebookBody),
      guidance: {
        rationale: "Keeps enough written context for a church community feed without repeating the separately supplied title.",
        callToAction: "Optional: add the church's real next step, such as service details, a discussion prompt, or the full-sermon link.",
        formatChecks: [
          "Read the title and first paragraph together to remove any repeated idea.",
          "Use no more than two hashtags when the post is primarily for the church community.",
        ],
      },
      constraints: {
        titleMaxCharacters: 255,
        captionMaxCharacters: 63_206,
        recommendedHashtags: { min: 0, max: 2 },
        primaryField: "Caption",
      },
    },
  };
}

export function listCanonicalPlatformPayloads(input: Parameters<typeof buildCanonicalPlatformPayloads>[0]): CanonicalPlatformPayload[] {
  const payloads = buildCanonicalPlatformPayloads(input);
  return PLATFORM_ORDER.map((platform) => payloads[platform]);
}
