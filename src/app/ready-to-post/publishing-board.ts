import { isEditoriallyPostReady } from "@/app/ready-to-post/readiness-display";
import type { PublishingServiceHealth } from "@/lib/publishingServiceHealth";
import type { ScheduledPost } from "@/lib/scheduledPosts";
import type { SocialAccount } from "@/lib/socialAccounts";

export type PublishingBoardClip = {
  id: string;
  title: string;
  mediaReady: boolean;
  qualityLabel: string | null;
  postReadyStatus: string | null;
  postReadyBlockers: string[];
};

export type PublishingDecision = {
  tone: "attention" | "ready" | "planned" | "quiet";
  eyebrow: string;
  title: string;
  detail: string;
  href: "#ready-clips" | "#posting-calendar" | "/sermons";
  actionLabel: string;
  evidence: string;
};

export type PublishingBoardSnapshot = {
  needsWorkCount: number;
  readyCount: number;
  scheduledCount: number;
  attentionCount: number;
  postedCount: number;
  verifiedChannelCount: number;
  automaticPublishingPlatforms: string[];
  automaticPublishingAttentionPlatforms: string[];
  automaticPublishingReady: boolean;
  automaticPublishingLabel: string;
  automaticPublishingDetail: string;
  manualHandoffAvailable: boolean;
  decision: PublishingDecision;
};

const SCHEDULED_STATUSES = new Set<ScheduledPost["status"]>([
  "PLANNED",
  "READY_FOR_MEDIA_TEAM",
  "POSTING",
]);

const ATTENTION_STATUSES = new Set<ScheduledPost["status"]>([
  "FAILED",
  "PRIVATE_ONLY_UNVERIFIED",
]);

const ATTEMPTED_STATUSES = new Set<ScheduledPost["status"]>([
  "FAILED",
  "PRIVATE_ONLY_UNVERIFIED",
  "POSTED",
  "SKIPPED",
]);

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((left, right) => left.localeCompare(right));
}

function postResultTime(post: ScheduledPost): number {
  for (const value of [post.lastAttemptAt, post.scheduledFor, post.createdAt]) {
    const timestamp = value ? new Date(value).getTime() : Number.NaN;
    if (Number.isFinite(timestamp)) return timestamp;
  }
  return 0;
}

function latestAutomaticAttentionPlatforms(posts: ScheduledPost[]): string[] {
  const latestByPlatform = new Map<string, ScheduledPost>();
  posts
    .filter((post) => post.automationMode === "AUTOMATIC" && ATTEMPTED_STATUSES.has(post.status))
    .forEach((post) => {
      const current = latestByPlatform.get(post.platform);
      if (!current || postResultTime(post) > postResultTime(current)) {
        latestByPlatform.set(post.platform, post);
      }
    });
  return uniqueSorted(
    Array.from(latestByPlatform.values())
      .filter((post) => ATTENTION_STATUSES.has(post.status))
      .map((post) => post.platform),
  );
}

function platformListLabel(platforms: string[]): string {
  if (platforms.length === 0) return "";
  if (platforms.length === 1) return platforms[0];
  if (platforms.length === 2) return `${platforms[0]} and ${platforms[1]}`;
  return `${platforms.slice(0, -1).join(", ")}, and ${platforms.at(-1)}`;
}

function findNextScheduledPost(posts: ScheduledPost[]): ScheduledPost | null {
  return posts
    .filter((post) => SCHEDULED_STATUSES.has(post.status) && post.scheduledFor)
    .sort((left, right) => (
      new Date(left.scheduledFor ?? 0).getTime() - new Date(right.scheduledFor ?? 0).getTime()
    ))[0] ?? null;
}

function formatNextPostTime(post: ScheduledPost): string {
  if (!post.scheduledFor) return "No exact time";

  const date = new Date(post.scheduledFor);
  if (Number.isNaN(date.getTime())) return "Time needs review";

  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZone: post.timezone ?? "Africa/Johannesburg",
  }).format(date);
}

function buildDecision(input: {
  clips: PublishingBoardClip[];
  posts: ScheduledPost[];
  approvedWaitingCount: number;
}): PublishingDecision {
  const attentionPost = input.posts.find((post) => ATTENTION_STATUSES.has(post.status));
  if (attentionPost) {
    return {
      tone: "attention",
      eyebrow: "Needs a decision",
      title: `Check the ${attentionPost.platform} result`,
      detail: attentionPost.status === "PRIVATE_ONLY_UNVERIFIED"
        ? "The platform received this post, but SermonClip has not confirmed that it is public."
        : "The last publishing attempt did not complete. Check the channel before retrying.",
      href: "#posting-calendar",
      actionLabel: "Review publishing result",
      evidence: `Based on the saved ${attentionPost.status.toLowerCase().replace(/_/g, " ")} publishing status.`,
    };
  }

  const clipNeedingWork = input.clips.find((clip) => !isEditoriallyPostReady(clip));
  if (clipNeedingWork) {
    return {
      tone: "attention",
      eyebrow: "Next decision",
      title: `Review “${clipNeedingWork.title}”`,
      detail: clipNeedingWork.mediaReady
        ? "The video is prepared, but its editorial readiness still needs a decision."
        : "The final media must be repaired before this clip can be handed off.",
      href: "#ready-clips",
      actionLabel: "Review clip",
      evidence: clipNeedingWork.mediaReady
        ? "Based on the clip’s current editorial readiness and blockers."
        : "Based on the absence of a prepared download file.",
    };
  }

  const readyClip = input.clips.find((clip) => isEditoriallyPostReady(clip));
  if (readyClip) {
    return {
      tone: "ready",
      eyebrow: "Next decision",
      title: `Plan “${readyClip.title}”`,
      detail: "Its final video and editorial checks are ready. Choose a platform and an open day.",
      href: "#posting-calendar",
      actionLabel: "Choose a day",
      evidence: "Based on prepared media, a post-ready editorial status, and no saved blockers.",
    };
  }

  const nextPost = findNextScheduledPost(input.posts);
  if (nextPost) {
    return {
      tone: "planned",
      eyebrow: "Next handoff",
      title: `${nextPost.platform} · ${formatNextPostTime(nextPost)}`,
      detail: nextPost.automationMode === "AUTOMATIC"
        ? "The post is scheduled for the connected publishing workflow."
        : "The media team has a manual handoff to complete.",
      href: "#posting-calendar",
      actionLabel: "Review week",
      evidence: `Based on the saved ${nextPost.status.toLowerCase().replace(/_/g, " ")} schedule entry.`,
    };
  }

  if (input.approvedWaitingCount > 0) {
    return {
      tone: "attention",
      eyebrow: "Next decision",
      title: `Prepare ${input.approvedWaitingCount} approved clip${input.approvedWaitingCount === 1 ? "" : "s"}`,
      detail: "Preparation creates the final video, captions, and downloadable handoff.",
      href: "#ready-clips",
      actionLabel: "Prepare approved clips",
      evidence: "Based on approved clips that do not yet have final publishing media.",
    };
  }

  return {
    tone: "quiet",
    eyebrow: "Week is clear",
    title: "Choose the next sermon moment",
    detail: "There is no unscheduled prepared clip or publishing issue in this view.",
    href: "/sermons",
    actionLabel: "Review sermons",
    evidence: "Based on the prepared clips and scheduled posts currently visible.",
  };
}

export function buildPublishingBoardSnapshot(input: {
  clips: PublishingBoardClip[];
  posts: ScheduledPost[];
  accounts: SocialAccount[];
  serviceHealth: PublishingServiceHealth;
  approvedWaitingCount?: number;
}): PublishingBoardSnapshot {
  const needsWorkCount = input.clips.filter((clip) => !isEditoriallyPostReady(clip)).length
    + (input.approvedWaitingCount ?? 0);
  const readyCount = input.clips.filter(isEditoriallyPostReady).length;
  const scheduledCount = input.posts.filter((post) => SCHEDULED_STATUSES.has(post.status)).length;
  const attentionCount = input.posts.filter((post) => ATTENTION_STATUSES.has(post.status)).length;
  const postedCount = input.posts.filter((post) => post.status === "POSTED").length;
  const verifiedChannelCount = input.accounts.filter((account) => (
    account.status === "CONNECTED" && account.credentialReady
  )).length;
  const verifiedPlatforms = uniqueSorted(input.accounts
    .filter((account) => account.status === "CONNECTED" && account.credentialReady)
    .map((account) => account.platform));
  const automaticPublishingAttentionPlatforms = latestAutomaticAttentionPlatforms(input.posts)
    .filter((platform) => verifiedPlatforms.includes(platform));
  const automaticPublishingPlatforms = verifiedPlatforms
    .filter((platform) => !automaticPublishingAttentionPlatforms.includes(platform));
  const automaticPublishingReady = input.serviceHealth.status === "ONLINE"
    && !input.serviceHealth.dryRun
    && automaticPublishingPlatforms.length > 0;

  let automaticPublishingLabel = "Manual handoff";
  let automaticPublishingDetail = "Downloadable media and copy remain available even without an automatic connection.";
  if (automaticPublishingReady) {
    automaticPublishingLabel = `Automatic: ${platformListLabel(automaticPublishingPlatforms)}`;
    automaticPublishingDetail = automaticPublishingAttentionPlatforms.length > 0
      ? `${platformListLabel(automaticPublishingAttentionPlatforms)} needs a result check before it is treated as healthy.`
      : "These channels have verified credentials, a live publishing service, and no newer unresolved delivery result.";
  } else if (input.serviceHealth.status === "ONLINE" && input.serviceHealth.dryRun) {
    automaticPublishingLabel = "Automatic publishing in test mode";
    automaticPublishingDetail = "The service is online, but it will not make a live platform post.";
  } else if (automaticPublishingAttentionPlatforms.length > 0) {
    automaticPublishingLabel = "Automatic publishing needs attention";
    automaticPublishingDetail = `${platformListLabel(automaticPublishingAttentionPlatforms)} has a failed or unverified latest result. Review it before scheduling another automatic post.`;
  } else if (verifiedChannelCount > 0) {
    automaticPublishingLabel = "Automatic publishing waiting";
    automaticPublishingDetail = "Verified channels are saved, but the publishing service is not currently live.";
  } else {
    automaticPublishingLabel = "No verified automatic channel";
    automaticPublishingDetail = "Use manual downloads, or connect and verify a channel before choosing automatic publishing.";
  }

  return {
    needsWorkCount,
    readyCount,
    scheduledCount,
    attentionCount,
    postedCount,
    verifiedChannelCount,
    automaticPublishingPlatforms,
    automaticPublishingAttentionPlatforms,
    automaticPublishingReady,
    automaticPublishingLabel,
    automaticPublishingDetail,
    manualHandoffAvailable: input.clips.some((clip) => clip.mediaReady),
    decision: buildDecision({
      clips: input.clips,
      posts: input.posts,
      approvedWaitingCount: input.approvedWaitingCount ?? 0,
    }),
  };
}

export type PublishingReceipt = {
  tone: "success" | "attention" | "progress" | "neutral";
  label: string;
  detail: string;
};

export function buildPublishingReceipt(post: ScheduledPost): PublishingReceipt {
  if (post.status === "POSTED" && post.publishedUrl) {
    return {
      tone: "success",
      label: "Platform receipt confirmed",
      detail: "A published post link was returned and saved.",
    };
  }

  if (post.status === "POSTED") {
    return {
      tone: "success",
      label: "Marked live by the team",
      detail: "No platform receipt link is saved for this manual confirmation.",
    };
  }

  if (post.status === "FAILED") {
    return {
      tone: "attention",
      label: `Attempt ${Math.max(post.attemptCount, 1)} needs attention`,
      detail: "Check the destination before retrying to avoid a duplicate post.",
    };
  }

  if (post.status === "PRIVATE_ONLY_UNVERIFIED") {
    return {
      tone: "attention",
      label: "Public status not confirmed",
      detail: "The platform may have received the upload; verify its visibility before retrying.",
    };
  }

  if (post.status === "POSTING" || post.workerStatus === "CLAIMED" || post.workerStatus === "POSTING") {
    return {
      tone: "progress",
      label: "Publishing in progress",
      detail: `Attempt ${Math.max(post.attemptCount, 1)} is being processed.`,
    };
  }

  if (post.automationMode === "MANUAL") {
    return {
      tone: "neutral",
      label: "Manual receipt pending",
      detail: "Mark this post live after the media team completes the platform upload.",
    };
  }

  return {
    tone: "neutral",
    label: "Platform receipt pending",
    detail: "A result will appear after automatic publishing is attempted.",
  };
}
