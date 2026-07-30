import Link from "next/link";

import type { PublishingBoardSnapshot } from "@/app/ready-to-post/publishing-board";
import styles from "@/app/ready-to-post/publishing-board.module.css";

export function WeeklyPublishingBoard({
  snapshot,
  weekLabel,
}: {
  snapshot: PublishingBoardSnapshot;
  weekLabel: string;
}) {
  return (
    <section className={styles.commandBoard} aria-labelledby="weekly-publishing-board-title">
      <div className={styles.commandHeader}>
        <div>
          <p className={styles.eyebrow}>This week</p>
          <h2 id="weekly-publishing-board-title">Publishing board</h2>
          <p>{weekLabel}</p>
        </div>
        <Link className="button tertiary" href="/growth">
          See growth decisions
        </Link>
      </div>

      <div className={styles.stateRail} aria-label="Publishing workflow status">
        <a className={`${styles.stateCard} ${snapshot.needsWorkCount > 0 ? styles.attention : ""}`} href="#ready-clips">
          <span>Needs work</span>
          <strong>{snapshot.needsWorkCount}</strong>
          <small>Repair or review</small>
        </a>
        <a className={`${styles.stateCard} ${snapshot.readyCount > 0 ? styles.ready : ""}`} href="#ready-clips">
          <span>Ready</span>
          <strong>{snapshot.readyCount}</strong>
          <small>Prepared to plan</small>
        </a>
        <a className={`${styles.stateCard} ${snapshot.scheduledCount > 0 ? styles.planned : ""}`} href="#posting-calendar">
          <span>Scheduled</span>
          <strong>{snapshot.scheduledCount}</strong>
          <small>Active handoffs</small>
        </a>
        <a className={`${styles.stateCard} ${snapshot.attentionCount > 0 ? styles.attention : ""}`} href="#posting-calendar">
          <span>Check result</span>
          <strong>{snapshot.attentionCount}</strong>
          <small>{snapshot.postedCount} confirmed live</small>
        </a>
      </div>

      <div className={styles.decisionRow}>
        <article className={`${styles.decisionCard} ${styles[snapshot.decision.tone]}`}>
          <div>
            <p className={styles.eyebrow}>{snapshot.decision.eyebrow}</p>
            <h3>{snapshot.decision.title}</h3>
            <p>{snapshot.decision.detail}</p>
            <small>{snapshot.decision.evidence}</small>
          </div>
          <Link className="button primary" href={snapshot.decision.href}>
            {snapshot.decision.actionLabel}
          </Link>
        </article>

        <aside className={styles.connectionCard} aria-label="Publishing connection readiness">
          <span className={snapshot.automaticPublishingReady ? styles.connectionReady : styles.connectionManual} aria-hidden="true" />
          <div>
            <strong>{snapshot.automaticPublishingLabel}</strong>
            <p>{snapshot.automaticPublishingDetail}</p>
            <small>
              {snapshot.manualHandoffAvailable
                ? "Manual video downloads and copy handoff are available."
                : "Manual handoff becomes available when final media is prepared."}
            </small>
          </div>
          <Link className="text-link small" href="/settings/social">Review channels</Link>
        </aside>
      </div>
    </section>
  );
}
