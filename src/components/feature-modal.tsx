"use client";

export type FeatureModalKind = "social" | "schedule" | "hook" | "broll" | "duplicate" | "drive" | "zoom";

type FeatureModalProps = {
  kind: FeatureModalKind | null;
  onClose: () => void;
};

const featureCopy: Record<
  FeatureModalKind,
  {
    title: string;
    description: string;
    primaryAction: string;
    cards: Array<{ title: string; detail: string; tag?: string }>;
  }
> = {
  social: {
    title: "Add social accounts",
    description: "Connect the church channels you want Sermon Clip to prepare posts for.",
    primaryAction: "Account connections are coming soon",
    cards: [
      { title: "YouTube Shorts", detail: "Church channel", tag: "Soon" },
      { title: "Instagram", detail: "Reels and captions", tag: "Soon" },
      { title: "Facebook", detail: "Church page", tag: "Soon" },
      { title: "TikTok", detail: "Vertical sermon clips", tag: "Soon" },
    ],
  },
  schedule: {
    title: "Schedule post",
    description: "Plan a weekly posting rhythm for approved sermon clips.",
    primaryAction: "Scheduling is coming soon",
    cards: [
      { title: "Sunday recap", detail: "Post after service" },
      { title: "Midweek encouragement", detail: "Post Tuesday or Wednesday" },
      { title: "Prayer invitation", detail: "Post before prayer meeting" },
      { title: "Weekend invite", detail: "Post before next service" },
    ],
  },
  hook: {
    title: "AI hook",
    description: "Generate stronger opening text for the first seconds of a clip.",
    primaryAction: "AI hook editing is coming soon",
    cards: [
      { title: "Question hook", detail: "Start with a clear question" },
      { title: "Scripture hook", detail: "Lead with the verse or theme" },
      { title: "Pastoral hook", detail: "Make the invitation feel warm" },
      { title: "Shorts hook", detail: "Sharper wording for social feeds" },
    ],
  },
  broll: {
    title: "Add B-Roll",
    description: "Plan simple supporting visuals without turning Sermon Clip into a complex editor.",
    primaryAction: "B-Roll planning is coming soon",
    cards: [
      { title: "Scripture slide", detail: "Show the referenced passage" },
      { title: "Church logo bumper", detail: "Short branded intro or outro" },
      { title: "Service photo", detail: "Use church-approved media" },
      { title: "Lower third", detail: "Speaker and sermon title" },
    ],
  },
  duplicate: {
    title: "Duplicate clip",
    description: "Create a second version for a different caption, hook, or platform.",
    primaryAction: "Clip duplication is coming soon",
    cards: [
      { title: "TikTok version", detail: "Shorter caption and hashtags" },
      { title: "Instagram version", detail: "Reels-ready copy" },
      { title: "YouTube version", detail: "Longer description" },
      { title: "Pastor edit", detail: "A safer alternate cut" },
    ],
  },
  drive: {
    title: "Import from Google Drive",
    description: "Bring in sermon videos from your church media folder without making pastors handle files manually.",
    primaryAction: "Google Drive import is coming soon",
    cards: [
      { title: "Church media folder", detail: "Choose a shared Drive folder", tag: "Soon" },
      { title: "Latest service video", detail: "Pick the newest sermon upload" },
      { title: "Team permissions", detail: "Keep access with approved media volunteers" },
      { title: "Auto-import", detail: "Prepare new sermons after upload" },
    ],
  },
  zoom: {
    title: "Import from Zoom",
    description: "Turn recorded livestreams and Bible studies into clips after the service ends.",
    primaryAction: "Zoom import is coming soon",
    cards: [
      { title: "Cloud recordings", detail: "Select from recent church recordings", tag: "Soon" },
      { title: "Bible study clips", detail: "Find teaching moments from classes" },
      { title: "Speaker view", detail: "Prefer the preacher when available" },
      { title: "Weekly rhythm", detail: "Pull recordings into the review queue" },
    ],
  },
};

export function FeatureModal({ kind, onClose }: FeatureModalProps) {
  if (!kind) {
    return null;
  }

  const copy = featureCopy[kind];

  return (
    <div className="feature-modal-backdrop" role="presentation" onClick={onClose}>
      <section
        className="feature-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="feature-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <button type="button" className="feature-modal-close" onClick={onClose} aria-label="Close">
          Close
        </button>
        <div className="stack-sm">
          <h2 id="feature-modal-title">{copy.title}</h2>
          <p className="muted">{copy.description}</p>
        </div>
        <div className="feature-modal-grid">
          {copy.cards.map((card) => (
            <article key={card.title} className="feature-modal-option">
              {card.tag ? <span className="status-pill">{card.tag}</span> : null}
              <strong>{card.title}</strong>
              <span className="muted small">{card.detail}</span>
            </article>
          ))}
        </div>
        <div className="feature-modal-footer">
          <button type="button" className="button primary" onClick={onClose}>
            Got it
          </button>
          <span className="muted small">{copy.primaryAction}</span>
        </div>
      </section>
    </div>
  );
}
