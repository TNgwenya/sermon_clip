import Link from "next/link";
import type { CSSProperties } from "react";

import {
  approveWeekDraftReviewFormAction,
  requestWeekDraftReviewChangeFormAction,
  sendWeekDraftItemForApprovalFormAction,
} from "@/app/week-drafts/actions";
import styles from "@/app/week-drafts/week-drafts.module.css";

export type WeekDraftReviewCardModel = Readonly<{
  draftId: string;
  draftTitle: string;
  weekLabel: string;
  itemId: string;
  itemTitle: string;
  formatLabel: string;
  statusLabel: string;
  currentIndex: number;
  totalItems: number;
  decidedItems: number;
  copy: string;
  previewUrl: string | null;
  previewKind: "video" | "image" | "text";
  approvalRequestId: string | null;
  eligibleApprovalRole: string | null;
  canRequestApproval: boolean;
  sourceTypeLabel: string;
  sourceId: string | null;
  sourceRevisionId: string | null;
  sourceLabel: string;
  sermonTitle: string;
  speakerName: string;
  sourceExcerpt: string;
  sourceTimeLabel: string | null;
  sourceHref: string;
}>;

export function WeekDraftReviewCard({
  item,
}: {
  item: WeekDraftReviewCardModel;
}) {
  const progress = item.totalItems === 0
    ? 0
    : Math.round((item.decidedItems / item.totalItems) * 100);
  const approvalHref = item.approvalRequestId
    ? `/inbox?approvalId=${encodeURIComponent(item.approvalRequestId)}`
    : `/inbox?weekDraftId=${encodeURIComponent(item.draftId)}`;

  return (
    <>
      <header className={styles.reviewHeader}>
        <Link className={styles.advancedLink} href="/week-drafts">
          ← All Week Drafts
        </Link>
        <div>
          <p className="kicker">{item.weekLabel}</p>
          <h1>{item.draftTitle}</h1>
        </div>
        <p>
          Review one piece at a time. Nothing is published from this screen,
          and every card keeps its exact sermon source.
        </p>
        <div className={styles.progress} aria-label={`${progress}% reviewed`}>
          <div className={styles.progressLabel}>
            <span>Week progress</span>
            <span>{item.decidedItems} of {item.totalItems} reviewed</span>
          </div>
          <div className={styles.progressTrack} aria-hidden="true">
            <span style={{ "--review-progress": `${progress}%` } as CSSProperties} />
          </div>
        </div>
      </header>

      <article className={styles.reviewCard}>
        <div className={styles.preview}>
          {item.previewKind === "video" && item.previewUrl ? (
            <video controls preload="metadata" src={item.previewUrl}>
              Your browser cannot play this preview.
            </video>
          ) : item.previewKind === "image" && item.previewUrl ? (
            // This preview can be an authenticated local route, which next/image
            // cannot optimize without stripping its request context.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.previewUrl} alt={`Preview of ${item.itemTitle}`} />
          ) : (
            <div className={styles.textPreview}>
              <strong>{item.itemTitle}</strong>
              <p>{item.copy}</p>
            </div>
          )}
        </div>

        <div className={styles.reviewBody}>
          <div>
            <p className="kicker">
              Piece {item.currentIndex} of {item.totalItems} · {item.formatLabel}
            </p>
            <h2>{item.itemTitle}</h2>
            <p className={styles.reviewBodyCopy}>{item.copy}</p>
          </div>

          {item.approvalRequestId && item.eligibleApprovalRole ? (
            <div className={styles.reviewActions} aria-label="Pastor review actions">
              <form action={approveWeekDraftReviewFormAction}>
                <input type="hidden" name="weekDraftId" value={item.draftId} />
                <input
                  type="hidden"
                  name="approvalRequestId"
                  value={item.approvalRequestId}
                />
                <input
                  type="hidden"
                  name="decidedAsRole"
                  value={item.eligibleApprovalRole}
                />
                <button className="button primary" type="submit">Approve</button>
              </form>
              <details className={styles.wordingAction}>
                <summary className="button secondary">Edit wording</summary>
                <form action={requestWeekDraftReviewChangeFormAction}>
                  <input type="hidden" name="weekDraftId" value={item.draftId} />
                  <input
                    type="hidden"
                    name="approvalRequestId"
                    value={item.approvalRequestId}
                  />
                  <input
                    type="hidden"
                    name="decidedAsRole"
                    value={item.eligibleApprovalRole}
                  />
                  <label htmlFor={`wording-${item.itemId}`}>
                    What wording should the editor use?
                  </label>
                  <textarea
                    id={`wording-${item.itemId}`}
                    name="reason"
                    rows={4}
                    maxLength={5_000}
                    placeholder="Write the exact replacement or explain the correction."
                    required
                  />
                  <button className="button primary" type="submit">
                    Send wording
                  </button>
                </form>
              </details>
              <form action={requestWeekDraftReviewChangeFormAction}>
                <input type="hidden" name="weekDraftId" value={item.draftId} />
                <input
                  type="hidden"
                  name="approvalRequestId"
                  value={item.approvalRequestId}
                />
                <input
                  type="hidden"
                  name="decidedAsRole"
                  value={item.eligibleApprovalRole}
                />
                <input
                  type="hidden"
                  name="reason"
                  value="Leave this piece out of this week's content plan."
                />
                <button className="button tertiary" type="submit">Leave out</button>
              </form>
            </div>
          ) : (
            <div className={styles.reviewActions} aria-label="Pastor review actions">
              {item.canRequestApproval && !item.approvalRequestId ? (
                <form action={sendWeekDraftItemForApprovalFormAction}>
                  <input type="hidden" name="weekDraftId" value={item.draftId} />
                  <input type="hidden" name="weekDraftItemId" value={item.itemId} />
                  <button className="button primary" type="submit">
                    Send for pastor approval
                  </button>
                </form>
              ) : (
                <Link className="button primary" href={approvalHref}>
                  Open approval Inbox
                </Link>
              )}
              <Link className="button secondary" href={item.sourceHref}>
                Edit wording
              </Link>
              <Link className="button tertiary" href={approvalHref}>
                Leave out
              </Link>
            </div>
          )}

          {!item.approvalRequestId ? (
            <p className="muted small">
              {item.statusLabel === "Ready For Review"
                ? "This piece is ready, but its governed approval request has not been sent yet. The Inbox will ask an authorized team member to use the church’s default approval policy."
                : "This piece still needs content preparation before a governed approval request can be sent."}
            </p>
          ) : !item.eligibleApprovalRole ? (
            <p className="muted small">
              This exact version is waiting for an eligible approver under the
              church’s policy. You can still inspect its source or edit it in
              Advanced Studio if your role allows.
            </p>
          ) : null}

          <details className={styles.sourcePanel}>
            <summary>See exact source &amp; context</summary>
            <dl className={styles.sourceGrid}>
              <div>
                <dt>Source</dt>
                <dd>{item.sourceLabel}</dd>
              </div>
              <div>
                <dt>Sermon</dt>
                <dd>{item.sermonTitle} · {item.speakerName}</dd>
              </div>
              <div>
                <dt>Evidence</dt>
                <dd>{item.sourceExcerpt || "Source record retained; no excerpt was supplied."}</dd>
              </div>
              <div>
                <dt>Location</dt>
                <dd>{item.sourceTimeLabel ?? "Whole-sermon source"}</dd>
              </div>
              <div>
                <dt>Provenance type</dt>
                <dd>{item.sourceTypeLabel}</dd>
              </div>
              <div>
                <dt>Immutable reference</dt>
                <dd>
                  {item.sourceId ?? "Manual source"}
                  {item.sourceRevisionId ? ` · revision ${item.sourceRevisionId}` : ""}
                </dd>
              </div>
            </dl>
          </details>

          <footer className={styles.reviewFooter}>
            <span className={styles.pill}>{item.statusLabel}</span>
            <Link className={styles.advancedLink} href={item.sourceHref}>
              Open Advanced Studio
            </Link>
          </footer>
        </div>
      </article>
    </>
  );
}
