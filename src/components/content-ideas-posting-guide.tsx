"use client";

import { useEffect, useRef, useState } from "react";

const CONTENT_IDEAS_POSTING_GUIDE_ID = "content-ideas-posting-guide";

type ContentIdeasPostingGuideProps = {
  /** Keep the guide open when there are no ideas to work with yet. */
  defaultOpen?: boolean;
  /** Teach idea-pack creation before the review workflow when the sermon has no ideas. */
  startingWithoutIdeas?: boolean;
  /** A small pointer back to the complete guide for people already in Ready to Post. */
  compact?: boolean;
};

export function isContentIdeasPostingGuideTarget(hash: string): boolean {
  return hash === `#${CONTENT_IDEAS_POSTING_GUIDE_ID}`;
}

export function ContentIdeasPostingGuide({
  defaultOpen = false,
  startingWithoutIdeas = false,
  compact = false,
}: ContentIdeasPostingGuideProps) {
  const guideRef = useRef<HTMLDetailsElement>(null);
  const [isOpen, setIsOpen] = useState(defaultOpen);

  useEffect(() => {
    if (compact) return;

    function revealLinkedGuide() {
      if (!isContentIdeasPostingGuideTarget(window.location.hash)) return;

      if (guideRef.current) guideRef.current.open = true;
      setIsOpen(true);
      window.requestAnimationFrame(() => {
        guideRef.current?.querySelector("summary")?.focus({ preventScroll: true });
      });
    }

    revealLinkedGuide();
    window.addEventListener("hashchange", revealLinkedGuide);
    return () => window.removeEventListener("hashchange", revealLinkedGuide);
  }, [compact]);

  if (compact) {
    return (
      <aside className="content-ideas-posting-guide-refresher" aria-label="Content ideas posting guide">
        <div>
          <p className="kicker">Need a refresher?</p>
          <strong>Follow the same calm path: review, prepare, then schedule.</strong>
          <p className="muted small">Your post is only planned after the final scheduling choice.</p>
        </div>
        <a className="text-link small" href={`/opportunities#${CONTENT_IDEAS_POSTING_GUIDE_ID}`}>Open the 2-minute guide</a>
      </aside>
    );
  }

  return (
    <details
      ref={guideRef}
      id={CONTENT_IDEAS_POSTING_GUIDE_ID}
      className="content-ideas-posting-guide"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="content-ideas-posting-guide-summary">
          <span className="content-ideas-posting-guide-mark" aria-hidden="true">?</span>
          <span>
            <strong>{startingWithoutIdeas ? "Create your first content plan" : "Your first post in three steps"}</strong>
            <small>{startingWithoutIdeas
              ? "Start with a weekly pack, then review and plan · about 2 minutes"
              : "How Content Ideas becomes a planned post · about 2 minutes"}</small>
          </span>
          <span className="content-ideas-posting-guide-chevron" aria-hidden="true">⌄</span>
        </span>
      </summary>

      <div className="content-ideas-posting-guide-body">
        <p className="content-ideas-posting-guide-intro">
          {startingWithoutIdeas
            ? <>Begin by creating a focused set of drafts from this sermon. You stay in control—creating a pack, reviewing, saving, and rendering do not publish anything.</>
            : <>Turn one sermon moment into a planned post. You stay in control throughout—reviewing, saving, and rendering do not publish anything.</>}
        </p>

        <ol className="content-ideas-posting-guide-steps">
          {startingWithoutIdeas ? (
            <li>
              <span aria-hidden="true">1</span>
              <div>
                <strong>Create the weekly pack</strong>
                <p>
                  Select <b>Create weekly content pack</b>. The app will create a balanced set of draft ideas from this sermon. Use <b>Create standard idea set</b> only when you want a smaller general set instead.
                </p>
              </div>
            </li>
          ) : (
            <li>
              <span aria-hidden="true">1</span>
              <div>
                <strong>Preview &amp; approve</strong>
                <p>
                  Start with <b>Recommended next</b>, or choose a goal under <b>More ideas</b>. For a draft, select <b>Review this idea</b>. In the idea library, <b>Preview &amp; review</b> opens the same review path. Check the wording and source context, then select <b>Approve idea</b>.
                </p>
              </div>
            </li>
          )}
          <li>
            <span aria-hidden="true">2</span>
            <div>
              <strong>{startingWithoutIdeas ? "Review & approve" : "Prepare approved content"}</strong>
              <p>
                {startingWithoutIdeas ? (
                  <>Start with <b>Recommended next</b> and select <b>Review this idea</b>. Check the wording and source context, edit the content if needed, then select <b>Approve idea</b>.</>
                ) : (
                  <>After approval, the next action becomes <b>Prepare for publishing</b>. Edit the post package, then choose <b>Save &amp; choose design</b> for artwork or <b>Save &amp; continue to scheduling</b> for text and document posts.</>
                )}
              </p>
            </div>
          </li>
          <li>
            <span aria-hidden="true">3</span>
            <div>
              <strong>{startingWithoutIdeas ? "Prepare & schedule" : "Design & schedule"}</strong>
              <p>
                {startingWithoutIdeas ? (
                  <>Select <b>Prepare for publishing</b>. Save the post package, refine artwork in <b>Content Design Studio</b> when needed, then open <b>Ready to Post</b> and select <b>Choose date &amp; time</b>.</>
                ) : (
                  <>Once prepared, graphics show <b>Preview &amp; edit design</b>; text and document posts show <b>Continue to scheduling</b>. Render final artwork when needed, then review it in <b>Ready to Post</b> and select <b>Choose date &amp; time</b>.</>
                )}
              </p>
            </div>
          </li>
        </ol>

        <aside className="content-ideas-posting-guide-scheduling">
          <div>
            <p className="kicker">Choose how the post is shared</p>
            <strong>Manual media-team handoff</strong>
            <p className="muted small">Adds the post to the calendar for your team to upload later.</p>
          </div>
          <div>
            <strong>Automatic Facebook / Instagram images</strong>
            <p className="muted small">Can publish eligible final artwork at the planned time, but needs a connected account and an online publishing service.</p>
          </div>
        </aside>

        <div className="content-ideas-posting-guide-tips" aria-label="Helpful publishing tips">
          <p><b>Finished artwork comes later.</b> Content Ideas previews the copy; Content Design Studio creates the final visual.</p>
          <p><b>Your edits autosave.</b> Pause briefly after typing, or choose <b>Save changes</b>. Open <b>Version history</b> in the editor to confirm the recent review versions.</p>
          <p><b>Changed words need reapproval.</b> If you edit approved content, the app marks it clearly and keeps the previously approved version protected.</p>
          <p><b>Change a planned post safely.</b> Remove its planned post before editing, or create a fresh version. Published versions stay protected.</p>
        </div>
      </div>
    </details>
  );
}
