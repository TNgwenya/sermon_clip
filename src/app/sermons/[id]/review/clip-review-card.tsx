import Link from "next/link";

type QuickReviewDecisionActionsProps = {
  sermonId: string;
  clipId: string;
  clipTitle: string;
  canApprove: boolean;
  canReject: boolean;
  isPending: boolean;
  onApprove: () => void;
  onReject: () => void;
};

export function buildQuickReviewDisplay<T extends {
  status: "SUGGESTED" | "APPROVED" | "REJECTED" | "EXPORTED";
  canPreviewVideo: boolean;
}>(
  rankedClips: T[],
): T[] {
  const nextUndecidedClip = rankedClips.find((clip) => (
    clip.status === "SUGGESTED" && clip.canPreviewVideo
  ));
  return nextUndecidedClip ? [nextUndecidedClip] : [];
}

/**
 * The pastor-facing decision set. These actions deliberately stop at approval:
 * neither this component nor its links render, export, schedule, or publish.
 */
export function QuickReviewDecisionActions({
  sermonId,
  clipId,
  clipTitle,
  canApprove,
  canReject,
  isPending,
  onApprove,
  onReject,
}: QuickReviewDecisionActionsProps) {
  return (
    <section aria-labelledby={`quick-decisions-${clipId}`}>
      <div>
        <p className="kicker">Your decision</p>
        <h4 id={`quick-decisions-${clipId}`}>Is this message faithful and useful?</h4>
      </div>
      <div role="group" aria-label={`Three review decisions for ${clipTitle}`}>
        <button
          type="button"
          className="button primary"
          disabled={isPending || !canApprove}
          onClick={onApprove}
        >
          Approve &amp; use
        </button>
        <Link
          href={`/sermons/${sermonId}/clips/${clipId}/studio`}
          className="button secondary"
        >
          Adjust in Quick Finish
        </Link>
        <button
          type="button"
          className="button tertiary"
          disabled={isPending || !canReject}
          onClick={onReject}
        >
          Leave out
        </button>
      </div>
      <p className="small muted">
        Approval keeps this clip for your team. It does not publish or send anything.
      </p>
    </section>
  );
}
