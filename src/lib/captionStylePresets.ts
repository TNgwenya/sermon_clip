export type CaptionStylePresetId =
  | "bold-sermon"
  | "kinetic-pop"
  | "creator-highlight"
  | "soft-bubble"
  | "clean-lower"
  | "high-contrast"
  | "youth-social"
  | "minimal-church"
  | "scripture-focus"
  | "cinematic-testimony"
  | "golden-hour"
  | "royal-focus"
  | "editorial-serif"
  | "clean-outline";

export type CaptionVisualStyle = {
  fontFamily: "sans" | "serif";
  fontWeight: 700 | 800 | 900;
  textColor: `#${string}`;
  activeTextColor: `#${string}`;
  backgroundColor: `#${string}`;
  backgroundOpacity: number;
  borderColor: `#${string}`;
  borderOpacity: number;
  borderWidth: number;
  borderRadius: number;
  textStrokeColor: `#${string}`;
  textStrokeWidth: number;
  uppercase: boolean;
};

export type CaptionStylePreset = {
  id: CaptionStylePresetId;
  name: string;
  description: string;
  personality: string;
  motion: string;
  bestFor: string;
  sampleText: string;
  emphasisWords: string[];
  className: string;
  visual: CaptionVisualStyle;
};

export const DEFAULT_CAPTION_STYLE_PRESET_ID: CaptionStylePresetId = "clean-lower";

export const CAPTION_STYLE_PRESETS: CaptionStylePreset[] = [
  {
    id: "bold-sermon",
    name: "Sermon Emphasis",
    description: "Strong social captions with a warm highlight for the most important words.",
    personality: "Confident and premium",
    motion: "Word pop",
    bestFor: "Reels, Shorts, TikTok",
    sampleText: "God is not finished with you.",
    emphasisWords: ["God", "finished"],
    className: "caption-style-bold-sermon",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FFFFFF", activeTextColor: "#FACC15",
      backgroundColor: "#030712", backgroundOpacity: 0.82, borderColor: "#FACC15", borderOpacity: 0.34,
      borderWidth: 2, borderRadius: 24, textStrokeColor: "#000000", textStrokeWidth: 5, uppercase: true,
    },
  },
  {
    id: "kinetic-pop",
    name: "Kinetic pop",
    description: "Big creator-style captions with a thick outline and animated word focus.",
    personality: "Fast and punchy",
    motion: "Active word punch",
    bestFor: "Hooks, punchlines, youth clips",
    sampleText: "This is your reminder.",
    emphasisWords: ["reminder"],
    className: "caption-style-kinetic-pop",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FFFFFF", activeTextColor: "#FACC15",
      backgroundColor: "#020617", backgroundOpacity: 0.28, borderColor: "#FFFFFF", borderOpacity: 0,
      borderWidth: 0, borderRadius: 18, textStrokeColor: "#020617", textStrokeWidth: 8, uppercase: true,
    },
  },
  {
    id: "creator-highlight",
    name: "Bold Highlight",
    description: "Glass-style social captions with a crisp highlight for the active phrase.",
    personality: "Beautiful and modern",
    motion: "Highlight glow",
    bestFor: "Teaching clips, Opus-style moments",
    sampleText: "Grace changes everything.",
    emphasisWords: ["Grace"],
    className: "caption-style-creator-highlight",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FFFFFF", activeTextColor: "#67E8F9",
      backgroundColor: "#020617", backgroundOpacity: 0.76, borderColor: "#7DD3FC", borderOpacity: 0.4,
      borderWidth: 2, borderRadius: 26, textStrokeColor: "#020617", textStrokeWidth: 5, uppercase: false,
    },
  },
  {
    id: "soft-bubble",
    name: "Soft bubble",
    description: "Rounded caption bubble with friendly contrast for warm ministry moments.",
    personality: "Warm and readable",
    motion: "Soft lift",
    bestFor: "Encouragement, testimony, pastoral care",
    sampleText: "You are not alone today.",
    emphasisWords: ["alone"],
    className: "caption-style-soft-bubble",
    visual: {
      fontFamily: "sans", fontWeight: 800, textColor: "#111827", activeTextColor: "#4D7C0F",
      backgroundColor: "#FFFFFF", backgroundOpacity: 0.92, borderColor: "#FFFFFF", borderOpacity: 0.78,
      borderWidth: 2, borderRadius: 56, textStrokeColor: "#FFFFFF", textStrokeWidth: 0, uppercase: false,
    },
  },
  {
    id: "clean-lower",
    name: "Clean Lower",
    description: "A refined lower-third with soft contrast, brand color, and readable weight.",
    personality: "Elegant and pastoral",
    motion: "Smooth rise",
    bestFor: "Facebook, sermon recaps",
    sampleText: "Grace meets you in the middle.",
    emphasisWords: ["Grace"],
    className: "caption-style-clean-lower",
    visual: {
      fontFamily: "sans", fontWeight: 800, textColor: "#0F172A", activeTextColor: "#0F766E",
      backgroundColor: "#FFFFFF", backgroundOpacity: 0.94, borderColor: "#0F766E", borderOpacity: 0.46,
      borderWidth: 2, borderRadius: 20, textStrokeColor: "#FFFFFF", textStrokeWidth: 0, uppercase: false,
    },
  },
  {
    id: "high-contrast",
    name: "High contrast captions",
    description: "Maximum readability for bright stages and mobile viewing.",
    personality: "Readable anywhere",
    motion: "Steady cut-in",
    bestFor: "Bright stages, older audiences",
    sampleText: "Hold on to the promise.",
    emphasisWords: ["promise"],
    className: "caption-style-high-contrast",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FACC15", activeTextColor: "#FFFFFF",
      backgroundColor: "#000000", backgroundOpacity: 0.94, borderColor: "#FFFFFF", borderOpacity: 1,
      borderWidth: 3, borderRadius: 12, textStrokeColor: "#000000", textStrokeWidth: 4, uppercase: false,
    },
  },
  {
    id: "youth-social",
    name: "Youth/social captions",
    description: "Energetic captions for short-form social platforms.",
    personality: "Fast and energetic",
    motion: "Bounce emphasis",
    bestFor: "Youth clips, announcements",
    sampleText: "Faith moves before fear does.",
    emphasisWords: ["Faith", "fear"],
    className: "caption-style-youth-social",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FFFFFF", activeTextColor: "#FDE047",
      backgroundColor: "#1D4ED8", backgroundOpacity: 0.94, borderColor: "#93C5FD", borderOpacity: 0.9,
      borderWidth: 3, borderRadius: 20, textStrokeColor: "#172554", textStrokeWidth: 4, uppercase: true,
    },
  },
  {
    id: "minimal-church",
    name: "Minimal White",
    description: "Simple captions that keep the sermon video understated.",
    personality: "Quiet reverence",
    motion: "Soft fade",
    bestFor: "Worship, prayer, devotionals",
    sampleText: "Be still and trust Him.",
    emphasisWords: ["trust"],
    className: "caption-style-minimal-church",
    visual: {
      fontFamily: "sans", fontWeight: 700, textColor: "#111827", activeTextColor: "#0F766E",
      backgroundColor: "#FFFFFF", backgroundOpacity: 0.86, borderColor: "#FFFFFF", borderOpacity: 0,
      borderWidth: 0, borderRadius: 14, textStrokeColor: "#FFFFFF", textStrokeWidth: 0, uppercase: false,
    },
  },
  {
    id: "scripture-focus",
    name: "Scripture focus",
    description: "Refined captions with a verse-card feel for biblical teaching moments.",
    personality: "Elegant teaching",
    motion: "Line reveal",
    bestFor: "Bible teaching, quote clips",
    sampleText: "The word of God stands forever.",
    emphasisWords: ["word", "God"],
    className: "caption-style-scripture-focus",
    visual: {
      fontFamily: "serif", fontWeight: 800, textColor: "#111827", activeTextColor: "#A16207",
      backgroundColor: "#FFFFFF", backgroundOpacity: 0.94, borderColor: "#FACC15", borderOpacity: 0.76,
      borderWidth: 2, borderRadius: 16, textStrokeColor: "#FFFFFF", textStrokeWidth: 0, uppercase: false,
    },
  },
  {
    id: "cinematic-testimony",
    name: "Cinematic testimony",
    description: "Warm documentary captions for emotional stories and altar-call moments.",
    personality: "Human and intimate",
    motion: "Slow dissolve",
    bestFor: "Testimonies, salvation moments",
    sampleText: "I was lost, but Jesus found me.",
    emphasisWords: ["Jesus", "found"],
    className: "caption-style-cinematic-testimony",
    visual: {
      fontFamily: "sans", fontWeight: 800, textColor: "#F8FAFC", activeTextColor: "#FDE68A",
      backgroundColor: "#030712", backgroundOpacity: 0.88, borderColor: "#E2E8F0", borderOpacity: 0.24,
      borderWidth: 2, borderRadius: 20, textStrokeColor: "#000000", textStrokeWidth: 4, uppercase: false,
    },
  },
  {
    id: "golden-hour",
    name: "Golden hour",
    description: "Warm, luminous captions that feel hopeful without overpowering the message.",
    personality: "Warm and uplifting",
    motion: "Golden word glow",
    bestFor: "Hope, invitation, encouragement",
    sampleText: "There is still hope for tomorrow.",
    emphasisWords: ["hope", "tomorrow"],
    className: "caption-style-golden-hour",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FFFBEB", activeTextColor: "#FCD34D",
      backgroundColor: "#1C1408", backgroundOpacity: 0.86, borderColor: "#F59E0B", borderOpacity: 0.56,
      borderWidth: 2, borderRadius: 28, textStrokeColor: "#120C03", textStrokeWidth: 5, uppercase: false,
    },
  },
  {
    id: "royal-focus",
    name: "Royal focus",
    description: "A rich violet treatment with a polished active-word accent.",
    personality: "Bold and refined",
    motion: "Royal word focus",
    bestFor: "Leadership, identity, declarations",
    sampleText: "You were called for this moment.",
    emphasisWords: ["called", "moment"],
    className: "caption-style-royal-focus",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#F5F3FF", activeTextColor: "#C4B5FD",
      backgroundColor: "#1E1338", backgroundOpacity: 0.88, borderColor: "#A78BFA", borderOpacity: 0.58,
      borderWidth: 2, borderRadius: 24, textStrokeColor: "#0F0820", textStrokeWidth: 5, uppercase: false,
    },
  },
  {
    id: "editorial-serif",
    name: "Editorial serif",
    description: "A quiet, premium serif card inspired by devotional print design.",
    personality: "Thoughtful and timeless",
    motion: "Gentle word reveal",
    bestFor: "Devotionals, Scripture, reflection",
    sampleText: "Let truth steady your heart.",
    emphasisWords: ["truth", "heart"],
    className: "caption-style-editorial-serif",
    visual: {
      fontFamily: "serif", fontWeight: 800, textColor: "#241C12", activeTextColor: "#9A6A1F",
      backgroundColor: "#FFF8E7", backgroundOpacity: 0.94, borderColor: "#D6C59F", borderOpacity: 0.88,
      borderWidth: 2, borderRadius: 12, textStrokeColor: "#FFF8E7", textStrokeWidth: 0, uppercase: false,
    },
  },
  {
    id: "clean-outline",
    name: "Clean outline",
    description: "Airy, high-impact words with a subtle glass backing for any stage lighting.",
    personality: "Modern and clear",
    motion: "Cyan word pulse",
    bestFor: "Fast teaching, bright stages",
    sampleText: "Keep moving with purpose.",
    emphasisWords: ["moving", "purpose"],
    className: "caption-style-clean-outline",
    visual: {
      fontFamily: "sans", fontWeight: 900, textColor: "#FFFFFF", activeTextColor: "#67E8F9",
      backgroundColor: "#020617", backgroundOpacity: 0.46, borderColor: "#FFFFFF", borderOpacity: 0.46,
      borderWidth: 2, borderRadius: 18, textStrokeColor: "#020617", textStrokeWidth: 7, uppercase: false,
    },
  },
];

export function isCaptionStylePresetId(value: unknown): value is CaptionStylePresetId {
  return typeof value === "string" && CAPTION_STYLE_PRESETS.some((preset) => preset.id === value);
}

export function resolveCaptionStylePreset(id: string | null | undefined): CaptionStylePreset {
  return (
    CAPTION_STYLE_PRESETS.find((preset) => preset.id === id) ??
    CAPTION_STYLE_PRESETS.find((preset) => preset.id === DEFAULT_CAPTION_STYLE_PRESET_ID) ??
    CAPTION_STYLE_PRESETS[0]
  );
}
