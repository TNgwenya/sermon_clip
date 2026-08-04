import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader, StatusBadge } from "@/components/ui";
import {
  EVENT_SESSION_TYPE_LABELS,
  MINISTRY_EVENT_STATUS_LABELS,
  MINISTRY_EVENT_TYPE_LABELS,
  resolveEventSessionStatus,
  type EventSessionStatusView,
} from "@/lib/ministryEvents";
import { prisma } from "@/lib/prisma";
import { EventLiveRefresh } from "@/app/events/event-live-refresh";
import { EventSessionForm } from "@/app/events/event-session-form";
import { updateMinistryEventStatusAction } from "@/server/actions/ministryEvents";
import { canPersistedTenantCapability, requireRequestCapability } from "@/server/auth/requestAuthorization";
import { tenantResourceScope } from "@/server/tenancy/scope";
import styles from "../events.module.css";

export const dynamic = "force-dynamic";

function formatEventDates(startDate: Date, endDate: Date): string {
  const formatter = new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  return startDate.getTime() === endDate.getTime()
    ? formatter.format(startDate)
    : `${formatter.format(startDate)} – ${formatter.format(endDate)}`;
}

function formatSessionTime(value: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-ZA", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(value);
}

function statusTone(status: EventSessionStatusView): "neutral" | "success" | "warning" | "info" {
  return status.tone;
}

export default async function EventDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const requestContext = await requireRequestCapability("sermons.read");
  const event = await prisma.ministryEvent.findFirst({
    where: tenantResourceScope(requestContext, id),
    select: {
      id: true,
      organizationId: true,
      campusId: true,
      name: true,
      eventType: true,
      theme: true,
      description: true,
      venue: true,
      timezone: true,
      startDate: true,
      endDate: true,
      status: true,
      primaryBrandColor: true,
      secondaryBrandColor: true,
      organization: { select: { defaultLanguage: true } },
      sessions: {
        orderBy: [{ scheduledStartAt: "asc" }, { sortOrder: "asc" }],
        select: {
          id: true,
          title: true,
          sessionType: true,
          speakerName: true,
          language: true,
          scheduledStartAt: true,
          scheduledEndAt: true,
          dayNumber: true,
          priority: true,
          status: true,
          notes: true,
          sermon: {
            select: {
              id: true,
              status: true,
              youtubeUrl: true,
              sourceAsset: { select: { status: true } },
              processingJobs: {
                orderBy: { updatedAt: "desc" },
                take: 8,
                select: { status: true, type: true },
              },
              clipCandidates: { take: 1, select: { id: true } },
              contentOpportunities: { take: 1, select: { id: true } },
              contentAssets: {
                where: { status: { in: ["READY", "SCHEDULED", "PUBLISHED"] } },
                take: 1,
                select: { id: true },
              },
            },
          },
        },
      },
    },
  });
  if (!event) notFound();

  const canManage = await canPersistedTenantCapability(requestContext, "sermons.create", {
    campusId: event.campusId,
    resource: { kind: "EVENT", id: event.id },
  });
  const sessions = event.sessions.map((session) => ({
    ...session,
    operationalStatus: resolveEventSessionStatus({
      sessionStatus: session.status,
      sermon: session.sermon
        ? {
            status: session.sermon.status,
            youtubeUrl: session.sermon.youtubeUrl,
            sourceAsset: session.sermon.sourceAsset,
            processingJobs: session.sermon.processingJobs,
            clipCount: session.sermon.clipCandidates.length,
            contentOpportunityCount: session.sermon.contentOpportunities.length,
            readyContentAssetCount: session.sermon.contentAssets.length,
          }
        : null,
    }),
  }));
  const awaitingCount = sessions.filter((session) => session.operationalStatus.code === "AWAITING_RECORDING").length;
  const activeCount = sessions.filter((session) => session.operationalStatus.code === "UPLOADING" || session.operationalStatus.code === "PROCESSING").length;
  const reviewCount = sessions.filter((session) => session.operationalStatus.code === "READY_FOR_REVIEW").length;
  const readyCount = sessions.filter((session) => session.operationalStatus.code === "CONTENT_READY").length;
  const issueCount = sessions.filter((session) => session.operationalStatus.code === "NEEDS_ATTENTION").length;
  const days = new Map<number, typeof sessions>();
  for (const session of sessions) {
    const group = days.get(session.dayNumber) ?? [];
    group.push(session);
    days.set(session.dayNumber, group);
  }
  const defaultSessionDate = event.startDate.toISOString().slice(0, 10);
  const nextStatus = event.status === "ACTIVE"
    ? { value: "COMPLETED", label: "Complete event" }
    : { value: "ACTIVE", label: event.status === "COMPLETED" ? "Reopen event" : "Start event" };

  return (
    <main
      className={`${styles.eventsShell} stack-lg`}
      style={{
        "--event-accent": event.primaryBrandColor || "#9fceb1",
        "--event-accent-secondary": event.secondaryBrandColor || "#ddb169",
      } as React.CSSProperties}
    >
      <PageHeader
        eyebrow={`${MINISTRY_EVENT_TYPE_LABELS[event.eventType]} · ${formatEventDates(event.startDate, event.endDate)}`}
        title={event.name}
        description={event.description || event.theme || "Conference programme and session content operations."}
        actions={[
          ...(canManage ? [{ label: "Add next recording", href: "#event-programme", variant: "primary" as const }] : []),
          { label: "All events", href: "/events", variant: "tertiary" as const },
        ]}
        meta={<StatusBadge tone={event.status === "ACTIVE" ? "success" : event.status === "UPCOMING" ? "info" : "neutral"}>{MINISTRY_EVENT_STATUS_LABELS[event.status]}</StatusBadge>}
        className={styles.eventHeader}
      />

      <section className={styles.eventCommandStrip}>
        <article><span>Programme</span><strong>{sessions.length}</strong><small>planned sessions</small></article>
        <article><span>Recordings</span><strong>{awaitingCount}</strong><small>still needed</small></article>
        <article><span>In motion</span><strong>{activeCount}</strong><small>uploading or processing</small></article>
        <article><span>Review</span><strong>{reviewCount}</strong><small>waiting for your team</small></article>
        <article><span>Ready</span><strong>{readyCount}</strong><small>publishing output</small></article>
      </section>

      {event.venue || event.theme || canManage ? (
        <section className={`${styles.eventContextBar} card`}>
          <div>
            {event.theme ? <p><span>Theme</span><strong>{event.theme}</strong></p> : null}
            {event.venue ? <p><span>Venue</span><strong>{event.venue}</strong></p> : null}
            <p><span>Timezone</span><strong>{event.timezone}</strong></p>
          </div>
          {canManage ? (
            <form action={updateMinistryEventStatusAction} className={styles.eventStatusActions}>
              <input type="hidden" name="eventId" value={event.id} />
              <button className="button tertiary" name="status" value={nextStatus.value}>{nextStatus.label}</button>
              {event.status !== "ARCHIVED" ? <button className="button tertiary" name="status" value="ARCHIVED">Archive</button> : null}
            </form>
          ) : null}
        </section>
      ) : null}

      <EventLiveRefresh enabled={activeCount > 0} activeCount={activeCount} />

      {issueCount > 0 ? (
        <div className="attention-banner" role="status">
          <strong>{issueCount} session{issueCount === 1 ? "" : "s"} need attention.</strong>
          <span>Other conference sessions will continue independently.</span>
        </div>
      ) : null}

      <section id="event-programme" className={`${styles.programmeSection} stack-lg`}>
        <div className={styles.sectionHeading}>
          <div>
            <p className="kicker">Event programme</p>
            <h2>Every recording, one clear status</h2>
          </div>
          <span>{days.size} day{days.size === 1 ? "" : "s"} planned</span>
        </div>

        {sessions.length === 0 ? (
          <div className={`${styles.noSessions} card stack-sm`}>
            <h3>Add the first preaching session</h3>
            <p className="muted">Plan sessions now, then attach each recording as soon as it becomes available.</p>
          </div>
        ) : (
          [...days.entries()].map(([dayNumber, daySessions]) => (
            <section key={dayNumber} className={styles.eventDay}>
              <header>
                <span>Day {dayNumber}</span>
                <strong>{new Intl.DateTimeFormat("en-ZA", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  timeZone: event.timezone,
                }).format(daySessions[0].scheduledStartAt)}</strong>
                <small>{daySessions.length} session{daySessions.length === 1 ? "" : "s"}</small>
              </header>
              <div className={styles.sessionList}>
                {daySessions.map((session) => {
                  const status = session.operationalStatus;
                  const attachHref = `/sermons/new?eventSessionId=${encodeURIComponent(session.id)}`;
                  const canResumeUpload = session.sermon
                    && session.sermon.status === "CREATED"
                    && session.sermon.youtubeUrl.startsWith("local-upload://")
                    && session.sermon.sourceAsset?.status !== "READY";
                  return (
                    <article key={session.id} id={`session-${session.id}`} className={styles.sessionCard}>
                      <div className={styles.sessionTime}>
                        <strong>{formatSessionTime(session.scheduledStartAt, event.timezone)}</strong>
                        {session.scheduledEndAt ? <span>to {formatSessionTime(session.scheduledEndAt, event.timezone)}</span> : null}
                        {session.priority >= 80 ? <small>Same-day</small> : null}
                      </div>
                      <div className={`${styles.sessionMain} stack-sm`}>
                        <div className={styles.sessionTopline}>
                          <span>{EVENT_SESSION_TYPE_LABELS[session.sessionType]}</span>
                          <StatusBadge tone={statusTone(status)}>{status.label}</StatusBadge>
                        </div>
                        <h3>{session.title}</h3>
                        <p className="muted small">
                          {session.speakerName || "Speaker to be confirmed"}
                          {session.language ? ` · ${session.language}` : ""}
                        </p>
                        <div className={styles.sessionProgress} aria-label={`${status.progress}% complete`}>
                          <span style={{ width: `${status.progress}%` }} />
                        </div>
                        <p className="muted small">{status.detail}</p>
                      </div>
                      <div className={styles.sessionActions}>
                        {(!session.sermon || canResumeUpload) && canManage ? (
                          <Link href={attachHref} className="button primary">
                            {canResumeUpload ? "Resume upload" : "Add recording"}
                          </Link>
                        ) : null}
                        {session.sermon && !canResumeUpload ? (
                          <>
                            <Link href={`/sermons/${session.sermon.id}`} className="button secondary">
                              {status.code === "NEEDS_ATTENTION" ? "Recover session" : "Open sermon"}
                            </Link>
                            {(status.code === "READY_FOR_REVIEW" || status.code === "CONTENT_READY") ? (
                              <Link href={`/opportunities?sermonId=${session.sermon.id}`} className="button tertiary">Content ideas</Link>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))
        )}
      </section>

      {canManage && event.status !== "ARCHIVED" ? (
        <details className={`${styles.addSessionPanel} card`} open={sessions.length === 0 || undefined}>
          <summary>
            <span>
              <span className="kicker">Programme builder</span>
              <strong>Add another session</strong>
            </span>
            <small>Plan it now; upload later</small>
          </summary>
          <div className={styles.addSessionBody}>
            <EventSessionForm
              eventId={event.id}
              defaultDate={defaultSessionDate}
              defaultLanguage={event.organization.defaultLanguage}
            />
          </div>
        </details>
      ) : null}
    </main>
  );
}
