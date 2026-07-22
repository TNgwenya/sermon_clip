"use server";

import { z } from "zod";

import {
  buildGuidedRewritePrompt,
  GUIDED_REWRITE_VARIANTS,
  GuidedRewriteValidationError,
  parseGuidedRewriteModelResponse,
  supportsGuidedRewrite,
  validateAndBuildGuidedRewriteSuggestion,
  type GuidedRewriteDraft,
  type GuidedRewriteEvidence,
  type GuidedRewriteSuggestion,
} from "@/lib/contentGuidedRewrite";
import {
  deriveMinistryVoiceProfile,
  type MinistryVoiceProfile,
} from "@/lib/contentEditorialQuality";
import {
  resolveContentOpportunityContract,
  type ContentOpportunityContract,
} from "@/lib/contentOpportunityContracts";
import { prisma } from "@/lib/prisma";
import { createLoggedChatCompletion } from "@/server/ai/aiGateway";
import { resolveOpenAIChatModel, resolveOpenAIReasoningEffort } from "@/server/ai/modelConfig";

const guidedRewriteInputSchema = z.object({
  sermonId: z.string().trim().min(1),
  opportunityId: z.string().trim().min(1),
  variant: z.enum(GUIDED_REWRITE_VARIANTS),
  currentDraft: z.object({
    title: z.string().trim().min(1).max(200),
    shortDescription: z.string().trim().max(400),
    content: z.string().trim().min(1).max(10_000),
  }).strict(),
}).strict();

export type GuidedRewriteActionState = {
  success: boolean;
  message: string;
  suggestion?: GuidedRewriteSuggestion;
};

function contractEvidence(contract: ContentOpportunityContract): GuidedRewriteEvidence[] {
  return contract.sourceEvidence.flatMap((evidence): GuidedRewriteEvidence[] => {
    if (evidence.kind === "SCRIPTURE") return [];
    if (evidence.kind === "TRANSCRIPT_SPAN") {
      return [{ label: "Stored transcript evidence", text: evidence.excerpt }];
    }
    if (evidence.kind === "MINISTRY_MOMENT" && evidence.verification.status === "VERIFIED") {
      return [{
        label: "Reviewed ministry moment",
        text: [evidence.title, evidence.excerpt].filter(Boolean).join(" — "),
      }];
    }
    if (evidence.kind === "CLIP" && evidence.verification.status === "VERIFIED") {
      return [{ label: "Reviewed sermon clip", text: evidence.title }];
    }
    return [];
  });
}
function uniqueEvidence(values: GuidedRewriteEvidence[]): GuidedRewriteEvidence[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = `${value.label}\u0000${value.text}`.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("en");
    if (!value.text.trim() || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).slice(0, 20);
}

function allowedEvidenceText(
  evidence: readonly GuidedRewriteEvidence[],
  profile: MinistryVoiceProfile,
): string {
  return [
    ...evidence.flatMap((item) => [item.label, item.text]),
    profile.identity.churchName,
    profile.identity.speakerName,
    profile.identity.sermonTitle,
    profile.identity.sermonDate,
    profile.identity.language,
    ...profile.anchors
      .filter((anchor) => anchor.kind !== "SCRIPTURE")
      .flatMap((anchor) => [anchor.value, anchor.evidence]),
  ].filter((value): value is string => Boolean(value?.trim())).join("\n");
}

function hasLeadershipGrounding(value: string): boolean {
  return /\b(?:leader(?:ship|s)?|integrity|stewardship|resilien(?:ce|t)|serv(?:e|es|ed|ing|ice|ant))\b/iu.test(value);
}

export async function requestGuidedContentRewriteAction(
  input: z.infer<typeof guidedRewriteInputSchema>,
): Promise<GuidedRewriteActionState> {
  const parsed = guidedRewriteInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, message: "Check the draft fields, then try the guided rewrite again." };
  }

  try {
    const [opportunity, branding] = await Promise.all([
      prisma.contentOpportunity.findFirst({
        where: {
          id: parsed.data.opportunityId,
          sermonId: parsed.data.sermonId,
        },
        select: {
          id: true,
          opportunityType: true,
          structuredContentJson: true,
          sourceTranscriptExcerpt: true,
          relatedScripture: true,
          suggestedPlatform: true,
          relatedClip: { select: { title: true } },
          ministryMoment: { select: { title: true } },
          sermon: {
            select: {
              title: true,
              speakerName: true,
              churchName: true,
              language: true,
              sermonDate: true,
              intelligence: {
                select: {
                  isManuallyReviewed: true,
                  manualTitle: true,
                  manualSummary: true,
                  manualCentralTheme: true,
                },
              },
              topicTags: {
                where: {
                  OR: [
                    { isManuallyAdded: true },
                    { evidence: { not: null } },
                  ],
                },
                select: {
                  topic: true,
                  evidence: true,
                  isManuallyAdded: true,
                },
                orderBy: { confidenceScore: "desc" },
                take: 20,
              },
              ministryMoments: {
                where: { reviewStatus: "APPROVED" },
                select: {
                  title: true,
                  description: true,
                  transcriptExcerpt: true,
                  suggestedAudience: true,
                  reviewStatus: true,
                },
                orderBy: { confidenceScore: "desc" },
                take: 12,
              },
            },
          },
        },
      }),
      prisma.brandingSettings.findUnique({
        where: { id: "local" },
        select: {
          churchName: true,
          primaryBrandColor: true,
          secondaryBrandColor: true,
          defaultFontFamily: true,
          defaultCaptionStyleName: true,
        },
      }),
    ]);

    if (!opportunity) {
      return { success: false, message: "This content idea could not be found for the selected sermon." };
    }
    if (!supportsGuidedRewrite(opportunity.opportunityType)) {
      return {
        success: false,
        message: "Guided rewrites are off for quote and Scripture graphics. Edit and verify their exact wording manually.",
      };
    }

    const currentDraft: GuidedRewriteDraft = parsed.data.currentDraft;
    const resolved = resolveContentOpportunityContract({
      opportunityType: opportunity.opportunityType,
      structuredContent: opportunity.structuredContentJson,
      bodyContent: currentDraft.content,
      title: currentDraft.title,
      sourceTranscriptExcerpt: opportunity.sourceTranscriptExcerpt,
      relatedScripture: opportunity.relatedScripture,
      relatedMinistryMomentTitle: opportunity.ministryMoment?.title,
      relatedClipTitle: opportunity.relatedClip?.title,
      suggestedPlatform: opportunity.suggestedPlatform,
    });
    const profile = deriveMinistryVoiceProfile({
      branding,
      sermon: opportunity.sermon,
    });
    const evidence = uniqueEvidence([
      ...(opportunity.sourceTranscriptExcerpt?.trim()
        ? [{ label: "Stored opportunity transcript excerpt", text: opportunity.sourceTranscriptExcerpt }]
        : []),
      ...contractEvidence(resolved.contract),
      ...(opportunity.sermon.intelligence?.isManuallyReviewed
        ? [
            opportunity.sermon.intelligence.manualCentralTheme
              ? { label: "Reviewed sermon theme", text: opportunity.sermon.intelligence.manualCentralTheme }
              : null,
            opportunity.sermon.intelligence.manualSummary
              ? { label: "Reviewed sermon summary", text: opportunity.sermon.intelligence.manualSummary }
              : null,
          ].filter((item): item is GuidedRewriteEvidence => item !== null)
        : []),
      ...opportunity.sermon.topicTags.flatMap((topic): GuidedRewriteEvidence[] => (
        topic.evidence?.trim()
          ? [{ label: `Grounded sermon topic: ${topic.topic}`, text: topic.evidence }]
          : topic.isManuallyAdded
            ? [{ label: "Manually reviewed sermon topic", text: topic.topic }]
            : []
      )),
      ...opportunity.sermon.ministryMoments.flatMap((moment): GuidedRewriteEvidence[] => (
        moment.transcriptExcerpt?.trim()
          ? [{
              label: `Approved ministry moment: ${moment.title}`,
              text: [moment.description, moment.transcriptExcerpt].filter(Boolean).join(" — "),
            }]
          : []
      )),
    ]);
    const groundingText = allowedEvidenceText(evidence, profile);
    if (
      parsed.data.variant === "LEADERSHIP"
      && !hasLeadershipGrounding(`${currentDraft.title}\n${currentDraft.shortDescription}\n${currentDraft.content}\n${groundingText}`)
    ) {
      return {
        success: false,
        message: "A leadership angle is not present in this draft or its reviewed sermon evidence. Choose another guided rewrite.",
      };
    }

    const prompt = buildGuidedRewritePrompt({
      opportunityType: opportunity.opportunityType,
      contract: resolved.contract,
      variant: parsed.data.variant,
      draft: currentDraft,
      evidence,
      voiceProfile: profile,
    });
    const model = resolveOpenAIChatModel("contentMultiplication");
    const suggestion = await createLoggedChatCompletion({
      operation: "content_guided_rewrite",
      model,
      reasoningEffort: resolveOpenAIReasoningEffort("contentMultiplication", model),
      temperature: 0.2,
      response_format: { type: "json_object" },
      sermonId: parsed.data.sermonId,
      promptVersion: "content-guided-rewrite-v1",
      metadata: {
        opportunityId: opportunity.id,
        opportunityType: opportunity.opportunityType,
        variant: parsed.data.variant,
        reviewOnly: true,
      },
      messages: [
        { role: "system", content: prompt.system },
        { role: "user", content: prompt.user },
      ],
      missingKeyMessage: "OPENAI_API_KEY is required for guided content rewrites.",
      validateResponse: (completion) => {
        const responseText = completion.choices[0]?.message.content;
        if (!responseText) {
          throw new GuidedRewriteValidationError("The rewrite response was empty. Please try again.");
        }
        const response = parseGuidedRewriteModelResponse(responseText);
        return validateAndBuildGuidedRewriteSuggestion({
          opportunityType: opportunity.opportunityType,
          contract: resolved.contract,
          response,
          variant: parsed.data.variant,
          currentDraft,
          allowedEvidenceText: groundingText,
          voiceProfile: profile,
        });
      },
    });

    return {
      success: true,
      message: "A guided suggestion was applied to the review draft. Review every word; it is not approved or published.",
      suggestion,
    };
  } catch (error) {
    if (error instanceof GuidedRewriteValidationError) {
      return { success: false, message: error.message };
    }
    console.error("Guided content rewrite failed.", error);
    return { success: false, message: "The guided rewrite could not be completed safely. Please try again." };
  }
}
