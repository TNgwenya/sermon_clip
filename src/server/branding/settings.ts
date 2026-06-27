import type { BrandingSettings, WatermarkPosition } from "@prisma/client";
import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { CAPTION_STYLE_PRESETS } from "@/lib/captionStylePresets";

export const LOCAL_BRANDING_SETTINGS_ID = "local";

export const watermarkPositions = [
  "TOP_LEFT",
  "TOP_RIGHT",
  "BOTTOM_LEFT",
  "BOTTOM_RIGHT",
  "CENTER",
] as const;

const colorValuePattern = /^#(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

export const brandingSettingsSchema = z.object({
  churchName: z.string().trim().min(1, "Church name is required."),
  churchLogoPath: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value && value.length > 0 ? value : null)),
  primaryBrandColor: z
    .string()
    .trim()
    .regex(colorValuePattern, "Primary brand color must be a valid hex value like #0F766E."),
  secondaryBrandColor: z
    .string()
    .trim()
    .regex(colorValuePattern, "Secondary brand color must be a valid hex value like #1D4ED8."),
  defaultFontFamily: z.string().trim().min(1, "Default font family is required."),
  watermarkPosition: z.enum(watermarkPositions),
  defaultCaptionStyleName: z
    .string()
    .trim()
    .min(1, "Default caption style name is required.")
    .refine((value) => CAPTION_STYLE_PRESETS.some((preset) => preset.id === value), {
      message: "Choose one of the available caption styles.",
    }),
});

export const brandingSettingsPatchSchema = brandingSettingsSchema.partial();

export type BrandingSettingsInput = z.input<typeof brandingSettingsSchema>;
export type BrandingSettingsParsed = z.output<typeof brandingSettingsSchema>;
export type BrandingSettingsPatchInput = z.input<typeof brandingSettingsPatchSchema>;
export type BrandingSettingsRecord = BrandingSettings;

export const defaultBrandingSettings: BrandingSettingsInput = {
  churchName: "Local Church",
  churchLogoPath: "",
  primaryBrandColor: "#0F766E",
  secondaryBrandColor: "#1D4ED8",
  defaultFontFamily: "Avenir Next",
  watermarkPosition: "BOTTOM_RIGHT",
  defaultCaptionStyleName: "clean-lower",
};

type BrandingRepository = {
  findById(id: string): Promise<BrandingSettingsRecord | null>;
  create(data: Omit<BrandingSettingsRecord, "createdAt" | "updatedAt">): Promise<BrandingSettingsRecord>;
  update(id: string, data: Partial<Omit<BrandingSettingsRecord, "id" | "createdAt" | "updatedAt">>): Promise<BrandingSettingsRecord>;
};

function toPersistedData(input: BrandingSettingsInput | BrandingSettingsParsed): Omit<BrandingSettingsRecord, "id" | "createdAt" | "updatedAt"> {
  const parsed = brandingSettingsSchema.parse(input);

  return {
    churchName: parsed.churchName,
    churchLogoPath: parsed.churchLogoPath,
    primaryBrandColor: parsed.primaryBrandColor,
    secondaryBrandColor: parsed.secondaryBrandColor,
    defaultFontFamily: parsed.defaultFontFamily,
    watermarkPosition: parsed.watermarkPosition,
    defaultCaptionStyleName: parsed.defaultCaptionStyleName,
  };
}

export function createBrandingSettingsService(repository: BrandingRepository) {
  async function getOrCreate(): Promise<BrandingSettingsRecord> {
    const existing = await repository.findById(LOCAL_BRANDING_SETTINGS_ID);
    if (existing) {
      return existing;
    }

    const defaults = toPersistedData(defaultBrandingSettings);
    return repository.create({
      id: LOCAL_BRANDING_SETTINGS_ID,
      ...defaults,
    });
  }

  async function save(input: BrandingSettingsInput | BrandingSettingsParsed): Promise<BrandingSettingsRecord> {
    const parsed = toPersistedData(input);
    const existing = await repository.findById(LOCAL_BRANDING_SETTINGS_ID);

    if (!existing) {
      return repository.create({
        id: LOCAL_BRANDING_SETTINGS_ID,
        ...parsed,
      });
    }

    return repository.update(LOCAL_BRANDING_SETTINGS_ID, parsed);
  }

  async function update(input: BrandingSettingsPatchInput): Promise<BrandingSettingsRecord> {
    const existing = await getOrCreate();
    const patch = brandingSettingsPatchSchema.parse(input);

    return save({
      churchName: patch.churchName ?? existing.churchName,
      churchLogoPath: patch.churchLogoPath ?? existing.churchLogoPath ?? "",
      primaryBrandColor: patch.primaryBrandColor ?? existing.primaryBrandColor,
      secondaryBrandColor: patch.secondaryBrandColor ?? existing.secondaryBrandColor,
      defaultFontFamily: patch.defaultFontFamily ?? existing.defaultFontFamily,
      watermarkPosition: patch.watermarkPosition ?? existing.watermarkPosition,
      defaultCaptionStyleName: patch.defaultCaptionStyleName ?? existing.defaultCaptionStyleName,
    });
  }

  function toBrandingHelperPayload(settings: BrandingSettingsRecord): {
    church: {
      name: string;
      logoPath: string | null;
    };
    colors: {
      primary: string;
      secondary: string;
    };
    typography: {
      defaultFontFamily: string;
      defaultCaptionStyleName: string;
    };
    watermark: {
      position: WatermarkPosition;
    };
  } {
    return {
      church: {
        name: settings.churchName,
        logoPath: settings.churchLogoPath,
      },
      colors: {
        primary: settings.primaryBrandColor,
        secondary: settings.secondaryBrandColor,
      },
      typography: {
        defaultFontFamily: settings.defaultFontFamily,
        defaultCaptionStyleName: settings.defaultCaptionStyleName,
      },
      watermark: {
        position: settings.watermarkPosition,
      },
    };
  }

  return {
    getOrCreate,
    save,
    update,
    toBrandingHelperPayload,
  };
}

const prismaRepository: BrandingRepository = {
  findById(id) {
    return prisma.brandingSettings.findUnique({
      where: { id },
    });
  },
  create(data) {
    return prisma.brandingSettings.create({
      data,
    });
  },
  update(id, data) {
    return prisma.brandingSettings.update({
      where: { id },
      data,
    });
  },
};

const brandingSettingsService = createBrandingSettingsService(prismaRepository);

export async function getBrandingSettings(): Promise<BrandingSettingsRecord> {
  return brandingSettingsService.getOrCreate();
}

export async function saveBrandingSettings(input: BrandingSettingsInput | BrandingSettingsParsed): Promise<BrandingSettingsRecord> {
  return brandingSettingsService.save(input);
}

export async function updateBrandingSettings(input: BrandingSettingsPatchInput): Promise<BrandingSettingsRecord> {
  return brandingSettingsService.update(input);
}

export function getBrandingHelperPayload(settings: BrandingSettingsRecord) {
  return brandingSettingsService.toBrandingHelperPayload(settings);
}

export const __brandingTestUtils = {
  createBrandingSettingsService,
  defaultBrandingSettings,
  brandingSettingsSchema,
};
