import Link from "next/link";
import type { CSSProperties } from "react";

import {
  canPersistedTenantCapability,
  requireRequestCapability,
} from "@/server/auth/requestAuthorization";
import { getActivationSnapshot } from "@/server/onboarding/activationSnapshot";

import { IdentityForm } from "./identity-form";
import { WorkflowDefaultsForm } from "./workflow-defaults-form";
import styles from "./onboarding.module.css";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const requestContext = await requireRequestCapability("organization.read", {
    campusId: null,
  });
  const [snapshot, canManageIdentity] = await Promise.all([
    getActivationSnapshot(
      {
        organizationId: requestContext.organizationId,
        campusId: requestContext.campusId,
      },
      requestContext.actorId,
    ),
    canPersistedTenantCapability(requestContext, "organization.update", {
      campusId: null,
    }),
  ]);
  const progressStyle = {
    "--activation-progress": `${snapshot.readiness.percentComplete * 3.6}deg`,
  } as CSSProperties;

  return (
    <main className={`container stack-lg ${styles.shell}`}>
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <Link href="/" className={styles.backLink}>← Back to dashboard</Link>
          <p className={styles.eyebrow}>Church launch guide</p>
          <h1>Set up once. Make every sermon easier.</h1>
          <p>
            Five practical decisions give the team consistent branding, clear
            approvals, and a repeatable path from Sunday to the week ahead.
          </p>
          {snapshot.readiness.nextStep ? (
            <Link className={styles.heroButton} href={snapshot.readiness.nextStep.href}>
              Continue with {snapshot.readiness.nextStep.title.toLowerCase()}
            </Link>
          ) : (
            <Link className={styles.heroButton} href="/sermons/new">
              Start a sermon
            </Link>
          )}
        </div>

        <div className={styles.progressCard}>
          <div className={styles.progressRing} style={progressStyle}>
            <span>{snapshot.readiness.percentComplete}%</span>
          </div>
          <div>
            <strong>{snapshot.readiness.completedCount} of {snapshot.readiness.totalCount} ready</strong>
            <span>
              {snapshot.readiness.nextStep
                ? `Next: ${snapshot.readiness.nextStep.title}`
                : "The church workflow is ready to use."}
            </span>
          </div>
        </div>
      </header>

      <section className={styles.checklistSection} aria-labelledby="activation-checklist-title">
        <div className={styles.sectionHeading}>
          <div>
            <p className={styles.eyebrow}>Launch checklist</p>
            <h2 id="activation-checklist-title">Your real workspace readiness</h2>
          </div>
          <p>Steps complete only when the related settings or work are saved.</p>
        </div>

        <ol className={styles.stepGrid}>
          {snapshot.readiness.steps.map((step, index) => (
            <li
              key={step.id}
              className={step.status === "complete" ? styles.stepComplete : styles.stepAttention}
            >
              <div className={styles.stepTopline}>
                <span className={styles.stepNumber} aria-hidden="true">
                  {step.status === "complete" ? "✓" : String(index + 1).padStart(2, "0")}
                </span>
                <span className={styles.status}>
                  <span className={styles.srOnly}>Status: </span>{step.statusLabel}
                </span>
              </div>
              <div className={styles.stepCopy}>
                <h3>{step.title}</h3>
                <p>{step.description}</p>
              </div>
              <Link href={step.href}>{step.actionLabel} <span aria-hidden="true">→</span></Link>
            </li>
          ))}
        </ol>
      </section>

      <section id="church-identity" className={styles.identityCard} aria-labelledby="identity-title">
        <div className={styles.identityHeading}>
          <div>
            <p className={styles.eyebrow}>Step 1</p>
            <h2 id="identity-title">Church identity</h2>
            <p>These saved defaults prefill every new sermon and keep calendars in local time.</p>
          </div>
          <span className={styles.workspaceBadge}>{snapshot.organization.name}</span>
        </div>
        <IdentityForm
          organization={snapshot.organization}
          canManage={canManageIdentity}
        />
      </section>

      <section className={styles.identityCard} aria-labelledby="rhythm-title">
        <div className={styles.identityHeading}>
          <div>
            <p className={styles.eyebrow}>Step 4</p>
            <h2 id="rhythm-title">Weekly rhythm</h2>
            <p>
              Choose the normal output target and reviewer day. This guides the
              workflow; it does not impose a fixed clip limit.
            </p>
          </div>
          <span className={styles.workspaceBadge}>Editable anytime</span>
        </div>
        <WorkflowDefaultsForm
          settings={snapshot.automationSettings}
          fallbackSpeakerName={snapshot.actor.displayName}
          fallbackEmail={snapshot.actor.email}
          canManage={canManageIdentity}
        />
      </section>

      <section className={styles.intakeCard} aria-labelledby="intake-title">
        <div>
          <p className={styles.eyebrow}>Sunday shortcut</p>
          <h2 id="intake-title">One recording starts the workflow.</h2>
          <p>
            Sermon details now begin with the saved church defaults. Add a YouTube
            link or recording, confirm rights, and SermonClip queues the full workflow.
          </p>
        </div>
        <div className={styles.intakeActions}>
          <Link className={styles.primaryButton} href="/sermons/new">Start a sermon</Link>
          <Link className={styles.secondaryButton} href="/settings/intake">YouTube intake readiness</Link>
        </div>
      </section>
    </main>
  );
}
