import { prisma } from "@/lib/prisma";

type QualityClip = Readonly<{
  status: string;
  transcriptSafetyStatus: string;
  riskLevel: string;
  contextWarning: boolean;
  finalQualityScore: number | null;
  postReadyStatus: string | null;
  visualReadinessScore: number | null;
  renderStatus: string;
  remotePreviewUrl: string | null;
  exportedFilePath: string | null;
  overlayVideoPath: string | null;
  captionedVideoPath: string | null;
  renderedFilePath: string | null;
}>;

export type CompetitiveQualityGate = Readonly<{
  id: "preview" | "quality" | "keeper" | "render" | "context" | "visual";
  label: string;
  value: number | null;
  target: number;
  unit: "percent";
  status: "PASS" | "NEEDS_WORK" | "NEEDS_SAMPLE";
  detail: string;
}>;

export type CompetitiveQualityReport = Readonly<{
  clipCount: number;
  reviewedClipCount: number;
  approvedClipCount: number;
  sampleWindowDays: number;
  gates: CompetitiveQualityGate[];
}>;

function percent(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  return Number(((numerator / denominator) * 100).toFixed(1));
}

function gate(input: Omit<CompetitiveQualityGate, "status"> & {
  minimumSample: number;
  sample: number;
}): CompetitiveQualityGate {
  return {
    id: input.id,
    label: input.label,
    value: input.value,
    target: input.target,
    unit: input.unit,
    status: input.sample < input.minimumSample || input.value === null
      ? "NEEDS_SAMPLE"
      : input.value >= input.target
        ? "PASS"
        : "NEEDS_WORK",
    detail: input.detail,
  };
}

function hasPreview(clip: QualityClip): boolean {
  return Boolean(
    clip.remotePreviewUrl
    || clip.exportedFilePath
    || clip.overlayVideoPath
    || clip.captionedVideoPath
    || clip.renderedFilePath,
  );
}

export function buildCompetitiveQualityReport(
  clips: readonly QualityClip[],
  sampleWindowDays = 90,
): CompetitiveQualityReport {
  const relevant = clips.filter((clip) => clip.status !== "REJECTED");
  const reviewed = clips.filter((clip) => clip.status !== "SUGGESTED");
  const approved = clips.filter((clip) => (
    clip.status === "APPROVED" || clip.status === "EXPORTED"
  ));
  const renderAttempted = approved.filter(
    (clip) => clip.renderStatus !== "NOT_RENDERED",
  );
  const contextSafe = approved.filter((clip) => (
    clip.transcriptSafetyStatus === "TRUSTED"
    && clip.riskLevel !== "HIGH"
    && !clip.contextWarning
  ));

  const previewRate = percent(
    relevant.filter(hasPreview).length,
    relevant.length,
  );
  const qualityCoverage = percent(
    relevant.filter((clip) => clip.finalQualityScore !== null).length,
    relevant.length,
  );
  const keeperRate = percent(approved.length, reviewed.length);
  const renderSuccessRate = percent(
    renderAttempted.filter((clip) => clip.renderStatus === "COMPLETED").length,
    renderAttempted.length,
  );
  const contextSafetyRate = percent(contextSafe.length, approved.length);
  const visualReadinessRate = percent(
    approved.filter((clip) => (
      clip.visualReadinessScore !== null
      && clip.visualReadinessScore >= 70
    )).length,
    approved.length,
  );

  return {
    clipCount: clips.length,
    reviewedClipCount: reviewed.length,
    approvedClipCount: approved.length,
    sampleWindowDays,
    gates: [
      gate({
        id: "preview",
        label: "Playable preview availability",
        value: previewRate,
        target: 99,
        unit: "percent",
        minimumSample: 10,
        sample: relevant.length,
        detail: "Every viable suggestion should be playable at the moment a pastor reviews it.",
      }),
      gate({
        id: "quality",
        label: "Quality assessment coverage",
        value: qualityCoverage,
        target: 95,
        unit: "percent",
        minimumSample: 10,
        sample: relevant.length,
        detail: "Clip, visual, caption, audio, context, and completeness signals should be measured before approval.",
      }),
      gate({
        id: "keeper",
        label: "Pastor keeper rate",
        value: keeperRate,
        target: 65,
        unit: "percent",
        minimumSample: 20,
        sample: reviewed.length,
        detail: "This measures reviewed suggestions that pastors approved, not an AI prediction of virality.",
      }),
      gate({
        id: "render",
        label: "Approved render success",
        value: renderSuccessRate,
        target: 99,
        unit: "percent",
        minimumSample: 10,
        sample: renderAttempted.length,
        detail: "Approved clips should complete media preparation without a manual repair.",
      }),
      gate({
        id: "context",
        label: "Approved context safety",
        value: contextSafetyRate,
        target: 100,
        unit: "percent",
        minimumSample: 10,
        sample: approved.length,
        detail: "No high-risk, context-warned, or untrusted transcript should reach approval unnoticed.",
      }),
      gate({
        id: "visual",
        label: "Approved visual readiness",
        value: visualReadinessRate,
        target: 95,
        unit: "percent",
        minimumSample: 10,
        sample: approved.length,
        detail: "Speaker visibility, tracking confidence, crop stability, and render checks must clear the quality floor.",
      }),
    ],
  };
}

export async function getCompetitiveQualityReport(input: Readonly<{
  organizationId: string;
  campusId: string | null;
  now?: Date;
  sampleWindowDays?: number;
}>): Promise<CompetitiveQualityReport> {
  const sampleWindowDays = Math.min(365, Math.max(7, input.sampleWindowDays ?? 90));
  const now = input.now ?? new Date();
  const clips = await prisma.clipCandidate.findMany({
    where: {
      createdAt: {
        gte: new Date(now.getTime() - sampleWindowDays * 24 * 60 * 60 * 1_000),
      },
      sermon: {
        organizationId: input.organizationId,
        ...(input.campusId ? { campusId: input.campusId } : {}),
      },
    },
    orderBy: { createdAt: "desc" },
    take: 500,
    select: {
      status: true,
      transcriptSafetyStatus: true,
      riskLevel: true,
      contextWarning: true,
      finalQualityScore: true,
      postReadyStatus: true,
      visualReadinessScore: true,
      renderStatus: true,
      remotePreviewUrl: true,
      exportedFilePath: true,
      overlayVideoPath: true,
      captionedVideoPath: true,
      renderedFilePath: true,
    },
  });
  return buildCompetitiveQualityReport(clips, sampleWindowDays);
}
