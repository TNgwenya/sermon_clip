import Link from "next/link";
import { canPersistedTenantCapability, requireRequestCapability } from "@/server/auth/requestAuthorization";
import { liveIntakeProviderReady } from "@/server/liveIntake/cloudflareStream";
import { prisma } from "@/lib/prisma";
import { LiveIntakeForm } from "./live-intake-form";
import styles from "./live-intake.module.css";

export const dynamic = "force-dynamic";

const destinationLabels = {
  PROVISIONING: "Setting up destination",
  READY: "Ready to receive",
  DISABLED: "Destination disabled",
  ERROR: "Setup needs attention",
};
const recordingLabels = {
  RECEIVED: "Recording received",
  MATERIALIZING: "Saving recording",
  QUEUED: "Queued for processing",
  FAILED: "Import needs attention",
  IGNORED: "Not imported",
};

export default async function LiveIntakePage() {
  const context = await requireRequestCapability("channels.read");
  const [canManage, intake] = await Promise.all([
    canPersistedTenantCapability(context, "channels.manage"),
    prisma.liveIntake.findFirst({ where: { organizationId: context.organizationId, campusId: context.campusId }, include: { organization: { select: { timezone: true } }, recordings: { where: { organizationId: context.organizationId }, orderBy: { createdAt: "desc" }, take: 5, include: { sermon: { select: { id: true, organizationId: true, campusId: true } } } } } }),
  ]);
  const enabled = liveIntakeProviderReady();
  return (
    <main className={`container stack-lg ${styles.shell}`}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <Link href="/settings/intake" className={styles.backLink}>← Sermon intake</Link>
          <p className={styles.eyebrow}>Live intake · Pilot</p>
          <h1>Sunday arrives here.</h1>
          <p>Connect your church’s encoder once. After each service, its recording enters your team’s review-first sermon workflow.</p>
        </div>
        <aside className={styles.statusCard} aria-label="Live destination status">
          <span className={styles.eyebrow}>Your destination</span>
          <strong>{!enabled ? "Setup unavailable" : intake ? destinationLabels[intake.status] : "Not connected yet"}</strong>
          <p>{intake?.status === "READY" && enabled ? "Your destination is configured. This does not confirm an active broadcast." : "Follow the steps below before your first service."}</p>
        </aside>
      </header>

      <section aria-labelledby="live-setup-heading" className={styles.setupSection}>
        <div className={styles.sectionHeading}><p className={styles.eyebrow}>One-time setup</p><h2 id="live-setup-heading">Three steps to your first recording</h2><p>Have your YoloBox, OBS, or another RTMPS-capable encoder ready.</p></div>
        <ol className={styles.steps}>
          <li className={styles.step}>
            <span className={styles.stepNumber} aria-hidden="true">01</span>
            <div><h3>{intake ? "Open your private destination" : "Create your private destination"}</h3><p>Give the destination a familiar name, then get the server address and stream key.</p>
              {intake ? <p className={styles.destinationName}>Destination: <strong>{intake.label}</strong></p> : null}
              <LiveIntakeForm enabled={enabled} canManage={canManage} hasIntake={Boolean(intake)} />
            </div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNumber} aria-hidden="true">02</span>
            <div><h3>Connect your encoder</h3><p>Add a custom streaming destination in YoloBox or OBS. Paste the RTMPS address into the server field and the private key into the stream-key field. Save it as “Sermon Clip”.</p><p className={styles.helper}>To broadcast to YouTube or Facebook at the same time, your encoder or streaming service must support sending to multiple destinations. Keep those destinations configured separately.</p></div>
          </li>
          <li className={styles.step}>
            <span className={styles.stepNumber} aria-hidden="true">03</span>
            <div><h3>Send a spoken test, then stop</h3><p>Stream a short spoken sample to Sermon Clip. Stop streaming so the recording can finish, then refresh this page to check its arrival below.</p><p className={styles.helper}>Open the imported sermon and check transcription and clips before relying on this for a full service. Finalizing and processing take time; “queued” does not mean clips are ready.</p><Link className="text-link" href="/sermons">Open sermon library →</Link></div>
          </li>
        </ol>
      </section>

      <section className={styles.recordings} aria-labelledby="recent-recordings-heading">
        <div className={styles.sectionHeading}><p className={styles.eyebrow}>After the service</p><h2 id="recent-recordings-heading">Recent recordings</h2><p>Your latest five recordings. Refresh to see new arrivals and status changes.</p></div>
        {intake?.lastError ? <div className={styles.notice} role="status"><strong>The last intake check needs attention.</strong><p>Your administrator can check the destination and retry the test before the next service.</p></div> : null}
        {intake?.recordings.length ? <ul className={styles.recordingList}>{intake.recordings.map((recording) => <li className={styles.recording} key={recording.id}>
          <div><h3>{recording.title || "Sunday live recording"}</h3><p className={styles.helper}><time dateTime={recording.receivedAt.toISOString()}>{recording.receivedAt.toLocaleDateString("en-ZA", { dateStyle: "medium", timeZone: intake.organization.timezone })}</time>{recording.durationSeconds != null ? ` · ${Math.floor(recording.durationSeconds / 60)}:${String(recording.durationSeconds % 60).padStart(2, "0")}` : ""}</p></div>
          <span className={styles.badge}>{recordingLabels[recording.status]}</span>
          {recording.sermon && recording.sermon.organizationId === context.organizationId && (!context.campusId || recording.sermon.campusId === context.campusId) ? <Link className="button secondary" href={`/sermons/${recording.sermonId}`} aria-label={`Open sermon: ${recording.title || "Sunday live recording"}`}>Open sermon</Link> : <span className={styles.helper}>{recording.status === "FAILED" ? "Ask your administrator to check the import." : recording.status === "IGNORED" ? "No sermon was created." : "The sermon link appears after import."}</span>}
        </li>)}</ul> : <div className={styles.empty}><strong>Your first recording will appear here.</strong><p>Complete the setup, send a test, and stop the stream. You can return to this page while the recording is prepared.</p></div>}
      </section>

      <aside className={styles.trustNote} aria-label="Review and storage policy"><div><h2>Your team stays in control</h2><p>Recordings become sermon drafts for your team to review. Nothing publishes automatically.</p></div><div><h2>Recording storage</h2><p>{intake ? `The live recording provider retains recordings for ${intake.recordingRetentionDays} days.` : "Your destination’s recording retention is shown after setup."} Imported sermon files follow a separate storage policy; this limit does not delete those copies.</p></div></aside>
    </main>
  );
}
