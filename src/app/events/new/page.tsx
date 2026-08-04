import Link from "next/link";

import { dateInputInTimezone } from "@/lib/ministryEvents";
import { prisma } from "@/lib/prisma";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { EventForm } from "@/app/events/event-form";
import styles from "../events.module.css";

export const dynamic = "force-dynamic";

export default async function NewEventPage() {
  const requestContext = await requireRequestCapability("sermons.create");
  const [organization, campus] = await Promise.all([
    prisma.organization.findUnique({
      where: { id: requestContext.organizationId },
      select: { timezone: true },
    }),
    requestContext.campusId
      ? prisma.campus.findFirst({
          where: {
            id: requestContext.campusId,
            organizationId: requestContext.organizationId,
          },
          select: { timezone: true },
        })
      : null,
  ]);
  const timezone = campus?.timezone || organization?.timezone || "Africa/Johannesburg";
  const today = dateInputInTimezone(new Date(), timezone);

  return (
    <main className={`${styles.eventsShell} stack-lg`}>
      <header className={`${styles.newEventHeader} stack-md`}>
        <Link href="/events" className="text-link">Back to events</Link>
        <div className="stack-sm">
          <p className="kicker">New event</p>
          <h1>Build the conference programme before the cameras roll.</h1>
          <p className="muted">
            Add the event once, then attach each day’s recordings to the right
            speaker and session from phone or desktop.
          </p>
        </div>
      </header>

      <div className={styles.newEventLayout}>
        <EventForm defaultStartDate={today} defaultTimezone={timezone} />
        <aside className={`${styles.eventBenefits} card stack-md`}>
          <p className="kicker">What this unlocks</p>
          <h2>One command centre for every message.</h2>
          <ul>
            <li><strong>Plan first</strong><span>Know which recordings are still missing.</span></li>
            <li><strong>Move quickly</strong><span>Upload directly against the correct session.</span></li>
            <li><strong>Review together</strong><span>Track every sermon and content handoff in one place.</span></li>
            <li><strong>Keep context</strong><span>Preserve day, speaker and conference attribution.</span></li>
          </ul>
        </aside>
      </div>
    </main>
  );
}
