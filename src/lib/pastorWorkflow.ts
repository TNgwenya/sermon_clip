export type PastorPrimaryAction = "process" | "review" | "prepare" | "post";

export type SermonWorkspaceAction =
  | "publish"
  | "edit"
  | "review"
  | "working"
  | "recover"
  | "analyze";

export type SermonWorkspaceActionInput = {
  hasExportedClips: boolean;
  hasApprovedClips: boolean;
  hasGeneratedMoments: boolean;
  hasFreshLiveAnalysis: boolean;
  hasBlockingFailure: boolean;
};

export type PastorWorkflowStep = {
  label: string;
  ready: boolean;
  detail: string;
};

export type PastorSermonWorkflowInput = {
  sourceVideoReady: boolean;
  transcriptReady: boolean;
  clipGenerationComplete: boolean;
  suggestedClipCount: number;
  approvedOrReadyClipCount: number;
  preparedClipCount: number;
  failedStepCount: number;
  staleClipCount: number;
  latestFailedStepType?: string | null;
};

export type PastorSermonWorkflow = {
  nextAction: string;
  primaryAction: PastorPrimaryAction;
  steps: PastorWorkflowStep[];
  attentionItems: string[];
};

export type DashboardWorkflowInput = {
  sermonCount: number;
  clipsGenerated: number;
  clipsApproved: number;
  clipsPrepared: number;
  readyClipCount: number;
  failedOperationCount: number;
  pendingPastorActionCount: number;
};

export type DashboardWorkflow = {
  nextAction: string;
  steps: PastorWorkflowStep[];
};

export type PastorProcessingJobRetryView = {
  id?: string;
  sermonId?: string;
  type: string;
  status: string;
  updatedAt: Date;
  heartbeatAt?: Date | null;
  generationSummary?: unknown;
};

export type PastorProcessingStepStatus = "Complete" | "Failed" | "Stuck / retry" | "Current / Running" | "Pending";

export const STALE_ACTIVE_PROCESSING_JOB_MS = 2 * 60 * 60 * 1000;

const failedStepMessages: Record<string, string> = {
  DOWNLOAD_VIDEO: "The sermon video could not be downloaded. Check the sermon link or upload the video file again.",
  EXTRACT_AUDIO: "The sermon audio could not be prepared. Try the audio step again or check Workspace Readiness.",
  TRANSCRIBE_AUDIO: "The sermon transcript did not finish. Try creating the transcript again before finding clips.",
  GENERATE_CLIPS: "The app could not find sermon clip suggestions yet. Retry after the transcript is ready.",
  EXPORT_CLIPS: "The approved clips were not fully prepared for download. Try preparing approved clips again.",
  GENERATE_SUBTITLES: "The captions did not finish. Try writing captions again after clips are approved.",
  BURN_SUBTITLES: "The captions were created, but they were not added to the video. Try preparing the clip again.",
  RENDER_OVERLAY: "The church branding pass did not finish. Try preparing the clip again.",
  PROCESS_SERMON: "The full sermon workflow stopped early. Retry the next best step shown above.",
};

const jobStepLabels: Record<string, string> = {
  DOWNLOAD_VIDEO: "Download sermon video",
  EXTRACT_AUDIO: "Prepare sermon audio",
  TRANSCRIBE_AUDIO: "Create sermon transcript",
  GENERATE_CLIPS: "Find sermon clip moments",
  EXPORT_CLIPS: "Prepare clip downloads",
  GENERATE_SUBTITLES: "Write clip captions",
  BURN_SUBTITLES: "Add captions to video",
  RENDER_OVERLAY: "Add church branding",
  PROCESS_SERMON: "Move sermon through the workflow",
};

export function pastorJobStepLabel(stepType: string): string {
  return jobStepLabels[stepType] ?? "Sermon workflow step";
}

export function pastorFailedStepMessage(stepType: string): string {
  return failedStepMessages[stepType] ?? "One sermon step needs attention. Retry the next best step shown above.";
}

const PROCESS_SERMON_CHILD_JOB_TYPES = new Set([
  "DOWNLOAD_VIDEO",
  "EXTRACT_AUDIO",
  "TRANSCRIBE_AUDIO",
  "GENERATE_INTELLIGENCE",
  "GENERATE_CLIPS",
]);

function asProcessingSummary(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function pastorChildFailureRequiresExplicitRetry(
  job: PastorProcessingJobRetryView,
): boolean {
  const summary = asProcessingSummary(job.generationSummary);
  if (
    job.type === "DOWNLOAD_VIDEO"
    || job.type === "EXTRACT_AUDIO"
    || job.type === "TRANSCRIBE_AUDIO"
  ) {
    const failure = asProcessingSummary(summary?.["failure"]);
    const details = asProcessingSummary(failure?.["details"]);
    return details?.["forceRequested"] === true;
  }

  if (job.type === "GENERATE_CLIPS") {
    const mode = summary?.["mode"];
    return summary?.["append"] === true
      || mode === "redo"
      || mode === "retry_generation"
      || mode === "repair_previews";
  }

  return false;
}

export function isPastorChildPipelineFailureSuperseded<T extends PastorProcessingJobRetryView>(
  job: T,
  jobs: readonly T[],
): boolean {
  if (
    job.status !== "FAILED"
    || !job.sermonId
    || !PROCESS_SERMON_CHILD_JOB_TYPES.has(job.type)
    || pastorChildFailureRequiresExplicitRetry(job)
  ) {
    return false;
  }

  return jobs.some((candidate) => (
    candidate.sermonId === job.sermonId
    && candidate.type === "PROCESS_SERMON"
    && candidate.status === "SUCCEEDED"
    && candidate.updatedAt.getTime() > job.updatedAt.getTime()
  ));
}

export function selectUnresolvedPastorFailedJobs<T extends PastorProcessingJobRetryView>(jobs: T[]): T[] {
  const latestByType = new Map<string, T>();

  for (const job of jobs) {
    const key = `${job.sermonId ?? "single-sermon"}:${job.type}`;
    const existing = latestByType.get(key);
    if (!existing || job.updatedAt.getTime() > existing.updatedAt.getTime()) {
      latestByType.set(key, job);
    }
  }

  return [...latestByType.values()]
    .filter((job) => job.status === "FAILED" || isStaleActiveProcessingJob(job))
    .filter((job) => !isPastorChildPipelineFailureSuperseded(job, jobs))
    .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
}

export function resolvePastorProcessingStepStatus(input: {
  complete: boolean;
  completionEvidenceAt?: Date | null;
  jobStatus?: string;
  jobStartedAt?: Date | null;
  staleActiveJob: boolean;
}): PastorProcessingStepStatus {
  const jobNeedsCurrentAttention = input.jobStatus === "FAILED"
    || input.jobStatus === "RUNNING"
    || input.staleActiveJob;
  const completionCameFromLatestAttempt = Boolean(
    input.complete
    && input.completionEvidenceAt
    && input.jobStartedAt
    && input.completionEvidenceAt.getTime() >= input.jobStartedAt.getTime(),
  );

  if (input.complete && (!jobNeedsCurrentAttention || completionCameFromLatestAttempt)) {
    return "Complete";
  }

  if (input.jobStatus === "FAILED") {
    return "Failed";
  }

  if (input.staleActiveJob) {
    return "Stuck / retry";
  }

  if (input.jobStatus === "RUNNING") {
    return "Current / Running";
  }

  if (input.jobStatus === "SUCCEEDED") {
    return "Complete";
  }

  if (input.complete) {
    return "Complete";
  }

  return "Pending";
}

export function isStaleActiveProcessingJob(
  job: PastorProcessingJobRetryView,
  now = new Date(),
  staleAfterMs = STALE_ACTIVE_PROCESSING_JOB_MS,
): boolean {
  if (job.status !== "RUNNING" && job.status !== "PENDING") {
    return false;
  }

  const lastWorkerSignal = job.heartbeatAt ?? job.updatedAt;
  return now.getTime() - lastWorkerSignal.getTime() > staleAfterMs;
}

export function deriveSermonWorkspaceAction(
  input: SermonWorkspaceActionInput,
): SermonWorkspaceAction {
  if (input.hasExportedClips) {
    return "publish";
  }

  if (input.hasApprovedClips) {
    return "edit";
  }

  if (input.hasGeneratedMoments) {
    return "review";
  }

  if (input.hasFreshLiveAnalysis) {
    return "working";
  }

  if (input.hasBlockingFailure) {
    return "recover";
  }

  return "analyze";
}

export function derivePastorSermonWorkflow(input: PastorSermonWorkflowInput): PastorSermonWorkflow {
  const hasApprovedClips = input.approvedOrReadyClipCount > 0;
  const hasPreparedClips = input.preparedClipCount > 0;

  const nextAction = !input.sourceVideoReady
    ? "Start sermon processing"
    : !input.transcriptReady
      ? "Create sermon transcript"
      : !input.clipGenerationComplete
        ? "Find sermon clips"
        : !hasApprovedClips
          ? "Approve at least one clip"
          : !hasPreparedClips
            ? "Prepare approved clips"
            : "Download and post clips";

  const primaryAction: PastorPrimaryAction =
    !input.clipGenerationComplete
      ? "process"
      : !hasApprovedClips
        ? "review"
        : !hasPreparedClips
          ? "prepare"
          : "post";

  const attentionItems: string[] = [];
  if (input.latestFailedStepType) {
    attentionItems.push(pastorFailedStepMessage(input.latestFailedStepType));
  }
  if (input.failedStepCount > 0) {
    attentionItems.push(`${input.failedStepCount} sermon or clip step${input.failedStepCount === 1 ? "" : "s"} ${input.failedStepCount === 1 ? "needs" : "need"} attention.`);
  }
  if (input.staleClipCount > 0) {
    attentionItems.push(`${input.staleClipCount} clip(s) should be prepared again.`);
  }

  return {
    nextAction,
    primaryAction,
    attentionItems,
    steps: [
      {
        label: "Sermon added",
        ready: true,
        detail: "The sermon record is ready.",
      },
      {
        label: "Best moments found",
        ready: input.clipGenerationComplete,
        detail: input.clipGenerationComplete
          ? `${input.suggestedClipCount} suggested clip(s).`
          : "Let the app find strong sermon moments.",
      },
      {
        label: "Clips approved",
        ready: hasApprovedClips,
        detail: hasApprovedClips
          ? `${input.approvedOrReadyClipCount} approved or ready clip(s).`
          : "Review suggestions and approve the ones you like.",
      },
      {
        label: "Clips prepared",
        ready: hasPreparedClips,
        detail: hasPreparedClips ? "Finished downloads are ready." : "Prepare approved clips for social media.",
      },
      {
        label: "Ready to post",
        ready: hasPreparedClips,
        detail: hasPreparedClips ? "Open the Ready To Post queue." : "Finished clips will appear in the queue.",
      },
    ],
  };
}

export function deriveDashboardWorkflow(input: DashboardWorkflowInput): DashboardWorkflow {
  const nextAction =
    input.failedOperationCount > 0
      ? "Open the sermon that needs attention and use the pastor-friendly recovery step."
      : input.pendingPastorActionCount > 0
        ? "Open the most recent sermon, review the suggested clips, and prepare the ones you approve."
        : input.sermonCount === 0
          ? "Add this week's sermon to start the clipping workflow."
          : input.readyClipCount > 0
            ? "Your finished clips are ready to download and post."
            : "Open a sermon to review suggestions and prepare approved clips.";

  return {
    nextAction,
    steps: [
      {
        label: "Upload sermon",
        ready: input.sermonCount > 0,
        detail: input.sermonCount > 0 ? "At least one sermon is in the workspace." : "Add this week's sermon.",
      },
      {
        label: "Review suggestions",
        ready: input.clipsGenerated > 0,
        detail: input.clipsGenerated > 0 ? "Suggested clips are ready for review." : "Find the best sermon moments.",
      },
      {
        label: "Approve clips",
        ready: input.clipsApproved > 0,
        detail: input.clipsApproved > 0 ? "Approved clips are ready to prepare." : "Approve the clips you want to post.",
      },
      {
        label: "Prepare clips",
        ready: input.clipsPrepared > 0,
        detail: input.clipsPrepared > 0 ? "Prepared clips have downloads." : "Prepare approved clips once.",
      },
      {
        label: "Download and post",
        ready: input.readyClipCount > 0,
        detail: input.readyClipCount > 0 ? "Finished clips are ready to post." : "Ready clips will appear in the queue.",
      },
    ],
  };
}
