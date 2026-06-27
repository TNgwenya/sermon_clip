import { describe, expect, it } from "vitest";

import { applyHookBoundaryAdjustment } from "@/server/agents/clipHookAnalysisService";
import { scoreProfessionalClipQuality } from "@/server/agents/clipQualityScoringService";
import { scoreAudioQuality } from "@/server/agents/audioQualityScoringService";
import { validateCaptionQuality } from "@/server/agents/captionQualityValidationService";
import { __clipVisualQualityTestUtils } from "@/server/agents/clipVisualQualityService";
import { semanticDedupeCandidates } from "@/server/agents/semanticDedupe";
import { clipJsonCandidateSchema } from "@/server/ai/clipJsonSchema";

const transcriptSegments = [
  { startTimeSeconds: 0, endTimeSeconds: 10, text: "God has not forgotten you." },
  { startTimeSeconds: 10, endTimeSeconds: 30, text: "And that is why we keep walking by faith." },
  { startTimeSeconds: 30, endTimeSeconds: 70, text: "The Scripture teaches us that faith trusts God even before the answer appears." },
  { startTimeSeconds: 70, endTimeSeconds: 95, text: "Today, choose to trust him and take the next step." },
];

const baseCandidate = {
  startTimeSeconds: 10,
  endTimeSeconds: 95,
  durationSeconds: 85,
  transcriptText: "And that is why we keep walking by faith. The Scripture teaches us that faith trusts God even before the answer appears. Today, choose to trust him and take the next step.",
  title: "Keep Walking By Faith",
  hook: "And that is why we keep walking by faith.",
  caption: "God has not forgotten you. Keep walking by faith, trust his Word, and choose the next step today.",
  score: 8,
  landingSentence: "Today, choose to trust him and take the next step.",
  clipType: "teaching",
  smartClipCategory: "Best Faith Clip",
  ministryValue: "Encourages people to trust God with scripture.",
  socialValue: "Useful as a short-form encouragement clip.",
  riskLevel: "LOW" as const,
  riskReasons: [],
  contextWarning: false,
  boundaryQuality: "GOOD" as const,
  boundaryQualityScore: 9,
  standaloneClarityScore: 8,
  emotionalImpactScore: 7.8,
  sermonValueScore: 8.5,
  shareabilityScore: 7.6,
  visualReadinessScore: 8,
  renderStatus: "COMPLETED",
};

describe("professional clip quality integration flow", () => {
  it("runs transcript to hook adjustment, arc/content scoring, dedupe, and post-ready review", () => {
    const aiCandidate = clipJsonCandidateSchema.parse({
      ...baseCandidate,
      hashtags: ["#Faith"],
      reasonSelected: "Clear faith teaching.",
      intendedAudience: "People who need encouragement",
      ministryMomentType: "ENCOURAGEMENT_MOMENT",
      riskReasons: [],
    });
    const hookAdjusted = applyHookBoundaryAdjustment(aiCandidate, transcriptSegments);
    const audio = scoreAudioQuality({
      hasAudio: true,
      averageLoudness: -18,
      peakLoudness: -3,
      silenceAtBeginningSeconds: 0.2,
      silenceAtEndSeconds: 0.3,
    });
    const caption = validateCaptionQuality({
      clipStartTimeSeconds: hookAdjusted.candidate.startTimeSeconds,
      clipEndTimeSeconds: hookAdjusted.candidate.endTimeSeconds,
      transcriptText: hookAdjusted.candidate.transcriptText,
      cues: [
        {
          startTimeSeconds: hookAdjusted.candidate.startTimeSeconds,
          endTimeSeconds: hookAdjusted.candidate.startTimeSeconds + 3,
          text: "God has not forgotten you.",
          lineCount: 1,
          safeZoneOk: true,
          contrastOk: true,
        },
        {
          startTimeSeconds: hookAdjusted.candidate.startTimeSeconds + 3,
          endTimeSeconds: hookAdjusted.candidate.endTimeSeconds,
          text: hookAdjusted.candidate.caption,
          lineCount: 2,
          safeZoneOk: true,
          contrastOk: true,
        },
      ],
    });
    const visual = __clipVisualQualityTestUtils.computeVisualQualityRefresh({
      score: hookAdjusted.candidate.score,
      hookStrengthScore: 8,
      standaloneClarityScore: 8,
      emotionalImpactScore: 8,
      sermonValueScore: 8,
      shareabilityScore: 8,
      contextSafetyScore: 8,
      boundaryQualityScore: 9,
      riskLevel: "LOW",
      contextWarning: false,
      boundaryQuality: "GOOD",
      recommendedAction: "KEEP",
      pastorFriendlyReason: "Good fixture.",
      qualitySummary: "Good fixture.",
      qualityWarnings: [],
      expectedDurationSeconds: hookAdjusted.candidate.durationSeconds,
      exportLayoutStrategy: "SMART_CROP",
      renderStatus: "COMPLETED",
      tracking: [
        { kind: "BODY", source: "MODEL", confidenceScore: 0.9, sampleCount: 5 },
        { kind: "FACE", source: "MODEL", confidenceScore: 0.84, sampleCount: 5 },
      ],
      renderQc: {
        outputExists: true,
        renderStatus: "COMPLETED",
        fileSizeBytes: 2_000_000,
        durationSeconds: hookAdjusted.candidate.durationSeconds,
        width: 1080,
        height: 1920,
        hasAudio: true,
      },
    });
    const scored = scoreProfessionalClipQuality({
      ...hookAdjusted.candidate,
      boundaryQuality: hookAdjusted.candidate.boundaryQuality ?? "GOOD",
      renderStatus: "COMPLETED",
      visualQualityScore: visual.visualQualityScore,
      audioQualityScore: audio.audioQualityScore,
      averageLoudness: audio.averageLoudness,
      peakLoudness: audio.peakLoudness,
      silenceAtBeginningSeconds: audio.silenceAtBeginningSeconds,
      silenceAtEndSeconds: audio.silenceAtEndSeconds,
      audioWarnings: audio.audioWarnings,
      captionQualityScore: caption.captionQualityScore,
      captionData: {
        cues: [
          {
            startSeconds: 0,
            endSeconds: 20,
            text: "God has not forgotten you.",
            lineCount: 2,
            safeZoneOk: true,
            contrastOk: true,
          },
          {
            startSeconds: 20,
            endSeconds: 45,
            text: "Keep walking by faith and trust his Word.",
            lineCount: 2,
            safeZoneOk: true,
            contrastOk: true,
          },
          {
            startSeconds: 45,
            endSeconds: hookAdjusted.candidate.durationSeconds,
            text: "Today, choose to trust him and take the next step.",
            lineCount: 2,
            safeZoneOk: true,
            contrastOk: true,
          },
        ],
      },
    });
    const duplicate = scoreProfessionalClipQuality({
      ...hookAdjusted.candidate,
      boundaryQuality: hookAdjusted.candidate.boundaryQuality ?? "GOOD",
      title: "Faith Keeps Walking",
      startTimeSeconds: 12,
      endTimeSeconds: 94,
    });
    const deduped = semanticDedupeCandidates([
      { ...hookAdjusted.candidate, ...scored },
      { ...hookAdjusted.candidate, ...duplicate, title: "Faith Keeps Walking", startTimeSeconds: 12, endTimeSeconds: 94 },
    ]);

    expect(hookAdjusted.adjusted).toBe(true);
    expect(scored.hookScore).toBeGreaterThanOrEqual(6);
    expect(scored.arcCompletenessScore).toBeGreaterThan(6);
    expect(deduped.kept).toHaveLength(1);
    expect(scored.postReadyStatus).toBe("POST_READY");
    const insertPayload = {
      sermonId: "sermon-fixture",
      title: hookAdjusted.candidate.title,
      rawAiCandidate: aiCandidate,
      startTimeSeconds: hookAdjusted.candidate.startTimeSeconds,
      endTimeSeconds: hookAdjusted.candidate.endTimeSeconds,
      visualQualityScore: visual.visualQualityScore,
      audioQualityScore: audio.audioQualityScore,
      captionQualityScore: caption.captionQualityScore,
      qualityDebugSnapshot: {
        hookAnalysis: { hookScore: scored.hookScore },
        arcAnalysis: { clipArcType: scored.clipArcType },
        scoreBreakdown: { finalQualityScore: scored.finalQualityScore },
      },
    };
    expect(insertPayload.rawAiCandidate.arcType).toBeTruthy();
    expect(insertPayload.audioQualityScore).toBeGreaterThan(7);
    expect(insertPayload.captionQualityScore).toBeGreaterThan(7);
    expect(insertPayload.qualityDebugSnapshot.scoreBreakdown.finalQualityScore).toBeGreaterThan(7);
  });

  it("regresses rendered but not post-ready for weak openings and caption gaps", () => {
    const scored = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "And the next thing is because of what we already said",
      hook: "And the next thing",
      caption: "",
      standaloneClarityScore: 4,
      boundaryQuality: "NEEDS_REVIEW",
      boundaryQualityScore: 5,
      contextWarning: true,
      renderStatus: "COMPLETED",
    });

    expect(scored.postReadyStatus).not.toBe("POST_READY");
    expect(scored.qualityWarnings).toContain("WEAK_HOOK");
    expect(scored.postReadyBlockers.length).toBeGreaterThan(0);
  });
});
