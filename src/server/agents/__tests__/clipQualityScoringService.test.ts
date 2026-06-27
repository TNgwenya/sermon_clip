import { describe, expect, it } from "vitest";

import {
  scoreProfessionalClipQuality,
  sortByProfessionalQuality,
} from "@/server/agents/clipQualityScoringService";

const baseCandidate = {
  startTimeSeconds: 20,
  endTimeSeconds: 80,
  durationSeconds: 60,
  transcriptText: "God has not forgotten you. The Scripture teaches us that faith keeps walking. Today, choose to trust him.",
  title: "God Has Not Forgotten You",
  hook: "God has not forgotten you.",
  caption: "Keep walking by faith today.",
  score: 8.4,
  clipType: "teaching",
  smartClipCategory: "Best Faith Clip",
  ministryValue: "Encourages people to trust God with scripture.",
  socialValue: "Clear short-form encouragement.",
  riskLevel: "LOW" as const,
  contextWarning: false,
  boundaryQuality: "GOOD" as const,
  boundaryQualityScore: 9,
  standaloneClarityScore: 8.5,
  emotionalImpactScore: 8,
  sermonValueScore: 8.8,
  shareabilityScore: 8,
  visualReadinessScore: 8,
  captionQualityScore: 8.5,
  captionData: {
    cues: [
      {
        startSeconds: 0,
        endSeconds: 20,
        text: "God has not forgotten you.",
        lineCount: 1,
        safeZoneOk: true,
        contrastOk: true,
      },
      {
        startSeconds: 20,
        endSeconds: 42,
        text: "The Scripture teaches us that faith keeps walking.",
        lineCount: 2,
        safeZoneOk: true,
        contrastOk: true,
      },
      {
        startSeconds: 42,
        endSeconds: 60,
        text: "Today, choose to trust him.",
        lineCount: 1,
        safeZoneOk: true,
        contrastOk: true,
      },
    ],
  },
  renderStatus: "COMPLETED",
};

describe("professional clip quality scoring service", () => {
  it("produces professional score fields and ranking buckets", () => {
    const result = scoreProfessionalClipQuality(baseCandidate);

    expect(result.finalQualityScore).toBeGreaterThan(7);
    expect(result.qualityLabel).not.toBe("REJECT");
    expect(result.rankingCategory).toMatch(/BEST_|NEEDS_REVIEW/);
    expect(result.qualityReasons.length).toBeGreaterThan(0);
  });

  it("does not downgrade strong discovery candidates just because media has not rendered yet", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      renderStatus: undefined,
      score: 9.2,
      standaloneClarityScore: 9,
      emotionalImpactScore: 8.8,
      sermonValueScore: 9.4,
      shareabilityScore: 9,
      visualReadinessScore: 9,
      captionData: {
        cues: [
          {
            startSeconds: 0,
            endSeconds: 20,
            text: "God has not forgotten you.",
            lineCount: 1,
            safeZoneOk: true,
            contrastOk: true,
          },
          {
            startSeconds: 20,
            endSeconds: 42,
            text: "The Scripture teaches us that faith keeps walking.",
            lineCount: 2,
            safeZoneOk: true,
            contrastOk: true,
          },
          {
            startSeconds: 42,
            endSeconds: 60,
            text: "Today, choose to trust him.",
            lineCount: 1,
            safeZoneOk: true,
            contrastOk: true,
          },
        ],
      },
    });

    expect(result.postReadyStatus).toBe("POST_READY");
    expect(result.qualityLabel).toBe("POST_READY");
    expect(result.postReadyBlockers).not.toContain("Rendered preview is not complete yet.");
  });

  it("downgrades valid but weak AI clips", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "And the next thing is connected to the previous point",
      hook: "And the next thing",
      score: 7,
      standaloneClarityScore: 4.5,
      boundaryQuality: "NEEDS_REVIEW",
      boundaryQualityScore: 5,
      contextWarning: true,
      renderStatus: "COMPLETED",
    });

    expect(result.hookScore).toBeLessThan(6);
    expect(result.qualityLabel).not.toBe("POST_READY");
    expect(result.qualityWarnings).toContain("WEAK_HOOK");
  });

  it("does not call merely decent clips good enough for pastor review", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      score: 6.9,
      hookScore: 6.5,
      standaloneClarityScore: 6.8,
      emotionalImpactScore: 6.4,
      sermonValueScore: 7,
      shareabilityScore: 6.8,
      visualReadinessScore: 6.8,
      boundaryQualityScore: 7,
    });

    expect(result.finalQualityScore).toBeLessThan(7.2);
    expect(result.qualityLabel).not.toBe("REJECT");
  });

  it("keeps grounded clips with repairable boundary/completeness issues as editing options", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "Because God placed a gift in your hand for the church, so this week choose one faithful act of service and stir up your gift.",
      hook: "Because God placed a gift in your hand.",
      score: 9.4,
      standaloneClarityScore: 4.2,
      boundaryQuality: "BAD",
      boundaryQualityScore: 3.8,
      contextWarning: true,
      completenessScore: 3.9,
      completenessAction: "REJECT_INCOMPLETE",
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(4);
    expect(result.qualityLabel).not.toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_BAD_BOUNDARY");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_INCOMPLETE_THOUGHT");
  });

  it("keeps high-scoring clips with weak openings as edit options", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      hookScore: 5.1,
      standaloneClarityScore: 8.3,
      score: 9.2,
      sermonValueScore: 9,
      shareabilityScore: 9,
      visualReadinessScore: 8.5,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(7);
    expect(result.qualityLabel).not.toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_WEAK_OPENING");
  });

  it("keeps high-scoring clips that do not clearly stand alone in pastor review", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      hookScore: 7.8,
      standaloneClarityScore: 5.4,
      score: 9.1,
      sermonValueScore: 9,
      shareabilityScore: 9,
      visualReadinessScore: 8.5,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(7);
    expect(result.qualityLabel).toBe("GOOD_NEEDS_REVIEW");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_LOW_STANDALONE_CLARITY");
  });

  it("does not call context-dependent clips post-ready even when the score is high", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      hookScore: 8.4,
      standaloneClarityScore: 6.8,
      score: 9.2,
      sermonValueScore: 9.2,
      shareabilityScore: 9,
      visualReadinessScore: 9,
      boundaryQualityScore: 9,
      contextWarning: true,
      riskLevel: "LOW",
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(8.2);
    expect(result.qualityLabel).toBe("GOOD_NEEDS_REVIEW");
    expect(result.qualityLabel).not.toBe("POST_READY");
  });

  it("keeps high-scoring clips that start with dependent sermon context as editing options", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "As I said earlier, God placed a gift in your hand for the church, so this week choose one faithful act of service and stir up your gift.",
      hook: "As I said earlier",
      hookScore: 8.6,
      standaloneClarityScore: 8.2,
      score: 9.3,
      sermonValueScore: 9.1,
      shareabilityScore: 9,
      visualReadinessScore: 9,
      boundaryQualityScore: 9,
      contextWarning: false,
      riskLevel: "LOW",
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(8);
    expect(result.qualityLabel).not.toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_DEPENDENT_OPENING");
  });

  it("keeps high-scoring clips that end mid-thought as editing options", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God has not forgotten you. Today choose to keep walking by faith because his grace is carrying you because",
      hook: "God has not forgotten you.",
      hookScore: 8.8,
      standaloneClarityScore: 8.5,
      score: 9.1,
      sermonValueScore: 9,
      shareabilityScore: 9,
      visualReadinessScore: 9,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(8);
    expect(result.qualityLabel).not.toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_DANGLING_ENDING");
  });

  it("keeps strong connector openings reviewable instead of post-ready", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "And God has not forgotten you. The Scripture teaches us that faith keeps walking. Today, choose to trust him.",
      hook: "And God has not forgotten you.",
      hookScore: 8.5,
      standaloneClarityScore: 8.4,
      score: 8.9,
      sermonValueScore: 8.9,
      shareabilityScore: 8.8,
      visualReadinessScore: 8.8,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.qualityLabel).toBe("GOOD_NEEDS_REVIEW");
    expect(result.qualityWarnings).toContain("PASTOR_REVIEW_OPENING_CONNECTOR");
  });

  it("rejects church logistics even when the AI score is high", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "Please scan the QR code on the screen for giving and registration. The parking team will help you in the lobby after service.",
      title: "Giving and Registration",
      hook: "Please scan the QR code.",
      caption: "Scan the code for giving and registration.",
      ministryValue: "Administrative reminder for the congregation.",
      hookScore: 8.2,
      standaloneClarityScore: 8.1,
      score: 9,
      sermonValueScore: 8.8,
      shareabilityScore: 8.6,
      visualReadinessScore: 8.8,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(8);
    expect(result.qualityLabel).toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_NON_SERMON_LOGISTICS");
  });

  it("rejects warm-up banter that has no ministry payoff", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "Good morning church. Are you ready today? Turn to your neighbor and tell somebody you look good.",
      title: "Good Morning Church",
      hook: "Good morning church.",
      caption: "Turn to your neighbor.",
      ministryValue: "Opening warm-up moment.",
      hookScore: 8,
      standaloneClarityScore: 8,
      score: 8.8,
      sermonValueScore: 8.5,
      shareabilityScore: 8.5,
      visualReadinessScore: 8.5,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.qualityLabel).toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_WARMUP_FILLER");
  });

  it("rejects polished motivational clips that have no spiritual sermon anchor", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "You are stronger than the pressure around you. Keep showing up, keep building, and refuse to quit when it gets difficult.",
      title: "Keep Showing Up",
      hook: "You are stronger than the pressure around you.",
      caption: "Keep showing up when it gets difficult.",
      clipType: "leadership",
      smartClipCategory: "Best Leadership Clip",
      ministryValue: "Motivational encouragement.",
      socialValue: "Clear motivational clip.",
      hookScore: 8.6,
      standaloneClarityScore: 8.7,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 9,
      visualReadinessScore: 9,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(8);
    expect(result.qualityLabel).toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_NO_SPIRITUAL_ANCHOR");
  });

  it("rejects clips where only generated metadata adds the spiritual anchor", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "You are stronger than the pressure around you. Keep showing up, keep building, and refuse to quit when it gets difficult.",
      title: "God Will Strengthen You",
      hook: "God will strengthen you in pressure.",
      caption: "Choose faith and keep going today.",
      clipType: "inspirational",
      smartClipCategory: "Best Faith Clip",
      ministryValue: "Encourages faith in God during pressure.",
      socialValue: "Clear spiritual encouragement.",
      hookScore: 8.6,
      standaloneClarityScore: 8.7,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 9,
      visualReadinessScore: 9,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(8);
    expect(result.qualityLabel).toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_TRANSCRIPT_NO_SPIRITUAL_ANCHOR");
  });

  it("rejects spiritually themed clips that do not land a clear sermon takeaway", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "We are looking at scripture on the screen and several notes are there for everyone in the room.",
      title: "Scripture On The Screen",
      hook: "We are looking at scripture on the screen.",
      caption: "A scripture moment from the sermon.",
      ministryValue: "Mentions a scripture section.",
      socialValue: "Short church moment.",
      hookScore: 8.4,
      standaloneClarityScore: 8.2,
      score: 8.8,
      sermonValueScore: 8.8,
      shareabilityScore: 8.5,
      visualReadinessScore: 8.8,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.qualityLabel).toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_NO_CLEAR_TAKEAWAY");
  });

  it("rejects clips where only metadata adds the sermon takeaway", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "The scripture passage is on the screen and the notes are available for everyone following along.",
      title: "Choose Faith Today",
      hook: "Choose faith today.",
      caption: "Trust God and walk in obedience this week.",
      ministryValue: "Calls believers to trust God and obey.",
      socialValue: "Clear application for social.",
      hookScore: 8.4,
      standaloneClarityScore: 8.2,
      score: 8.8,
      sermonValueScore: 8.8,
      shareabilityScore: 8.5,
      visualReadinessScore: 8.8,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.qualityLabel).toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_TRANSCRIPT_NO_CLEAR_TAKEAWAY");
  });

  it("allows post-ready scoring when the spoken excerpt itself carries the sermon anchor and takeaway", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God gives strength when pressure comes. Scripture reminds us that faith keeps walking, so this week choose obedience and pray again.",
      title: "Choose Obedience This Week",
      hook: "God gives strength when pressure comes.",
      caption: "Choose obedience and pray again this week.",
      ministryValue: "A clear faith application from scripture.",
      socialValue: "Strong discipleship encouragement.",
      hookScore: 8.7,
      standaloneClarityScore: 8.8,
      score: 9,
      sermonValueScore: 9.1,
      shareabilityScore: 8.8,
      visualReadinessScore: 8.8,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.qualityWarnings).not.toContain("PASTOR_GRADE_TRANSCRIPT_NO_SPIRITUAL_ANCHOR");
    expect(result.qualityWarnings).not.toContain("PASTOR_GRADE_TRANSCRIPT_NO_CLEAR_TAKEAWAY");
    expect(result.qualityLabel).not.toBe("REJECT");
  });

  it("rejects polished setup-only clips that mention scripture but do not land the point", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "Today I want to show you why faith matters. We need to understand scripture before we can see what obedience requires.",
      title: "Why Faith Matters",
      hook: "Today I want to show you why faith matters.",
      caption: "Understanding why faith matters.",
      ministryValue: "Introduces a scripture teaching about faith and obedience.",
      socialValue: "Polished teaching setup.",
      hookScore: 8.7,
      standaloneClarityScore: 8.8,
      score: 9,
      sermonValueScore: 9.2,
      shareabilityScore: 9,
      visualReadinessScore: 9,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(8);
    expect(result.qualityLabel).not.toBe("REJECT");
    expect(result.postReadyStatus).toBe("NEEDS_EDITING");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_SETUP_WITHOUT_LANDING");
    expect(result.postReadyBlockers.join(" ")).toContain("landing");
  });

  it("allows a setup phrase when the spoken excerpt also lands with application", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "Today I want to show you why faith matters. God gives courage when pressure comes, so this week choose obedience and pray again.",
      title: "Choose Obedience This Week",
      hook: "Today I want to show you why faith matters.",
      caption: "Choose obedience and pray again this week.",
      ministryValue: "A clear faith application from scripture.",
      socialValue: "Strong discipleship encouragement.",
      hookScore: 8.7,
      standaloneClarityScore: 8.8,
      score: 9,
      sermonValueScore: 9.1,
      shareabilityScore: 8.8,
      visualReadinessScore: 8.8,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.qualityWarnings).not.toContain("PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION");
    expect(result.qualityWarnings).not.toContain("PASTOR_GRADE_SETUP_WITHOUT_LANDING");
    expect(result.qualityLabel).not.toBe("REJECT");
  });

  it("rejects generic spiritual truth that never lands with the hearer", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God is faithful. God is good. The Scripture is true. Grace is beautiful. Faith matters in every season.",
      title: "God Is Faithful",
      hook: "God is faithful.",
      caption: "A reminder that God is faithful.",
      ministryValue: "A general faith reminder.",
      socialValue: "Simple encouragement.",
      hookScore: 8.6,
      standaloneClarityScore: 8.7,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 9,
      visualReadinessScore: 9,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(8);
    expect(result.qualityLabel).not.toBe("REJECT");
    expect(result.postReadyStatus).toBe("NEEDS_EDITING");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION");
  });

  it("allows a spiritual declaration when it carries personal ministry payoff", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God has not forgotten you in the pressure. His grace strengthens your faith, so today choose to trust him and take one obedient step.",
      title: "God Has Not Forgotten You",
      hook: "God has not forgotten you in the pressure.",
      caption: "Choose to trust him and take one obedient step.",
      ministryValue: "A clear faith application from scripture.",
      socialValue: "Strong discipleship encouragement.",
      hookScore: 8.7,
      standaloneClarityScore: 8.8,
      score: 9,
      sermonValueScore: 9.1,
      shareabilityScore: 8.8,
      visualReadinessScore: 8.8,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.qualityWarnings).not.toContain("PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION");
    expect(result.qualityLabel).not.toBe("REJECT");
  });

  it("allows calling and gift clips when the spoken excerpt calls for stewardship", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God has placed a gift in you, and the Holy Spirit did not give it so it could stay hidden. Paul tells Timothy to stir up what God gave. Use what grace entrusted to you, step into your calling, and serve with what is in your hand.",
      title: "Stir Up What God Gave",
      hook: "God has placed a gift in you.",
      caption: "Stir up what God gave and serve with what is in your hand.",
      ministryValue: "Calls believers to steward their God-given gift.",
      socialValue: "Clear discipleship encouragement.",
      hookScore: 8.7,
      standaloneClarityScore: 8.8,
      score: 9,
      sermonValueScore: 9.1,
      shareabilityScore: 8.9,
      visualReadinessScore: 8.8,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.qualityWarnings).not.toContain("PASTOR_GRADE_TRANSCRIPT_NO_CLEAR_TAKEAWAY");
    expect(result.qualityWarnings).not.toContain("PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION");
    expect(result.qualityLabel).not.toBe("REJECT");
  });

  it("still rejects generic gift teaching when it lacks stewardship payoff", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "Spiritual gifts are important in the New Testament. There are different views about gifts, and many churches teach about gifts in different ways. This subject is worth studying because it appears in several letters.",
      title: "Spiritual Gifts Matter",
      hook: "Spiritual gifts are important.",
      caption: "A teaching moment about spiritual gifts.",
      ministryValue: "Explains spiritual gifts.",
      socialValue: "A teaching excerpt.",
      hookScore: 8.7,
      standaloneClarityScore: 8.8,
      score: 9,
      sermonValueScore: 9.1,
      shareabilityScore: 8.9,
      visualReadinessScore: 8.8,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.qualityLabel).toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_NO_PAYOFF_OR_APPLICATION");
  });

  it("rejects unsupported dramatic claims introduced by clip metadata", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God has placed a gift in you. The Scripture teaches us to serve faithfully with what is already in our hands. This week, choose obedience and encourage somebody.",
      title: "Your Financial Breakthrough Is Here",
      hook: "God has placed a gift in you.",
      caption: "Your financial breakthrough is here. Step into it today.",
      ministryValue: "Encourages faithful obedience and service.",
      socialValue: "Clear discipleship encouragement.",
      hookScore: 8.6,
      standaloneClarityScore: 8.7,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 9,
      visualReadinessScore: 9,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(8);
    expect(result.qualityLabel).toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_UNSUPPORTED_METADATA_CLAIM");
  });

  it("does not let AI ministry metadata justify a dramatic claim absent from the spoken excerpt", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God has placed a gift in you. The Scripture teaches us to serve faithfully with what is already in our hands. This week, choose obedience and encourage somebody.",
      title: "Your Financial Breakthrough Is Here",
      hook: "Your financial breakthrough is here.",
      caption: "Step into your financial breakthrough today.",
      ministryValue: "Encourages faith for financial breakthrough.",
      socialValue: "A financial breakthrough clip for social media.",
      hookScore: 8.7,
      standaloneClarityScore: 8.7,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 9,
      visualReadinessScore: 9,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(8);
    expect(result.qualityLabel).toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_UNSUPPORTED_METADATA_CLAIM");
  });

  it("allows strong metadata when the dramatic claim is actually in the sermon excerpt", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God can bring healing miracle moments, but today the Scripture calls us to trust him and pray with faith for those who are hurting.",
      title: "Pray For A Healing Miracle",
      hook: "God can bring healing miracle moments.",
      caption: "Pray with faith for those who are hurting.",
      ministryValue: "Encourages prayer and faith for people who are hurting.",
      socialValue: "Clear prayer encouragement.",
      hookScore: 8.6,
      standaloneClarityScore: 8.7,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 9,
      visualReadinessScore: 9,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.qualityWarnings).not.toContain("PASTOR_GRADE_UNSUPPORTED_METADATA_CLAIM");
    expect(result.qualityLabel).not.toBe("REJECT");
  });

  it("rejects high-scoring clips that are too short to carry a sermon thought", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      durationSeconds: 12,
      endTimeSeconds: 32,
      clipType: "teaching",
      smartClipCategory: "Best Teaching Clip",
      hookScore: 8.5,
      standaloneClarityScore: 8.4,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 8.8,
      visualReadinessScore: 8.8,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.durationQualityLabel).toBe("TOO_SHORT");
    expect(result.qualityLabel).toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_TOO_SHORT");
  });

  it("rejects high-scoring clips with too little spoken sermon substance", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      durationSeconds: 60,
      endTimeSeconds: 80,
      transcriptText: "God is faithful. Choose faith today.",
      title: "Choose Faith Today",
      hook: "God is faithful.",
      caption: "Choose faith today.",
      clipType: "teaching",
      smartClipCategory: "Best Faith Clip",
      hookScore: 8.6,
      standaloneClarityScore: 8.7,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 9,
      visualReadinessScore: 9,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.finalQualityScore).toBeGreaterThan(8);
    expect(result.qualityLabel).toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_LOW_SPOKEN_SUBSTANCE");
  });

  it("rejects long clips with very low spoken-word density", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      durationSeconds: 90,
      endTimeSeconds: 110,
      transcriptText: "God is faithful when pressure comes. Scripture reminds us to choose obedience, pray again, and keep walking today.",
      title: "Keep Walking Today",
      hook: "God is faithful when pressure comes.",
      caption: "Choose obedience and pray again.",
      clipType: "teaching",
      smartClipCategory: "Best Faith Clip",
      hookScore: 8.6,
      standaloneClarityScore: 8.7,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 9,
      visualReadinessScore: 9,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.qualityLabel).toBe("REJECT");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_LOW_SPOKEN_DENSITY");
  });

  it("allows short quote-style clips when the spoken quote has enough substance", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      durationSeconds: 28,
      endTimeSeconds: 48,
      transcriptText: "God is faithful when pressure comes, so choose prayer again today and keep walking.",
      title: "God Is Faithful",
      hook: "God is faithful when pressure comes.",
      caption: "Choose prayer again and keep walking.",
      clipType: "inspirational quote",
      smartClipCategory: "Best Quote-Worthy Moment Clip",
      hookScore: 8.7,
      standaloneClarityScore: 8.8,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 9,
      visualReadinessScore: 8.8,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.qualityWarnings).not.toContain("PASTOR_GRADE_LOW_SPOKEN_SUBSTANCE");
    expect(result.qualityWarnings).not.toContain("PASTOR_GRADE_LOW_SPOKEN_DENSITY");
    expect(result.qualityLabel).not.toBe("REJECT");
  });

  it("keeps high-scoring clips that are too long for pastor review", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      durationSeconds: 160,
      endTimeSeconds: 180,
      clipType: "teaching",
      smartClipCategory: "Best Leadership Clip",
      transcriptText: "Leadership begins with obedience. You cannot wait for perfect confidence before you take responsibility. Choose one faithful step today. The church does not grow through hidden gifts, it grows when believers serve with courage, humility, prayer, and consistency. Let the Holy Spirit lead your words, your decisions, your family, and your work so that your authority becomes care and your influence becomes service.",
      hookScore: 8.5,
      standaloneClarityScore: 8.4,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 8.8,
      visualReadinessScore: 8.8,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.durationQualityLabel).toBe("TOO_LONG");
    expect(result.qualityLabel).toBe("NEEDS_EDITING");
    expect(result.qualityWarnings).toContain("PASTOR_GRADE_TOO_LONG");
  });

  it("keeps slightly long quote clips out of post-ready until an editor reviews duration", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      durationSeconds: 55,
      endTimeSeconds: 75,
      clipType: "inspirational quote",
      smartClipCategory: "Best Quote Clip",
      transcriptText: "Leadership begins with obedience. You cannot wait for perfect confidence before you take responsibility. Choose one faithful step today.",
      hookScore: 8.5,
      standaloneClarityScore: 8.4,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 8.8,
      visualReadinessScore: 8.8,
      boundaryQualityScore: 9,
      renderStatus: "COMPLETED",
    });

    expect(result.durationQualityLabel).toBe("SLIGHTLY_LONG");
    expect(result.qualityLabel).not.toBe("POST_READY");
    expect(result.qualityWarnings).toContain("PASTOR_REVIEW_DURATION");
    expect(result.recommendedNextAction).toBe("TRIM_CLIP");
  });

  it("classifies a strong repaired-clean clip as post-ready", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God has placed a gift in you. The Holy Spirit gives courage to serve the church. This week, stir up what God gave you and use your gift to strengthen somebody.",
      title: "Stir Up What God Gave",
      hook: "God has placed a gift in you.",
      caption: "Stir up what God gave and serve somebody this week.",
      hookScore: 8.8,
      standaloneClarityScore: 8.9,
      emotionalImpactScore: 8.7,
      sermonValueScore: 9.2,
      shareabilityScore: 8.9,
      visualReadinessScore: 9,
      boundaryQuality: "GOOD",
      boundaryQualityScore: 9,
      qualityWarnings: ["OPENING_REPAIRED", "LANDING_REPAIRED"],
      captionQualityScore: 8.8,
      audioQualityScore: 8.8,
    });

    expect(result.finalQualityScore).toBeGreaterThanOrEqual(8);
    expect(result.qualityLabel).toBe("POST_READY");
    expect(result.postReadyStatus).toBe("POST_READY");
    expect(result.recommendedNextAction).toBe("POST_NOW");
  });

  it("classifies strong human-review-only clips as good needs review", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "And God has placed a gift in you. The Holy Spirit gives courage to serve the church. This week, stir up what God gave you and use your gift to strengthen somebody.",
      title: "Stir Up What God Gave",
      hook: "And God has placed a gift in you.",
      hookScore: 8.4,
      standaloneClarityScore: 8.5,
      emotionalImpactScore: 8.5,
      sermonValueScore: 9,
      shareabilityScore: 8.8,
      visualReadinessScore: 8.8,
      boundaryQuality: "GOOD",
      boundaryQualityScore: 9,
      captionQualityScore: 8.5,
      audioQualityScore: 8.5,
    });

    expect(result.finalQualityScore).toBeGreaterThanOrEqual(7.2);
    expect(result.qualityWarnings).toContain("PASTOR_REVIEW_OPENING_CONNECTOR");
    expect(result.qualityLabel).toBe("GOOD_NEEDS_REVIEW");
    expect(result.recommendedNextAction).toBe("REVIEW_OPENING");
  });

  it("classifies strong clips that need ending extension as editing work", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God has placed a gift in you. The Holy Spirit gives courage to serve the church. This week, stir up what God gave you and use your gift to strengthen somebody.",
      hookScore: 8.5,
      standaloneClarityScore: 8.4,
      emotionalImpactScore: 8.4,
      sermonValueScore: 9,
      shareabilityScore: 8.7,
      visualReadinessScore: 8.8,
      qualityWarnings: ["NEEDS_CONTEXT_EXTENSION"],
      captionQualityScore: 8.5,
      audioQualityScore: 8.5,
    });

    expect(result.finalQualityScore).toBeGreaterThanOrEqual(7.2);
    expect(result.qualityLabel).toBe("NEEDS_EDITING");
    expect(result.recommendedNextAction).toBe("EXTEND_CONTEXT");
  });

  it("does not force editing when captions have not been evaluated during discovery", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God has placed a gift in you. The Holy Spirit gives courage to serve the church. This week, stir up what God gave you and use your gift to strengthen somebody.",
      caption: "Gift.",
      captionData: null,
      captionQualityScore: undefined,
      hookScore: 8.5,
      standaloneClarityScore: 8.4,
      emotionalImpactScore: 8.4,
      sermonValueScore: 9,
      shareabilityScore: 8.7,
      visualReadinessScore: 8.8,
      audioQualityScore: 8.5,
    });

    expect(result.finalQualityScore).toBeGreaterThanOrEqual(7.2);
    expect(result.qualityWarnings).not.toContain("MISSING_CAPTION_SEGMENTS");
    expect(result.recommendedNextAction).not.toBe("FIX_CAPTIONS");
  });

  it("classifies strong clips with failed caption generation as editing work", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God has placed a gift in you. The Holy Spirit gives courage to serve the church. This week, stir up what God gave you and use your gift to strengthen somebody.",
      caption: "Gift.",
      captionData: null,
      captionQualityScore: undefined,
      captionStatus: "FAILED",
      hookScore: 8.5,
      standaloneClarityScore: 8.4,
      emotionalImpactScore: 8.4,
      sermonValueScore: 9,
      shareabilityScore: 8.7,
      visualReadinessScore: 8.8,
      audioQualityScore: 8.5,
    });

    expect(result.finalQualityScore).toBeGreaterThanOrEqual(7.2);
    expect(result.qualityWarnings).toContain("MISSING_CAPTION_SEGMENTS");
    expect(result.qualityLabel).toBe("NEEDS_EDITING");
    expect(result.recommendedNextAction).toBe("FIX_CAPTIONS");
  });

  it("keeps hard warnings and high risk as rejects", () => {
    const hardWarning = scoreProfessionalClipQuality({
      ...baseCandidate,
      hookScore: 8.7,
      standaloneClarityScore: 8.8,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 9,
      qualityWarnings: ["PASTOR_GRADE_NO_SPIRITUAL_ANCHOR"],
      captionQualityScore: 8.5,
      audioQualityScore: 8.5,
    });
    const highRisk = scoreProfessionalClipQuality({
      ...baseCandidate,
      riskLevel: "HIGH",
      hookScore: 8.7,
      standaloneClarityScore: 8.8,
      score: 9,
      sermonValueScore: 9,
      shareabilityScore: 9,
      captionQualityScore: 8.5,
      audioQualityScore: 8.5,
    });

    expect(hardWarning.qualityLabel).toBe("REJECT");
    expect(hardWarning.recommendedNextAction).toBe("REJECT");
    expect(highRisk.qualityLabel).toBe("REJECT");
    expect(highRisk.recommendedNextAction).toBe("REJECT");
  });

  it("keeps needs-review boundaries without active edit warnings in good needs review", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God has placed a gift in you. The Holy Spirit gives courage to serve the church. This week, stir up what God gave you and use your gift to strengthen somebody.",
      hookScore: 8.4,
      standaloneClarityScore: 8.3,
      emotionalImpactScore: 8.4,
      sermonValueScore: 9,
      shareabilityScore: 8.7,
      boundaryQuality: "NEEDS_REVIEW",
      boundaryQualityScore: 5.8,
      captionQualityScore: 8.5,
      audioQualityScore: 8.5,
    });

    expect(result.finalQualityScore).toBeGreaterThanOrEqual(7.2);
    expect(result.qualityLabel).toBe("GOOD_NEEDS_REVIEW");
    expect(result.recommendedNextAction).toBe("REVIEW_CLIP");
  });

  it("does not recommend review opening without an opening warning or low hook score", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God has placed a gift in you. The Holy Spirit gives courage to serve the church. This week, stir up what God gave you and use your gift to strengthen somebody.",
      hookScore: 8.4,
      standaloneClarityScore: 8.3,
      emotionalImpactScore: 8.4,
      sermonValueScore: 9,
      shareabilityScore: 8.7,
      boundaryQuality: "NEEDS_REVIEW",
      boundaryQualityScore: 5.8,
      captionQualityScore: 8.5,
      audioQualityScore: 8.5,
    });

    expect(result.qualityWarnings).not.toContain("PASTOR_REVIEW_OPENING");
    expect(result.qualityWarnings).not.toContain("PASTOR_REVIEW_OPENING_CONNECTOR");
    expect(result.hookScore).toBeGreaterThanOrEqual(5.5);
    expect(result.recommendedNextAction).not.toBe("REVIEW_OPENING");
  });

  it("keeps filler-heavy clips reviewable but marks them for speech polish", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God has not forgotten you. Um the Scripture teaches us, uh, that faith keeps walking. Uhhhmmm today, you know, choose to trust him and, errrr, take one obedient step.",
      hook: "God has not forgotten you.",
      hookScore: 8.5,
      standaloneClarityScore: 8.5,
      emotionalImpactScore: 8.4,
      sermonValueScore: 9,
      shareabilityScore: 8.8,
      visualReadinessScore: 8.8,
      audioQualityScore: 8.5,
      captionQualityScore: 8.5,
    });

    expect(result.qualityWarnings).toContain("FILLER_WORD_DENSITY");
    expect(result.qualityWarnings).toContain("SPEECH_POLISH_NEEDED");
    expect(result.qualityLabel).toBe("NEEDS_EDITING");
    expect(result.recommendedNextAction).toBe("TRIM_CLIP");
  });

  it("treats long internal silence as a trim problem instead of a hard rejection", () => {
    const result = scoreProfessionalClipQuality({
      ...baseCandidate,
      transcriptText: "God has not forgotten you. The Scripture teaches us that faith keeps walking. Today, choose to trust him and take one obedient step.",
      hookScore: 8.5,
      standaloneClarityScore: 8.5,
      emotionalImpactScore: 8.4,
      sermonValueScore: 9,
      shareabilityScore: 8.8,
      visualReadinessScore: 8.8,
      audioQualityScore: 7.4,
      audioWarnings: ["LONG_INTERNAL_SILENCE"],
      captionQualityScore: 8.5,
    });

    expect(result.audioWarnings).toContain("LONG_INTERNAL_SILENCE");
    expect(result.qualityLabel).toBe("NEEDS_EDITING");
    expect(result.recommendedNextAction).toBe("TRIM_CLIP");
    expect(result.qualityLabel).not.toBe("REJECT");
  });

  it("scores complete sermon arcs above polished but shallow excerpts", () => {
    const sharedSignals = {
      hookScore: 8.5,
      standaloneClarityScore: 8.5,
      emotionalImpactScore: 8,
      sermonValueScore: 8.6,
      shareabilityScore: 8.4,
      visualReadinessScore: 8.3,
      boundaryQualityScore: 8.8,
    };
    const shallow = scoreProfessionalClipQuality({
      ...baseCandidate,
      ...sharedSignals,
      transcriptText: "God is faithful. The Scripture teaches us that faith matters.",
      hook: "God is faithful.",
      caption: "Faith matters.",
    });
    const complete = scoreProfessionalClipQuality({
      ...baseCandidate,
      ...sharedSignals,
      transcriptText: "God is faithful. The Scripture teaches us that faith keeps walking when pressure comes. Today, choose to trust him and take one obedient step.",
      hook: "God is faithful.",
      caption: "Choose to trust him and take one obedient step.",
    });

    expect(complete.arcCompletenessScore).toBeGreaterThan(shallow.arcCompletenessScore);
    expect(complete.finalQualityScore).toBeGreaterThan(shallow.finalQualityScore);
    expect(complete.qualityReasons.join(" ")).toContain("Sermon arc completeness scored");
  });

  it("sorts by quality label before final score", () => {
    const sorted = sortByProfessionalQuality([
      { title: "Needs edit", qualityLabel: "NEEDS_EDITING" as const, finalQualityScore: 9, score: 9, startTimeSeconds: 20 },
      { title: "Post ready", qualityLabel: "POST_READY" as const, finalQualityScore: 8, score: 8, startTimeSeconds: 40 },
    ]);

    expect(sorted[0].title).toBe("Post ready");
  });
});
