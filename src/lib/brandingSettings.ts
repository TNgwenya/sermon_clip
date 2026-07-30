export const watermarkPositions = [
  "TOP_LEFT",
  "TOP_RIGHT",
  "BOTTOM_LEFT",
  "BOTTOM_RIGHT",
  "CENTER",
] as const;

export type WatermarkPositionValue = (typeof watermarkPositions)[number];

export type BrandingSettingsValues = {
  churchName: string;
  churchLogoPath: string | null;
  primaryBrandColor: string;
  secondaryBrandColor: string;
  defaultFontFamily: string;
  watermarkPosition: WatermarkPositionValue;
  defaultCaptionStyleName: string;
};

export type BrandingSettingsActionState = {
  success: boolean;
  message: string;
  savedChurchLogoPath?: string | null;
  fieldErrors?: {
    churchName?: string;
    churchLogoPath?: string;
    churchLogoFile?: string;
    primaryBrandColor?: string;
    secondaryBrandColor?: string;
    defaultFontFamily?: string;
    watermarkPosition?: string;
    defaultCaptionStyleName?: string;
  };
};
