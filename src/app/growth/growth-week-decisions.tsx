import Link from "next/link";

import type { WeeklyGrowthDecision } from "@/app/growth/growth-display";
import styles from "@/app/growth/growth-week-decisions.module.css";

export function GrowthWeekDecisions({
  decision,
  recommendationHref,
  plannedCount,
}: {
  decision: WeeklyGrowthDecision;
  recommendationHref: string;
  plannedCount: number;
}) {
  return (
    <section className={styles.decisionBoard} aria-labelledby="growth-week-decisions-title">
      <div className={styles.header}>
        <div>
          <p className={styles.eyebrow}>This week’s decisions</p>
          <h2 id="growth-week-decisions-title">Turn evidence into the next post</h2>
        </div>
        <Link href="/ready-to-post#posting-calendar" className="button secondary">
          Review weekly board
        </Link>
      </div>

      <div className={styles.cards}>
        <article className={styles.primaryDecision}>
          <div className={styles.cardHeading}>
            <span>Publish next</span>
            <strong>{decision.confidence} confidence</strong>
          </div>
          <h3>{decision.title}</h3>
          <p>{decision.detail}</p>
          <small><b>Evidence:</b> {decision.evidence}</small>
          <Link href={recommendationHref} className="button primary">
            {decision.actionLabel}
          </Link>
        </article>

        <article className={styles.supportDecision}>
          <span>Plan</span>
          <strong>{plannedCount} active post{plannedCount === 1 ? "" : "s"}</strong>
          <p>{plannedCount > 0 ? "Check timing and handoff readiness on the weekly board." : "Choose an open day after preparing the next post."}</p>
          <Link href="/ready-to-post#posting-calendar" className="text-link small">Open calendar</Link>
        </article>

        <article className={styles.supportDecision}>
          <span>Learn</span>
          <strong>Measurement status</strong>
          <p>{decision.measurement}</p>
          <Link href="/settings/social" className="text-link small">Review analytics connections</Link>
        </article>
      </div>
    </section>
  );
}
