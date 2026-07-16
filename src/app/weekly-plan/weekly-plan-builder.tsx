"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import type {
  ContentFollowUpRecommendation,
  ContentPerformanceSummary,
} from "@/lib/contentPerformance";
import type { ContentPublishingPlatform } from "@/lib/contentPublishing";
import {
  buildWeeklyPlan,
  findExactScheduleDuplicateWarning,
  isValidIanaTimeZone,
  resolveWeeklyPlanPlatform,
  type WeeklyPlanCandidate,
  type WeeklyPlanObjective,
} from "@/lib/weeklyPlan";
import {
  bulkScheduleWeeklyPlanAction,
  recordWeeklyPlanPerformanceAction,
} from "@/server/actions/weeklyPlan";
import styles from "./weekly-plan.module.css";

export type WeeklyPlanSermonOption = {
  id: string;
  title: string;
  speakerName: string;
  sermonDate: string | null;
  centralTheme: string | null;
};

type WeeklyPlanBuilderProps = {
  sermons: WeeklyPlanSermonOption[];
  candidates: WeeklyPlanCandidate[];
  defaultWeekStart: string;
  performance: ContentPerformanceSummary[];
  recommendations: ContentFollowUpRecommendation[];
  recentPublishedPosts: Array<{
    id: string;
    title: string;
    platform: string;
    publishedUrl: string | null;
    hasMetrics: boolean;
  }>;
};

const PLATFORM_OPTIONS: Array<{ value: ContentPublishingPlatform; label: string }> = [
  { value: "INSTAGRAM", label: "Instagram" },
  { value: "FACEBOOK", label: "Facebook" },
  { value: "TIKTOK", label: "TikTok" },
  { value: "YOUTUBE_SHORTS", label: "YouTube Shorts" },
];

const OBJECTIVE_OPTIONS: Array<{ value: WeeklyPlanObjective; label: string; detail: string }> = [
  { value: "REACH", label: "Reach", detail: "Lead with high-quality clips, recaps, and shareable moments." },
  { value: "DISCIPLESHIP", label: "Discipleship", detail: "Prioritise teaching, Scripture, guides, and application." },
  { value: "PRAYER", label: "Prayer", detail: "Build the week around prayer, hope, and encouragement." },
  { value: "INVITATION", label: "Invitation", detail: "Prioritise gospel, service, event, and next-step content." },
  { value: "ENGAGEMENT", label: "Engagement", detail: "Use questions, Stories, discussions, and carousels." },
];

function dateTimeLabel(value: string, timezone: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Time needs review";
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function platformLabel(value: ContentPublishingPlatform): string {
  return PLATFORM_OPTIONS.find((platform) => platform.value === value)?.label ?? value;
}

export function WeeklyPlanBuilder({
  sermons,
  candidates,
  defaultWeekStart,
  performance,
  recommendations,
  recentPublishedPosts,
}: WeeklyPlanBuilderProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [performancePending, startPerformanceTransition] = useTransition();
  const [sermonId, setSermonId] = useState(sermons[0]?.id ?? "");
  const [weekStart, setWeekStart] = useState(defaultWeekStart);
  const [frequency, setFrequency] = useState(5);
  const [objective, setObjective] = useState<WeeklyPlanObjective>("DISCIPLESHIP");
  const [timezone, setTimezone] = useState("Africa/Johannesburg");
  const [platforms, setPlatforms] = useState<ContentPublishingPlatform[]>(["INSTAGRAM", "FACEBOOK"]);
  const [excludedIds, setExcludedIds] = useState<Set<string>>(new Set());
  const [platformOverrides, setPlatformOverrides] = useState<Record<string, ContentPublishingPlatform>>({});
  const [resultMessage, setResultMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [performancePostId, setPerformancePostId] = useState(recentPublishedPosts.find((post) => !post.hasMetrics)?.id ?? recentPublishedPosts[0]?.id ?? "");
  const [performanceValues, setPerformanceValues] = useState({ reach: "", views: "", comments: "", shares: "", saves: "", clickThroughs: "" });
  const [performanceMessage, setPerformanceMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const selectedSermon = sermons.find((sermon) => sermon.id === sermonId) ?? null;
  const plan = useMemo(() => buildWeeklyPlan({
    candidates,
    sermonId,
    weekStart,
    platforms,
    frequency,
    objective,
    timezone,
  }).map((item) => {
    const platform = resolveWeeklyPlanPlatform({
      planned: item.platform,
      override: platformOverrides[item.sourceId],
      selectedPlatforms: platforms,
    });
    const candidate = candidates.find((candidateItem) => (
      candidateItem.id === item.sourceId && candidateItem.sourceKind === item.sourceKind
    ));
    const exactWarning = candidate ? findExactScheduleDuplicateWarning({
      candidate,
      platform,
      scheduledFor: item.scheduledFor,
    }) : null;
    return {
      ...item,
      platform,
      duplicateWarnings: [
        ...item.duplicateWarnings.filter((warning) => !warning.includes("exact item")),
        ...(exactWarning ? [exactWarning] : []),
      ],
    };
  }), [candidates, frequency, objective, platformOverrides, platforms, sermonId, timezone, weekStart]);
  const selectedPlan = plan.filter((item) => !excludedIds.has(`${item.sourceKind}:${item.sourceId}`));
  const exactDuplicateCount = selectedPlan.filter((item) => item.duplicateWarnings.some((warning) => warning.includes("exact item"))).length;
  const repeatedPointCount = selectedPlan.filter((item) => item.duplicateWarnings.some((warning) => warning.includes("same sermon point"))).length;
  const selectedAssets = selectedPlan.filter((item) => item.sourceKind === "CONTENT_ASSET").length;
  const selectedClips = selectedPlan.length - selectedAssets;
  const timezoneValid = isValidIanaTimeZone(timezone);

  function togglePlatform(platform: ContentPublishingPlatform) {
    setPlatforms((current) => current.includes(platform)
      ? current.filter((item) => item !== platform)
      : [...current, platform]);
  }

  function scheduleWeek() {
    setResultMessage(null);
    startTransition(async () => {
      const result = await bulkScheduleWeeklyPlanAction({
        sermonId,
        weekStart,
        timezone,
        objective,
        items: selectedPlan.map((item) => ({
          sourceId: item.sourceId,
          sourceKind: item.sourceKind,
          sermonId: item.sermonId,
          title: item.title,
          caption: item.caption,
          contentType: item.contentType,
          pointKey: item.pointKey,
          platform: item.platform,
          scheduledFor: item.scheduledFor,
        })),
      });
      setResultMessage({ tone: result.success ? "success" : "error", text: result.message });
      if (result.success) router.refresh();
    });
  }

  function savePerformance() {
    const metric = (value: string): number | null => {
      const normalized = value.trim();
      if (!normalized) return null;
      const number = Number(normalized);
      return Number.isSafeInteger(number) && number >= 0 ? number : null;
    };
    setPerformanceMessage(null);
    startPerformanceTransition(async () => {
      const result = await recordWeeklyPlanPerformanceAction({
        scheduledPostId: performancePostId,
        reach: metric(performanceValues.reach),
        views: metric(performanceValues.views),
        comments: metric(performanceValues.comments),
        shares: metric(performanceValues.shares),
        saves: metric(performanceValues.saves),
        clickThroughs: metric(performanceValues.clickThroughs),
      });
      setPerformanceMessage({ tone: result.success ? "success" : "error", text: result.message });
      if (result.success) router.refresh();
    });
  }

  if (sermons.length === 0) {
    return (
      <section className={styles.section}>
        <h2>No publishing-ready sermon content yet</h2>
        <p className={styles.muted}>Prepare at least one approved clip or generated content asset, then return to build a mixed weekly plan.</p>
        <a href="/opportunities" className="button primary">Open Publishing Ideas</a>
      </section>
    );
  }

  return (
    <>
      <div className={styles.grid}>
        <aside className={`${styles.section} ${styles.controls}`} aria-label="Weekly plan settings">
          <div>
            <p className="kicker">Plan settings</p>
            <h2>Choose the ministry week</h2>
          </div>
          <label>
            Sermon
            <select value={sermonId} onChange={(event) => setSermonId(event.target.value)}>
              {sermons.map((sermon) => <option key={sermon.id} value={sermon.id}>{sermon.title}</option>)}
            </select>
          </label>
          <label>
            Week starts Monday
            <input type="date" value={weekStart} onChange={(event) => setWeekStart(event.target.value)} />
          </label>
          <label>
            Posting frequency
            <select value={frequency} onChange={(event) => setFrequency(Number(event.target.value))}>
              <option value={3}>3 posts</option>
              <option value={5}>5 posts</option>
              <option value={7}>7 posts</option>
            </select>
          </label>
          <label>
            Ministry objective
            <select value={objective} onChange={(event) => setObjective(event.target.value as WeeklyPlanObjective)}>
              {OBJECTIVE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
            <span className={styles.muted}>{OBJECTIVE_OPTIONS.find((option) => option.value === objective)?.detail}</span>
          </label>
          <div className={styles.platforms}>
            <fieldset>
              <legend>Platforms</legend>
              <div className={styles.platformOptions}>
                {PLATFORM_OPTIONS.map((platform) => (
                  <label key={platform.value}>
                    <input
                      type="checkbox"
                      checked={platforms.includes(platform.value)}
                      onChange={() => togglePlatform(platform.value)}
                    />
                    {platform.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <label>
            Calendar timezone
            <input value={timezone} maxLength={100} onChange={(event) => setTimezone(event.target.value)} />
            {!timezoneValid ? <span className={styles.error}>Use a valid IANA timezone, such as Africa/Johannesburg.</span> : null}
          </label>
          <div className={styles.warning}>
            <strong>Safe handoff mode</strong>
            <p>Every weekly-plan item is added for human review. Generated non-video content is never made automatic by this bulk action.</p>
          </div>
        </aside>

        <section className={styles.section} aria-label="Weekly plan preview">
          <div>
            <p className="kicker">Review before scheduling</p>
            <h2>{selectedSermon?.title ?? "Weekly content plan"}</h2>
            <p className={styles.muted}>{selectedSermon?.centralTheme || "Clips and approved generated material are balanced across the week."}</p>
          </div>
          <div className={styles.summary} aria-label="Weekly plan summary">
            <div><strong>{selectedPlan.length}</strong><span>selected posts</span></div>
            <div><strong>{selectedClips}</strong><span>video clips</span></div>
            <div><strong>{selectedAssets}</strong><span>generated assets</span></div>
          </div>
          {exactDuplicateCount > 0 ? (
            <div className={styles.error}><strong>Duplicate schedule blocked</strong><br />Remove the {exactDuplicateCount} item{exactDuplicateCount === 1 ? "" : "s"} already scheduled on the same platform.</div>
          ) : repeatedPointCount > 0 ? (
            <div className={styles.warning}><strong>Repeated sermon point</strong><br />{repeatedPointCount} proposed post{repeatedPointCount === 1 ? "" : "s"} may repeat an idea already used this week. Deselect or replace it if the repetition is not intentional.</div>
          ) : null}
          {resultMessage ? <div className={resultMessage.tone === "success" ? styles.success : styles.error}>{resultMessage.text}</div> : null}

          <div className={styles.list}>
            {plan.map((item) => {
              const selectionKey = `${item.sourceKind}:${item.sourceId}`;
              const selected = !excludedIds.has(selectionKey);
              return (
                <article key={selectionKey} className={styles.item}>
                  <label className={styles.selectRow} aria-label={`Include ${item.title}`}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => setExcludedIds((current) => {
                        const next = new Set(current);
                        if (next.has(selectionKey)) next.delete(selectionKey);
                        else next.add(selectionKey);
                        return next;
                      })}
                    />
                  </label>
                  <div>
                    <div className={styles.pills}>
                      <span className="status-pill">{item.sourceKind === "CLIP" ? "Video clip" : item.contentType.replace(/_/g, " ").toLowerCase()}</span>
                      <span className="status-pill">{platformLabel(item.platform)}</span>
                    </div>
                    <h3>{item.title}</h3>
                    <p className={styles.meta}>{dateTimeLabel(item.scheduledFor, timezone)} · {timezone}</p>
                    {item.duplicateWarnings.map((warning) => <p key={warning} className={styles.warning}>{warning}</p>)}
                    {item.sourceKind === "CONTENT_ASSET" ? (
                      <div className={styles.handoffs}>
                        <a className="text-link small" href={`/api/content-assets/${item.sourceId}/handoff/whatsapp`}>WhatsApp pack</a>
                        <a className="text-link small" href={`/api/content-assets/${item.sourceId}/handoff/story`}>Story pack</a>
                        <a className="text-link small" href={`/api/content-assets/${item.sourceId}/handoff/email`}>HTML email</a>
                      </div>
                    ) : null}
                  </div>
                  <label className={styles.itemSchedule}>
                    Platform
                    <select
                      value={item.platform}
                      onChange={(event) => setPlatformOverrides((current) => ({
                        ...current,
                        [item.sourceId]: event.target.value as ContentPublishingPlatform,
                      }))}
                    >
                      {PLATFORM_OPTIONS.filter((platform) => platforms.includes(platform.value)).map((platform) => (
                        <option key={platform.value} value={platform.value}>{platform.label}</option>
                      ))}
                    </select>
                  </label>
                </article>
              );
            })}
          </div>
          {plan.length === 0 ? <p className={styles.muted}>Choose at least one platform and prepare more content for this sermon.</p> : null}
          <div className={styles.actions}>
            <button
              type="button"
              className="button primary"
              disabled={isPending || selectedPlan.length === 0 || exactDuplicateCount > 0 || platforms.length === 0 || !timezoneValid}
              onClick={scheduleWeek}
            >
              {isPending ? "Checking & scheduling..." : `Approve & schedule ${selectedPlan.length || ""} post${selectedPlan.length === 1 ? "" : "s"}`}
            </button>
            <a className="button secondary" href="/ready-to-post#posting-calendar">Open mixed calendar</a>
          </div>
        </section>
      </div>

      <section className={`${styles.section} ${styles.performance}`} aria-label="Sermon content performance">
        <p className="kicker">Traceable performance</p>
        <h2>What published sermon content is teaching us</h2>
        <p className={styles.muted}>Metrics are matched to the scheduled post, then traced back to its clip or generated asset and source sermon.</p>
        {recentPublishedPosts.length > 0 ? (
          <details className={styles.performanceRecorder}>
            <summary>Record results for a manual handoff</summary>
            <div className={styles.controls}>
              <label>
                Published post
                <select value={performancePostId} onChange={(event) => setPerformancePostId(event.target.value)}>
                  {recentPublishedPosts.map((post) => (
                    <option key={post.id} value={post.id}>{post.title} · {post.platform}{post.hasMetrics ? " · results recorded" : ""}</option>
                  ))}
                </select>
              </label>
              <div className={styles.performanceInputs}>
                {([
                  ["reach", "Reach"],
                  ["views", "Views"],
                  ["comments", "Comments"],
                  ["shares", "Shares"],
                  ["saves", "Saves"],
                  ["clickThroughs", "Clicks"],
                ] as const).map(([key, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      type="number"
                      min={0}
                      step={1}
                      inputMode="numeric"
                      value={performanceValues[key]}
                      onChange={(event) => setPerformanceValues((current) => ({ ...current, [key]: event.target.value }))}
                    />
                  </label>
                ))}
              </div>
              {performanceMessage ? <div className={performanceMessage.tone === "success" ? styles.success : styles.error}>{performanceMessage.text}</div> : null}
              <button type="button" className="button secondary" disabled={performancePending || !performancePostId} onClick={savePerformance}>
                {performancePending ? "Saving results..." : "Save traceable results"}
              </button>
            </div>
          </details>
        ) : null}
        {performance.length > 0 ? (
          <div className={styles.performanceGrid}>
            {performance.slice(0, 6).map((item) => (
              <article key={`${item.sourceKind}:${item.sourceId}`} className={styles.performanceCard}>
                <span className="status-pill">{item.contentType.replace(/_/g, " ").toLowerCase()}</span>
                {!item.latestCapturedAt ? <span className="status-pill">Awaiting metrics</span> : null}
                <h3>{item.title}</h3>
                <p className={styles.meta}>{item.sermonTitle} · {item.platforms.join(" · ")}</p>
                <div className={styles.metricRow}>
                  <span><strong>{item.reach || item.views}</strong><br />reach/views</span>
                  <span><strong>{item.shares}</strong><br />shares</span>
                  <span><strong>{item.saves}</strong><br />saves</span>
                </div>
                <a className="text-link small" href={item.sourceKind === "CONTENT_ASSET"
                  ? `/ready-to-post?contentAssetId=${item.sourceId}`
                  : `/ready-to-post?clipId=${item.sourceId}`}
                >Open source content</a>
                {item.publishedUrls[0] ? <a className="text-link small" href={item.publishedUrls[0]} target="_blank" rel="noreferrer">Open published post</a> : null}
              </article>
            ))}
          </div>
        ) : <p className={styles.muted}>Published items will appear here after platform metrics or manually recorded results can be matched to a scheduled post.</p>}
        {recommendations.length > 0 ? (
          <div className={styles.list}>
            <h3>Recommended follow-ups</h3>
            {recommendations.map((recommendation) => (
              <article key={`${recommendation.sourceId}:${recommendation.followUpType}`} className={styles.performanceCard}>
                <span className="status-pill">{recommendation.followUpType.toLowerCase()}</span>
                <strong>{recommendation.title}</strong>
                <p className={styles.muted}>{recommendation.rationale}</p>
                <a className="text-link small" href={`/opportunities?sermonId=${recommendation.sermonId}`}>Create from this sermon</a>
              </article>
            ))}
          </div>
        ) : null}
      </section>
    </>
  );
}
