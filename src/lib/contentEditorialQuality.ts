import {
  detectProductionCopyIssues,
  normalizeIntegrityText,
  validateScriptureReference,
  verifyQuoteTextAgainstTranscript,
} from "@/lib/contentIntegrity";
import type {
  ContentOpportunityContract,
  SourceEvidence,
} from "@/lib/contentOpportunityContracts";

export const CONTENT_EDITORIAL_SCORING_VERSION = 1 as const;

export const EDITORIAL_DIMENSIONS = [
  "SERMON_SPECIFICITY",
  "AUDIENCE_PLATFORM_FIT",
  "HOOK_CLARITY",
  "CTA_USEFULNESS",
  "COMPLETENESS",
  "REPETITION",
  "PRODUCTION_SAFETY",
] as const;

export type EditorialDimension = (typeof EDITORIAL_DIMENSIONS)[number];

export const EDITORIAL_DIMENSION_WEIGHTS = {
  SERMON_SPECIFICITY: 22,
  AUDIENCE_PLATFORM_FIT: 15,
  HOOK_CLARITY: 15,
  CTA_USEFULNESS: 10,
  COMPLETENESS: 15,
  REPETITION: 10,
  PRODUCTION_SAFETY: 13,
} as const satisfies Record<EditorialDimension, number>;

export const EDITORIAL_QUALITY_THRESHOLDS = {
  readyForApproval: 88,
  highPriorityReview: 72,
  repetitiveSimilarity: 0.62,
  repetitiveOpeningWords: 5,
} as const;

export type EditorialFindingSeverity = "BLOCKER" | "MAJOR" | "MINOR";

export type EditorialFinding = {
  code: string;
  dimension: EditorialDimension;
  severity: EditorialFindingSeverity;
  deduction: number;
  message: string;
  repairInstruction: string;
};

export type EditorialDimensionResult = {
  score: number;
  band: "STRONG" | "ACCEPTABLE" | "WEAK" | "BLOCKED";
  reasons: string[];
  findingCodes: string[];
};

export type PublishReviewPriority =
  | "PUBLISH_BLOCKED"
  | "HIGH"
  | "STANDARD"
  | "READY";

export type PublishRecommendation = "BLOCK" | "REVIEW" | "READY_FOR_APPROVAL";

export const GUIDED_CONTENT_VARIANTS = [
  "SHORTER",
  "WARMER",
  "MORE_PRACTICAL",
  "YOUTH",
  "LEADERSHIP",
] as const;

export type GuidedContentVariant = (typeof GUIDED_CONTENT_VARIANTS)[number];

export type BrandingVoiceMetadata = {
  churchName?: string | null;
  primaryBrandColor?: string | null;
  secondaryBrandColor?: string | null;
  defaultFontFamily?: string | null;
  defaultCaptionStyleName?: string | null;
};

export type SermonVoiceMetadata = {
  title?: string | null;
  speakerName?: string | null;
  churchName?: string | null;
  language?: string | null;
  sermonDate?: Date | string | null;
  intelligence?: {
    isManuallyReviewed?: boolean | null;
    manualTitle?: string | null;
    manualSummary?: string | null;
    manualCentralTheme?: string | null;
  } | null;
  topicTags?: readonly {
    topic: string;
    evidence?: string | null;
    isManuallyAdded?: boolean | null;
  }[];
  scriptureRefs?: readonly {
    reference: string;
    transcriptEvidence?: string | null;
    isManuallyAdded?: boolean | null;
  }[];
  ministryMoments?: readonly {
    title: string;
    description?: string | null;
    transcriptExcerpt?: string | null;
    suggestedAudience?: string | null;
    reviewStatus?: string | null;
  }[];
};

export type MinistryVoiceAnchor = {
  kind: "REVIEWED_THEME" | "TOPIC" | "SCRIPTURE" | "MINISTRY_MOMENT" | "AUDIENCE";
  value: string;
  evidence: string | null;
  source: "MANUAL_REVIEW" | "MANUAL_METADATA" | "GROUNDED_METADATA";
};

export type MinistryVoiceProfile = {
  profileVersion: 1;
  provenance: "MINISTRY_METADATA_ONLY";
  identity: {
    churchName: string | null;
    speakerName: string | null;
    sermonTitle: string | null;
    sermonDate: string | null;
    language: string | null;
  };
  presentation: {
    primaryBrandColor: string | null;
    secondaryBrandColor: string | null;
    defaultFontFamily: string | null;
    defaultCaptionStyleName: string | null;
  };
  anchors: MinistryVoiceAnchor[];
  safePersonalizationTerms: string[];
  generationGuardrails: string[];
  omittedUnreviewedMetadata: string[];
};

export type ContentRepetitionFingerprint = {
  hook: string;
  normalizedHook: string;
  opening: string;
  distinctiveTokens: string[];
  unitOpenings: string[];
};

export type AcceptedEditorialItem = {
  id: string;
  contract: ContentOpportunityContract;
};

export type RepetitionMatch = {
  acceptedId: string;
  kind: "EXACT_HOOK" | "SAME_OPENING" | "SIMILAR_HOOK";
  similarity: number;
  candidateHook: string;
  acceptedHook: string;
};

export type BatchRepetitionComparison = {
  candidate: ContentRepetitionFingerprint;
  matches: RepetitionMatch[];
  highestSimilarity: number;
};

export type EditorialQualityAssessment = {
  scoringVersion: 1;
  deterministic: true;
  family: ContentOpportunityContract["family"];
  overallScore: number;
  dimensions: Record<EditorialDimension, EditorialDimensionResult>;
  publishReviewPriority: PublishReviewPriority;
  publishRecommendation: PublishRecommendation;
  findings: EditorialFinding[];
  blockers: EditorialFinding[];
  critique: string[];
  repairInstructions: string[];
  repetition: BatchRepetitionComparison;
  voiceProfileApplied: boolean;
};

type AssessmentInput = {
  contract: ContentOpportunityContract;
  voiceProfile?: MinistryVoiceProfile | null;
  acceptedBatch?: readonly AcceptedEditorialItem[];
};

const PASS_REASON: Record<EditorialDimension, string> = {
  SERMON_SPECIFICITY: "The draft has traceable sermon or Scripture grounding.",
  AUDIENCE_PLATFORM_FIT: "The format and publishing copy fit the selected channels.",
  HOOK_CLARITY: "The opening is concise, readable, and specific enough to review.",
  CTA_USEFULNESS: "The next step is clear and usable.",
  COMPLETENESS: "The content family includes its expected editorial and production parts.",
  REPETITION: "No material repetition was found inside the draft or accepted batch.",
  PRODUCTION_SAFETY: "No publishing blocker, placeholder, or unverified claim was detected.",
};

const SEVERITY_ORDER: Record<EditorialFindingSeverity, number> = {
  BLOCKER: 0,
  MAJOR: 1,
  MINOR: 2,
};

const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "because", "been", "before", "being",
  "between", "but", "can", "could", "does", "every", "for", "from", "have", "into",
  "just", "more", "most", "not", "our", "that", "the", "their", "there", "these",
  "they", "this", "through", "today", "very", "was", "were", "what", "when", "where",
  "which", "while", "who", "why", "will", "with", "would", "you", "your",
]);

const GENERIC_HOOK_PATTERNS = [
  /\b(?:stop scrolling|you need to hear this)\b/iu,
  /\bthis (?:message|sermon|word) will change your life\b/iu,
  /\bwait (?:for it|until the end)\b/iu,
  /\bthe truth (?:is|about)\b/iu,
  /\bhere(?:'|’)s what you need to know\b/iu,
];

const GENERIC_CHURCH_NAMES = new Set([
  "church name",
  "local church",
  "my church",
  "our church",
  "your church",
]);

const CTA_VERBS: Record<ContentOpportunityContract["publishingCopy"]["callToAction"] extends infer T
  ? T extends { type: infer K }
    ? K & string
    : never
  : never, readonly string[]> = {
  COMMENT: ["comment", "reply", "tell", "share"],
  SHARE: ["share", "send", "forward"],
  SAVE: ["save", "bookmark", "keep"],
  PRAY: ["pray", "pause", "ask"],
  ATTEND: ["attend", "join", "come", "visit"],
  VISIT_LINK: ["visit", "click", "open", "follow"],
  WATCH: ["watch", "listen", "view"],
  CUSTOM: [],
};

function cleanMetadata(value: string | null | undefined, maxLength = 500): string | null {
  const cleaned = value?.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return cleaned ? cleaned.slice(0, maxLength) : null;
}

function uniqueStrings(values: readonly (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = cleanMetadata(value);
    if (!cleaned) continue;
    const key = normalizeIntegrityText(cleaned);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}

function safeDate(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

/**
 * Builds a voice/personalization profile exclusively from stored ministry facts.
 * AI-only themes without evidence, unreviewed intelligence, and unreviewed ministry
 * moments are deliberately excluded so the profile cannot invent a theology.
 */
export function deriveMinistryVoiceProfile(input: {
  branding?: BrandingVoiceMetadata | null;
  sermon: SermonVoiceMetadata;
}): MinistryVoiceProfile {
  const brandingChurchCandidate = cleanMetadata(input.branding?.churchName, 200);
  const brandingChurch = brandingChurchCandidate
    && !GENERIC_CHURCH_NAMES.has(normalizeIntegrityText(brandingChurchCandidate))
    ? brandingChurchCandidate
    : null;
  const sermonChurch = cleanMetadata(input.sermon.churchName, 200);
  const churchName = brandingChurch ?? sermonChurch;
  const speakerName = cleanMetadata(input.sermon.speakerName, 200);
  const sermonTitle = cleanMetadata(
    input.sermon.intelligence?.isManuallyReviewed
      ? input.sermon.intelligence.manualTitle ?? input.sermon.title
      : input.sermon.title,
    240,
  );
  const reviewedTheme = input.sermon.intelligence?.isManuallyReviewed
    ? cleanMetadata(input.sermon.intelligence.manualCentralTheme, 500)
    : null;
  const reviewedSummary = input.sermon.intelligence?.isManuallyReviewed
    ? cleanMetadata(input.sermon.intelligence.manualSummary, 1000)
    : null;
  const omittedUnreviewedMetadata: string[] = [];

  if (brandingChurchCandidate && !brandingChurch) {
    omittedUnreviewedMetadata.push("default branding church name");
  }

  if (
    input.sermon.intelligence
    && !input.sermon.intelligence.isManuallyReviewed
    && (
      input.sermon.intelligence.manualTitle
      || input.sermon.intelligence.manualSummary
      || input.sermon.intelligence.manualCentralTheme
    )
  ) {
    omittedUnreviewedMetadata.push("sermon intelligence");
  }

  const anchors: MinistryVoiceAnchor[] = [];
  if (reviewedTheme) {
    anchors.push({
      kind: "REVIEWED_THEME",
      value: reviewedTheme,
      evidence: reviewedSummary,
      source: "MANUAL_REVIEW",
    });
  }

  for (const tag of input.sermon.topicTags ?? []) {
    const topic = cleanMetadata(tag.topic, 200);
    const evidence = cleanMetadata(tag.evidence, 800);
    if (!topic) continue;
    if (!tag.isManuallyAdded && !evidence) {
      omittedUnreviewedMetadata.push(`topic: ${topic}`);
      continue;
    }
    anchors.push({
      kind: "TOPIC",
      value: topic,
      evidence,
      source: tag.isManuallyAdded ? "MANUAL_METADATA" : "GROUNDED_METADATA",
    });
  }

  for (const reference of input.sermon.scriptureRefs ?? []) {
    const value = cleanMetadata(reference.reference, 200);
    const evidence = cleanMetadata(reference.transcriptEvidence, 800);
    if (!value) continue;
    if (!reference.isManuallyAdded && !evidence) {
      omittedUnreviewedMetadata.push(`Scripture: ${value}`);
      continue;
    }
    anchors.push({
      kind: "SCRIPTURE",
      value,
      evidence,
      source: reference.isManuallyAdded ? "MANUAL_METADATA" : "GROUNDED_METADATA",
    });
  }

  for (const moment of input.sermon.ministryMoments ?? []) {
    const title = cleanMetadata(moment.title, 200);
    const excerpt = cleanMetadata(moment.transcriptExcerpt, 1000);
    if (!title) continue;
    if (moment.reviewStatus !== "APPROVED" || !excerpt) {
      omittedUnreviewedMetadata.push(`ministry moment: ${title}`);
      continue;
    }
    anchors.push({
      kind: "MINISTRY_MOMENT",
      value: title,
      evidence: excerpt,
      source: "MANUAL_REVIEW",
    });
    const audience = cleanMetadata(moment.suggestedAudience, 200);
    if (audience) {
      anchors.push({
        kind: "AUDIENCE",
        value: audience,
        evidence: excerpt,
        source: "MANUAL_REVIEW",
      });
    }
  }

  const dedupedAnchors = anchors.filter((anchor, index) => anchors.findIndex((candidate) => (
    candidate.kind === anchor.kind
    && normalizeIntegrityText(candidate.value) === normalizeIntegrityText(anchor.value)
  )) === index);

  return {
    profileVersion: 1,
    provenance: "MINISTRY_METADATA_ONLY",
    identity: {
      churchName,
      speakerName,
      sermonTitle,
      sermonDate: safeDate(input.sermon.sermonDate),
      language: cleanMetadata(input.sermon.language, 80),
    },
    presentation: {
      primaryBrandColor: cleanMetadata(input.branding?.primaryBrandColor, 20),
      secondaryBrandColor: cleanMetadata(input.branding?.secondaryBrandColor, 20),
      defaultFontFamily: cleanMetadata(input.branding?.defaultFontFamily, 120),
      defaultCaptionStyleName: cleanMetadata(input.branding?.defaultCaptionStyleName, 120),
    },
    anchors: dedupedAnchors,
    safePersonalizationTerms: uniqueStrings([
      churchName,
      speakerName,
      sermonTitle,
      reviewedTheme,
      ...dedupedAnchors.map((anchor) => anchor.value),
    ]),
    generationGuardrails: [
      "Use only the supplied transcript, verified Scripture, and reviewed metadata for ministry claims.",
      "Preserve direct sermon quotes exactly; do not silently paraphrase and attribute them to the speaker.",
      "Do not infer a denomination, doctrine, theological position, audience, event detail, URL, or service time.",
      "Keep Scripture wording tied to its named, approved translation.",
      "Use church, speaker, sermon, topic, and audience names only as supplied in this profile.",
      "When source context is missing, request review instead of filling the gap.",
    ],
    omittedUnreviewedMetadata: uniqueStrings(omittedUnreviewedMetadata),
  };
}

export function buildMinistryVoicePromptContext(profile: MinistryVoiceProfile): string {
  const facts = [
    profile.identity.churchName ? `Church: ${profile.identity.churchName}` : null,
    profile.identity.speakerName ? `Speaker: ${profile.identity.speakerName}` : null,
    profile.identity.sermonTitle ? `Sermon: ${profile.identity.sermonTitle}` : null,
    profile.identity.sermonDate ? `Sermon date: ${profile.identity.sermonDate}` : null,
    profile.identity.language ? `Language: ${profile.identity.language}` : null,
  ].filter((value): value is string => Boolean(value));
  const anchors = profile.anchors.map((anchor) => (
    `${anchor.kind}: ${anchor.value}${anchor.evidence ? ` | Evidence: ${anchor.evidence}` : ""}`
  ));

  return [
    "MINISTRY FACTS (use exactly; do not infer missing facts)",
    ...(facts.length > 0 ? facts : ["No ministry identity facts supplied."]),
    "GROUNDED EDITORIAL ANCHORS",
    ...(anchors.length > 0 ? anchors : ["No reviewed thematic anchors supplied."]),
    "NON-NEGOTIABLE GUARDRAILS",
    ...profile.generationGuardrails.map((guardrail) => `- ${guardrail}`),
  ].join("\n");
}

/**
 * Produces a bounded editorial direction for future guided-regeneration UI.
 * Every variant carries the same non-negotiable source protections so a tone
 * change can never silently alter a quote, Scripture wording, or stored fact.
 */
export function buildGuidedContentVariantPromptInstruction(
  variant: GuidedContentVariant,
): string {
  const direction: Record<GuidedContentVariant, string> = {
    SHORTER: "Reduce length and repetition while retaining the complete central thought and useful next step.",
    WARMER: "Use welcoming, pastoral language without adding intimacy, promises, testimony, or ministry details that the sources do not establish.",
    MORE_PRACTICAL: "Make the application and next step more concrete using only implications supported by the supplied sermon evidence.",
    YOUTH: "Use clear, age-accessible language without invented slang, stereotypes, trends, or a new theological claim.",
    LEADERSHIP: "Emphasize leadership, integrity, stewardship, resilience, or service only when that theme is present in the supplied evidence.",
  };

  return [
    `GUIDED VARIANT: ${variant}`,
    direction[variant],
    "Preserve every verbatim sermon quote exactly, including its attribution and evidence link.",
    "Preserve verified Scripture wording, reference, and named translation exactly.",
    "Preserve stored names, dates, church details, links, and all other grounded facts; do not infer missing facts.",
    "Keep the content family, publishing purpose, and evidence provenance unchanged.",
  ].join("\n");
}

function normalizedWords(value: string): string[] {
  return normalizeIntegrityText(value).split(" ").filter(Boolean);
}

function distinctiveTokens(value: string): string[] {
  return Array.from(new Set(normalizedWords(value).filter((word) => (
    word.length >= 4 && !STOP_WORDS.has(word)
  ))));
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function roundSimilarity(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function jaccard(left: readonly string[], right: readonly string[]): number {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size === 0 || rightSet.size === 0) return 0;
  let intersection = 0;
  for (const token of leftSet) if (rightSet.has(token)) intersection += 1;
  return intersection / (leftSet.size + rightSet.size - intersection);
}

function contentHook(contract: ContentOpportunityContract): string {
  switch (contract.family) {
    case "QUOTE_GRAPHIC":
      return contract.quote.text;
    case "SCRIPTURE_GRAPHIC":
      return contract.artwork.headline ?? contract.artwork.primaryText;
    case "VIDEO_CLIP_BRIEF":
      return contract.creative.hook;
    case "CAROUSEL":
      return contract.slides[0]?.headline ?? contract.title;
    case "PLATFORM_CAPTION_PACK":
      return contract.campaignMessage;
    case "STORY_SET":
      return contract.frames[0]?.headline ?? contract.title;
    case "MULTI_DAY_GUIDE":
      return contract.title;
    case "TEXT_POST":
      return contract.headline ?? contract.body.split(/[.!?\n]/u)[0] ?? contract.body;
  }
}

function contentUnits(contract: ContentOpportunityContract): string[] {
  switch (contract.family) {
    case "QUOTE_GRAPHIC":
      return [contract.quote.text, contract.quote.supportingText ?? ""];
    case "SCRIPTURE_GRAPHIC":
      return [contract.artwork.headline ?? "", contract.artwork.primaryText, contract.artwork.footer ?? ""];
    case "VIDEO_CLIP_BRIEF":
      return [contract.creative.hook, contract.creative.spokenFocus, ...contract.productionBrief.onScreenText];
    case "CAROUSEL":
      return contract.slides.map((slide) => `${slide.headline} ${slide.body}`);
    case "PLATFORM_CAPTION_PACK":
      return contract.captions.map((caption) => caption.caption);
    case "STORY_SET":
      return contract.frames.map((frame) => `${frame.headline} ${frame.body}`);
    case "MULTI_DAY_GUIDE":
      return contract.days.map((day) => `${day.title} ${day.teaching}`);
    case "TEXT_POST":
      return [contract.headline ?? "", contract.body, ...contract.sections.map((section) => `${section.heading} ${section.body}`)];
  }
}

function publishableText(contract: ContentOpportunityContract): string {
  return [
    ...contentUnits(contract),
    contract.publishingCopy.caption,
    contract.publishingCopy.callToAction?.text ?? "",
    ...(contract.family === "PLATFORM_CAPTION_PACK"
      ? contract.captions.flatMap((caption) => [caption.caption, caption.callToAction?.text ?? ""])
      : []),
  ].filter(Boolean).join("\n");
}

export function buildContentRepetitionFingerprint(
  contract: ContentOpportunityContract,
): ContentRepetitionFingerprint {
  const hook = contentHook(contract).trim();
  const hookWords = normalizedWords(hook);
  return {
    hook,
    normalizedHook: hookWords.join(" "),
    opening: hookWords.slice(0, EDITORIAL_QUALITY_THRESHOLDS.repetitiveOpeningWords).join(" "),
    distinctiveTokens: distinctiveTokens(hook),
    unitOpenings: uniqueStrings(contentUnits(contract).map((unit) => (
      normalizedWords(unit).slice(0, EDITORIAL_QUALITY_THRESHOLDS.repetitiveOpeningWords).join(" ")
    ))).filter((opening) => normalizedWords(opening).length >= 3),
  };
}

export function compareContentAgainstAcceptedBatch(input: {
  candidate: ContentOpportunityContract;
  acceptedBatch?: readonly AcceptedEditorialItem[];
}): BatchRepetitionComparison {
  const candidate = buildContentRepetitionFingerprint(input.candidate);
  const matches = (input.acceptedBatch ?? []).flatMap((accepted): RepetitionMatch[] => {
    const comparison = buildContentRepetitionFingerprint(accepted.contract);
    const similarity = roundSimilarity(jaccard(candidate.distinctiveTokens, comparison.distinctiveTokens));
    if (candidate.normalizedHook && candidate.normalizedHook === comparison.normalizedHook) {
      return [{
        acceptedId: accepted.id,
        kind: "EXACT_HOOK",
        similarity: 1,
        candidateHook: candidate.hook,
        acceptedHook: comparison.hook,
      }];
    }
    if (
      candidate.opening
      && normalizedWords(candidate.opening).length >= EDITORIAL_QUALITY_THRESHOLDS.repetitiveOpeningWords
      && candidate.opening === comparison.opening
    ) {
      return [{
        acceptedId: accepted.id,
        kind: "SAME_OPENING",
        similarity: Math.max(similarity, 0.8),
        candidateHook: candidate.hook,
        acceptedHook: comparison.hook,
      }];
    }
    if (similarity >= EDITORIAL_QUALITY_THRESHOLDS.repetitiveSimilarity) {
      return [{
        acceptedId: accepted.id,
        kind: "SIMILAR_HOOK",
        similarity,
        candidateHook: candidate.hook,
        acceptedHook: comparison.hook,
      }];
    }
    return [];
  }).sort((left, right) => (
    right.similarity - left.similarity
    || left.acceptedId.localeCompare(right.acceptedId)
  ));

  return {
    candidate,
    matches,
    highestSimilarity: matches[0]?.similarity ?? 0,
  };
}

function evidenceStatus(evidence: SourceEvidence): "VERIFIED" | "UNVERIFIED" | "MISMATCH" {
  if (evidence.kind !== "SCRIPTURE") return evidence.verification.status;
  const statuses = [
    evidence.scripture.verification.referenceStatus,
    evidence.scripture.verification.verseTextStatus,
    evidence.scripture.verification.translationStatus,
  ];
  if (statuses.includes("MISMATCH") || statuses.includes("INVALID")) return "MISMATCH";
  const populatedStatuses = [
    evidence.scripture.reference ? evidence.scripture.verification.referenceStatus : null,
    evidence.scripture.verseText ? evidence.scripture.verification.verseTextStatus : null,
    evidence.scripture.translation ? evidence.scripture.verification.translationStatus : null,
  ].filter(Boolean);
  return populatedStatuses.length > 0 && populatedStatuses.every((status) => status === "VERIFIED")
    ? "VERIFIED"
    : "UNVERIFIED";
}

function evidenceText(evidence: SourceEvidence): string {
  switch (evidence.kind) {
    case "TRANSCRIPT_SPAN":
      return evidence.excerpt;
    case "SCRIPTURE":
      return [
        evidence.scripture.reference,
        evidence.scripture.verseText,
        evidence.scripture.translation,
      ].filter(Boolean).join(" ");
    case "MINISTRY_MOMENT":
      return [evidence.title, evidence.excerpt].filter(Boolean).join(" ");
    case "CLIP":
      return evidence.title;
  }
}

function addFinding(
  findings: EditorialFinding[],
  finding: EditorialFinding,
): void {
  if (!findings.some((existing) => existing.code === finding.code)) findings.push(finding);
}

function assessSpecificity(
  contract: ContentOpportunityContract,
  profile: MinistryVoiceProfile | null,
  findings: EditorialFinding[],
): void {
  if (contract.sourceEvidence.length === 0) {
    addFinding(findings, {
      code: "SOURCE_EVIDENCE_MISSING",
      dimension: "SERMON_SPECIFICITY",
      severity: "MAJOR",
      deduction: 45,
      message: "No sermon, clip, ministry-moment, or Scripture evidence is attached.",
      repairInstruction: "Attach the exact transcript span, reviewed clip, ministry moment, or verified Scripture used by this draft.",
    });
  } else if (!contract.sourceEvidence.some((evidence) => evidenceStatus(evidence) === "VERIFIED")) {
    addFinding(findings, {
      code: "SOURCE_EVIDENCE_NOT_VERIFIED",
      dimension: "SERMON_SPECIFICITY",
      severity: "MAJOR",
      deduction: 30,
      message: "The attached source evidence has not been verified.",
      repairInstruction: "Verify at least one source record and retain its reviewer, method, and timestamp before approval.",
    });
  }

  const sourceText = contract.sourceEvidence.map(evidenceText).join(" ");
  const profileText = profile?.anchors.map((anchor) => `${anchor.value} ${anchor.evidence ?? ""}`).join(" ") ?? "";
  const anchorTokens = distinctiveTokens(`${sourceText} ${profileText}`);
  const draftTokens = distinctiveTokens(publishableText(contract));
  const overlap = anchorTokens.filter((token) => draftTokens.includes(token));
  if (anchorTokens.length >= 2 && overlap.length < 2) {
    addFinding(findings, {
      code: "WEAK_SERMON_ANCHOR_OVERLAP",
      dimension: "SERMON_SPECIFICITY",
      severity: "MAJOR",
      deduction: 24,
      message: "The draft uses very little distinctive language from its attached sermon context.",
      repairInstruction: "Rewrite the main idea using at least two meaningful concepts or phrases present in the verified evidence; do not invent a new theme.",
    });
  }

  const transcriptEvidence = contract.sourceEvidence.filter((evidence) => evidence.kind === "TRANSCRIPT_SPAN");
  if (
    transcriptEvidence.length > 0
    && transcriptEvidence.every((evidence) => (
      evidence.transcriptId === null
      && evidence.segmentIds.length === 0
      && evidence.startMs === null
    ))
  ) {
    addFinding(findings, {
      code: "TRANSCRIPT_LOCATION_MISSING",
      dimension: "SERMON_SPECIFICITY",
      severity: "MINOR",
      deduction: 12,
      message: "Transcript wording is present, but its segment or timecode location is missing.",
      repairInstruction: "Link the evidence to transcript segment IDs or a start/end time range so a reviewer can find it quickly.",
    });
  }
}

function assessAudiencePlatformFit(
  contract: ContentOpportunityContract,
  profile: MinistryVoiceProfile | null,
  findings: EditorialFinding[],
): void {
  const platforms = new Set(contract.publishingCopy.platforms);
  const hasSocial = ["INSTAGRAM", "FACEBOOK", "TIKTOK", "YOUTUBE"].some((platform) => platforms.has(platform as never));
  if (platforms.size === 1 && platforms.has("OTHER")) {
    addFinding(findings, {
      code: "PLATFORM_UNSPECIFIED",
      dimension: "AUDIENCE_PLATFORM_FIT",
      severity: "MAJOR",
      deduction: 25,
      message: "The draft has no named publishing channel.",
      repairInstruction: "Choose the actual destination platform and adapt the copy to its format before review.",
    });
  }

  if (
    (platforms.has("INSTAGRAM") || platforms.has("TIKTOK"))
    && contract.publishingCopy.caption.length > 2200
  ) {
    addFinding(findings, {
      code: "SOCIAL_CAPTION_TOO_LONG",
      dimension: "AUDIENCE_PLATFORM_FIT",
      severity: "MAJOR",
      deduction: 20,
      message: "The shared caption is too long for a concise Instagram or TikTok publishing flow.",
      repairInstruction: "Create a platform-specific caption of 2,200 characters or fewer and move long teaching into the asset or linked resource.",
    });
  }

  switch (contract.family) {
    case "VIDEO_CLIP_BRIEF":
      if (!hasSocial) {
        addFinding(findings, {
          code: "VIDEO_PLATFORM_MISMATCH",
          dimension: "AUDIENCE_PLATFORM_FIT",
          severity: "MAJOR",
          deduction: 30,
          message: "The short-form video brief is not assigned to a video-capable social channel.",
          repairInstruction: "Select Instagram, Facebook, TikTok, or YouTube and adapt the aspect ratio and hook for that channel.",
        });
      }
      if (!contract.creative.audience) {
        addFinding(findings, {
          code: "VIDEO_AUDIENCE_MISSING",
          dimension: "AUDIENCE_PLATFORM_FIT",
          severity: "MINOR",
          deduction: 15,
          message: "The clip brief does not name its intended audience.",
          repairInstruction: "Choose a reviewed audience from the sermon context, or ask a person to supply one; do not infer it.",
        });
      }
      if (
        (platforms.has("TIKTOK") || platforms.has("YOUTUBE"))
        && contract.productionBrief.aspectRatio !== "9:16"
      ) {
        addFinding(findings, {
          code: "SHORT_VIDEO_ASPECT_RATIO_MISMATCH",
          dimension: "AUDIENCE_PLATFORM_FIT",
          severity: "MINOR",
          deduction: 12,
          message: "The selected short-video channel does not use a vertical production brief.",
          repairInstruction: "Set the short-form version to 9:16 or choose a channel and format that match the current aspect ratio.",
        });
      }
      break;
    case "CAROUSEL":
      if (!platforms.has("INSTAGRAM") && !platforms.has("FACEBOOK")) {
        addFinding(findings, {
          code: "CAROUSEL_PLATFORM_MISMATCH",
          dimension: "AUDIENCE_PLATFORM_FIT",
          severity: "MAJOR",
          deduction: 24,
          message: "The carousel is not assigned to Instagram or Facebook.",
          repairInstruction: "Choose a carousel-capable social channel or convert this material into the correct format for the selected platform.",
        });
      }
      if (contract.slides.some((slide) => normalizedWords(slide.body).length > 75)) {
        addFinding(findings, {
          code: "CAROUSEL_SLIDE_TOO_DENSE",
          dimension: "AUDIENCE_PLATFORM_FIT",
          severity: "MINOR",
          deduction: 15,
          message: "At least one carousel slide is too dense for comfortable mobile reading.",
          repairInstruction: "Keep each slide to one idea and roughly 75 words or fewer; split dense teaching across slides.",
        });
      }
      break;
    case "PLATFORM_CAPTION_PACK": {
      const uniquePlatforms = new Set(contract.captions.map((caption) => (
        caption.platform === "OTHER" ? `OTHER:${caption.otherPlatform}` : caption.platform
      )));
      if (uniquePlatforms.size !== contract.captions.length) {
        addFinding(findings, {
          code: "CAPTION_PACK_DUPLICATE_PLATFORM",
          dimension: "AUDIENCE_PLATFORM_FIT",
          severity: "MAJOR",
          deduction: 24,
          message: "The caption pack contains more than one entry for the same platform.",
          repairInstruction: "Keep one intentionally adapted caption per destination platform.",
        });
      }
      if (contract.captions.some((caption) => !caption.adaptationNote)) {
        addFinding(findings, {
          code: "CAPTION_ADAPTATION_UNEXPLAINED",
          dimension: "AUDIENCE_PLATFORM_FIT",
          severity: "MINOR",
          deduction: 12,
          message: "At least one platform caption does not explain its channel-specific adaptation.",
          repairInstruction: "Record the platform choice behind each variation, such as hook length, link placement, or community prompt.",
        });
      }
      break;
    }
    case "STORY_SET":
      if (!platforms.has("INSTAGRAM") && !platforms.has("FACEBOOK")) {
        addFinding(findings, {
          code: "STORY_PLATFORM_MISMATCH",
          dimension: "AUDIENCE_PLATFORM_FIT",
          severity: "MAJOR",
          deduction: 25,
          message: "The Story set is not assigned to Instagram or Facebook.",
          repairInstruction: "Choose Instagram or Facebook, or rebuild the frames in the native format of the selected channel.",
        });
      }
      if (contract.frames.some((frame) => normalizedWords(frame.body).length > 45)) {
        addFinding(findings, {
          code: "STORY_FRAME_TOO_DENSE",
          dimension: "AUDIENCE_PLATFORM_FIT",
          severity: "MINOR",
          deduction: 15,
          message: "At least one Story frame carries too much copy for a quick mobile view.",
          repairInstruction: "Reduce each Story frame to one thought and about 45 words or fewer.",
        });
      }
      break;
    case "MULTI_DAY_GUIDE":
      if (platforms.size === 1 && (platforms.has("TIKTOK") || platforms.has("YOUTUBE"))) {
        addFinding(findings, {
          code: "GUIDE_PLATFORM_MISMATCH",
          dimension: "AUDIENCE_PLATFORM_FIT",
          severity: "MAJOR",
          deduction: 24,
          message: "A multi-day written guide is assigned only to a short-video channel.",
          repairInstruction: "Choose email, website, Facebook, or another long-form destination, then create a separate video promotion if needed.",
        });
      }
      break;
    case "TEXT_POST":
      if (contract.postKind === "EMAIL" && !platforms.has("EMAIL")) {
        addFinding(findings, {
          code: "EMAIL_PLATFORM_MISSING",
          dimension: "AUDIENCE_PLATFORM_FIT",
          severity: "MAJOR",
          deduction: 25,
          message: "Email content is not assigned to the email channel.",
          repairInstruction: "Add email as a destination or change the content family to match the intended channel.",
        });
      }
      if (["CAPTION", "SOCIAL_POST"].includes(contract.postKind) && !hasSocial) {
        addFinding(findings, {
          code: "SOCIAL_POST_PLATFORM_MISSING",
          dimension: "AUDIENCE_PLATFORM_FIT",
          severity: "MAJOR",
          deduction: 22,
          message: "Social copy has no named social destination.",
          repairInstruction: "Choose the intended social platform and edit the opening, length, and CTA for that channel.",
        });
      }
      if (
        ["PROMOTION", "INVITATION", "FOLLOW_UP"].includes(contract.postKind)
        && profile?.identity.churchName
        && !normalizeIntegrityText(publishableText(contract)).includes(normalizeIntegrityText(profile.identity.churchName))
      ) {
        addFinding(findings, {
          code: "MINISTRY_IDENTITY_MISSING",
          dimension: "AUDIENCE_PLATFORM_FIT",
          severity: "MINOR",
          deduction: 10,
          message: "The invitation or follow-up does not identify the ministry it represents.",
          repairInstruction: `Add the supplied ministry name “${profile.identity.churchName}” where it helps the reader understand who is inviting them.`,
        });
      }
      break;
    case "QUOTE_GRAPHIC":
    case "SCRIPTURE_GRAPHIC":
      break;
  }
}

function assessHookClarity(
  contract: ContentOpportunityContract,
  findings: EditorialFinding[],
): void {
  const hook = contentHook(contract).trim();
  const words = normalizedWords(hook);
  if (words.length < 4) {
    addFinding(findings, {
      code: "HOOK_TOO_THIN",
      dimension: "HOOK_CLARITY",
      severity: "MAJOR",
      deduction: 32,
      message: "The opening is too short to communicate a useful, distinctive idea.",
      repairInstruction: "Write a specific opening of at least four words using the sermon’s verified central thought.",
    });
  }
  const familyLimit = contract.family === "QUOTE_GRAPHIC" ? 35 : 24;
  if (words.length > familyLimit) {
    addFinding(findings, {
      code: "HOOK_TOO_LONG",
      dimension: "HOOK_CLARITY",
      severity: "MINOR",
      deduction: 16,
      message: "The opening carries too many words to scan quickly.",
      repairInstruction: `Reduce the opening to ${familyLimit} words or fewer without changing the sermon’s meaning.`,
    });
  }
  if (GENERIC_HOOK_PATTERNS.some((pattern) => pattern.test(hook))) {
    addFinding(findings, {
      code: "GENERIC_HOOK",
      dimension: "HOOK_CLARITY",
      severity: "MAJOR",
      deduction: 25,
      message: "The opening relies on a generic attention phrase instead of sermon value.",
      repairInstruction: "Replace the stock phrase with the sermon’s concrete tension, promise, question, or insight.",
    });
  }
  const letters = hook.match(/\p{L}/gu) ?? [];
  const capitals = hook.match(/\p{Lu}/gu) ?? [];
  if (letters.length >= 12 && capitals.length / letters.length > 0.65) {
    addFinding(findings, {
      code: "HOOK_EXCESSIVE_CAPITALS",
      dimension: "HOOK_CLARITY",
      severity: "MINOR",
      deduction: 12,
      message: "The opening uses excessive capital letters.",
      repairInstruction: "Use normal sentence or title case and let the wording carry the emphasis.",
    });
  }
  if (/[!?]{3,}/u.test(hook)) {
    addFinding(findings, {
      code: "HOOK_EXCESSIVE_PUNCTUATION",
      dimension: "HOOK_CLARITY",
      severity: "MINOR",
      deduction: 10,
      message: "The opening uses excessive punctuation.",
      repairInstruction: "Use one purposeful punctuation mark and strengthen the wording instead.",
    });
  }
  const firstSentence = publishableText(contract).split(/[.!?\n]/u)[0] ?? "";
  if (normalizedWords(firstSentence).length > 40) {
    addFinding(findings, {
      code: "OPENING_SENTENCE_TOO_LONG",
      dimension: "HOOK_CLARITY",
      severity: "MINOR",
      deduction: 12,
      message: "The first sentence is difficult to absorb in one pass.",
      repairInstruction: "Split the opening sentence at its natural turn and lead with one clear idea.",
    });
  }
}

function hasExpectedCtaVerb(type: keyof typeof CTA_VERBS, text: string): boolean {
  const verbs = CTA_VERBS[type];
  if (type === "CUSTOM") return normalizedWords(text).length >= 3;
  const words = new Set(normalizedWords(text));
  return verbs.some((verb) => words.has(verb));
}

function assessCta(contract: ContentOpportunityContract, findings: EditorialFinding[]): void {
  const cta = contract.publishingCopy.callToAction;
  const storyInteraction = contract.family === "STORY_SET"
    && contract.frames.some((frame) => frame.interaction !== null);
  if (!cta && !storyInteraction) {
    addFinding(findings, {
      code: "CTA_MISSING",
      dimension: "CTA_USEFULNESS",
      severity: "MAJOR",
      deduction: 38,
      message: "The reader is not given a clear next step.",
      repairInstruction: "Add one honest, specific action that fits the message: pray, reflect, comment, share, save, attend, watch, or visit a verified link.",
    });
  } else if (cta && !hasExpectedCtaVerb(cta.type, cta.text)) {
    addFinding(findings, {
      code: "CTA_ACTION_MISMATCH",
      dimension: "CTA_USEFULNESS",
      severity: "MAJOR",
      deduction: 25,
      message: "The CTA label and wording do not describe the same action clearly.",
      repairInstruction: `Rewrite the CTA so it plainly asks the reader to ${cta.type.toLocaleLowerCase("en").replace("_", " ")}.`,
    });
  }

  if (contract.family === "CAROUSEL" && !contract.slides.some((slide) => slide.role === "CTA")) {
    addFinding(findings, {
      code: "CAROUSEL_CTA_SLIDE_MISSING",
      dimension: "CTA_USEFULNESS",
      severity: "MINOR",
      deduction: 20,
      message: "The carousel ends without a purpose-built response slide.",
      repairInstruction: "Add a final CTA slide that gives one meaningful next step connected to the sermon.",
    });
  }

  if (contract.family === "PLATFORM_CAPTION_PACK") {
    const missing = contract.captions.filter((caption) => caption.callToAction === null).length;
    if (missing > contract.captions.length / 2) {
      addFinding(findings, {
        code: "CAPTION_PACK_CTAS_INCOMPLETE",
        dimension: "CTA_USEFULNESS",
        severity: "MINOR",
        deduction: 18,
        message: "Most platform variations have no channel-specific next step.",
        repairInstruction: "Give each important platform an appropriate CTA instead of relying only on the shared publishing CTA.",
      });
    }
  }
}

function assessCompleteness(contract: ContentOpportunityContract, findings: EditorialFinding[]): void {
  if (normalizedWords(contract.publishingCopy.caption).length < 6) {
    addFinding(findings, {
      code: "PUBLISHING_CAPTION_TOO_THIN",
      dimension: "COMPLETENESS",
      severity: "MINOR",
      deduction: 15,
      message: "The publishing caption is too thin to frame the content responsibly.",
      repairInstruction: "Add a short source-grounded setup and the intended response without repeating the artwork word for word.",
    });
  }

  switch (contract.family) {
    case "QUOTE_GRAPHIC":
      if (contract.quote.kind === "VERBATIM_SERMON" && !contract.quote.attribution) {
        addFinding(findings, {
          code: "QUOTE_ATTRIBUTION_MISSING",
          dimension: "COMPLETENESS",
          severity: "MAJOR",
          deduction: 25,
          message: "A direct sermon quote has no speaker attribution.",
          repairInstruction: "Add the stored sermon speaker as the attribution, then confirm the exact transcript wording.",
        });
      }
      if (!contract.designBrief.visualMood && !contract.designBrief.imageDirection) {
        addFinding(findings, {
          code: "QUOTE_DESIGN_BRIEF_THIN",
          dimension: "COMPLETENESS",
          severity: "MINOR",
          deduction: 10,
          message: "The quote has no useful visual direction.",
          repairInstruction: "Add a concise visual mood or image direction that supports the quote without adding new theological meaning.",
        });
      }
      break;
    case "SCRIPTURE_GRAPHIC":
      if (!contract.scripture.verseText || !contract.scripture.translation) {
        addFinding(findings, {
          code: "SCRIPTURE_COPY_INCOMPLETE",
          dimension: "COMPLETENESS",
          severity: "MAJOR",
          deduction: 35,
          message: "The Scripture graphic lacks verse wording or a named translation.",
          repairInstruction: "Supply the full verse wording and named translation from a trusted source before design review.",
        });
      }
      if (!contract.designBrief.visualMood && !contract.designBrief.imageDirection) {
        addFinding(findings, {
          code: "SCRIPTURE_DESIGN_BRIEF_THIN",
          dimension: "COMPLETENESS",
          severity: "MINOR",
          deduction: 10,
          message: "The Scripture artwork has no visual direction.",
          repairInstruction: "Add a restrained visual mood or image direction that keeps the verse legible and primary.",
        });
      }
      break;
    case "VIDEO_CLIP_BRIEF":
      if (contract.productionBrief.mediaStatus === "MISSING") {
        addFinding(findings, {
          code: "VIDEO_MEDIA_NOT_LINKED",
          dimension: "COMPLETENESS",
          severity: "MAJOR",
          deduction: 45,
          message: "The video idea is not linked to sermon media.",
          repairInstruction: "Link the approved sermon clip or media item and store its exact time range before production.",
        });
      }
      if (!contract.productionBrief.targetDurationSeconds) {
        addFinding(findings, {
          code: "VIDEO_DURATION_MISSING",
          dimension: "COMPLETENESS",
          severity: "MINOR",
          deduction: 12,
          message: "The video brief has no target duration.",
          repairInstruction: "Set a realistic duration from the approved source range and selected platform.",
        });
      }
      if (contract.productionBrief.onScreenText.length === 0) {
        addFinding(findings, {
          code: "VIDEO_ON_SCREEN_TEXT_MISSING",
          dimension: "COMPLETENESS",
          severity: "MINOR",
          deduction: 10,
          message: "The brief does not define any opening or supporting on-screen text.",
          repairInstruction: "Add a concise source-grounded title or hook for the first frame.",
        });
      }
      break;
    case "CAROUSEL": {
      const roles = new Set(contract.slides.map((slide) => slide.role));
      if (contract.slides.length < 5) {
        addFinding(findings, {
          code: "CAROUSEL_TOO_SHORT",
          dimension: "COMPLETENESS",
          severity: "MINOR",
          deduction: 18,
          message: "The carousel is too short to develop a useful teaching sequence.",
          repairInstruction: "Build a focused 5–8 slide arc: cover, source-grounded teaching, application, and CTA.",
        });
      }
      if (!roles.has("COVER") || !roles.has("APPLICATION")) {
        addFinding(findings, {
          code: "CAROUSEL_ARC_INCOMPLETE",
          dimension: "COMPLETENESS",
          severity: "MAJOR",
          deduction: 25,
          message: "The carousel is missing its cover or application stage.",
          repairInstruction: "Add a clear cover and a practical application slide while preserving sequential positions.",
        });
      }
      break;
    }
    case "PLATFORM_CAPTION_PACK":
      if (contract.captions.length < 2) {
        addFinding(findings, {
          code: "CAPTION_PACK_TOO_SMALL",
          dimension: "COMPLETENESS",
          severity: "MAJOR",
          deduction: 35,
          message: "The platform pack contains only one caption variation.",
          repairInstruction: "Add at least one genuinely adapted caption for another selected publishing channel.",
        });
      }
      break;
    case "STORY_SET": {
      const roles = new Set(contract.frames.map((frame) => frame.role));
      if (contract.frames.length < 3) {
        addFinding(findings, {
          code: "STORY_SET_TOO_SHORT",
          dimension: "COMPLETENESS",
          severity: "MAJOR",
          deduction: 28,
          message: "The Story set does not form a complete sequence.",
          repairInstruction: "Create at least a hook, one source-grounded teaching/reflection frame, and a response frame.",
        });
      }
      if (!roles.has("HOOK")) {
        addFinding(findings, {
          code: "STORY_HOOK_FRAME_MISSING",
          dimension: "COMPLETENESS",
          severity: "MAJOR",
          deduction: 22,
          message: "The Story sequence has no hook frame.",
          repairInstruction: "Start with a clear hook frame drawn from the sermon’s verified tension or insight.",
        });
      }
      if (
        !roles.has("CTA")
        && !contract.frames.some((frame) => frame.interaction !== null)
      ) {
        addFinding(findings, {
          code: "STORY_RESPONSE_FRAME_MISSING",
          dimension: "COMPLETENESS",
          severity: "MINOR",
          deduction: 20,
          message: "The Story sequence has no CTA or interactive response frame.",
          repairInstruction: "End with a prayer, question, poll, reflection, or other response that fits the sermon.",
        });
      }
      break;
    }
    case "MULTI_DAY_GUIDE": {
      if (contract.days.length < 2) {
        addFinding(findings, {
          code: "MULTI_DAY_GUIDE_TOO_SHORT",
          dimension: "COMPLETENESS",
          severity: "MAJOR",
          deduction: 35,
          message: "A multi-day guide contains only one day.",
          repairInstruction: "Add at least a second distinct, source-grounded day or convert this item to a single devotional post.",
        });
      }
      if (!contract.introduction) {
        addFinding(findings, {
          code: "GUIDE_INTRODUCTION_MISSING",
          dimension: "COMPLETENESS",
          severity: "MINOR",
          deduction: 10,
          message: "The guide does not explain its purpose or how to use it.",
          repairInstruction: "Add a brief introduction grounded in the sermon that explains the guide’s rhythm and intended use.",
        });
      }
      const daysWithoutResponse = contract.days.filter((day) => (
        day.reflectionQuestions.length === 0 && !day.prayer && !day.actionStep
      )).length;
      if (daysWithoutResponse > 0) {
        addFinding(findings, {
          code: "GUIDE_DAY_RESPONSE_MISSING",
          dimension: "COMPLETENESS",
          severity: daysWithoutResponse === contract.days.length ? "MAJOR" : "MINOR",
          deduction: daysWithoutResponse === contract.days.length ? 25 : 12,
          message: "At least one guide day has teaching but no reflection, prayer, or action.",
          repairInstruction: "Give each day one meaningful response drawn from its teaching: a question, prayer, or concrete action step.",
        });
      }
      break;
    }
    case "TEXT_POST":
      if (!contract.headline) {
        addFinding(findings, {
          code: "TEXT_HEADLINE_MISSING",
          dimension: "COMPLETENESS",
          severity: "MINOR",
          deduction: 12,
          message: "The written content has no working headline.",
          repairInstruction: "Add a specific headline using the sermon’s central verified idea.",
        });
      }
      if (
        ["OUTLINE", "EMAIL", "QUESTIONS", "CONTENT_PLAN"].includes(contract.postKind)
        && contract.sections.length === 0
      ) {
        addFinding(findings, {
          code: "TEXT_STRUCTURE_MISSING",
          dimension: "COMPLETENESS",
          severity: "MAJOR",
          deduction: 28,
          message: "This written content type needs structure but has no sections.",
          repairInstruction: "Break the content into clearly named sections appropriate to its purpose and keep each section tied to the sermon.",
        });
      }
      break;
  }
}

function repeatedInternalOpening(contract: ContentOpportunityContract): string | null {
  const openings = contentUnits(contract)
    .map((unit) => normalizedWords(unit).slice(0, 4).join(" "))
    .filter((opening) => normalizedWords(opening).length === 4);
  const counts = new Map<string, number>();
  for (const opening of openings) counts.set(opening, (counts.get(opening) ?? 0) + 1);
  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .find(([, count]) => count >= 2)?.[0] ?? null;
}

function assessRepetition(
  contract: ContentOpportunityContract,
  comparison: BatchRepetitionComparison,
  findings: EditorialFinding[],
): void {
  const topMatch = comparison.matches[0];
  if (topMatch?.kind === "EXACT_HOOK") {
    addFinding(findings, {
      code: "ACCEPTED_BATCH_EXACT_HOOK",
      dimension: "REPETITION",
      severity: "MAJOR",
      deduction: 60,
      message: `The hook duplicates accepted item ${topMatch.acceptedId}.`,
      repairInstruction: "Choose a different verified sermon moment or lead with a materially different tension, audience need, or application.",
    });
  } else if (topMatch?.kind === "SAME_OPENING") {
    addFinding(findings, {
      code: "ACCEPTED_BATCH_SAME_OPENING",
      dimension: "REPETITION",
      severity: "MAJOR",
      deduction: 42,
      message: `The hook begins with the same five-word pattern as accepted item ${topMatch.acceptedId}.`,
      repairInstruction: "Rewrite the opening from a different source-grounded angle instead of swapping only the final words.",
    });
  } else if (topMatch?.kind === "SIMILAR_HOOK") {
    addFinding(findings, {
      code: "ACCEPTED_BATCH_SIMILAR_HOOK",
      dimension: "REPETITION",
      severity: "MINOR",
      deduction: 28,
      message: `The hook is ${Math.round(topMatch.similarity * 100)}% similar to accepted item ${topMatch.acceptedId}.`,
      repairInstruction: "Differentiate the hook with another verified insight, question, or practical outcome from the sermon.",
    });
  }

  const repeatedOpening = repeatedInternalOpening(contract);
  if (repeatedOpening) {
    addFinding(findings, {
      code: "INTERNAL_OPENING_REPETITION",
      dimension: "REPETITION",
      severity: "MINOR",
      deduction: 22,
      message: `Multiple content units repeat the opening “${repeatedOpening}”.`,
      repairInstruction: "Give each slide, frame, day, or platform variation its own role and opening while keeping one coherent message.",
    });
  }
}

type ScriptureCitation = Extract<SourceEvidence, { kind: "SCRIPTURE" }>["scripture"];

function contractScriptures(contract: ContentOpportunityContract): Array<{
  citation: ScriptureCitation;
  requiresVerseText: boolean;
  label: string;
}> {
  const citations: Array<{
    citation: ScriptureCitation;
    requiresVerseText: boolean;
    label: string;
  }> = contract.sourceEvidence
    .filter((evidence): evidence is Extract<SourceEvidence, { kind: "SCRIPTURE" }> => evidence.kind === "SCRIPTURE")
    .map((evidence, index) => ({
      citation: evidence.scripture,
      requiresVerseText: false,
      label: `source Scripture ${index + 1}`,
    }));

  if (contract.family === "SCRIPTURE_GRAPHIC") {
    citations.push({ citation: contract.scripture, requiresVerseText: true, label: "Scripture graphic" });
  } else if (contract.family === "CAROUSEL") {
    contract.slides.forEach((slide) => {
      if (slide.scripture) citations.push({
        citation: slide.scripture,
        requiresVerseText: false,
        label: `carousel slide ${slide.position}`,
      });
    });
  } else if (contract.family === "STORY_SET") {
    contract.frames.forEach((frame) => {
      if (frame.scripture) citations.push({
        citation: frame.scripture,
        requiresVerseText: false,
        label: `Story frame ${frame.position}`,
      });
    });
  } else if (contract.family === "MULTI_DAY_GUIDE") {
    contract.days.forEach((day) => {
      if (day.scripture) citations.push({
        citation: day.scripture,
        requiresVerseText: false,
        label: `guide day ${day.day}`,
      });
    });
  }
  return citations;
}

function normalizedSpeakerName(value: string): string {
  return normalizeIntegrityText(value).replace(/^(?:pastor|reverend|rev|doctor|dr|bishop)\s+/u, "");
}

function assessProductionSafety(
  contract: ContentOpportunityContract,
  profile: MinistryVoiceProfile | null,
  findings: EditorialFinding[],
): void {
  if (contract.legacyConversion) {
    addFinding(findings, {
      code: "LEGACY_CONTENT_REVIEW_REQUIRED",
      dimension: "PRODUCTION_SAFETY",
      severity: "BLOCKER",
      deduction: 65,
      message: "This item was recovered from unstructured legacy copy and is explicitly review-required.",
      repairInstruction: "Rebuild and validate the item as a native structured contract before approving it for publishing.",
    });
  }

  const copyIssues = detectProductionCopyIssues({
    artworkText: contentUnits(contract).join("\n"),
    caption: [
      contract.publishingCopy.caption,
      ...(contract.family === "PLATFORM_CAPTION_PACK"
        ? contract.captions.map((caption) => caption.caption)
        : []),
    ].join("\n"),
  });
  if (copyIssues.some((issue) => issue.kind === "PLACEHOLDER")) {
    addFinding(findings, {
      code: "PUBLISHABLE_PLACEHOLDER",
      dimension: "PRODUCTION_SAFETY",
      severity: "BLOCKER",
      deduction: 60,
      message: "Publishable copy still contains a placeholder.",
      repairInstruction: "Replace every placeholder with confirmed information, or remove the claim when confirmed information is unavailable.",
    });
  }
  if (copyIssues.some((issue) => issue.kind === "INSTRUCTION")) {
    addFinding(findings, {
      code: "PRODUCTION_INSTRUCTION_IN_COPY",
      dimension: "PRODUCTION_SAFETY",
      severity: "BLOCKER",
      deduction: 55,
      message: "Internal design or production instructions appear in publishable copy.",
      repairInstruction: "Move production directions into the design or production brief and leave only audience-facing words in publishable fields.",
    });
  }

  if (contract.sourceEvidence.some((evidence) => evidenceStatus(evidence) === "MISMATCH")) {
    addFinding(findings, {
      code: "SOURCE_EVIDENCE_MISMATCH",
      dimension: "PRODUCTION_SAFETY",
      severity: "BLOCKER",
      deduction: 70,
      message: "At least one source record is marked as a mismatch.",
      repairInstruction: "Correct or remove the mismatched claim, then attach and verify the source that supports the final wording.",
    });
  }

  if (contract.family === "QUOTE_GRAPHIC" && contract.quote.kind === "VERBATIM_SERMON") {
    const transcripts = contract.sourceEvidence.filter((evidence) => evidence.kind === "TRANSCRIPT_SPAN");
    const quoteChecks = transcripts.map((evidence) => verifyQuoteTextAgainstTranscript({
      quoteText: contract.quote.text,
      sourceTranscriptExcerpt: evidence.excerpt,
    }));
    const verification = quoteChecks.find((check) => check.verified)
      ?? quoteChecks[0]
      ?? verifyQuoteTextAgainstTranscript({ quoteText: contract.quote.text });
    const evidenceVerified = transcripts.some((evidence) => evidence.verification.status === "VERIFIED");
    if (!verification.verified || !evidenceVerified) {
      addFinding(findings, {
        code: "VERBATIM_QUOTE_NOT_VERIFIED",
        dimension: "PRODUCTION_SAFETY",
        severity: "BLOCKER",
        deduction: 70,
        message: verification.verified
          ? "The direct quote wording matches an excerpt, but the evidence record is not approved."
          : verification.message,
        repairInstruction: "Restore the speaker’s exact transcript words and complete evidence verification, or explicitly change the item to a non-attributed paraphrase.",
      });
    }
    if (
      profile?.identity.speakerName
      && contract.quote.attribution
      && normalizedSpeakerName(contract.quote.attribution) !== normalizedSpeakerName(profile.identity.speakerName)
    ) {
      addFinding(findings, {
        code: "QUOTE_ATTRIBUTION_MISMATCH",
        dimension: "PRODUCTION_SAFETY",
        severity: "BLOCKER",
        deduction: 60,
        message: "The direct quote attribution does not match the stored sermon speaker.",
        repairInstruction: `Confirm the speaker identity and use the stored attribution “${profile.identity.speakerName}”, or remove the direct-quote claim.`,
      });
    }
  }

  const scriptureCitations = contractScriptures(contract);
  for (const { citation, requiresVerseText, label } of scriptureCitations) {
    const verification = citation.verification;
    const referenceValid = validateScriptureReference([
      citation.reference,
      citation.translation ? `(${citation.translation})` : null,
    ].filter(Boolean).join(" "));
    const mismatch = [
      verification.referenceStatus,
      verification.verseTextStatus,
      verification.translationStatus,
    ].includes("MISMATCH" as never);
    const referenceApproved = verification.referenceStatus === "VERIFIED";
    const verseApproved = !citation.verseText || verification.verseTextStatus === "VERIFIED";
    const translationApproved = !citation.verseText
      || Boolean(citation.translation) && verification.translationStatus === "VERIFIED";
    if (
      mismatch
      || !referenceValid.valid
      || !referenceApproved
      || !verseApproved
      || !translationApproved
      || (requiresVerseText && !citation.verseText)
      || (requiresVerseText && !citation.translation)
    ) {
      addFinding(findings, {
        code: `SCRIPTURE_REVIEW_REQUIRED_${label.toLocaleUpperCase("en").replace(/[^A-Z0-9]+/gu, "_")}`,
        dimension: "PRODUCTION_SAFETY",
        severity: "BLOCKER",
        deduction: 65,
        message: `${label} is missing trusted reference, verse, or translation verification.`,
        repairInstruction: "Confirm the reference, exact verse wording, and named translation against a trusted source, then record the reviewer and verification method.",
      });
    }
  }

  if (
    contract.family === "SCRIPTURE_GRAPHIC"
    && contract.scripture.verseText
    && !normalizeIntegrityText(contract.artwork.primaryText).includes(normalizeIntegrityText(contract.scripture.verseText))
  ) {
    addFinding(findings, {
      code: "SCRIPTURE_ARTWORK_TEXT_MISMATCH",
      dimension: "PRODUCTION_SAFETY",
      severity: "BLOCKER",
      deduction: 70,
      message: "The artwork wording does not contain the verified verse text.",
      repairInstruction: "Restore the verified verse wording in the artwork or clearly separate any editorial headline from the verse itself.",
    });
  }

  if (
    contract.family === "VIDEO_CLIP_BRIEF"
    && contract.productionBrief.mediaStatus !== "REVIEWED"
  ) {
    addFinding(findings, {
      code: "VIDEO_SOURCE_NOT_REVIEWED",
      dimension: "PRODUCTION_SAFETY",
      severity: "BLOCKER",
      deduction: 55,
      message: "The video source and exact clip range have not completed review.",
      repairInstruction: "Review the linked sermon media, approve its start/end range, and set the production brief to reviewed before publishing.",
    });
  }
}

function dimensionBand(score: number, hasBlocker: boolean): EditorialDimensionResult["band"] {
  if (hasBlocker) return "BLOCKED";
  if (score >= 85) return "STRONG";
  if (score >= 70) return "ACCEPTABLE";
  return "WEAK";
}

function buildDimensions(findings: readonly EditorialFinding[]): Record<EditorialDimension, EditorialDimensionResult> {
  return Object.fromEntries(EDITORIAL_DIMENSIONS.map((dimension) => {
    const relevant = findings.filter((finding) => finding.dimension === dimension);
    const score = clampScore(100 - relevant.reduce((sum, finding) => sum + finding.deduction, 0));
    return [dimension, {
      score,
      band: dimensionBand(score, relevant.some((finding) => finding.severity === "BLOCKER")),
      reasons: relevant.length > 0 ? relevant.map((finding) => finding.message) : [PASS_REASON[dimension]],
      findingCodes: relevant.map((finding) => finding.code),
    } satisfies EditorialDimensionResult];
  })) as Record<EditorialDimension, EditorialDimensionResult>;
}

function weightedOverallScore(dimensions: Record<EditorialDimension, EditorialDimensionResult>): number {
  const weighted = EDITORIAL_DIMENSIONS.reduce((sum, dimension) => (
    sum + dimensions[dimension].score * EDITORIAL_DIMENSION_WEIGHTS[dimension]
  ), 0);
  return clampScore(weighted / 100);
}

function decideReviewPriority(
  overallScore: number,
  findings: readonly EditorialFinding[],
): { priority: PublishReviewPriority; recommendation: PublishRecommendation } {
  if (findings.some((finding) => finding.severity === "BLOCKER")) {
    return { priority: "PUBLISH_BLOCKED", recommendation: "BLOCK" };
  }
  if (
    overallScore < EDITORIAL_QUALITY_THRESHOLDS.highPriorityReview
    || findings.some((finding) => finding.severity === "MAJOR")
  ) {
    return { priority: "HIGH", recommendation: "REVIEW" };
  }
  if (
    overallScore < EDITORIAL_QUALITY_THRESHOLDS.readyForApproval
    || findings.some((finding) => finding.severity === "MINOR")
  ) {
    return { priority: "STANDARD", recommendation: "REVIEW" };
  }
  return { priority: "READY", recommendation: "READY_FOR_APPROVAL" };
}

/**
 * Deterministically assesses a typed opportunity. The result never uses the
 * generator's confidence score; every deduction has a stable code, reason,
 * repair instruction, and published threshold.
 */
export function assessContentEditorialQuality(input: AssessmentInput): EditorialQualityAssessment {
  const findings: EditorialFinding[] = [];
  const profile = input.voiceProfile ?? null;
  const repetition = compareContentAgainstAcceptedBatch({
    candidate: input.contract,
    acceptedBatch: input.acceptedBatch,
  });

  assessSpecificity(input.contract, profile, findings);
  assessAudiencePlatformFit(input.contract, profile, findings);
  assessHookClarity(input.contract, findings);
  assessCta(input.contract, findings);
  assessCompleteness(input.contract, findings);
  assessRepetition(input.contract, repetition, findings);
  assessProductionSafety(input.contract, profile, findings);

  const sortedFindings = findings.slice().sort((left, right) => (
    SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
    || EDITORIAL_DIMENSIONS.indexOf(left.dimension) - EDITORIAL_DIMENSIONS.indexOf(right.dimension)
    || left.code.localeCompare(right.code)
  ));
  const dimensions = buildDimensions(sortedFindings);
  const overallScore = weightedOverallScore(dimensions);
  const decision = decideReviewPriority(overallScore, sortedFindings);

  return {
    scoringVersion: CONTENT_EDITORIAL_SCORING_VERSION,
    deterministic: true,
    family: input.contract.family,
    overallScore,
    dimensions,
    publishReviewPriority: decision.priority,
    publishRecommendation: decision.recommendation,
    findings: sortedFindings,
    blockers: sortedFindings.filter((finding) => finding.severity === "BLOCKER"),
    critique: sortedFindings.map((finding) => finding.message),
    repairInstructions: uniqueStrings(sortedFindings.map((finding) => finding.repairInstruction)),
    repetition,
    voiceProfileApplied: Boolean(profile),
  };
}
