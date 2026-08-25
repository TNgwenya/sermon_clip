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
  const nextUndecidedClip = rankedClips.find((clip) => clip.status === "SUGGESTED");
  return nextUndecidedClip ? [nextUndecidedClip] : [];
}

const TECHNICAL_REVIEW_LANGUAGE = /\b(?:AI|algorithm|candidate|deterministic|fallback|model|top[- ]?up|boundary (?:adjusted|kept)|timing window)\b|\b\d+(?:\.\d+)?-\d+(?:\.\d+)?s\b/i;

function cleanDisplayText(value: string): string {
  return value
    .replace(/^[\s"“”']+|[\s"“”']+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtWord(value: string, maxLength = 76): string {
  if (value.length <= maxLength) return value;
  const shortened = value.slice(0, maxLength + 1).replace(/\s+\S*$/, "").trim();
  return `${shortened || value.slice(0, maxLength).trim()}…`;
}

function looksLikeGeneratedWordPile(value: string): boolean {
  const words = value.match(/[A-Za-z][A-Za-z'-]*/g) ?? [];
  if (words.length < 4) return false;

  const meaningfulWords = words
    .map((word) => word.toLowerCase())
    .filter((word) => !["a", "an", "and", "at", "for", "from", "in", "of", "on", "the", "to", "with"].includes(word));
  const hasRepeatedKeyword = new Set(meaningfulWords).size < meaningfulWords.length;
  const hasSentenceConnector = words.some((word) => /^(?:a|an|and|because|but|for|from|how|if|in|is|of|on|the|to|when|where|why|with|you|your)$/i.test(word));
  const titleCaseRatio = words.filter((word) => /^[A-Z]/.test(word)).length / words.length;

  return hasRepeatedKeyword || (titleCaseRatio >= 0.8 && !hasSentenceConnector);
}

export function buildPastorFacingClipTitle({
  title,
  hook,
  transcriptText,
}: {
  title: string;
  hook: string;
  transcriptText: string;
}): string {
  const cleanedTitle = cleanDisplayText(title);
  if (
    cleanedTitle
    && !TECHNICAL_REVIEW_LANGUAGE.test(cleanedTitle)
    && !looksLikeGeneratedWordPile(cleanedTitle)
  ) {
    return truncateAtWord(cleanedTitle);
  }

  const cleanedHook = cleanDisplayText(hook);
  if (cleanedHook && !TECHNICAL_REVIEW_LANGUAGE.test(cleanedHook)) {
    return truncateAtWord(cleanedHook.replace(/[.!?]+$/, ""));
  }

  const firstTranscriptThought = cleanDisplayText(transcriptText).split(/(?<=[.!?])\s+/)[0] ?? "";
  if (firstTranscriptThought && !TECHNICAL_REVIEW_LANGUAGE.test(firstTranscriptThought)) {
    return truncateAtWord(firstTranscriptThought.replace(/[.!?]+$/, ""));
  }

  return "Sermon moment";
}

export function buildPastorFacingInsight(value: string): string {
  const usableThoughts = value
    .split(/(?<=[.!?])\s+/)
    .map(cleanDisplayText)
    .filter((thought) => thought && !TECHNICAL_REVIEW_LANGUAGE.test(thought));
  const uniqueThoughts = usableThoughts.filter((thought, index) => (
    usableThoughts.findIndex((candidate) => candidate.toLowerCase() === thought.toLowerCase()) === index
  ));

  return uniqueThoughts.join(" ") || "This moment carries a clear message that is ready for your review.";
}

export function buildPastorFacingContext(boundaryQuality: "GOOD" | "NEEDS_REVIEW" | "BAD"): string {
  return boundaryQuality === "GOOD"
    ? "The opening and ending form a complete thought from the sermon."
    : "Listen to the opening and ending before approving this excerpt.";
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
