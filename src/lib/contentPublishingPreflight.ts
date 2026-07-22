import type { PostingPlatform } from "@/lib/postingDrafts";
import {
  deriveTranslationReviewState,
  detectProductionCopyIssues,
  extractQuoteTextFromContent,
  validateScriptureReference,
  verifyQuoteTextAgainstTranscript,
  type TranscriptSegmentEvidence,
  type TranslationReviewInput,
} from "@/lib/contentIntegrity";

export type ContentPublishingPreflightStatus = "READY" | "BLOCKED" | "REVIEW";

export type ContentPublishingPreflightCheck = {
  id: string;
  status: ContentPublishingPreflightStatus;
  summary: string;
};

export type ContentPublishingPreflightResult = {
  canSchedule: boolean;
  canPublishAutomatically: boolean;
  checks: ContentPublishingPreflightCheck[];
};

export type ContentPublishingPreflightFile = {
  fileName?: string;
  mimeType: string;
  publicUrl?: string | null;
  width?: number | null;
  height?: number | null;
  sizeBytes?: number | null;
  overflowDetected?: boolean;
};

export type ContentPublishingPreflightInput = {
  assetType: string;
  status: string;
  platform: PostingPlatform | null;
  caption: string;
  automationMode?: "MANUAL" | "AUTOMATIC";
  metaConnectionReady?: boolean;
  sourceTranscriptExcerpt?: string | null;
  sourceTranscriptSegments?: TranscriptSegmentEvidence[];
  artworkText?: string | null;
  relatedScripture?: string | null;
  translationNeedsReview?: boolean;
  translationReview?: Omit<TranslationReviewInput, "translationNeedsReview">;
  files: ContentPublishingPreflightFile[];
};

const CAPTION_LIMITS: Record<PostingPlatform, number> = {
  TikTok: 2_200,
  Instagram: 2_200,
  "YouTube Shorts": 5_000,
  Facebook: 63_206,
};

const PLATFORM_IMAGE_LIMITS: Partial<Record<PostingPlatform, { maxFiles: number; mimeTypes: string[] }>> = {
  Instagram: { maxFiles: 10, mimeTypes: ["image/jpeg", "image/png"] },
  Facebook: { maxFiles: 10, mimeTypes: ["image/jpeg", "image/png"] },
  TikTok: { maxFiles: 35, mimeTypes: ["image/jpeg", "image/png"] },
};

const MANUAL_HANDOFF_WITHOUT_MEDIA_TYPES = new Set([
  "TEXT_POST",
  "DEVOTIONAL",
  "PRAYER",
  "INVITATION",
  "DISCUSSION",
  "SERMON_RECAP",
  "STORY",
  "GUIDE",
  "EMAIL",
  "NEWSLETTER",
  "BLOG",
  "OTHER",
]);

export function supportsManualContentHandoffWithoutMedia(assetType: string): boolean {
  return MANUAL_HANDOFF_WITHOUT_MEDIA_TYPES.has(assetType);
}

function check(id: string, status: ContentPublishingPreflightStatus, summary: string): ContentPublishingPreflightCheck {
  return { id, status, summary };
}

export function selectContentPublishingFiles<T extends ContentPublishingPreflightFile>(input: {
  assetType: string;
  platform: PostingPlatform | null;
  files: T[];
}): T[] {
  const imageFiles = input.files.filter((file) => file.mimeType.toLowerCase().startsWith("image/"));
  const jpegFiles = imageFiles.filter((file) => ["image/jpeg", "image/jpg"].includes(file.mimeType.toLowerCase()));
  const candidates = jpegFiles.length > 0 ? jpegFiles : imageFiles;
  if (input.assetType === "CAROUSEL") return candidates;

  const preferredNames = input.platform === "Facebook"
    ? ["facebook-landscape", "square", "portrait", "story"]
    : ["portrait", "square", "facebook-landscape", "story"];
  for (const preferredName of preferredNames) {
    const match = candidates.find((file) => file.fileName?.toLowerCase().includes(preferredName));
    if (match) return [match];
  }
  return candidates[0] ? [candidates[0]] : [];
}

export function runContentPublishingPreflight(input: ContentPublishingPreflightInput): ContentPublishingPreflightResult {
  const checks: ContentPublishingPreflightCheck[] = [];
  const lifecycleReady = input.status === "READY" || input.status === "SCHEDULED";
  const automatic = input.automationMode === "AUTOMATIC";
  const supportsManualWithoutMedia = supportsManualContentHandoffWithoutMedia(input.assetType);
  const requiresPreparedMedia = automatic || !supportsManualWithoutMedia;
  const automaticImagePlatform = input.platform === "Instagram" || input.platform === "Facebook";
  const publishingFiles = selectContentPublishingFiles({
    assetType: input.assetType,
    platform: input.platform,
    files: input.files,
  });

  checks.push(lifecycleReady
    ? check("approval", "READY", "Content is approved and prepared.")
    : check("approval", "BLOCKED", "Approve and prepare this content before scheduling it."));

  checks.push(input.platform
    ? check("platform", "READY", `${input.platform} is selected.`)
    : check("platform", "BLOCKED", "Choose a publishing platform."));

  if (input.assetType === "QUOTE_GRAPHIC") {
    const hasTranscriptEvidence = Boolean(
      input.sourceTranscriptExcerpt?.trim()
      || input.sourceTranscriptSegments?.some((segment) => (
        typeof segment === "string" ? segment.trim() : segment.text?.trim()
      )),
    );
    checks.push(hasTranscriptEvidence
      ? check("quote-evidence", "READY", "The pastor quote has transcript evidence.")
      : check("quote-evidence", "BLOCKED", "A pastor quote needs transcript evidence before publishing."));

    if (input.artworkText?.trim()) {
      const quoteIntegrity = verifyQuoteTextAgainstTranscript({
        quoteText: extractQuoteTextFromContent(input.artworkText),
        sourceTranscriptExcerpt: input.sourceTranscriptExcerpt,
        transcriptSegments: input.sourceTranscriptSegments,
      });
      checks.push(quoteIntegrity.verified
        ? check("quote-integrity", "READY", quoteIntegrity.message)
        : check("quote-integrity", "BLOCKED", quoteIntegrity.message));
    }
  }

  if (input.assetType === "SCRIPTURE_GRAPHIC") {
    const scripture = validateScriptureReference(input.relatedScripture);
    if (!scripture.valid) {
      checks.push(check("scripture-reference", "BLOCKED", scripture.errors[0] ?? "Add a valid Bible reference."));
    } else if (scripture.versionStatus === "UNRECOGNIZED") {
      checks.push(check("scripture-reference", "BLOCKED", "Use a recognized Scripture translation/version label."));
    } else if (scripture.versionStatus === "MISSING") {
      checks.push(check("scripture-reference", "BLOCKED", "Choose and confirm the Scripture translation/version used for the verse wording."));
    } else {
      checks.push(check("scripture-reference", "READY", "The Bible reference and translation/version syntax are valid."));
    }
  }

  const translationReview = deriveTranslationReviewState({
    ...input.translationReview,
    translationNeedsReview: input.translationNeedsReview,
  });
  if (translationReview.blocking) {
    checks.push(check("translation", "BLOCKED", translationReview.message));
  } else {
    checks.push(check("translation", "READY", translationReview.message));
  }

  if (input.artworkText !== undefined) {
    const productionCopyIssues = detectProductionCopyIssues({
      artworkText: input.artworkText,
      caption: input.caption,
    });
    checks.push(productionCopyIssues.length > 0
      ? check(
          "production-copy",
          "BLOCKED",
          "Remove internal production instructions or placeholders from the artwork and caption before publishing.",
        )
      : check("production-copy", "READY", "Artwork and caption contain no production placeholders or internal directions."));
  }

  if (requiresPreparedMedia) {
    checks.push(publishingFiles.length > 0
      ? check("media", "READY", `${publishingFiles.length} prepared publishing image${publishingFiles.length === 1 ? " is" : "s are"} attached.`)
      : check("media", "BLOCKED", "Render a platform-ready image before scheduling this content."));
  } else {
    checks.push(check(
      "manual-handoff",
      "READY",
      "Approved document or text content can be scheduled as a manual media-team handoff without a rendered social image.",
    ));
  }

  if (automatic) {
    checks.push(automaticImagePlatform
      ? check("automatic-platform", "READY", `${input.platform} supports automatic image publishing.`)
      : check("automatic-platform", "BLOCKED", "Automatic non-video publishing is currently available for Facebook and Instagram images."));
    if (input.assetType === "STORY") {
      checks.push(check("automatic-format", "BLOCKED", "Story sets stay manual so your team can add native stickers and interactions."));
    }
    checks.push(input.metaConnectionReady
      ? check("meta-connection", "READY", `A connected ${input.platform ?? "Meta"} publishing credential is ready.`)
      : check("meta-connection", "BLOCKED", `Connect the ${input.platform ?? "Meta"} account with publishing permission before using automatic mode.`));

    const publicPublishingFiles = publishingFiles.filter((file) => /^https:\/\//i.test(file.publicUrl?.trim() ?? ""));
    checks.push(publishingFiles.length > 0 && publicPublishingFiles.length === publishingFiles.length
      ? check("public-media", "READY", "Every publishing image has an HTTPS public URL that Meta can fetch.")
      : check("public-media", "BLOCKED", "Upload every publishing image to HTTPS public storage before automatic publishing."));

    if (input.platform === "Instagram") {
      checks.push(publishingFiles.every((file) => ["image/jpeg", "image/jpg"].includes(file.mimeType.toLowerCase()))
        ? check("instagram-image-format", "READY", "Instagram JPEG publishing media is ready.")
        : check("instagram-image-format", "BLOCKED", "Render JPEG publishing media before automatic Instagram posting."));
    }

    if (input.assetType === "CAROUSEL") {
      checks.push(publishingFiles.length >= 2 && publishingFiles.length <= 10
        ? check("carousel-count", "READY", `${publishingFiles.length} ordered carousel slides are ready.`)
        : check("carousel-count", "BLOCKED", "A Meta carousel needs between 2 and 10 publishing slides."));
    }
  }

  if (input.files.some((file) => file.overflowDetected)) {
    checks.push(check("overflow", "BLOCKED", "One or more graphics have text-overflow warnings."));
  } else if (input.files.length > 0) {
    checks.push(check("overflow", "READY", "Prepared graphics passed text-fit checks."));
  }

  if (input.platform) {
    const captionLimit = CAPTION_LIMITS[input.platform];
    checks.push(input.caption.length <= captionLimit
      ? check("caption", "READY", `Caption fits the ${input.platform} limit.`)
      : check("caption", "BLOCKED", `Shorten the caption to ${captionLimit.toLocaleString()} characters or fewer.`));

    const mediaRules = PLATFORM_IMAGE_LIMITS[input.platform];
    if (mediaRules && publishingFiles.length > 0) {
      const unsupported = publishingFiles.some((file) => !mediaRules.mimeTypes.includes(file.mimeType));
      checks.push(unsupported
        ? check("format", "BLOCKED", `${input.platform} requires prepared PNG or JPEG images.`)
        : publishingFiles.length > mediaRules.maxFiles
          ? check("format", "BLOCKED", `${input.platform} supports at most ${mediaRules.maxFiles} images in this workflow.`)
          : check("format", "READY", "Media count and file formats fit the selected platform."));
    }
  }

  const canSchedule = checks.every((item) => item.status !== "BLOCKED");
  return {
    canSchedule,
    canPublishAutomatically: automatic
      && canSchedule
      && Boolean(automaticImagePlatform)
      && publishingFiles.length > 0,
    checks,
  };
}
