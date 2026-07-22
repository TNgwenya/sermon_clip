import { describe, expect, it } from "vitest";

import {
  EDITORIAL_DIMENSIONS,
  EDITORIAL_DIMENSION_WEIGHTS,
  assessContentEditorialQuality,
  buildContentRepetitionFingerprint,
  buildGuidedContentVariantPromptInstruction,
  buildMinistryVoicePromptContext,
  compareContentAgainstAcceptedBatch,
  deriveMinistryVoiceProfile,
} from "@/lib/contentEditorialQuality";
import {
  contentOpportunityContractSchema,
  type ContentOpportunityContract,
} from "@/lib/contentOpportunityContracts";

const VERIFIED_AT = "2026-07-20T10:00:00.000Z";

function transcriptEvidence(excerpt: string) {
  return {
    kind: "TRANSCRIPT_SPAN" as const,
    transcriptId: "transcript-1",
    segmentIds: ["segment-1"],
    startMs: 15_000,
    endMs: 24_000,
    excerpt,
    speaker: "Pastor Ndlovu",
    verification: {
      status: "VERIFIED" as const,
      method: "TRANSCRIPT_MATCH" as const,
      verifiedAt: VERIFIED_AT,
      verifiedBy: "editor-1",
      note: "Matched against stored transcript segments.",
    },
  };
}

function verifiedScripture() {
  return {
    reference: "Psalms 23:1",
    verseText: "The Lord is my shepherd; I lack nothing.",
    translation: "NIV",
    verification: {
      referenceStatus: "VERIFIED" as const,
      verseTextStatus: "VERIFIED" as const,
      translationStatus: "VERIFIED" as const,
      method: "TRUSTED_SOURCE" as const,
      verifiedAt: VERIFIED_AT,
      verifiedBy: "editor-1",
      note: "Checked against the named translation.",
    },
  };
}

function publishingCopy(
  platforms: Array<"INSTAGRAM" | "FACEBOOK" | "TIKTOK" | "YOUTUBE" | "EMAIL" | "WEBSITE" | "OTHER"> = ["INSTAGRAM"],
) {
  return {
    caption: "Faith keeps walking because God remains faithful through every season.",
    hashtags: ["#Faith", "#SundaySermon"],
    callToAction: {
      type: "SHARE" as const,
      text: "Share this encouragement with someone walking through pressure.",
      url: null,
    },
    platforms,
  };
}

function parse(value: unknown): ContentOpportunityContract {
  return contentOpportunityContractSchema.parse(value);
}

function strongContracts(): Record<ContentOpportunityContract["family"], ContentOpportunityContract> {
  const quote = parse({
    schemaVersion: 1,
    family: "QUOTE_GRAPHIC",
    sourceEvidence: [transcriptEvidence("Faith keeps walking when pressure comes because God remains faithful.")],
    publishingCopy: publishingCopy(),
    quote: {
      text: "Faith keeps walking when pressure comes.",
      kind: "VERBATIM_SERMON",
      attribution: "Pastor Ndlovu",
      supportingText: "A reminder from Sunday’s message about faithful endurance.",
    },
    designBrief: {
      visualMood: "Warm, steady, and hopeful",
      imageDirection: "A calm path with generous negative space",
      emphasisWords: ["faith", "walking"],
    },
  });

  const scripture = verifiedScripture();
  const scriptureGraphic = parse({
    schemaVersion: 1,
    family: "SCRIPTURE_GRAPHIC",
    sourceEvidence: [{ kind: "SCRIPTURE", scripture }],
    publishingCopy: {
      ...publishingCopy(),
      caption: "The Shepherd’s care gives us confidence for every step before us.",
      callToAction: { type: "SAVE", text: "Save this verse for the week ahead.", url: null },
    },
    scripture,
    artwork: {
      headline: "The Shepherd stays near",
      primaryText: "The Lord is my shepherd; I lack nothing.",
      footer: "Psalms 23:1 · NIV",
    },
    designBrief: {
      visualMood: "Quiet confidence",
      imageDirection: "Soft natural texture with highly legible verse text",
      emphasisWords: ["shepherd"],
    },
  });

  const video = parse({
    schemaVersion: 1,
    family: "VIDEO_CLIP_BRIEF",
    sourceEvidence: [transcriptEvidence("Faith keeps walking when pressure comes because God remains faithful.")],
    publishingCopy: {
      ...publishingCopy(["TIKTOK", "YOUTUBE"]),
      callToAction: { type: "WATCH", text: "Watch the full sermon for the complete teaching.", url: null },
    },
    creative: {
      hook: "Faith keeps walking under pressure",
      spokenFocus: "The pastor explains why faithful endurance grows through pressure.",
      onScreenTitle: "Keep walking by faith",
      audience: "People navigating a difficult season",
      desiredResponse: "Choose one faithful next step today.",
    },
    productionBrief: {
      mediaStatus: "REVIEWED",
      sermonMediaId: "sermon-media-1",
      clipId: "clip-1",
      startMs: 15_000,
      endMs: 55_000,
      targetDurationSeconds: 40,
      aspectRatio: "9:16",
      captionsRequired: true,
      onScreenText: ["Faith keeps walking"],
      bRollDirections: [],
      editNotes: ["Keep the pastor’s sentence intact."],
    },
  });

  const carousel = parse({
    schemaVersion: 1,
    family: "CAROUSEL",
    sourceEvidence: [transcriptEvidence("Faith grows through pressure when we take the next faithful step.")],
    publishingCopy: publishingCopy(),
    title: "Five faithful steps under pressure",
    slides: [
      { position: 1, role: "COVER", headline: "Faith can keep moving", body: "Five reminders for pressure-filled seasons.", scripture: null, imageDirection: "Simple path" },
      { position: 2, role: "CONTENT", headline: "Name the pressure", body: "Honesty helps us bring the real burden into prayer.", scripture: null, imageDirection: null },
      { position: 3, role: "CONTENT", headline: "Remember God’s faithfulness", body: "The sermon calls us to look back before choosing the next step.", scripture: null, imageDirection: null },
      { position: 4, role: "APPLICATION", headline: "Choose one faithful step", body: "Write down the next obedient action you can take today.", scripture: null, imageDirection: null },
      { position: 5, role: "CTA", headline: "Encourage another person", body: "Share this with someone walking through pressure.", scripture: null, imageDirection: null },
    ],
    designBrief: { visualMood: "Steady progress", layoutDirection: "One concise idea per slide" },
  });

  const captionPack = parse({
    schemaVersion: 1,
    family: "PLATFORM_CAPTION_PACK",
    sourceEvidence: [transcriptEvidence("Faith keeps walking when pressure comes because God remains faithful.")],
    publishingCopy: publishingCopy(["INSTAGRAM", "FACEBOOK"]),
    campaignMessage: "Faith keeps walking through pressure",
    captions: [
      {
        platform: "INSTAGRAM",
        otherPlatform: null,
        caption: "Pressure does not get the final word. Faith keeps walking because God remains faithful. What faithful step will you take today?",
        hashtags: ["#Faith", "#SundaySermon"],
        callToAction: { type: "COMMENT", text: "Comment with your next faithful step.", url: null },
        adaptationNote: "Short reflection prompt for comments and saves.",
      },
      {
        platform: "FACEBOOK",
        otherPlatform: null,
        caption: "Sunday’s message reminded us that faith can keep moving through pressure. Share one way God’s faithfulness has carried you this week.",
        hashtags: ["#Faith"],
        callToAction: { type: "SHARE", text: "Share this message with a friend.", url: null },
        adaptationNote: "Longer community conversation prompt.",
      },
    ],
  });

  const story = parse({
    schemaVersion: 1,
    family: "STORY_SET",
    sourceEvidence: [transcriptEvidence("Faith keeps walking when pressure comes because God remains faithful.")],
    publishingCopy: publishingCopy(["INSTAGRAM"]),
    title: "Faith under pressure",
    frames: [
      { position: 1, role: "HOOK", headline: "What keeps faith moving?", body: "Pressure can make the next step feel impossible.", scripture: null, interaction: null, imageDirection: "A path at dawn" },
      { position: 2, role: "TEACHING", headline: "Remember who is faithful", body: "Sunday’s sermon called us to trust God’s faithfulness before our feelings.", scripture: null, interaction: null, imageDirection: null },
      { position: 3, role: "CTA", headline: "Name your next step", body: "What faithful step can you take today?", scripture: null, interaction: { kind: "QUESTION", prompt: "My next faithful step is…", options: [] }, imageDirection: null },
    ],
  });

  const guide = parse({
    schemaVersion: 1,
    family: "MULTI_DAY_GUIDE",
    sourceEvidence: [transcriptEvidence("Faith grows through pressure when we take the next faithful step.")],
    publishingCopy: {
      ...publishingCopy(["WEBSITE", "EMAIL"]),
      callToAction: { type: "SAVE", text: "Save this guide and begin day one today.", url: null },
    },
    guideKind: "DEVOTIONAL",
    title: "Two days of faithful steps",
    introduction: "Use this short guide to reflect on the sermon’s call to faithful endurance.",
    days: [
      { day: 1, title: "Name the pressure", scripture: null, teaching: "Faith begins with honesty about the pressure we are carrying.", reflectionQuestions: ["What pressure are you carrying today?"], prayer: "Ask God for courage to be honest.", actionStep: "Write down the pressure in one sentence." },
      { day: 2, title: "Take the next step", scripture: null, teaching: "God’s faithfulness gives us courage to choose the next faithful step.", reflectionQuestions: ["What is your next faithful step?"], prayer: "Pray for courage to take that step.", actionStep: "Complete the step you identified." },
    ],
  });

  const text = parse({
    schemaVersion: 1,
    family: "TEXT_POST",
    sourceEvidence: [transcriptEvidence("Faith keeps walking when pressure comes because God remains faithful.")],
    publishingCopy: publishingCopy(["FACEBOOK"]),
    postKind: "SOCIAL_POST",
    headline: "Faith keeps walking under pressure",
    body: "Pressure can slow us down, but Sunday’s sermon reminds us that God remains faithful. We can choose one faithful next step today.",
    sections: [{ heading: "Take the next step", body: "Name one action that expresses trust today." }],
  });

  return {
    QUOTE_GRAPHIC: quote,
    SCRIPTURE_GRAPHIC: scriptureGraphic,
    VIDEO_CLIP_BRIEF: video,
    CAROUSEL: carousel,
    PLATFORM_CAPTION_PACK: captionPack,
    STORY_SET: story,
    MULTI_DAY_GUIDE: guide,
    TEXT_POST: text,
  };
}

const voiceProfile = deriveMinistryVoiceProfile({
  branding: {
    churchName: "Grace Community Church",
    primaryBrandColor: "#123456",
    secondaryBrandColor: "#F0B429",
    defaultFontFamily: "Inter",
    defaultCaptionStyleName: "clean-lower",
  },
  sermon: {
    title: "Faith Under Pressure",
    speakerName: "Pastor Ndlovu",
    churchName: "Older Church Name",
    language: "English",
    sermonDate: "2026-07-19T08:00:00.000Z",
    intelligence: {
      isManuallyReviewed: true,
      manualTitle: "Faith Under Pressure",
      manualSummary: "A reviewed summary about taking the next faithful step.",
      manualCentralTheme: "Faithful endurance under pressure",
    },
    topicTags: [{ topic: "Endurance", evidence: "Faith keeps walking.", isManuallyAdded: false }],
    scriptureRefs: [{ reference: "Psalms 23:1", isManuallyAdded: true }],
    ministryMoments: [{
      title: "Faithful next step",
      transcriptExcerpt: "Take the next faithful step.",
      suggestedAudience: "People navigating a difficult season",
      reviewStatus: "APPROVED",
    }],
  },
});

describe("ministry voice profile", () => {
  it("derives personalization only from supplied, reviewed, or evidence-grounded metadata", () => {
    const profile = deriveMinistryVoiceProfile({
      branding: { churchName: "Grace Community Church" },
      sermon: {
        title: "Walking in Hope",
        speakerName: "Pastor Amina",
        churchName: "Stale Church Name",
        language: "English",
        intelligence: {
          isManuallyReviewed: false,
          manualCentralTheme: "Unreviewed doctrinal claim",
          manualSummary: "Unreviewed summary",
        },
        topicTags: [
          { topic: "Hope", evidence: "We keep walking in hope." },
          { topic: "Invented theology", evidence: null, isManuallyAdded: false },
          { topic: "Prayer", isManuallyAdded: true },
        ],
        scriptureRefs: [
          { reference: "Romans 5:3-5", transcriptEvidence: "The pastor reads Romans 5." },
          { reference: "Unknown 1:1", isManuallyAdded: false },
        ],
        ministryMoments: [
          { title: "Reviewed prayer", transcriptExcerpt: "Let us pray together.", reviewStatus: "APPROVED" },
          { title: "Pending idea", transcriptExcerpt: "Maybe use this.", reviewStatus: "PENDING" },
        ],
      },
    });

    expect(profile.provenance).toBe("MINISTRY_METADATA_ONLY");
    expect(profile.identity).toMatchObject({
      churchName: "Grace Community Church",
      speakerName: "Pastor Amina",
      sermonTitle: "Walking in Hope",
    });
    expect(profile.anchors.map((anchor) => anchor.value)).toEqual([
      "Hope",
      "Prayer",
      "Romans 5:3-5",
      "Reviewed prayer",
    ]);
    expect(profile.safePersonalizationTerms.join(" ")).not.toContain("Invented theology");
    expect(profile.safePersonalizationTerms.join(" ")).not.toContain("Unreviewed doctrinal claim");
    expect(profile.omittedUnreviewedMetadata).toEqual(expect.arrayContaining([
      "sermon intelligence",
      "topic: Invented theology",
      "Scripture: Unknown 1:1",
      "ministry moment: Pending idea",
    ]));
    expect(profile.generationGuardrails.join(" ")).toContain("Do not infer a denomination");
  });

  it("builds a prompt context that carries facts and explicit non-invention rules", () => {
    const context = buildMinistryVoicePromptContext(voiceProfile);

    expect(context).toContain("Church: Grace Community Church");
    expect(context).toContain("Speaker: Pastor Ndlovu");
    expect(context).toContain("REVIEWED_THEME: Faithful endurance under pressure");
    expect(context).toContain("do not infer missing facts");
    expect(context).toContain("Do not infer a denomination");
  });

  it("never promotes the default Local Church placeholder into personalization copy", () => {
    const profile = deriveMinistryVoiceProfile({
      branding: { churchName: "Local Church" },
      sermon: { title: "Hope", churchName: "Kingdom Life Church" },
    });

    expect(profile.identity.churchName).toBe("Kingdom Life Church");
    expect(profile.safePersonalizationTerms).not.toContain("Local Church");
    expect(profile.omittedUnreviewedMetadata).toContain("default branding church name");
  });

  it.each(["SHORTER", "WARMER", "MORE_PRACTICAL", "YOUTH", "LEADERSHIP"] as const)(
    "keeps %s guided variants behind the same quote, Scripture, and fact guardrails",
    (variant) => {
      const instruction = buildGuidedContentVariantPromptInstruction(variant);

      expect(instruction).toContain(`GUIDED VARIANT: ${variant}`);
      expect(instruction).toContain("Preserve every verbatim sermon quote exactly");
      expect(instruction).toContain("Preserve verified Scripture wording");
      expect(instruction).toContain("do not infer missing facts");
      expect(instruction).toContain("evidence provenance unchanged");
    },
  );
});

describe("professional editorial assessment", () => {
  it("uses explicit weights that total 100 instead of model self-confidence", () => {
    expect(Object.keys(EDITORIAL_DIMENSION_WEIGHTS).sort()).toEqual([...EDITORIAL_DIMENSIONS].sort());
    expect(Object.values(EDITORIAL_DIMENSION_WEIGHTS).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });

  it.each(Object.entries(strongContracts()))(
    "scores the %s family across every professional dimension",
    (family, contract) => {
      const assessment = assessContentEditorialQuality({ contract, voiceProfile });

      expect(assessment.family).toBe(family);
      expect(assessment.deterministic).toBe(true);
      expect(Object.keys(assessment.dimensions).sort()).toEqual([...EDITORIAL_DIMENSIONS].sort());
      expect(assessment.overallScore).toBeGreaterThanOrEqual(0);
      expect(assessment.overallScore).toBeLessThanOrEqual(100);
      expect(assessment.blockers).toEqual([]);
      expect(assessment.voiceProfileApplied).toBe(true);
    },
  );

  it("returns an approval-ready result for a fully grounded, complete quote", () => {
    const assessment = assessContentEditorialQuality({
      contract: strongContracts().QUOTE_GRAPHIC,
      voiceProfile,
    });

    expect(assessment).toMatchObject({
      overallScore: 100,
      publishReviewPriority: "READY",
      publishRecommendation: "READY_FOR_APPROVAL",
      findings: [],
    });
    expect(assessment.dimensions.PRODUCTION_SAFETY.reasons).toEqual([
      "No publishing blocker, placeholder, or unverified claim was detected.",
    ]);
  });

  it("is byte-for-byte deterministic for the same inputs", () => {
    const input = {
      contract: strongContracts().CAROUSEL,
      voiceProfile,
      acceptedBatch: [{ id: "accepted-1", contract: strongContracts().TEXT_POST }],
    };

    expect(assessContentEditorialQuality(input)).toEqual(assessContentEditorialQuality(input));
  });

  it("blocks a direct quote whose wording is not in its approved transcript evidence", () => {
    const quote = structuredClone(strongContracts().QUOTE_GRAPHIC);
    if (quote.family !== "QUOTE_GRAPHIC") throw new Error("Expected quote contract");
    quote.quote.text = "Pressure always guarantees immediate success.";

    const assessment = assessContentEditorialQuality({ contract: parse(quote), voiceProfile });

    expect(assessment.publishReviewPriority).toBe("PUBLISH_BLOCKED");
    expect(assessment.publishRecommendation).toBe("BLOCK");
    expect(assessment.blockers.map((finding) => finding.code)).toContain("VERBATIM_QUOTE_NOT_VERIFIED");
    expect(assessment.repairInstructions.join(" ")).toContain("exact transcript words");
  });

  it("blocks a direct quote attributed to someone other than the stored sermon speaker", () => {
    const quote = structuredClone(strongContracts().QUOTE_GRAPHIC);
    if (quote.family !== "QUOTE_GRAPHIC") throw new Error("Expected quote contract");
    quote.quote.attribution = "Pastor Someone Else";

    const assessment = assessContentEditorialQuality({ contract: parse(quote), voiceProfile });

    expect(assessment.blockers.map((finding) => finding.code)).toContain("QUOTE_ATTRIBUTION_MISMATCH");
    expect(assessment.repairInstructions.join(" ")).toContain("Pastor Ndlovu");
  });

  it("blocks unverified Scripture even when the reference syntax looks plausible", () => {
    const scripture = structuredClone(strongContracts().SCRIPTURE_GRAPHIC);
    if (scripture.family !== "SCRIPTURE_GRAPHIC") throw new Error("Expected Scripture contract");
    scripture.scripture.verification.referenceStatus = "SYNTAX_VALID";
    scripture.scripture.verification.verseTextStatus = "UNVERIFIED";
    scripture.scripture.verification.translationStatus = "UNVERIFIED";
    scripture.scripture.verification.method = "NONE";
    scripture.scripture.verification.verifiedAt = null;
    scripture.scripture.verification.verifiedBy = null;

    const assessment = assessContentEditorialQuality({ contract: parse(scripture), voiceProfile });

    expect(assessment.publishReviewPriority).toBe("PUBLISH_BLOCKED");
    expect(assessment.blockers.some((finding) => finding.code.startsWith("SCRIPTURE_REVIEW_REQUIRED"))).toBe(true);
  });

  it("blocks Scripture artwork that changes the verified verse wording", () => {
    const scripture = structuredClone(strongContracts().SCRIPTURE_GRAPHIC);
    if (scripture.family !== "SCRIPTURE_GRAPHIC") throw new Error("Expected Scripture contract");
    scripture.artwork.primaryText = "The Lord is my shepherd, so every outcome will be easy.";

    const assessment = assessContentEditorialQuality({ contract: parse(scripture), voiceProfile });

    expect(assessment.blockers.map((finding) => finding.code)).toContain("SCRIPTURE_ARTWORK_TEXT_MISMATCH");
  });

  it("blocks a clip idea until its media and exact range are reviewed", () => {
    const video = structuredClone(strongContracts().VIDEO_CLIP_BRIEF);
    if (video.family !== "VIDEO_CLIP_BRIEF") throw new Error("Expected video brief");
    video.productionBrief.mediaStatus = "MISSING";
    video.productionBrief.sermonMediaId = null;
    video.productionBrief.clipId = null;
    video.productionBrief.startMs = null;
    video.productionBrief.endMs = null;

    const assessment = assessContentEditorialQuality({ contract: parse(video), voiceProfile });

    expect(assessment.blockers.map((finding) => finding.code)).toContain("VIDEO_SOURCE_NOT_REVIEWED");
    expect(assessment.findings.map((finding) => finding.code)).toContain("VIDEO_MEDIA_NOT_LINKED");
  });

  it("blocks placeholders and production directions in audience-facing fields", () => {
    const text = structuredClone(strongContracts().TEXT_POST);
    if (text.family !== "TEXT_POST") throw new Error("Expected text post");
    text.body = "Join us at [insert service time]. Add a small footer with the church logo.";

    const assessment = assessContentEditorialQuality({ contract: parse(text), voiceProfile });

    expect(assessment.blockers.map((finding) => finding.code)).toEqual(expect.arrayContaining([
      "PUBLISHABLE_PLACEHOLDER",
      "PRODUCTION_INSTRUCTION_IN_COPY",
    ]));
  });

  it("returns actionable CTA critique when the CTA type and wording disagree", () => {
    const text = structuredClone(strongContracts().TEXT_POST);
    text.publishingCopy.callToAction = {
      type: "SHARE",
      text: "Be encouraged today.",
      url: null,
    };

    const assessment = assessContentEditorialQuality({ contract: parse(text), voiceProfile });

    expect(assessment.dimensions.CTA_USEFULNESS.findingCodes).toContain("CTA_ACTION_MISMATCH");
    expect(assessment.repairInstructions.join(" ")).toContain("plainly asks the reader to share");
  });

  it("prioritizes ministry identity for invitations without inventing it", () => {
    const text = structuredClone(strongContracts().TEXT_POST);
    if (text.family !== "TEXT_POST") throw new Error("Expected text post");
    text.postKind = "INVITATION";
    text.body = "Join us this Sunday as we continue reflecting on faithful endurance.";

    const assessment = assessContentEditorialQuality({ contract: parse(text), voiceProfile });

    expect(assessment.findings.map((finding) => finding.code)).toContain("MINISTRY_IDENTITY_MISSING");
    expect(assessment.repairInstructions.join(" ")).toContain("Grace Community Church");
  });
});

describe("family-specific completeness", () => {
  it.each([
    ["QUOTE_GRAPHIC", "QUOTE_ATTRIBUTION_MISSING", () => {
      const value = structuredClone(strongContracts().QUOTE_GRAPHIC);
      if (value.family !== "QUOTE_GRAPHIC") throw new Error("Expected quote");
      value.quote.attribution = null;
      return parse(value);
    }],
    ["SCRIPTURE_GRAPHIC", "SCRIPTURE_COPY_INCOMPLETE", () => {
      const value = structuredClone(strongContracts().SCRIPTURE_GRAPHIC);
      if (value.family !== "SCRIPTURE_GRAPHIC") throw new Error("Expected Scripture");
      value.scripture.verseText = null;
      value.scripture.translation = null;
      value.scripture.verification.verseTextStatus = "MISSING";
      value.scripture.verification.translationStatus = "MISSING";
      return parse(value);
    }],
    ["VIDEO_CLIP_BRIEF", "VIDEO_MEDIA_NOT_LINKED", () => {
      const value = structuredClone(strongContracts().VIDEO_CLIP_BRIEF);
      if (value.family !== "VIDEO_CLIP_BRIEF") throw new Error("Expected video");
      value.productionBrief.mediaStatus = "MISSING";
      value.productionBrief.sermonMediaId = null;
      value.productionBrief.clipId = null;
      value.productionBrief.startMs = null;
      value.productionBrief.endMs = null;
      return parse(value);
    }],
    ["CAROUSEL", "CAROUSEL_TOO_SHORT", () => {
      const value = structuredClone(strongContracts().CAROUSEL);
      if (value.family !== "CAROUSEL") throw new Error("Expected carousel");
      value.slides = value.slides.slice(0, 2);
      return parse(value);
    }],
    ["PLATFORM_CAPTION_PACK", "CAPTION_PACK_TOO_SMALL", () => {
      const value = structuredClone(strongContracts().PLATFORM_CAPTION_PACK);
      if (value.family !== "PLATFORM_CAPTION_PACK") throw new Error("Expected caption pack");
      value.captions = value.captions.slice(0, 1);
      return parse(value);
    }],
    ["STORY_SET", "STORY_SET_TOO_SHORT", () => {
      const value = structuredClone(strongContracts().STORY_SET);
      if (value.family !== "STORY_SET") throw new Error("Expected Story set");
      value.frames = value.frames.slice(0, 1);
      return parse(value);
    }],
    ["MULTI_DAY_GUIDE", "MULTI_DAY_GUIDE_TOO_SHORT", () => {
      const value = structuredClone(strongContracts().MULTI_DAY_GUIDE);
      if (value.family !== "MULTI_DAY_GUIDE") throw new Error("Expected guide");
      value.days = value.days.slice(0, 1);
      return parse(value);
    }],
    ["TEXT_POST", "TEXT_STRUCTURE_MISSING", () => {
      const value = structuredClone(strongContracts().TEXT_POST);
      if (value.family !== "TEXT_POST") throw new Error("Expected text");
      value.postKind = "EMAIL";
      value.publishingCopy.platforms = ["EMAIL"];
      value.sections = [];
      return parse(value);
    }],
  ] as const)("flags incomplete %s records with %s", (_family, expectedCode, build) => {
    const assessment = assessContentEditorialQuality({ contract: build(), voiceProfile });

    expect(assessment.findings.map((finding) => finding.code)).toContain(expectedCode);
    const finding = assessment.findings.find((candidate) => candidate.code === expectedCode);
    expect(finding?.repairInstruction.length).toBeGreaterThan(20);
  });
});

describe("batch and internal repetition", () => {
  it("builds a stable fingerprint from each family’s actual hook field", () => {
    const quote = buildContentRepetitionFingerprint(strongContracts().QUOTE_GRAPHIC);
    const video = buildContentRepetitionFingerprint(strongContracts().VIDEO_CLIP_BRIEF);
    const carousel = buildContentRepetitionFingerprint(strongContracts().CAROUSEL);

    expect(quote.hook).toBe("Faith keeps walking when pressure comes.");
    expect(video.hook).toBe("Faith keeps walking under pressure");
    expect(carousel.hook).toBe("Faith can keep moving");
    expect(quote.distinctiveTokens).toEqual(expect.arrayContaining(["faith", "keeps", "walking", "pressure"]));
  });

  it("detects an exact hook duplicate across different contract families", () => {
    const accepted = structuredClone(strongContracts().TEXT_POST);
    if (accepted.family !== "TEXT_POST") throw new Error("Expected text post");
    accepted.headline = "Faith keeps walking when pressure comes.";

    const comparison = compareContentAgainstAcceptedBatch({
      candidate: strongContracts().QUOTE_GRAPHIC,
      acceptedBatch: [{ id: "accepted-text", contract: parse(accepted) }],
    });

    expect(comparison.matches[0]).toMatchObject({
      acceptedId: "accepted-text",
      kind: "EXACT_HOOK",
      similarity: 1,
    });
  });

  it("detects semantically repetitive token phrasing even when word order changes", () => {
    const accepted = structuredClone(strongContracts().TEXT_POST);
    if (accepted.family !== "TEXT_POST") throw new Error("Expected text post");
    accepted.headline = "When pressure comes, faith keeps walking";

    const comparison = compareContentAgainstAcceptedBatch({
      candidate: strongContracts().QUOTE_GRAPHIC,
      acceptedBatch: [{ id: "accepted-reordered", contract: parse(accepted) }],
    });

    expect(comparison.matches[0]).toMatchObject({
      acceptedId: "accepted-reordered",
      kind: "SIMILAR_HOOK",
      similarity: 1,
    });
  });

  it("turns accepted-batch duplication into a deterministic high-priority repair", () => {
    const quote = strongContracts().QUOTE_GRAPHIC;
    const assessment = assessContentEditorialQuality({
      contract: quote,
      voiceProfile,
      acceptedBatch: [{ id: "accepted-quote", contract: quote }],
    });

    expect(assessment.publishReviewPriority).toBe("HIGH");
    expect(assessment.dimensions.REPETITION).toMatchObject({ score: 40, band: "WEAK" });
    expect(assessment.findings.map((finding) => finding.code)).toContain("ACCEPTED_BATCH_EXACT_HOOK");
    expect(assessment.repairInstructions.join(" ")).toContain("different verified sermon moment");
  });

  it("detects repeated openings inside a caption pack", () => {
    const pack = structuredClone(strongContracts().PLATFORM_CAPTION_PACK);
    if (pack.family !== "PLATFORM_CAPTION_PACK") throw new Error("Expected caption pack");
    pack.captions[0].caption = "Faith keeps walking when pressure comes on Instagram.";
    pack.captions[1].caption = "Faith keeps walking when pressure comes on Facebook.";

    const assessment = assessContentEditorialQuality({ contract: parse(pack), voiceProfile });

    expect(assessment.findings.map((finding) => finding.code)).toContain("INTERNAL_OPENING_REPETITION");
  });
});
