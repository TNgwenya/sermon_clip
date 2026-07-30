import Link from "next/link";

import { assembleAutomaticWeekDraftAction } from "@/app/week-drafts/actions";
import styles from "@/app/week-drafts/week-drafts.module.css";
import { prisma } from "@/lib/prisma";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { tenantScope } from "@/server/tenancy/scope";

export const dynamic = "force-dynamic";

function mondayDateInput(reference = new Date()): string {
  const date = new Date(Date.UTC(
    reference.getUTCFullYear(),
    reference.getUTCMonth(),
    reference.getUTCDate(),
  ));
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() + (day === 0 ? 1 : 8 - day));
  return date.toISOString().slice(0, 10);
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default async function WeekDraftsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const filters = await searchParams;
  const requestContext = await requireRequestCapability("content.read");
  const scope = tenantScope(requestContext);
  const [drafts, sermons, workspace] = await Promise.all([
    prisma.weekDraft.findMany({
      where: scope,
      orderBy: [
        { weekStartsOn: "desc" },
        { updatedAt: "desc" },
      ],
      take: 24,
      select: {
        id: true,
        title: true,
        status: true,
        weekStartsOn: true,
        sermon: {
          select: {
            title: true,
            speakerName: true,
          },
        },
        items: {
          orderBy: [{ sortOrder: "asc" }],
          select: {
            format: true,
            status: true,
          },
        },
      },
    }),
    prisma.sermon.findMany({
      where: {
        ...scope,
        OR: [
          { clipCandidates: { some: {} } },
          { contentOpportunities: { some: {} } },
          { contentAssets: { some: {} } },
        ],
      },
      orderBy: [
        { sermonDate: "desc" },
        { createdAt: "desc" },
      ],
      take: 50,
      select: {
        id: true,
        title: true,
        speakerName: true,
        sermonDate: true,
      },
    }),
    requestContext.campusId
      ? prisma.campus.findFirst({
          where: {
            id: requestContext.campusId,
            organizationId: requestContext.organizationId,
            status: "ACTIVE",
          },
          select: {
            timezone: true,
            organization: { select: { timezone: true } },
          },
        })
      : prisma.organization.findFirst({
          where: {
            id: requestContext.organizationId,
            status: "ACTIVE",
          },
          select: { timezone: true },
        }),
  ]);
  const timezone = workspace && "organization" in workspace
    ? workspace.timezone || workspace.organization.timezone
    : workspace?.timezone || "UTC";

  return (
    <main className={styles.shell}>
      <header className={styles.hero}>
        <div>
          <p className="kicker">One sermon → one faithful week</p>
          <h1>Your week, already drafted.</h1>
          <p className={styles.heroCopy}>
            Sermon Clip chooses the strongest moments and ideas already in your
            sermon workspace, then arranges a balanced week for human review.
          </p>
        </div>
        <aside className={styles.promise}>
          <strong>5–7 total pieces, not 5–7 new clips</strong>
          <p>
            The automatic mix reuses your existing clips, graphics, posts, and
            ministry resources. It never changes how many clips are generated,
            and manual Week Drafts remain open-ended.
          </p>
        </aside>
      </header>

      <div className={styles.grid}>
        <section className={styles.section} aria-labelledby="assemble-heading">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="assemble-heading">Assemble this week</h2>
              <p>Choose the sermon. We’ll build the mix and preserve every source.</p>
            </div>
          </div>
          {filters.error ? (
            <p className={styles.errorNotice} role="alert">
              {filters.error}
            </p>
          ) : null}
          {sermons.length > 0 ? (
            <form action={assembleAutomaticWeekDraftAction} className={styles.form}>
              <label className={styles.field}>
                <span>Source sermon</span>
                <select name="sermonId" required defaultValue={sermons[0]?.id}>
                  {sermons.map((sermon) => (
                    <option key={sermon.id} value={sermon.id}>
                      {sermon.title} · {sermon.speakerName}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span>Week beginning</span>
                <input
                  type="date"
                  name="weekStartsOn"
                  required
                  defaultValue={mondayDateInput()}
                />
              </label>
              <label className={styles.field}>
                <span>Automatic mix size</span>
                <select name="targetItemCount" defaultValue="6">
                  <option value="5">5 total · Light week</option>
                  <option value="6">6 total · Recommended</option>
                  <option value="7">7 total · Full week</option>
                </select>
                <small>Uses at least three formats when your sermon has them.</small>
              </label>
              <label className={styles.field}>
                <span>Content focus</span>
                <select name="mixFocus" defaultValue="BALANCED">
                  <option value="BALANCED">Balanced week · Recommended</option>
                  <option value="SOCIAL">Social reach</option>
                  <option value="DISCIPLESHIP">Discipleship &amp; care</option>
                  <option value="CHURCH_COMMS">Church communications</option>
                </select>
                <small>
                  This prioritizes formats; it never invents a source that is
                  not present in the sermon workspace.
                </small>
              </label>
              <input type="hidden" name="timezone" value={timezone} />
              <button className="button primary" type="submit">
                Create my Week Draft
              </button>
            </form>
          ) : (
            <div className={styles.empty}>
              <div>
                <strong>No source-ready sermon yet</strong>
                <p>
                  Process a sermon first. Once it has a clip, content idea, or
                  content asset, it can become a Week Draft.
                </p>
                <Link className="button primary" href="/sermons/new">
                  Add a sermon
                </Link>
              </div>
            </div>
          )}
          <Link className={styles.advancedLink} href="/weekly-plan">
            Open Advanced Studio instead
          </Link>
        </section>

        <section className={styles.section} aria-labelledby="drafts-heading">
          <div className={styles.sectionHeader}>
            <div>
              <h2 id="drafts-heading">Week Drafts</h2>
              <p>Review the week as a whole, then approve one piece at a time.</p>
            </div>
            <span className={styles.pill}>{drafts.length} recent</span>
          </div>
          {drafts.length > 0 ? (
            <div className={styles.draftList}>
              {drafts.map((draft) => {
                const decided = draft.items.filter((item) =>
                  ["APPROVED", "CHANGES_REQUESTED", "SKIPPED", "ARCHIVED"]
                    .includes(item.status)).length;
                const formats = Array.from(new Set(draft.items.map((item) =>
                  humanize(item.format))));
                return (
                  <article className={styles.draftCard} key={draft.id}>
                    <div>
                      <h3>{draft.title}</h3>
                      <p>
                        {draft.sermon.speakerName} · Week of{" "}
                        {draft.weekStartsOn.toLocaleDateString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          timeZone: "UTC",
                        })}
                      </p>
                      <div className={styles.meta}>
                        <span className={styles.pill}>{humanize(draft.status)}</span>
                        <span className={styles.pill}>
                          {decided}/{draft.items.length} reviewed
                        </span>
                        <span className={styles.pill}>
                          {formats.length} formats
                        </span>
                      </div>
                      <div className={styles.formatRow}>
                        {formats.slice(0, 4).map((format) => (
                          <span className={styles.pill} key={format}>{format}</span>
                        ))}
                      </div>
                    </div>
                    <Link className="button primary" href={`/week-drafts/${draft.id}`}>
                      Review draft
                    </Link>
                  </article>
                );
              })}
            </div>
          ) : (
            <div className={styles.empty}>
              <div>
                <strong>Your first week starts on the left</strong>
                <p>
                  Automatic assembly is idempotent: choosing the same sermon and
                  week returns the same draft instead of creating duplicates.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
