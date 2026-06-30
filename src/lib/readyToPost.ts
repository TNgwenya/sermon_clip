export type PlatformCaptionVariant = {
  platform: "TikTok" | "Instagram" | "YouTube Shorts" | "Facebook";
  label: string;
  text: string;
};

export type PostingPlatform = PlatformCaptionVariant["platform"];

export type PlatformUploadHandoff = {
  platform: PostingPlatform;
  uploadUrl: string;
  titleText: string;
  captionText: string;
  primaryCopyLabel: string;
  primaryCopyText: string;
  checklistText: string;
};

export type ReadyToPostPackage = {
  previewHref: string;
  downloadHref: string;
  badges: string[];
  hashtags: string[];
  platformCount: number;
  captionFileCount: number;
  contentsLabel: string;
  sizeLabel: string | null;
  variants: PlatformCaptionVariant[];
  handoffs: PlatformUploadHandoff[];
};

export type ReadyQueueStatus = {
  readyCount: number;
  preparingCount: number;
  approvedWaitingCount: number;
  liveRefreshEnabled: boolean;
  headline: string;
  description: string;
};

const TECHNICAL_QUALITY_TEXT_PATTERN = /\b(ZodError|Invalid option|expected one of|reviews\.\d+|qualityWarnings\.\d+|AI review fallback used:|JSON|schema|validation error)\b/i;
const PLATFORM_UPLOAD_URLS: Record<PostingPlatform, string> = {
  TikTok: "https://www.tiktok.com/upload",
  Instagram: "https://www.instagram.com/",
  "YouTube Shorts": "https://studio.youtube.com/",
  Facebook: "https://www.facebook.com/",
};

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized = value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => (item.startsWith("#") ? item : `#${item.replace(/^#+/, "")}`));

  return Array.from(new Set(normalized));
}

export function sanitizePastorFacingQualityText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  if (!TECHNICAL_QUALITY_TEXT_PATTERN.test(trimmed)) {
    return trimmed;
  }

  const firstSentence = trimmed.split(/(?<=[.!?])\s+/)[0]?.trim();
  if (firstSentence && !TECHNICAL_QUALITY_TEXT_PATTERN.test(firstSentence)) {
    return firstSentence;
  }

  return "This clip passed the backup quality review. Please do a quick pastor review before publishing.";
}

export function formatRecommendedNextAction(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }

  const labels: Record<string, string> = {
    POST_NOW: "Ready to post",
    REVIEW_CLIP: "Pastor review",
    REVIEW_OPENING: "Review the opening",
    FIX_CROP: "Check the crop",
    RERENDER: "Render again",
    TRIM_CLIP: "Consider trimming",
    EXTEND_CONTEXT: "Consider adding context",
    FIX_CAPTIONS: "Fix captions",
    KEEP: "Keep as is",
    EXTEND: "Consider extending",
    SHORTEN: "Consider shortening",
    MERGE: "Consider merging with context",
    REJECT: "Do not post yet",
    NEEDS_REVIEW: "Review before posting",
  };

  return labels[trimmed] ?? sanitizePastorFacingQualityText(trimmed.replace(/_/g, " "));
}

export function buildReadyQueueStatus(input: {
  readyCount: number;
  preparingCount: number;
  approvedWaitingCount: number;
}): ReadyQueueStatus {
  if (input.readyCount > 0) {
    return {
      ...input,
      liveRefreshEnabled: input.preparingCount > 0,
      headline: `${input.readyCount} clip${input.readyCount === 1 ? "" : "s"} prepared for posting`,
      description: input.preparingCount > 0
        ? `${input.preparingCount} more clip${input.preparingCount === 1 ? " is" : "s are"} still being prepared.`
        : "Schedule posts or copy captions from finished clips.",
    };
  }

  if (input.preparingCount > 0) {
    return {
      ...input,
      liveRefreshEnabled: true,
      headline: `${input.preparingCount} clip${input.preparingCount === 1 ? " is" : "s are"} being prepared`,
      description: "Sermon Clip is creating the videos, captions, branding, and downloads. This page will keep checking for finished clips.",
    };
  }

  if (input.approvedWaitingCount > 0) {
    return {
      ...input,
      liveRefreshEnabled: false,
      headline: `${input.approvedWaitingCount} approved clip${input.approvedWaitingCount === 1 ? "" : "s"} waiting`,
      description: "Open the Pastor Review Feed and choose Prepare approved clips to create posting downloads.",
    };
  }

  return {
    ...input,
    liveRefreshEnabled: false,
    headline: "No finished clips yet",
    description: "Approve sermon clips, then use Prepare approved clips from the review feed.",
  };
}

export function buildPlatformCaptionVariants(input: {
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  intendedAudience?: string | null;
}): PlatformCaptionVariant[] {
  const hashtags = input.hashtags.join(" ");
  const baseCaption = `${input.caption}${hashtags ? `\n\n${hashtags}` : ""}`;
  const audience = input.intendedAudience ? ` For ${input.intendedAudience.toLowerCase()}.` : "";
  const hook = input.hook.trim() || input.title;

  return [
    {
      platform: "TikTok",
      label: "TikTok caption",
      text: `${hook}\n\n${baseCaption}`,
    },
    {
      platform: "Instagram",
      label: "Instagram caption",
      text: `${baseCaption}${audience}`,
    },
    {
      platform: "YouTube Shorts",
      label: "YouTube Shorts title",
      text: input.title.length > 80 ? `${input.title.slice(0, 77)}...` : input.title,
    },
    {
      platform: "Facebook",
      label: "Facebook caption",
      text: `${input.caption}\n\nWatch and share with someone who needs encouragement today.${hashtags ? `\n\n${hashtags}` : ""}`,
    },
  ];
}

function buildBaseCaption(input: {
  caption: string;
  hashtags: string[];
}): string {
  const hashtags = input.hashtags.join(" ");
  return `${input.caption}${hashtags ? `\n\n${hashtags}` : ""}`;
}

export function buildPlatformUploadHandoffs(input: {
  title: string;
  hook: string;
  caption: string;
  hashtags: string[];
  intendedAudience?: string | null;
}): PlatformUploadHandoff[] {
  const variants = buildPlatformCaptionVariants(input);
  const baseCaption = buildBaseCaption(input);

  return variants.map((variant) => {
    const isYouTube = variant.platform === "YouTube Shorts";
    const titleText = isYouTube ? variant.text : input.title;
    const captionText = isYouTube ? baseCaption : variant.text;
    const primaryCopyLabel = isYouTube ? "Copy title" : "Copy caption";
    const primaryCopyText = isYouTube ? titleText : captionText;
    const checklistText = [
      `${variant.platform} upload handoff`,
      "",
      `Upload URL: ${PLATFORM_UPLOAD_URLS[variant.platform]}`,
      `Video: download the prepared clip from this package.`,
      "",
      `Title: ${titleText}`,
      "",
      `Caption:`,
      captionText || "Caption pending.",
      "",
      "Checklist:",
      "1. Download the prepared video file.",
      `2. Open ${variant.platform}.`,
      `3. Upload the video.`,
      `4. Paste the ${isYouTube ? "title and caption" : "caption"}.`,
      "5. Confirm thumbnail, cover frame, crop, captions, and audio.",
      "6. Mark the post as posted in Sermon Clip.",
    ].join("\n");

    return {
      platform: variant.platform,
      uploadUrl: PLATFORM_UPLOAD_URLS[variant.platform],
      titleText,
      captionText,
      primaryCopyLabel,
      primaryCopyText,
      checklistText,
    };
  });
}

export function formatPackageSize(bytes: number | null | undefined): string | null {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return null;
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

export function buildReadyToPostPackage(input: {
  clipId: string;
  title: string;
  hook: string;
  caption: string;
  hashtags: unknown;
  estimatedBytes?: number | null;
  smartClipCategory?: string | null;
  intendedAudience?: string | null;
}): ReadyToPostPackage {
  const hashtags = normalizeStringArray(input.hashtags);
  const platformBadges = ["TikTok", "Instagram", "YouTube Shorts", "Facebook"];
  const ministryBadges = [
    input.smartClipCategory?.trim(),
    input.intendedAudience?.trim(),
  ].filter((item): item is string => Boolean(item));
  const variants = buildPlatformCaptionVariants({
    title: input.title,
    hook: input.hook,
    caption: input.caption,
    hashtags,
    intendedAudience: input.intendedAudience,
  });
  const handoffs = buildPlatformUploadHandoffs({
    title: input.title,
    hook: input.hook,
    caption: input.caption,
    hashtags,
    intendedAudience: input.intendedAudience,
  });
  const captionFileCount = variants.length + 1;

  return {
    previewHref: `/api/clips/${input.clipId}/preview?variant=best`,
    downloadHref: `/api/clips/${input.clipId}/download?variant=best`,
    badges: ["Posting package", ...platformBadges, ...ministryBadges],
    hashtags,
    platformCount: platformBadges.length,
    captionFileCount,
    contentsLabel: `Video + ${captionFileCount} caption files`,
    sizeLabel: formatPackageSize(input.estimatedBytes),
    variants,
    handoffs,
  };
}
