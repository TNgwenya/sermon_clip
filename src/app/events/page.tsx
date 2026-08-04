import Link from "next/link";

import { EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import {
  MINISTRY_EVENT_STATUS_LABELS,
  MINISTRY_EVENT_TYPE_LABELS,
  resolveEventSessionStatus,
} from "@/lib/ministryEvents";
import { prisma } from "@/lib/prisma";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { tenantScope } from "@/server/tenancy/scope";
import styles from "./events.module.css";

export const dynamic = "force-dynamic";

function formatEventDates(startDate: Date, endDate: Date): string {
  const formatter = new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
  if (startDate.getTime() === endDate.getTime()) return formatter.format(startDate);
  return `${formatter.format(startDate)} – ${formatter.format(endDate)}`;
}

export default async function EventsPage() {
  const requestContext = await requireRequestCapability("sermons.read");
  const events = await prisma.ministryEvent.findMany({
    where: {
      ...tenantScope(requestContext),
      status: { not: "ARCHIVED" },
    },
    orderBy: [{ startDate: "desc" }, { createdAt: "desc" }],
    take: 60,
    select: {
      id: true,
      name: true,
      eventType: true,
      theme: true,
      venue: true,
      timezone: true,
      startDate: true,
      endDate: true,
      status: true,
      primaryBrandColor: true,
      sessions: {
        orderBy: [{ scheduledStartAt: "asc" }, { sortOrder: "asc" }],
        select: {
          status: true,
          sermon: {
            select: {
              status: true,
              youtubeUrl: true,
              sourceAsset: { select: { status: true } },
              processingJobs: {
                orderBy: { updatedAt: "desc" },
                take: 5,
                select: { status: true },
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

  return (
    <main className={`${styles.eventsShell} stack-lg`}>
      <PageHeader
        eyebrow="Events"
        title="Run every conference message from one place"
        description="Plan the programme, collect each recording, and follow every session through processing, review, and publishing."
        actions={[{ label: "Create event", href: "/events/new", variant: "primary" }]}
      />

      {events.length === 0 ? (
        <EmptyState
          eyebrow="No events yet"
          title="Create your first conference workspace"
          description="Events group several preaching sessions without changing your normal Sunday sermon workflow."
          action={{ label: "Create event", href: "/events/new", variant: "primary" }}
          className={styles.eventsEmpty}
          icon={<span>EV</span>}
        />
      ) : (
        <section className={styles.eventGrid} aria-label="Conference events">
          {events.map((event) => {
            const sessionStatuses = event.sessions.map((session) => resolveEventSessionStatus({
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
            }));
            const waiting = sessionStatuses.filter((status) => status.code === "AWAITING_RECORDING").length;
            const active = sessionStatuses.filter((status) => status.code === "UPLOADING" || status.code === "PROCESSING").length;
            const ready = sessionStatuses.filter((status) => status.code === "READY_FOR_REVIEW" || status.code === "CONTENT_READY").length;
            const issues = sessionStatuses.filter((status) => status.code === "NEEDS_ATTENTION").length;

            return (
              <article
                key={event.id}
                className={styles.eventCard}
                style={event.primaryBrandColor ? { "--event-accent": event.primaryBrandColor } as React.CSSProperties : undefined}
              >
                <div className={styles.eventCardTopline}>
                  <span>{MINISTRY_EVENT_TYPE_LABELS[event.eventType]}</span>
                  <StatusBadge tone={event.status === "ACTIVE" ? "success" : event.status === "UPCOMING" ? "info" : "neutral"}>
                    {MINISTRY_EVENT_STATUS_LABELS[event.status]}
                  </StatusBadge>
                </div>
                <div className="stack-sm">
                  <h2><Link href={`/events/${event.id}`}>{event.name}</Link></h2>
                  {event.theme ? <p className={styles.eventTheme}>{event.theme}</p> : null}
                  <p className="muted small">
                    {formatEventDates(event.startDate, event.endDate)}
                    {event.venue ? ` · ${event.venue}` : ""}
                  </p>
                </div>
                <div className={styles.eventCardStats}>
                  <span><strong>{event.sessions.length}</strong> sessions</span>
                  <span><strong>{waiting}</strong> need video</span>
                  <span><strong>{active}</strong> processing</span>
                  <span><strong>{ready}</strong> ready</span>
                </div>
                {issues > 0 ? (
                  <p className={styles.eventIssue}><strong>{issues}</strong> session{issues === 1 ? "" : "s"} need attention</p>
                ) : null}
                <Link href={`/events/${event.id}`} className="button secondary">Open event dashboard</Link>
              </article>
            );
          })}
        </section>
      )}
    </main>
  );
}
