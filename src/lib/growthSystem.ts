import type { PostingPlatform } from "@/lib/postingDrafts";
import type { ScheduledPost } from "@/lib/scheduledPosts";
import type { SocialAccount } from "@/lib/socialAccounts";

export type GrowthPlatform =
  | "YouTube"
  | "Instagram"
  | "TikTok"
  | "Facebook"
  | "X / Twitter"
  | "Threads"
  | "Website / Blog";

export type GrowthConnectionStatus = "CONNECTED" | "READY_TO_CONNECT" | "MANUAL_TRACKING";

export type MinistryTheme =
  | "Gospel invitation"
  | "Prayer"
  | "Scripture teaching"
  | "Discipleship"
  | "Testimony"
  | "Worship"
  | "Community"
  | "Event promotion";

export type GrowthClipInput = {
  id: string;
  title: string;
  hook: string;
  caption: string;
  hashtags: unknown;
  score: number;
  finalQualityScore: number | null;
  overallPostScore?: number | null;
  qualityLabel?: string | null;
  postReadyStatus?: string | null;
  smartClipCategory?: string | null;
  intendedAudience?: string | null;
  durationSeconds?: number | null;
  exportStatus?: string | null;
  status?: string | null;
  sermon: {
    id: string;
    title: string;
    churchName: string;
    speakerName?: string | null;
    intelligence?: {
      centralTheme: string | null;
      summary?: string | null;
    } | null;
  };
};

export type PlatformGrowthSnapshot = {
  platform: GrowthPlatform;
  status: GrowthConnectionStatus;
  connectedLabel: string;
  followersLabel: string;
  plannedPosts: number;
  postedPosts: number;
  estimatedReach: number;
  estimatedEngagementRate: number;
  primarySignals: string[];
  nextMove: string;
};

export type PerformancePrediction = {
  reachLow: number;
  reachHigh: number;
  engagementRate: number;
  followerGrowthLow: number;
  followerGrowthHigh: number;
  expectedWatchTimeSeconds: number;
  confidence: "High" | "Medium" | "Low";
  reasoning: string[];
};

export type GrowthRecommendation = {
  id: string;
  priority: number;
  title: string;
  sourceClipId: string;
  sourceSermonId: string;
  ministryTheme: MinistryTheme;
  platforms: GrowthPlatform[];
  postingWindow: string;
  hook: string;
  caption: string;
  cta: string;
  hashtags: string[];
  prediction: PerformancePrediction;
  rationale: string[];
  guardrails: string[];
};

export type TrendAssessment = {
  trend: string;
  decision: "Use" | "Adapt carefully" | "Avoid";
  ministryFit: number;
  reason: string;
  adaptation: string;
};

export type EventCampaignPlan = {
  name: string;
  objective: string;
  phases: Array<{
    name: string;
    timing: string;
    content: string;
    cta: string;
  }>;
};

type PlatformPlaybook = {
  platform: GrowthPlatform;
  postingWindow: string;
  cta: string;
  primarySignals: string[];
};

const PLATFORM_PLAYBOOKS: PlatformPlaybook[] = [
  {
    platform: "YouTube",
    postingWindow: "Sunday afternoon or Wednesday evening",
    cta: "Watch the full message or send it to someone who needs this word.",
    primarySignals: ["watch time", "retention", "subscriber growth"],
  },
  {
    platform: "Instagram",
    postingWindow: "Tuesday to Thursday evening",
    cta: "Save this for prayer later and share it with a friend.",
    primarySignals: ["saves", "shares", "profile visits"],
  },
  {
    platform: "TikTok",
    postingWindow: "Weekday evening after work or school",
    cta: "Comment one word we can pray with you about.",
    primarySignals: ["completion rate", "comments", "shares"],
  },
  {
    platform: "Facebook",
    postingWindow: "Sunday afternoon, Monday morning, or event reminder windows",
    cta: "Invite someone to join you this Sunday.",
    primarySignals: ["shares", "comments", "event clicks"],
  },
  {
    platform: "X / Twitter",
    postingWindow: "Morning reflection or live service recap",
    cta: "Reply with the phrase that stayed with you.",
    primarySignals: ["replies", "reposts", "link clicks"],
  },
  {
    platform: "Threads",
    postingWindow: "Morning devotional thread or evening reflection",
    cta: "Share this with someone walking through this season.",
    primarySignals: ["replies", "shares", "follows"],
  },
  {
    platform: "Website / Blog",
    postingWindow: "Monday sermon recap or event landing-page update",
    cta: "Read the recap, register, or take the next discipleship step.",
    primarySignals: ["sessions", "click-throughs", "signups"],
  },
];

const DB_PLATFORM_TO_GROWTH: Record<PostingPlatform, GrowthPlatform> = {
  TikTok: "TikTok",
  Instagram: "Instagram",
  "YouTube Shorts": "YouTube",
  Facebook: "Facebook",
};

const DANGEROUS_TREND_TERMS = [
  "rage bait",
  "shock",
  "prank",
  "thirst",
  "mock",
  "deception",
  "humiliation",
  "expose",
];

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getGrowthPlatforms(): GrowthPlatform[] {
  return PLATFORM_PLAYBOOKS.map((item) => item.platform);
}

export function growthPlatformToPostingPlatform(platform: GrowthPlatform): PostingPlatform | null {
  if (platform === "TikTok") return "TikTok";
  if (platform === "Instagram") return "Instagram";
  if (platform === "YouTube") return "YouTube Shorts";
  if (platform === "Facebook") return "Facebook";
  return null;
}

export function postingPlatformToGrowthPlatform(platform: PostingPlatform): GrowthPlatform {
  return DB_PLATFORM_TO_GROWTH[platform];
}

export function getClipGrowthScore(clip: GrowthClipInput): number {
  const qualityScore = clip.finalQualityScore ?? clip.overallPostScore ?? clip.score;
  const postReadyBonus = clip.qualityLabel === "POST_READY" || clip.postReadyStatus === "POST_READY" ? 12 : 0;
  const exportedBonus = clip.exportStatus === "COMPLETED" || clip.status === "EXPORTED" ? 8 : 0;
  const hookBonus = clip.hook.trim().length > 24 ? 5 : 0;
  const durationScore = clip.durationSeconds
    ? clip.durationSeconds >= 25 && clip.durationSeconds <= 60
      ? 6
      : clip.durationSeconds <= 90
        ? 2
        : -4
    : 0;

  return clamp(qualityScore + postReadyBonus + exportedBonus + hookBonus + durationScore, 0, 100);
}

export function classifyMinistryTheme(input: Pick<GrowthClipInput, "title" | "caption" | "hook" | "smartClipCategory">): MinistryTheme {
  const text = [
    input.title,
    input.caption,
    input.hook,
    input.smartClipCategory ?? "",
  ].map(normalizeText).join(" ");

  if (text.match(/salvation|gospel|jesus|cross|repent|altar|invite/)) return "Gospel invitation";
  if (text.match(/pray|prayer|intercede|anxiety|fear|peace/)) return "Prayer";
  if (text.match(/scripture|bible|verse|word|romans|john|psalm|matthew/)) return "Scripture teaching";
  if (text.match(/testimony|story|healed|changed|delivered/)) return "Testimony";
  if (text.match(/worship|praise|song|sing/)) return "Worship";
  if (text.match(/community|family|together|serve|outreach/)) return "Community";
  if (text.match(/conference|event|service|youth|night|meeting|register/)) return "Event promotion";
  return "Discipleship";
}

export function buildPlatformSnapshots(input: {
  accounts: SocialAccount[];
  scheduledPosts: ScheduledPost[];
  clips: GrowthClipInput[];
}): PlatformGrowthSnapshot[] {
  const plannedByPlatform = new Map<GrowthPlatform, number>();
  const postedByPlatform = new Map<GrowthPlatform, number>();
  const connectedByPlatform = new Map<GrowthPlatform, SocialAccount>();

  input.accounts.forEach((account) => {
    connectedByPlatform.set(DB_PLATFORM_TO_GROWTH[account.platform], account);
  });

  input.scheduledPosts.forEach((post) => {
    const platform = DB_PLATFORM_TO_GROWTH[post.platform];
    if (post.status === "POSTED") {
      postedByPlatform.set(platform, (postedByPlatform.get(platform) ?? 0) + 1);
    } else if (!["SKIPPED", "FAILED"].includes(post.status)) {
      plannedByPlatform.set(platform, (plannedByPlatform.get(platform) ?? 0) + 1);
    }
  });

  const avgClipScore = input.clips.length > 0
    ? input.clips.reduce((sum, clip) => sum + getClipGrowthScore(clip), 0) / input.clips.length
    : 42;

  return PLATFORM_PLAYBOOKS.map((playbook) => {
    const account = connectedByPlatform.get(playbook.platform);
    const plannedPosts = plannedByPlatform.get(playbook.platform) ?? 0;
    const postedPosts = postedByPlatform.get(playbook.platform) ?? 0;
    const isNativeConnected = Boolean(account);
    const status: GrowthConnectionStatus = isNativeConnected
      ? "CONNECTED"
      : playbook.platform === "Website / Blog" || playbook.platform === "X / Twitter" || playbook.platform === "Threads"
        ? "MANUAL_TRACKING"
        : "READY_TO_CONNECT";

    return {
      platform: playbook.platform,
      status,
      connectedLabel: account?.handle || account?.label || (status === "CONNECTED" ? "Connected" : "Not connected yet"),
      followersLabel: status === "CONNECTED" ? "Import followers via connector" : "Manual baseline needed",
      plannedPosts,
      postedPosts,
      estimatedReach: Math.round((postedPosts * 650) + (plannedPosts * 420) + avgClipScore * 22),
      estimatedEngagementRate: Number(clamp(3.4 + avgClipScore / 28 + postedPosts * 0.15, 3.1, 9.8).toFixed(1)),
      primarySignals: playbook.primarySignals,
      nextMove: status === "CONNECTED"
        ? `Review ${playbook.primarySignals[0]} and schedule the next sermon asset.`
        : `Connect or manually baseline ${playbook.platform} so recommendations can learn from real results.`,
    };
  });
}

export function predictPostPerformance(clip: GrowthClipInput, platformCount: number): PerformancePrediction {
  const score = getClipGrowthScore(clip);
  const theme = classifyMinistryTheme(clip);
  const ministryMultiplier = theme === "Prayer" || theme === "Testimony" ? 1.15 : theme === "Event promotion" ? 0.95 : 1;
  const reachMidpoint = Math.round((700 + score * 55 + platformCount * 320) * ministryMultiplier);
  const reachLow = Math.max(120, Math.round(reachMidpoint * 0.72));
  const reachHigh = Math.round(reachMidpoint * 1.28);
  const engagementRate = Number(clamp(3.5 + score / 24 + (theme === "Prayer" ? 0.8 : 0), 3.2, 11.5).toFixed(1));
  const confidenceScore = score + (clip.exportStatus === "COMPLETED" || clip.status === "EXPORTED" ? 8 : 0);
  const confidence = confidenceScore >= 78 ? "High" : confidenceScore >= 58 ? "Medium" : "Low";

  return {
    reachLow,
    reachHigh,
    engagementRate,
    followerGrowthLow: Math.floor(reachLow * 0.0025),
    followerGrowthHigh: Math.ceil(reachHigh * 0.007),
    expectedWatchTimeSeconds: Math.round((clip.durationSeconds ?? 45) * (0.46 + score / 220)),
    confidence,
    reasoning: [
      `${Math.round(score)} growth score from clip quality, hook strength, and publishing readiness.`,
      `${theme} content usually earns meaningful comments, saves, or shares when the call to action is clear.`,
      confidence === "Low"
        ? "Confidence is limited until real platform analytics are synced."
        : "Confidence improves because this clip has stronger quality and readiness signals.",
    ],
  };
}

export function buildGrowthRecommendations(input: {
  clips: GrowthClipInput[];
  scheduledPosts: ScheduledPost[];
  accounts: SocialAccount[];
  limit?: number;
}): GrowthRecommendation[] {
  const connectedPlatforms = new Set(input.accounts.map((account) => DB_PLATFORM_TO_GROWTH[account.platform]));
  const defaultPlatforms: GrowthPlatform[] = connectedPlatforms.size > 0
    ? [...connectedPlatforms]
    : ["Instagram", "TikTok", "YouTube", "Facebook"];
  const scheduledClipIds = new Set(input.scheduledPosts.flatMap((post) => post.clipIds));

  return input.clips
    .filter((clip) => !scheduledClipIds.has(clip.id))
    .filter((clip) => clip.qualityLabel !== "REJECT" && clip.postReadyStatus !== "REJECT")
    .map((clip) => {
      const theme = classifyMinistryTheme(clip);
      const score = getClipGrowthScore(clip);
      const platforms = choosePlatformsForTheme(theme, defaultPlatforms);
      const prediction = predictPostPerformance(clip, platforms.length);
      const playbook = PLATFORM_PLAYBOOKS.find((item) => item.platform === platforms[0]) ?? PLATFORM_PLAYBOOKS[1];
      const hashtags = asStringArray(clip.hashtags).slice(0, 5);

      return {
        id: `growth-rec-${clip.id}`,
        priority: Math.round(score),
        title: `Post "${clip.title}" as a ${theme.toLowerCase()} moment`,
        sourceClipId: clip.id,
        sourceSermonId: clip.sermon.id,
        ministryTheme: theme,
        platforms,
        postingWindow: playbook.postingWindow,
        hook: clip.hook || clip.title,
        caption: buildPlatformCaption(clip, theme),
        cta: playbook.cta,
        hashtags,
        prediction,
        rationale: [
          `${clip.sermon.title} has a clear ${theme.toLowerCase()} angle for people beyond Sunday attendance.`,
          score >= 75
            ? "The clip is strong enough to lead a weekly posting plan."
            : "Use this as a supporting post while higher-scoring clips anchor the week.",
          "Human approval stays required before anything is published.",
        ],
        guardrails: buildGuardrailsForTheme(theme),
      };
    })
    .sort((a, b) => b.priority - a.priority)
    .slice(0, input.limit ?? 5);
}

function choosePlatformsForTheme(theme: MinistryTheme, connectedPlatforms: GrowthPlatform[]): GrowthPlatform[] {
  const preferred: Record<MinistryTheme, GrowthPlatform[]> = {
    "Gospel invitation": ["Instagram", "TikTok", "YouTube", "Facebook"],
    Prayer: ["Instagram", "TikTok", "Threads", "Facebook"],
    "Scripture teaching": ["YouTube", "Instagram", "Website / Blog", "Threads"],
    Discipleship: ["YouTube", "Website / Blog", "Instagram", "Facebook"],
    Testimony: ["Instagram", "TikTok", "Facebook", "YouTube"],
    Worship: ["Instagram", "TikTok", "YouTube", "Facebook"],
    Community: ["Facebook", "Instagram", "Threads", "Website / Blog"],
    "Event promotion": ["Facebook", "Instagram", "Website / Blog", "Threads"],
  };

  const selected = preferred[theme].filter((platform) => connectedPlatforms.includes(platform));
  return selected.length > 0 ? selected.slice(0, 3) : preferred[theme].slice(0, 3);
}

function buildPlatformCaption(clip: GrowthClipInput, theme: MinistryTheme): string {
  const base = clip.caption.trim() || clip.hook.trim() || clip.title;
  const suffix: Record<MinistryTheme, string> = {
    "Gospel invitation": "Jesus is still inviting people to come home.",
    Prayer: "Pause for a moment and bring this to God in prayer.",
    "Scripture teaching": "Let the Word shape the way you walk this out today.",
    Discipleship: "Save this as a reminder for the week.",
    Testimony: "What God has done for one person can strengthen faith for another.",
    Worship: "Let worship turn your attention back to God.",
    Community: "Faith was never meant to be walked alone.",
    "Event promotion": "Bring someone with you and take the next step together.",
  };

  return `${base}\n\n${suffix[theme]}`;
}

function buildGuardrailsForTheme(theme: MinistryTheme): string[] {
  const common = [
    "Media team approval required before publishing.",
    "Do not imply attendance, giving, or public engagement proves spiritual maturity.",
  ];

  if (theme === "Testimony") {
    return [...common, "Confirm testimony consent and avoid exposing private pastoral care details."];
  }

  if (theme === "Gospel invitation") {
    return [...common, "Keep the invitation clear without pressure, fear-bait, or exaggerated promises."];
  }

  if (theme === "Event promotion") {
    return [...common, "Check date, location, registration link, and child/minor consent language."];
  }

  return [...common, "Preserve the sermon context and avoid turning a pastoral moment into a slogan."];
}

export function assessTrendForMinistry(trend: string): TrendAssessment {
  const normalized = trend.toLowerCase();
  const hasDanger = DANGEROUS_TREND_TERMS.some((term) => normalized.includes(term));
  const hasMinistryFit = normalized.match(/prayer|testimony|story|quiet|reflection|scripture|hope|community|service/);

  if (hasDanger) {
    return {
      trend,
      decision: "Avoid",
      ministryFit: 15,
      reason: "The format leans on manipulation, mockery, or shock value.",
      adaptation: "Use a slower pastoral teaching or testimony post instead.",
    };
  }

  if (hasMinistryFit) {
    return {
      trend,
      decision: "Use",
      ministryFit: 86,
      reason: "The format can serve encouragement, prayer, or testimony without distorting the message.",
      adaptation: "Frame it around a sincere question, scripture reflection, or next-step invitation.",
    };
  }

  return {
    trend,
    decision: "Adapt carefully",
    ministryFit: 58,
    reason: "The trend may work if the church changes the tone and keeps the message original.",
    adaptation: "Remove gimmicks, keep the hook truthful, and connect the format to a real ministry moment.",
  };
}

export function buildEventCampaignPlan(input: {
  eventName: string;
  eventType?: string;
  startsAt?: Date | null;
}): EventCampaignPlan {
  const eventLabel = input.eventName.trim() || "Upcoming church event";
  const type = input.eventType?.trim() || "church gathering";
  const dateLabel = input.startsAt
    ? new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(input.startsAt)
    : "event week";

  return {
    name: `${eventLabel} growth campaign`,
    objective: `Invite people to the ${type}, help regular members bring someone, and make the next step easy.`,
    phases: [
      {
        name: "Awareness",
        timing: `2-3 weeks before ${dateLabel}`,
        content: "Pastor invite clip, scripture graphic, and one clear reason this gathering matters.",
        cta: "Save the date and share with someone who should come.",
      },
      {
        name: "Invitation",
        timing: `7-10 days before ${dateLabel}`,
        content: "Testimony, worship moment, or community highlight tied to the event theme.",
        cta: "Register, RSVP, or send the event page to a friend.",
      },
      {
        name: "Final reminder",
        timing: `48 hours before ${dateLabel}`,
        content: "Short practical reminder with time, location, childcare, parking, and livestream details.",
        cta: "Confirm your plan and invite one person.",
      },
      {
        name: "Recap and follow-up",
        timing: `1-3 days after ${dateLabel}`,
        content: "Thank-you post, testimony prompt, next sermon clip, and follow-up pathway.",
        cta: "Share what God did or take the next discipleship step.",
      },
    ],
  };
}
