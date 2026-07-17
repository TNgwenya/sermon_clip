export type RetentionProject = {
  id: string;
  title: string;
  updatedAt: Date;
  hasActiveProcessingJob: boolean;
  hasScheduledPost: boolean;
};

export type RetentionDecision = {
  project: RetentionProject;
  eligible: boolean;
  reason: "eligible" | "recent" | "active-processing" | "scheduled-post";
};

export function buildMediaRetentionDecisions(input: {
  projects: RetentionProject[];
  now: Date;
  retentionDays: number;
}): RetentionDecision[] {
  if (!Number.isFinite(input.retentionDays) || input.retentionDays < 1) {
    throw new Error("retentionDays must be at least 1.");
  }
  const cutoff = input.now.getTime() - input.retentionDays * 24 * 60 * 60 * 1000;

  return input.projects.map((project) => {
    if (project.hasActiveProcessingJob) {
      return { project, eligible: false, reason: "active-processing" };
    }
    if (project.hasScheduledPost) {
      return { project, eligible: false, reason: "scheduled-post" };
    }
    if (project.updatedAt.getTime() > cutoff) {
      return { project, eligible: false, reason: "recent" };
    }
    return { project, eligible: true, reason: "eligible" };
  });
}
