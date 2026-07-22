export const GUIDED_REWRITE_VARIANTS = [
  "SHORTER",
  "WARMER",
  "MORE_PRACTICAL",
  "YOUTH",
  "LEADERSHIP",
] as const;

export type GuidedRewriteVariant = (typeof GUIDED_REWRITE_VARIANTS)[number];

export const GUIDED_REWRITE_VARIANT_LABELS = {
  SHORTER: "Make it shorter",
  WARMER: "Make it warmer",
  MORE_PRACTICAL: "Make it more practical",
  YOUTH: "Adapt for youth",
  LEADERSHIP: "Adapt for leaders",
} as const satisfies Record<GuidedRewriteVariant, string>;
