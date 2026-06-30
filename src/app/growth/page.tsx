import Link from "next/link";

import { Chip, EmptyState, SectionCard, StatCard, StatusBadge } from "@/components/ui";
import {
  assessTrendForMinistry,
  buildEventCampaignPlan,
  buildGrowthRecommendations,
  buildPlatformSnapshots,
  getClipGrowthScore,
  type GrowthClipInput,
} from "@/lib/growthSystem";
import { prisma } from "@/lib/prisma";
import { listScheduledPosts } from "@/lib/scheduledPosts";
import { listSocialAccounts } from "@/lib/socialAccounts";
import {
  createDraftFromSavedRecommendation,
  createGrowthRecommendationDraft,
  generateCampaignPostingDrafts,
  recordPredictionActuals,
  recordMinistryOutcome,
  reviewGrowthRecommendationGuardrails,
  saveGrowthCampaign,
  saveWeeklyGrowthRecommendations,
  syncMetaAnalytics,
  syncThreadsAnalytics,
  syncTikTokAnalytics,
  syncYouTubeAnalytics,
  updateGrowthRecommendationStatus,
} from "@/app/growth/actions";
import {
  listHistoricalPerformanceBaselines,
  listMinistryOutcomeReports,
  listPredictionReports,
  listSavedGrowthRecommendations,
} from "@/lib/growthPersistence";
import { listSocialAnalyticsConnectors } from "@/lib/socialAnalyticsConnectors";

export const dynamic = "force-dynamic";

type SearchParams = {
  draft?: string;
  campaign?: string;
  recommendations?: string;
  actuals?: string;
  youtube?: string;
  meta?: string;
  tiktok?: string;
  threads?: string;
  guardrails?: string;
  campaignPosts?: string;
  outcome?: string;
  eventName?: string;
  eventType?: string;
  eventDate?: string;
  signupUrl?: string;
};

type SavedGrowthCampaign = {
  id: string;
  name: string;
  eventName: string;
  eventType: string | null;
  objective: string;
  startsAt: Date | null;
  status: string;
  phases: Array<{
    id: string;
    name: string;
    timing: string;
    content: string;
    cta: string;
    status: string;
  }>;
};

type SavedCampaignResult = {
  available: boolean;
  campaigns: SavedGrowthCampaign[];
};

type CampaignCalendarItem = {
  id: string;
  campaignName: string;
  eventName: string;
  phaseName: string;
  timing: string;
  content: string;
  cta: string;
  status: string;
  scheduledDate: Date | null;
};

const CAMPAIGN_PHASE_DAY_OFFSETS = [-21, -9, -2, 2];

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { maximumFractionDigits: 0 }).format(value);
}

function formatPercent(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatCalendarDate(value: Date | null): string {
  if (!value) return "Flexible";

  return new Intl.DateTimeFormat("en", {
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(value);
}

function shiftDate(date: Date, days: number): Date {
  const shifted = new Date(date);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted;
}

function calendarStatusTone(status: string): "success" | "warning" | "neutral" | "accent" {
  if (["ACTIVE", "IN_PROGRESS", "APPROVED"].includes(status)) return "success";
  if (["COMPLETED", "POSTED"].includes(status)) return "accent";
  if (["SKIPPED", "ARCHIVED", "REJECTED"].includes(status)) return "neutral";
  return "warning";
}

function buildCampaignCalendarItems(input: {
  campaigns: SavedGrowthCampaign[];
  previewPlan: ReturnType<typeof buildEventCampaignPlan>;
  previewEventName: string;
  previewStartsAt: Date | null;
}): CampaignCalendarItem[] {
  const savedItems = input.campaigns.flatMap((campaign) => (
    campaign.phases.map((phase, index) => ({
      id: `${campaign.id}-${phase.id}`,
      campaignName: campaign.name,
      eventName: campaign.eventName,
      phaseName: phase.name,
      timing: phase.timing,
      content: phase.content,
      cta: phase.cta,
      status: phase.status,
      scheduledDate: campaign.startsAt ? shiftDate(campaign.startsAt, CAMPAIGN_PHASE_DAY_OFFSETS[index] ?? 0) : null,
    }))
  ));

  if (savedItems.length > 0) {
    return savedItems.sort((a, b) => {
      if (!a.scheduledDate && !b.scheduledDate) return 0;
      if (!a.scheduledDate) return 1;
      if (!b.scheduledDate) return -1;
      return a.scheduledDate.getTime() - b.scheduledDate.getTime();
    });
  }

  return input.previewPlan.phases.map((phase, index) => ({
    id: `preview-${phase.name}`,
    campaignName: input.previewPlan.name,
    eventName: input.previewEventName,
    phaseName: phase.name,
    timing: phase.timing,
    content: phase.content,
    cta: phase.cta,
    status: "DRAFT",
    scheduledDate: input.previewStartsAt ? shiftDate(input.previewStartsAt, CAMPAIGN_PHASE_DAY_OFFSETS[index] ?? 0) : null,
  }));
}

function normalizeClipQualityLabel(value: string | null | undefined): string {
  if (value === "POST_READY") return "Post-ready";
  if (value === "GOOD_NEEDS_REVIEW") return "Review first";
  if (value === "NEEDS_EDITING") return "Needs edit";
  if (value === "REJECT") return "Rejected";
  return "Needs review";
}

function connectionTone(status: string): "success" | "warning" | "neutral" {
  if (status === "CONNECTED") return "success";
  if (status === "MANUAL_TRACKING") return "warning";
  return "neutral";
}

function normalizeSearchString(value: string | undefined, fallback: string): string {
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function normalizeSearchDate(value: string | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function draftBannerMessage(status: string | undefined): string | null {
  if (status === "saved") return "Draft was created from the saved recommendation.";
  if (status === "invalid") return "Choose a valid recommendation with at least one supported posting platform.";
  if (status === "not-ready") return "That clip needs to be exported before it can become a growth draft.";
  if (status === "not-persisted") return "Draft could not be created from the saved recommendation.";
  return null;
}

function campaignBannerMessage(status: string | undefined): { tone: "success" | "warning"; message: string } | null {
  if (status === "saved") {
    return { tone: "success", message: "Campaign saved with phases for the media team to work through." };
  }

  if (status === "not-persisted") {
    return {
      tone: "warning",
      message: "Campaign could not be saved because the growth campaign tables are not available in the active database yet.",
    };
  }

  return null;
}

function workflowBannerMessage(input: {
  recommendations?: string;
  actuals?: string;
  youtube?: string;
  meta?: string;
  tiktok?: string;
  threads?: string;
  guardrails?: string;
  campaignPosts?: string;
  outcome?: string;
}): { tone: "success" | "warning"; title: string; message: string } | null {
  if (input.recommendations === "saved") {
    return { tone: "success", title: "Recommendations saved", message: "Weekly recommendations are now available for team review." };
  }

  if (input.recommendations === "updated") {
    return { tone: "success", title: "Recommendation updated", message: "The saved recommendation status was updated." };
  }

  if (input.recommendations === "invalid") {
    return { tone: "warning", title: "Recommendation not updated", message: "The recommendation action was missing required information." };
  }

  if (input.recommendations === "not-persisted") {
    return { tone: "warning", title: "Recommendations not saved", message: "Recommendation tables are not available in the active database yet." };
  }

  if (input.actuals === "saved") {
    return { tone: "success", title: "Actuals recorded", message: "Prediction accuracy has been updated for that post." };
  }

  if (input.actuals === "invalid" || input.actuals === "not-persisted") {
    return { tone: "warning", title: "Actuals not recorded", message: "Prediction actuals could not be saved. Check that growth tables are migrated." };
  }

  if (input.youtube === "synced") {
    return { tone: "success", title: "YouTube synced", message: "Recent YouTube analytics snapshots were imported." };
  }

  if (input.youtube === "not-synced") {
    return { tone: "warning", title: "YouTube not synced", message: "YouTube credentials, network access, or analytics tables are not available yet." };
  }

  if (input.meta === "synced") {
    return { tone: "success", title: "Meta synced", message: "Facebook and Instagram analytics snapshots were imported where permissions allow." };
  }

  if (input.meta === "not-synced") {
    return { tone: "warning", title: "Meta not synced", message: "Meta credentials, permissions, network access, or analytics tables are not available yet." };
  }

  if (input.tiktok === "synced") {
    return { tone: "success", title: "TikTok synced", message: "Recent TikTok video metrics were imported." };
  }

  if (input.tiktok === "not-synced") {
    return { tone: "warning", title: "TikTok not synced", message: "TikTok credentials, approved scopes, network access, or analytics tables are not available yet." };
  }

  if (input.threads === "synced") {
    return { tone: "success", title: "Threads synced", message: "Recent Threads post insights were imported." };
  }

  if (input.threads === "not-synced") {
    return { tone: "warning", title: "Threads not synced", message: "Threads credentials, approved scopes, network access, or analytics tables are not available yet." };
  }

  if (input.guardrails === "saved") {
    return { tone: "success", title: "Guardrails reviewed", message: "The saved recommendation now has a persisted guardrail review." };
  }

  if (input.guardrails === "invalid" || input.guardrails === "not-persisted") {
    return { tone: "warning", title: "Guardrails not saved", message: "Guardrail review could not be persisted for that recommendation." };
  }

  if (input.campaignPosts === "created") {
    return { tone: "success", title: "Campaign posts generated", message: "Campaign phases were turned into media-team posting drafts." };
  }

  if (input.campaignPosts === "invalid" || input.campaignPosts === "not-persisted") {
    return { tone: "warning", title: "Campaign posts not generated", message: "Campaign phase drafts could not be created." };
  }

  if (input.outcome === "saved") {
    return { tone: "success", title: "Outcome recorded", message: "Ministry impact was saved for reporting." };
  }

  if (input.outcome === "invalid" || input.outcome === "not-persisted") {
    return { tone: "warning", title: "Outcome not recorded", message: "The ministry outcome could not be saved." };
  }

  return null;
}

async function listSavedGrowthCampaigns(): Promise<SavedCampaignResult> {
  try {
    const campaigns = await prisma.growthCampaign.findMany({
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        name: true,
        eventName: true,
        eventType: true,
        objective: true,
        startsAt: true,
        status: true,
        phases: {
          orderBy: { orderIndex: "asc" },
          select: {
            id: true,
            name: true,
            timing: true,
            content: true,
            cta: true,
            status: true,
          },
        },
      },
    });

    return { available: true, campaigns };
  } catch (error) {
    console.warn("Growth campaign persistence is unavailable.", error);
    return { available: false, campaigns: [] };
  }
}

async function safeLoad<T>(label: string, promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    console.warn(`${label} is unavailable.`, error);
    return fallback;
  }
}

export default async function GrowthPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const [
    clipRecords,
    accounts,
    scheduledPosts,
    sermons,
    savedCampaignResult,
    savedRecommendationResult,
    predictionReportResult,
    historicalBaselineResult,
    ministryOutcomeResult,
  ] = await Promise.all([
    safeLoad(
      "Growth clips",
      prisma.clipCandidate.findMany({
        where: {
          OR: [
            { exportStatus: "COMPLETED" },
            { status: { in: ["APPROVED", "EXPORTED"] } },
          ],
        },
        orderBy: [
          { finalQualityScore: "desc" },
          { overallPostScore: "desc" },
          { score: "desc" },
        ],
        select: {
          id: true,
          title: true,
          hook: true,
          caption: true,
          hashtags: true,
          score: true,
          finalQualityScore: true,
          overallPostScore: true,
          qualityLabel: true,
          postReadyStatus: true,
          smartClipCategory: true,
          intendedAudience: true,
          durationSeconds: true,
          exportStatus: true,
          status: true,
          sermon: {
            select: {
              id: true,
              title: true,
              churchName: true,
              speakerName: true,
              intelligence: {
                select: {
                  centralTheme: true,
                  summary: true,
                },
              },
            },
          },
        },
        take: 60,
      }),
      [],
    ),
    safeLoad("Social accounts", listSocialAccounts(), []),
    safeLoad("Scheduled posts", listScheduledPosts(), []),
    safeLoad(
      "Recent sermon themes",
      prisma.sermon.findMany({
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          title: true,
          sermonDate: true,
          speakerName: true,
          churchName: true,
          intelligence: {
            select: {
              centralTheme: true,
            },
          },
          topicTags: {
            select: {
              topic: true,
              confidenceScore: true,
            },
            orderBy: { confidenceScore: "desc" },
            take: 4,
          },
        },
        take: 8,
      }),
      [],
    ),
    listSavedGrowthCampaigns(),
    listSavedGrowthRecommendations(),
    listPredictionReports(),
    listHistoricalPerformanceBaselines(),
    listMinistryOutcomeReports(),
  ]);
  const connectors = await listSocialAnalyticsConnectors();

  const clips: GrowthClipInput[] = clipRecords;
  const platformSnapshots = buildPlatformSnapshots({ accounts, scheduledPosts, clips });
  const recommendations = buildGrowthRecommendations({ clips, scheduledPosts, accounts, limit: 4 });
  const bestClips = [...clips]
    .sort((a, b) => getClipGrowthScore(b) - getClipGrowthScore(a))
    .slice(0, 5);
  const connectedCount = platformSnapshots.filter((item) => item.status === "CONNECTED").length;
  const plannedCount = scheduledPosts.filter((item) => !["POSTED", "SKIPPED", "FAILED"].includes(item.status)).length;
  const postedCount = scheduledPosts.filter((item) => item.status === "POSTED").length;
  const previewEventName = normalizeSearchString(params.eventName, "Next Sunday service");
  const previewEventType = normalizeSearchString(params.eventType, "church service");
  const previewStartsAt = normalizeSearchDate(params.eventDate);
  const eventPlan = buildEventCampaignPlan({
    eventName: previewEventName,
    eventType: previewEventType,
    startsAt: previewStartsAt,
  });
  const campaignCalendarItems = buildCampaignCalendarItems({
    campaigns: savedCampaignResult.campaigns,
    previewPlan: eventPlan,
    previewEventName,
    previewStartsAt,
  }).slice(0, 12);
  const bannerMessage = draftBannerMessage(params.draft);
  const campaignMessage = campaignBannerMessage(params.campaign);
  const workflowMessage = workflowBannerMessage(params);
  const trendAssessments = [
    assessTrendForMinistry("quiet prayer reflection format"),
    assessTrendForMinistry("testimony story-time format"),
    assessTrendForMinistry("shock reaction rage bait"),
  ];

  return (
    <main className="growth-page-shell stack-lg">
      <header className="growth-hero">
        <div className="stack-sm">
          <p className="kicker">Growth system</p>
          <h1>Ministry-aware social growth cockpit.</h1>
          <p className="muted">
            Use sermon clips, platform signals, event timing, and guardrails to decide what to post next, why it matters, and what impact to expect.
          </p>
        </div>
        <nav className="topbar-actions" aria-label="Growth actions">
          <Link href="/ready-to-post" className="button primary">Open publishing desk</Link>
          <Link href="/settings/social" className="button secondary">Connect analytics</Link>
          <Link href="/opportunities" className="button secondary">Content ideas</Link>
          <Link href="/sermons/new" className="button tertiary">Create clips</Link>
        </nav>
      </header>

      {bannerMessage ? (
        <div className="error-banner">
          <strong>Draft was not created</strong>
          <span>{bannerMessage}</span>
        </div>
      ) : null}

      {campaignMessage ? (
        <div className={campaignMessage.tone === "success" ? "success-banner" : "error-banner"}>
          <strong>{campaignMessage.tone === "success" ? "Campaign saved" : "Campaign not saved"}</strong>
          <span>{campaignMessage.message}</span>
        </div>
      ) : null}

      {workflowMessage ? (
        <div className={workflowMessage.tone === "success" ? "success-banner" : "error-banner"}>
          <strong>{workflowMessage.title}</strong>
          <span>{workflowMessage.message}</span>
        </div>
      ) : null}

      <section className="dashboard-command-strip growth-signal-strip" aria-label="Social growth summary">
        <StatCard label="Connected platforms" value={`${connectedCount}/7`} detail="Native or manual tracking" tone="success" />
        <StatCard label="Planned posts" value={plannedCount} detail="Waiting for approval or publish" tone="accent" />
        <StatCard label="Published posts" value={postedCount} detail="Marked posted in workflow" />
        <StatCard label="Growth-ready clips" value={clips.length} detail="Available content assets" tone="warning" />
      </section>

      <section className="growth-main-grid">
        <SectionCard
          title="AI recommendations"
          description="Ranked by clip quality, platform fit, ministry value, readiness, and human approval safety."
          className="growth-recommendations-panel"
        >
          <form action={saveWeeklyGrowthRecommendations} className="growth-save-campaign-form">
            <button type="submit" className="button secondary">Save weekly recommendations</button>
            <span className="muted small">Persists the current AI picks so the team can review them later.</span>
          </form>
          {recommendations.length === 0 ? (
            <EmptyState
              title="No unscheduled clip recommendations yet"
              description="Approve or export sermon clips, then the growth system will rank the best next posts."
              action={{ label: "Review sermons", href: "/sermons", variant: "primary" }}
            />
          ) : (
            <div className="growth-recommendation-list">
              {recommendations.map((recommendation) => (
                <article key={recommendation.id} className="growth-recommendation-card">
                  <div className="growth-recommendation-heading">
                    <div className="stack-sm">
                      <div className="clip-badge-row">
                        <StatusBadge tone="accent">Priority {recommendation.priority}</StatusBadge>
                        <StatusBadge tone="success">{recommendation.ministryTheme}</StatusBadge>
                        <StatusBadge tone="info">{recommendation.prediction.confidence} confidence</StatusBadge>
                      </div>
                      <h2>{recommendation.title}</h2>
                      <p className="muted small">{recommendation.hook}</p>
                    </div>
                    <form action={createGrowthRecommendationDraft} className="growth-draft-form">
                      <input type="hidden" name="clipId" value={recommendation.sourceClipId} />
                      <input type="hidden" name="title" value={recommendation.title} />
                      <input type="hidden" name="caption" value={recommendation.caption} />
                      <input type="hidden" name="postingSlot" value={recommendation.postingWindow} />
                      <input type="hidden" name="platforms" value={JSON.stringify(recommendation.platforms)} />
                      <input
                        type="hidden"
                        name="note"
                        value={`Growth recommendation: ${recommendation.rationale.join(" ")} Guardrails: ${recommendation.guardrails.join(" ")}`}
                      />
                      <button type="submit" className="button primary">Create draft</button>
                      <Link href={`/ready-to-post?clipId=${recommendation.sourceClipId}`} className="button tertiary">
                        Open clip
                      </Link>
                    </form>
                  </div>

                  <div className="growth-platform-chip-row">
                    {recommendation.platforms.map((platform) => (
                      <Chip key={platform} tone="info" size="sm">{platform}</Chip>
                    ))}
                    <Chip tone="neutral" size="sm">{recommendation.postingWindow}</Chip>
                  </div>

                  <div className="growth-two-column">
                    <div className="growth-copy-box">
                      <p className="kicker">Caption direction</p>
                      <p>{recommendation.caption}</p>
                      <p className="muted small">CTA: {recommendation.cta}</p>
                    </div>
                    <div className="growth-copy-box">
                      <p className="kicker">Forecast</p>
                      <p>
                        {formatNumber(recommendation.prediction.reachLow)}-{formatNumber(recommendation.prediction.reachHigh)} reach · {" "}
                        {formatPercent(recommendation.prediction.engagementRate)} engagement
                      </p>
                      <p className="muted small">
                        {recommendation.prediction.followerGrowthLow}-{recommendation.prediction.followerGrowthHigh} followers · {" "}
                        {recommendation.prediction.expectedWatchTimeSeconds}s expected watch time
                      </p>
                    </div>
                  </div>

                  <div className="growth-explanation-grid">
                    <div>
                      <p className="kicker">Why this</p>
                      <ul className="growth-check-list">
                        {recommendation.rationale.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                    <div>
                      <p className="kicker">Guardrails</p>
                      <ul className="growth-check-list">
                        {recommendation.guardrails.map((item) => <li key={item}>{item}</li>)}
                      </ul>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </SectionCard>

        <aside className="growth-side-stack stack-lg">
          <SectionCard title="Connected channels" description="API analytics can replace these derived estimates as each connector is approved.">
            <div className="growth-platform-list">
              {platformSnapshots.map((snapshot) => (
                <article key={snapshot.platform} className="growth-platform-row">
                  <div>
                    <div className="clip-badge-row">
                      <strong>{snapshot.platform}</strong>
                      <StatusBadge tone={connectionTone(snapshot.status)}>
                        {snapshot.status.toLowerCase().replace(/_/g, " ")}
                      </StatusBadge>
                    </div>
                    <p className="muted small">{snapshot.connectedLabel}</p>
                  </div>
                  <div className="growth-platform-metrics">
                    <span>{snapshot.plannedPosts} planned</span>
                    <span>{formatNumber(snapshot.estimatedReach)} reach</span>
                    <span>{formatPercent(snapshot.estimatedEngagementRate)}</span>
                  </div>
                  <p className="muted small">{snapshot.nextMove}</p>
                </article>
              ))}
            </div>
          </SectionCard>

          <SectionCard title="Trend discernment" description="Trends are filtered for gospel fit before any adaptation is suggested.">
            <div className="growth-trend-list">
              {trendAssessments.map((assessment) => (
                <article key={assessment.trend} className="growth-trend-card">
                  <div className="clip-badge-row">
                    <strong>{assessment.trend}</strong>
                    <StatusBadge tone={assessment.decision === "Use" ? "success" : assessment.decision === "Avoid" ? "danger" : "warning"}>
                      {assessment.decision}
                    </StatusBadge>
                  </div>
                  <p className="muted small">{assessment.reason}</p>
                  <p className="small">{assessment.adaptation}</p>
                </article>
              ))}
            </div>
          </SectionCard>
        </aside>
      </section>

      <section className="growth-lower-grid growth-admin-grid">
        <SectionCard title="Analytics connectors" description="Connectors show what can sync now and what is ready for setup next.">
          <div className="growth-connector-list">
            {connectors.map((connector) => (
              <article key={connector.platform} className="growth-connector-row">
                <div>
                  <div className="clip-badge-row">
                    <strong>{connector.platform}</strong>
                    <StatusBadge tone={connector.status === "ready" ? "success" : connector.status === "planned" ? "warning" : "neutral"}>
                      {connector.status.replace(/_/g, " ")}
                    </StatusBadge>
                  </div>
                  <p className="muted small">{connector.capability}</p>
                  {connector.missingEnv && connector.missingEnv.length > 0 ? (
                    <p className="muted small">Missing: {connector.missingEnv.join(", ")}</p>
                  ) : null}
                  {typeof connector.connectedAccounts === "number" ? (
                    <p className="muted small">{connector.connectedAccounts} connected account{connector.connectedAccounts === 1 ? "" : "s"}</p>
                  ) : null}
                </div>
                <div className="topbar-actions">
                  {connector.syncAction === "youtube" ? (
                    <form action={syncYouTubeAnalytics}>
                      <button type="submit" className="button secondary">Sync</button>
                    </form>
                  ) : null}
                  {connector.syncAction === "meta" ? (
                    <form action={syncMetaAnalytics}>
                      <button type="submit" className="button secondary">Sync</button>
                    </form>
                  ) : null}
                  {connector.syncAction === "tiktok" ? (
                    <form action={syncTikTokAnalytics}>
                      <button type="submit" className="button secondary">Sync</button>
                    </form>
                  ) : null}
                  {connector.syncAction === "threads" ? (
                    <form action={syncThreadsAnalytics}>
                      <button type="submit" className="button secondary">Sync</button>
                    </form>
                  ) : null}
                  {connector.setupHref ? <Link href={connector.setupHref} className="button tertiary">Setup</Link> : null}
                </div>
              </article>
            ))}
          </div>
        </SectionCard>

        <SectionCard title="Historical baseline" description="Actual snapshots now influence growth judgment and show where forecasts should improve.">
          {!historicalBaselineResult.available ? (
            <EmptyState title="No baseline available" description="Metric snapshots will appear here after YouTube sync or manual actual entry." />
          ) : historicalBaselineResult.items.length === 0 ? (
            <EmptyState title="No metric snapshots yet" description="Sync YouTube or record post actuals to build a performance baseline." />
          ) : (
            <div className="growth-baseline-list">
              {historicalBaselineResult.items.map((baseline) => (
                <article key={baseline.platform} className="growth-baseline-row">
                  <div>
                    <strong>{baseline.platform}</strong>
                    <p className="muted small">{baseline.snapshotCount} snapshots</p>
                  </div>
                  <span>{baseline.averageReach === null ? "n/a" : formatNumber(baseline.averageReach)} reach</span>
                  <span>{baseline.averageViews === null ? "n/a" : formatNumber(baseline.averageViews)} views</span>
                  <span>{baseline.averageEngagementRate === null ? "n/a" : formatPercent(baseline.averageEngagementRate)}</span>
                </article>
              ))}
            </div>
          )}
        </SectionCard>
      </section>

      <section className="growth-lower-grid">
        <SectionCard title="Saved recommendations" description="Weekly AI picks that have been persisted for approval, scheduling, and learning.">
          {!savedRecommendationResult.available ? (
            <EmptyState
              title="Recommendation persistence is waiting on the database"
              description="Apply the growth analytics migration after the PostgreSQL migration history is reachable."
            />
          ) : savedRecommendationResult.items.length === 0 ? (
            <EmptyState title="No saved recommendations yet" description="Save this week's AI recommendations from the panel above." />
          ) : (
            <div className="growth-saved-recommendation-list">
              {savedRecommendationResult.items.map((recommendation) => (
                <article key={recommendation.id} className="growth-saved-recommendation-row">
                  <div>
                    <div className="clip-badge-row">
                      <StatusBadge tone="accent">Priority {recommendation.priority}</StatusBadge>
                      <StatusBadge tone="neutral">{recommendation.status.toLowerCase().replace(/_/g, " ")}</StatusBadge>
                    </div>
                    <h3>{recommendation.title}</h3>
                    <p className="muted small">{recommendation.platforms.join(", ") || "No platforms saved"}</p>
                  </div>
                  {recommendation.sourceClipId ? (
                    <div className="growth-draft-form">
                      <form action={updateGrowthRecommendationStatus}>
                        <input type="hidden" name="recommendationId" value={recommendation.id} />
                        <input type="hidden" name="status" value="APPROVED" />
                        <button type="submit" className="button secondary">Approve</button>
                      </form>
                      <form action={updateGrowthRecommendationStatus}>
                        <input type="hidden" name="recommendationId" value={recommendation.id} />
                        <input type="hidden" name="status" value="REJECTED" />
                        <button type="submit" className="button tertiary">Reject</button>
                      </form>
                      <form action={reviewGrowthRecommendationGuardrails}>
                        <input type="hidden" name="recommendationId" value={recommendation.id} />
                        <button type="submit" className="button tertiary">
                          {recommendation.guardrailResult ? `Guardrail: ${recommendation.guardrailResult.toLowerCase()}` : "Review guardrails"}
                        </button>
                      </form>
                      <form action={createDraftFromSavedRecommendation}>
                        <input type="hidden" name="recommendationId" value={recommendation.id} />
                        <button type="submit" className="button primary">Create draft</button>
                      </form>
                      <Link href={`/ready-to-post?clipId=${recommendation.sourceClipId}`} className="button tertiary">Open clip</Link>
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Social analytics sync" description="Imports recent native analytics into growth metric snapshots when OAuth credentials are configured.">
          <div className="growth-copy-box">
            <p className="kicker">Connector status</p>
            <p>OAuth credentials are stored encrypted after authorization. Legacy YouTube env refresh tokens still work as a fallback.</p>
            <p className="muted small">The sync stores views, reach, impressions, engagement, watch time, saves, shares, comments, and follower movement where each API exposes them.</p>
          </div>
          <form action={syncYouTubeAnalytics} className="growth-save-campaign-form">
            <button type="submit" className="button primary">Sync YouTube analytics</button>
            <Link href="/settings/social" className="button tertiary">OAuth setup</Link>
            <span className="muted small">Requires network access and provider-approved OAuth scopes.</span>
          </form>
        </SectionCard>
      </section>

      <SectionCard title="Prediction vs actual" description="Compare AI forecasts against recorded post performance to improve future recommendations.">
        {!predictionReportResult.available ? (
          <EmptyState
            title="Prediction reporting is waiting on the database"
            description="Once the growth analytics tables are migrated, scheduled forecasts and actuals will appear here."
          />
        ) : predictionReportResult.items.length === 0 ? (
          <EmptyState title="No predictions recorded yet" description="Create a draft from a growth recommendation to record the first forecast." />
        ) : (
          <div className="growth-prediction-grid">
            {predictionReportResult.items.map((report) => (
              <article key={report.id} className="growth-prediction-card">
                <div className="stack-sm">
                  <div className="clip-badge-row">
                    <StatusBadge tone="info">{report.platform}</StatusBadge>
                    <StatusBadge tone="neutral">{report.confidence.toLowerCase()} confidence</StatusBadge>
                    {report.latestResult ? <StatusBadge tone="success">Actuals recorded</StatusBadge> : null}
                  </div>
                  <h3>{report.scheduledPost?.title ?? "Forecasted post"}</h3>
                  <p className="muted small">{report.scheduledPost?.postingSlot ?? "No posting slot"}</p>
                </div>
                <div className="growth-platform-metrics">
                  <span>{formatNumber(report.predictedReachLow)}-{formatNumber(report.predictedReachHigh)} reach</span>
                  <span>{formatPercent(report.predictedEngagementRate)} engagement</span>
                  <span>{formatNumber(report.predictedWatchTimeSeconds)}s watch</span>
                </div>
                {report.latestResult ? (
                  <div className="growth-copy-box">
                    <p className="kicker">Latest actual</p>
                    <p>
                      {report.latestResult.actualReach === null ? "No reach" : `${formatNumber(report.latestResult.actualReach)} reach`}
                      {" · "}
                      {report.latestResult.actualEngagementRate === null ? "No engagement" : formatPercent(report.latestResult.actualEngagementRate)}
                    </p>
                    <p className="muted small">
                      Reach error {report.latestResult.reachErrorPercent ?? "n/a"}% · Engagement delta {report.latestResult.engagementErrorPercent ?? "n/a"} pts
                    </p>
                  </div>
                ) : (
                  <form action={recordPredictionActuals} className="growth-actuals-form">
                    <input type="hidden" name="predictionId" value={report.id} />
                    <label>
                      <span className="small muted">Reach</span>
                      <input name="actualReach" type="number" min="0" placeholder="4200" />
                    </label>
                    <label>
                      <span className="small muted">Engagement %</span>
                      <input name="actualEngagementRate" type="number" min="0" step="0.1" placeholder="6.8" />
                    </label>
                    <label>
                      <span className="small muted">Followers</span>
                      <input name="actualFollowerGrowth" type="number" min="0" placeholder="18" />
                    </label>
                    <label>
                      <span className="small muted">Watch seconds</span>
                      <input name="actualWatchTimeSeconds" type="number" min="0" placeholder="37" />
                    </label>
                    <button type="submit" className="button secondary">Record actuals</button>
                  </form>
                )}
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      <section className="growth-lower-grid">
        <SectionCard title="Best sermon assets" description="Clips most likely to support gospel reach and meaningful engagement.">
          {bestClips.length === 0 ? (
            <EmptyState title="No growth-ready assets yet" description="Export approved clips to build your weekly posting plan." />
          ) : (
            <div className="growth-asset-list">
              {bestClips.map((clip) => (
                <Link key={clip.id} href={`/sermons/${clip.sermon.id}/clips/${clip.id}/studio`} className="growth-asset-row">
                  <div>
                    <h3>{clip.title}</h3>
                    <p className="muted small">{clip.sermon.title}</p>
                  </div>
                  <div className="clip-badge-row">
                    <StatusBadge tone="accent">Score {Math.round(getClipGrowthScore(clip))}</StatusBadge>
                    <StatusBadge tone="neutral">{normalizeClipQualityLabel(clip.qualityLabel ?? clip.postReadyStatus)}</StatusBadge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </SectionCard>

        <SectionCard title="Event campaign planner" description={eventPlan.objective}>
          <form className="growth-event-form" action="/growth" method="get">
            <label>
              <span className="small muted">Event name</span>
              <input name="eventName" defaultValue={eventPlan.name.replace(" growth campaign", "")} placeholder="Youth night" />
            </label>
            <label>
              <span className="small muted">Event type</span>
              <input name="eventType" defaultValue={previewEventType} placeholder="conference, worship night, outreach" />
            </label>
            <label>
              <span className="small muted">Event date</span>
              <input name="eventDate" type="date" defaultValue={params.eventDate ?? ""} />
            </label>
            <label>
              <span className="small muted">Signup URL</span>
              <input name="signupUrl" type="url" defaultValue={params.signupUrl ?? ""} placeholder="https://church.org/events/youth-night" />
            </label>
            <button className="button secondary" type="submit">Plan campaign</button>
          </form>
          <form action={saveGrowthCampaign} className="growth-save-campaign-form">
            <input type="hidden" name="eventName" value={eventPlan.name.replace(" growth campaign", "")} />
            <input type="hidden" name="eventType" value={previewEventType} />
            <input type="hidden" name="eventDate" value={params.eventDate ?? ""} />
            <input type="hidden" name="signupUrl" value={params.signupUrl ?? ""} />
            <button type="submit" className="button primary">Save campaign</button>
            <span className="muted small">
              Saves the generated phases for approval, scheduling, and future performance tracking.
            </span>
          </form>
          <div className="growth-campaign-timeline">
            {eventPlan.phases.map((phase) => (
              <article key={phase.name} className="growth-campaign-phase">
                <div>
                  <p className="kicker">{phase.timing}</p>
                  <h3>{phase.name}</h3>
                </div>
                <p className="muted small">{phase.content}</p>
                <p className="small"><strong>CTA:</strong> {phase.cta}</p>
              </article>
            ))}
          </div>
        </SectionCard>
      </section>

      <SectionCard
        title="Campaign calendar"
        description="A phase-by-phase ministry calendar for saved campaigns and the current event plan."
      >
        <div className="growth-calendar-toolbar">
          <div>
            <p className="kicker">Planning view</p>
            <h3>{savedCampaignResult.campaigns.length > 0 ? "Saved campaign phases" : eventPlan.name}</h3>
          </div>
          <div className="growth-platform-chip-row">
            <StatusBadge tone={savedCampaignResult.campaigns.length > 0 ? "success" : "warning"}>
              {savedCampaignResult.campaigns.length > 0 ? "Live plan" : "Draft preview"}
            </StatusBadge>
            <StatusBadge tone="neutral">{campaignCalendarItems.length} slots</StatusBadge>
          </div>
        </div>

        <div className="growth-calendar-grid">
          {campaignCalendarItems.map((item, index) => (
            <article key={item.id} className="growth-calendar-card">
              <div className="growth-calendar-date">
                <strong>{formatCalendarDate(item.scheduledDate)}</strong>
                <span>{item.timing}</span>
              </div>
              <div className="growth-calendar-body">
                <div className="clip-badge-row">
                  <StatusBadge tone={calendarStatusTone(item.status)}>
                    {item.status.toLowerCase().replace(/_/g, " ")}
                  </StatusBadge>
                  <StatusBadge tone="neutral">Phase {index + 1}</StatusBadge>
                </div>
                <h3>{item.phaseName}</h3>
                <p className="muted small">{item.campaignName}</p>
                <p>{item.content}</p>
                <p className="small"><strong>CTA:</strong> {item.cta}</p>
              </div>
            </article>
          ))}
        </div>
      </SectionCard>

      <SectionCard
        title="Saved campaigns"
        description="Persisted campaign plans are ready for approval workflows, scheduled posts, and outcome tracking."
      >
        {!savedCampaignResult.available ? (
          <EmptyState
            title="Campaign persistence is waiting on the database"
            description="The UI and schema are implemented. Apply the growth analytics migration after reconciling Prisma's SQLite/PostgreSQL migration history."
          />
        ) : savedCampaignResult.campaigns.length === 0 ? (
          <EmptyState
            title="No saved campaigns yet"
            description="Generate a campaign plan above, then save it for the media team."
          />
        ) : (
          <div className="growth-saved-campaign-grid">
            {savedCampaignResult.campaigns.map((campaign) => (
              <article key={campaign.id} className="growth-saved-campaign-card">
                <div className="stack-sm">
                  <div className="clip-badge-row">
                    <StatusBadge tone="accent">{campaign.status.toLowerCase()}</StatusBadge>
                    {campaign.startsAt ? (
                      <StatusBadge tone="neutral">
                        {new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(campaign.startsAt)}
                      </StatusBadge>
                    ) : null}
                  </div>
                  <h3>{campaign.name}</h3>
                  <p className="muted small">{campaign.objective}</p>
                </div>
                <div className="growth-mini-phase-list">
                  {campaign.phases.map((phase) => (
                    <div key={phase.id} className="growth-mini-phase-row">
                      <strong>{phase.name}</strong>
                      <span>{phase.timing}</span>
                    </div>
                  ))}
                </div>
                <form action={generateCampaignPostingDrafts} className="growth-save-campaign-form">
                  <input type="hidden" name="campaignId" value={campaign.id} />
                  <button type="submit" className="button secondary">Generate phase posts</button>
                </form>
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Ministry outcomes" description="Track ministry fruit alongside reach: prayer requests, signups, discipleship steps, messages, testimonies, and attendance.">
        <form action={recordMinistryOutcome} className="growth-outcome-form">
          <label>
            <span className="small muted">Outcome type</span>
            <select name="outcomeType" defaultValue="EVENT_SIGNUP">
              <option value="EVENT_SIGNUP">Event signup</option>
              <option value="PRAYER_REQUEST">Prayer request</option>
              <option value="DISCIPLESHIP_STEP">Discipleship step</option>
              <option value="WEBSITE_CLICK">Website click</option>
              <option value="MESSAGE">Message</option>
              <option value="TESTIMONY">Testimony</option>
              <option value="SERVICE_ATTENDANCE">Service attendance</option>
              <option value="OTHER">Other</option>
            </select>
          </label>
          <label>
            <span className="small muted">Campaign</span>
            <select name="campaignId" defaultValue="">
              <option value="">No campaign</option>
              {savedCampaignResult.campaigns.map((campaign) => (
                <option key={campaign.id} value={campaign.id}>{campaign.name}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="small muted">Scheduled post</span>
            <select name="scheduledPostId" defaultValue="">
              <option value="">No post</option>
              {scheduledPosts.slice(0, 20).map((post) => (
                <option key={post.id} value={post.id}>{post.title || `${post.platform} · ${post.postingSlot}`}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="small muted">Value</span>
            <input name="value" type="number" min="1" defaultValue="1" />
          </label>
          <label>
            <span className="small muted">Notes</span>
            <input name="notes" placeholder="Three prayer requests from this reel" />
          </label>
          <button type="submit" className="button primary">Record outcome</button>
        </form>
        {!ministryOutcomeResult.available ? (
          <EmptyState title="Outcome reporting unavailable" description="Ministry outcome tables are not reachable yet." />
        ) : ministryOutcomeResult.items.length === 0 ? (
          <EmptyState title="No outcomes recorded yet" description="Record outcomes as posts and campaigns produce meaningful responses." />
        ) : (
          <div className="growth-outcome-list">
            {ministryOutcomeResult.items.map((outcome) => (
              <article key={outcome.id} className="growth-outcome-row">
                <div>
                  <strong>{outcome.outcomeType.toLowerCase().replace(/_/g, " ")}</strong>
                  <p className="muted small">{outcome.notes || outcome.campaignName || outcome.scheduledPostTitle || "No note"}</p>
                </div>
                <span>{outcome.value}</span>
              </article>
            ))}
          </div>
        )}
      </SectionCard>

      <SectionCard title="Learning loop" description="The system is designed to compare predicted and actual performance once native analytics snapshots are synced.">
        <div className="growth-learning-grid">
          <div className="growth-copy-box">
            <p className="kicker">Current data source</p>
            <p>Clip quality, scheduled posts, manual publishing status, platform connections, sermon themes, and readiness checks.</p>
          </div>
          <div className="growth-copy-box">
            <p className="kicker">Next connector step</p>
            <p>Add metric snapshots for followers, views, reach, impressions, engagement, watch time, retention, clicks, and event signups.</p>
          </div>
          <div className="growth-copy-box">
            <p className="kicker">Ministry priority</p>
            <p>Optimize for discipleship, saves, shares, prayerful comments, event signups, and next-step pathways over vanity metrics alone.</p>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Recent sermon themes" description="Use these as campaign anchors for devotionals, clips, scripture posts, and follow-up content.">
        {sermons.length === 0 ? (
          <EmptyState title="No sermons yet" description="Process a sermon to see theme-based growth opportunities." />
        ) : (
          <div className="growth-sermon-theme-grid">
            {sermons.map((sermon) => (
              <article key={sermon.id} className="growth-theme-card">
                <p className="kicker">{sermon.churchName}</p>
                <h3>{sermon.title}</h3>
                <p className="muted small">{sermon.intelligence?.centralTheme ?? "Theme analysis pending."}</p>
                <div className="growth-platform-chip-row">
                  {sermon.topicTags.map((tag) => <Chip key={tag.topic} size="sm">{tag.topic}</Chip>)}
                </div>
              </article>
            ))}
          </div>
        )}
      </SectionCard>
    </main>
  );
}
