export type CaptionStylePresetId =
  | "bold-sermon"
  | "clean-lower"
  | "high-contrast"
  | "youth-social"
  | "minimal-church"
  | "scripture-focus"
  | "cinematic-testimony";

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
};

export const CAPTION_STYLE_PRESETS: CaptionStylePreset[] = [
  {
    id: "bold-sermon",
    name: "Bold sermon captions",
    description: "Large centered captions for teaching and encouragement clips.",
    personality: "Punchy declaration",
    motion: "Word-by-word pop",
    bestFor: "Reels, Shorts, TikTok",
    sampleText: "God is not finished with you.",
    emphasisWords: ["God", "finished"],
    className: "caption-style-bold-sermon",
  },
  {
    id: "clean-lower",
    name: "Clean lower captions",
    description: "A calm lower-third caption style for church announcements and teaching.",
    personality: "Clear and pastoral",
    motion: "Gentle slide up",
    bestFor: "Facebook, sermon recaps",
    sampleText: "Grace meets you in the middle.",
    emphasisWords: ["Grace"],
    className: "caption-style-clean-lower",
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
  },
  {
    id: "minimal-church",
    name: "Minimal church captions",
    description: "Simple captions that keep the sermon video understated.",
    personality: "Quiet reverence",
    motion: "Soft fade",
    bestFor: "Worship, prayer, devotionals",
    sampleText: "Be still and trust Him.",
    emphasisWords: ["trust"],
    className: "caption-style-minimal-church",
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
  },
];

export function resolveCaptionStylePreset(id: string | null | undefined): CaptionStylePreset {
  return CAPTION_STYLE_PRESETS.find((preset) => preset.id === id) ?? CAPTION_STYLE_PRESETS[0];
}
