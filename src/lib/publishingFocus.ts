export type PublishingFocusInput = {
  sermonTitle?: string | null;
  sermonId?: string | null;
  clipTitle?: string | null;
  clipId?: string | null;
  assetTitle?: string | null;
  assetId?: string | null;
  assetNeedsReview?: boolean;
};

export type PublishingFocus = {
  eyebrow: string;
  title: string;
  description: string;
  actionLabel: string;
  actionHref: string;
};

/**
 * Keeps the publishing desk centred on one pastoral decision. Operational
 * queues remain available, but they are never presented as the primary object.
 */
export function buildPublishingFocus(input: PublishingFocusInput): PublishingFocus {
  if (input.assetId && input.assetTitle) {
    if (input.assetNeedsReview) {
      return {
        eyebrow: "One post",
        title: `Review ${input.assetTitle}`,
        description: `Check the wording and source context${input.sermonTitle ? ` from ${input.sermonTitle}` : ""}, then explicitly approve this version before it can be scheduled.`,
        actionLabel: "Review this post",
        actionHref: `/ready-to-post/content-assets/${input.assetId}/studio`,
      };
    }

    return {
      eyebrow: "One post",
      title: `Prepare ${input.assetTitle}`,
      description: `Preview the approved version${input.sermonTitle ? ` from ${input.sermonTitle}` : ""}, then choose whether to download or schedule it.`,
      actionLabel: "Open this post",
      actionHref: "#publishing-operations",
    };
  }

  if (input.clipId && input.clipTitle) {
    return {
      eyebrow: "One clip",
      title: `Finish ${input.clipTitle}`,
      description: `Review this clip in its sermon context, then prepare it only after a person approves the moment.`,
      actionLabel: "Review this clip",
      actionHref: input.sermonId ? `/sermons/${input.sermonId}/review` : "#sermon-assets",
    };
  }

  if (input.sermonId && input.sermonTitle) {
    return {
      eyebrow: "One sermon",
      title: `Choose one post from ${input.sermonTitle}`,
      description: "Start with one clip or written post. The queue, calendar, and batch tools remain available when you need them.",
      actionLabel: "Choose a post",
      actionHref: "#sermon-assets",
    };
  }

  return {
    eyebrow: "Publishing",
    title: "Choose one sermon, then one post.",
    description: "Work through one message at a time so approval, church context, and publishing intent stay clear.",
    actionLabel: "Choose a sermon",
    actionHref: "#sermon-library",
  };
}
