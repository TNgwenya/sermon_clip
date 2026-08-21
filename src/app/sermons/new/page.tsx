import Link from "next/link";
import { notFound } from "next/navigation";

import { dateInputInTimezone } from "@/lib/ministryEvents";
import { prisma } from "@/lib/prisma";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { getSermonStartDefaults } from "@/server/onboarding/activationSnapshot";
import { isS3SourceStorageConfigured } from "@/server/media/s3SourceStorage";
import { canRunLocalMediaProcessing } from "@/server/runtime/workerRuntime";
import { tenantResourceScope } from "@/server/tenancy/scope";

import { NewSermonForm } from "./new-sermon-form";
import styles from "./new-sermon.module.css";

type NewSermonSearchParams = {
  youtubeUrl?: string;
  eventSessionId?: string;
};

export default async function NewSermonPage({ searchParams }: { searchParams: Promise<NewSermonSearchParams> }) {
  const params = await searchParams;
  const requestContext = await requireRequestCapability("sermons.create");
  const defaults = await getSermonStartDefaults(
    {
      organizationId: requestContext.organizationId,
      campusId: requestContext.campusId,
    },
    requestContext.actorId,
  );
  const eventSession = params.eventSessionId
    ? await prisma.eventSession.findFirst({
        where: tenantResourceScope(requestContext, params.eventSessionId),
        select: {
          id: true,
          title: true,
          speakerName: true,
          language: true,
          scheduledStartAt: true,
          status: true,
          sermonId: true,
          sermon: {
            select: {
              id: true,
              status: true,
              youtubeUrl: true,
              sourceAsset: {
                select: {
                  id: true,
                  status: true,
                  originalFileName: true,
                  sizeBytes: true,
                },
              },
            },
          },
          event: {
            select: {
              id: true,
              name: true,
              timezone: true,
              status: true,
            },
          },
        },
      })
    : null;
  const resumableEventUpload = Boolean(
    eventSession?.sermon
    && eventSession.sermon.status === "CREATED"
    && eventSession.sermon.youtubeUrl.startsWith("local-upload://")
    && eventSession.sermon.sourceAsset?.status !== "READY",
  );
  if (params.eventSessionId && (
    !eventSession
    || eventSession.status === "CANCELLED"
    || eventSession.event.status === "ARCHIVED"
    || (eventSession.sermonId && !resumableEventUpload)
  )) {
    notFound();
  }
  const eventContext = eventSession
    ? {
        eventId: eventSession.event.id,
        eventName: eventSession.event.name,
        sessionId: eventSession.id,
        sessionTitle: eventSession.title,
        ...(resumableEventUpload && eventSession.sermon ? {
          resumeUpload: {
            sermonId: eventSession.sermon.id,
            ...(eventSession.sermon.sourceAsset ? {
              sourceAssetId: eventSession.sermon.sourceAsset.id,
              fileName: eventSession.sermon.sourceAsset.originalFileName,
              fileSize: Number(eventSession.sermon.sourceAsset.sizeBytes),
            } : {}),
          },
        } : {}),
      }
    : undefined;
  const formDefaults = eventSession
    ? {
        ...defaults,
        title: eventSession.title,
        speakerName: eventSession.speakerName || defaults.speakerName,
        language: eventSession.language || defaults.language,
        sermonDate: dateInputInTimezone(eventSession.scheduledStartAt, eventSession.event.timezone),
      }
    : defaults;
  const localUploadFallbackEnabled = canRunLocalMediaProcessing();
  const directSourceUploadEnabled = isS3SourceStorageConfigured();
  const canUploadMedia = localUploadFallbackEnabled || directSourceUploadEnabled;

  return (
    <main id="main-content" className={`upload-page-shell premium-intake-page stack-lg ${styles.intakeShell}`}>
      <header className={`upload-hero premium-intake-hero ${styles.hero} ${styles.compactHero}`}>
        <div className="stack-sm">
          <Link href={eventContext ? `/events/${eventContext.eventId}` : "/"} className="text-link">
            {eventContext ? `Back to ${eventContext.eventName}` : "Back to your studio"}
          </Link>
          <p className="kicker">{eventContext ? "Add event recording" : "Add a sermon"}</p>
          <h1>{eventContext ? "Add the session recording" : "Start with your sermon"}</h1>
          <p className="muted">
            {eventContext
              ? `${eventContext.eventName} · ${eventContext.sessionTitle}. Its saved event details will stay attached.`
              : "Paste the YouTube link or upload the recording. We’ll show the strongest moments for your team to review first."}
          </p>
        </div>
        <div className={styles.heroActions}>
          <Link href="/settings/intake" className={styles.readinessLink}>YouTube automation</Link>
        </div>
      </header>

      <div className="premium-intake-layout">
        <NewSermonForm
          initialYoutubeUrl={params.youtubeUrl ?? ""}
          canUploadMedia={canUploadMedia}
          directSourceUploadEnabled={directSourceUploadEnabled}
          localUploadFallbackEnabled={localUploadFallbackEnabled}
          defaults={formDefaults}
          eventContext={eventContext}
        />

        <aside className="upload-outcome-panel" aria-label="What Sermon Clip will prepare">
          <div className="stack-sm">
            <p className="kicker">What you will get</p>
            <h2>A thoughtful first cut, ready for human review.</h2>
            <p className="muted">
              Sermon Clip keeps the message intact while helping your team move faster.
            </p>
          </div>

          <div className="outcome-media-composition" aria-hidden="true">
            <div className="outcome-source-frame">
              <span>Full sermon</span>
              <strong>48:20</strong>
            </div>
            <span className="outcome-bridge">becomes</span>
            <div className="outcome-clip-stack">
              <div><span>Strong opening</span><strong>0:42</strong></div>
              <div><span>Teaching moment</span><strong>0:58</strong></div>
            </div>
          </div>

          <ol className="outcome-assurance-list">
            <li><strong>Meaningful moments</strong><span>Suggestions are chosen for clarity, context, and ministry value.</span></li>
            <li><strong>Your approval stays central</strong><span>Nothing moves to posting until your team reviews it.</span></li>
            <li><strong>Ready for every channel</strong><span>Edit captions, framing, branding, and post copy in one workflow.</span></li>
          </ol>

          <div className={styles.processingNote}>
            <strong>Safe to leave after intake</strong>
            <p>
              Once the source is accepted, background processing continues. Live
              status is available on the dashboard; completion email delivery is
              not active yet.
            </p>
          </div>
        </aside>
      </div>
    </main>
  );
}
