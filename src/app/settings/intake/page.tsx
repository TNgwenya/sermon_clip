import Link from "next/link";

import {
  canPersistedTenantCapability,
  requireRequestCapability,
} from "@/server/auth/requestAuthorization";
import {
  getActivationSnapshot,
  getYouTubeIntakeSnapshot,
} from "@/server/onboarding/activationSnapshot";

import { IntakeSettingsForm } from "./intake-settings-form";
import styles from "./intake.module.css";

export const dynamic = "force-dynamic";

function dateLabel(value: string | null | undefined): string {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
function statusTone(state: string): string {
  if (state === "monitoring_active") return styles.statusActive;
  if (state === "ready_to_enable" || state === "manual_ready") return styles.statusReady;
  return styles.statusAttention;
}

export default async function IntakeSettingsPage() {
  const requestContext = await requireRequestCapability("channels.read");
  const scope = {
    organizationId: requestContext.organizationId,
    campusId: requestContext.campusId,
  };
  const [intake, activation, canManage] = await Promise.all([
    getYouTubeIntakeSnapshot(scope),
    getActivationSnapshot(scope, requestContext.actorId),
    canPersistedTenantCapability(requestContext, "channels.manage"),
  ]);

  return (
    <main className={`container stack-lg ${styles.shell}`}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <Link href="/settings/social" className={styles.backLink}>← Social connections</Link>
          <p className={styles.eyebrow}>YouTube sermon intake</p>
          <h1>Let Sunday arrive on its own.</h1>
          <p>
            Connect one church channel, define safe defaults, and review every
            automatic check. Sermon Clip imports only eligible public videos published after
            the church confirms recording rights.
          </p>
        </div>
        <div className={`${styles.statusCard} ${statusTone(intake.readiness.state)}`}>
          <span>{intake.readiness.monitoringActive ? "Live status" : "Readiness status"}</span>
          <strong>{intake.readiness.title}</strong>
          <p>{intake.readiness.description}</p>
        </div>
      </header>

      <div className={styles.layout}>
        <section className={styles.configurationCard} aria-labelledby="intake-config-title">
          <div className={styles.cardHeading}>
            <div>
              <p className={styles.eyebrow}>Setup</p>
              <h2 id="intake-config-title">Channel and workflow defaults</h2>
              <p>These details are saved to the church workspace and checked before a new sermon is added.</p>
            </div>
            <span className={styles.scopeBadge}>{activation.organization.name}</span>
          </div>

          <IntakeSettingsForm
            accounts={intake.accounts}
            settings={intake.settings}
            fallbackSpeakerName={activation.actor.displayName}
            fallbackLanguage={activation.organization.defaultLanguage}
            fallbackEmail={activation.actor.email}
            canManage={canManage}
          />
        </section>

        <aside className={styles.readinessCard} aria-labelledby="readiness-title">
          <div className={styles.cardHeading}>
            <div>
              <p className={styles.eyebrow}>Before automatic intake starts</p>
              <h2 id="readiness-title">What must be true</h2>
            </div>
          </div>
          <ol className={styles.checkList}>
            {intake.readiness.checks.map((check) => (
              <li key={check.label} className={check.complete ? styles.checkComplete : styles.checkIncomplete}>
                <span className={styles.checkMark} aria-hidden="true">{check.complete ? "✓" : "!"}</span>
                <div>
                  <strong>{check.label}</strong>
                  <p>{check.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>

      <section className={styles.activityCard} aria-labelledby="monitoring-activity-title">
        <div className={styles.cardHeading}>
          <div>
            <p className={styles.eyebrow}>Automatic check history</p>
            <h2 id="monitoring-activity-title">What Sermon Clip has done</h2>
            <p>Recent channel checks and imports appear here so your team can confirm the automation is working.</p>
          </div>
          <Link className={styles.secondaryButton} href="/sermons/new">Add a sermon manually</Link>
          <Link className={styles.secondaryButton} href="/settings/live-intake">Set up live intake</Link>
        </div>

        <dl className={styles.activityGrid}>
          <div>
            <dt>Selected channel</dt>
            <dd>{intake.account?.label ?? "No channel selected"}</dd>
            <small>{intake.account?.handle || intake.account?.channelId || "Connect YouTube to identify the channel"}</small>
          </div>
          <div>
            <dt>Last automatic scan</dt>
            <dd>{dateLabel(intake.settings?.lastYoutubeScanAt)}</dd>
            <small>{intake.readiness.monitoringActive ? "Automatic checks are running" : "No recent automatic check is available"}</small>
          </div>
          <div>
            <dt>Last automatic import</dt>
            <dd>{dateLabel(intake.settings?.lastYoutubeImportAt)}</dd>
            <small>{intake.settings?.lastYoutubeVideoId ? `Video ${intake.settings.lastYoutubeVideoId}` : "No automatically imported video recorded"}</small>
          </div>
          <div>
            <dt>Latest manual YouTube sermon</dt>
            <dd>{intake.lastManualSermon?.title ?? "None yet"}</dd>
            <small>{intake.lastManualSermon ? `${dateLabel(intake.lastManualSermon.createdAt)} · ${intake.lastManualSermon.status.replace(/_/g, " ").toLowerCase()}` : "Paste a public or unlisted link to start"}</small>
          </div>
        </dl>

        {intake.settings?.lastError || intake.credential?.lastError ? (
          <div className={styles.errorNotice} role="alert">
            <strong>Latest connection or scan issue</strong>
            <p>{intake.settings?.lastError || intake.credential?.lastError}</p>
          </div>
        ) : null}
      </section>
    </main>
  );
}
