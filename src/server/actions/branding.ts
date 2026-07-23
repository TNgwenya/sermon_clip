"use server";

import { revalidatePath } from "next/cache";

import {
  brandingSettingsSchema,
  getBrandingSettings,
  saveBrandingSettings,
} from "@/server/branding/settings";
import { getLogoUpload, saveLogoUpload } from "@/server/branding/logoUpload";
import {
  invalidateAfterBrandingChange,
  shouldInvalidateOverlayForBrandingChange,
} from "@/server/regeneration/dependencies";

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

export async function saveBrandingSettingsAction(
  _prevState: BrandingSettingsActionState,
  formData: FormData,
): Promise<BrandingSettingsActionState> {
  const logoUpload = getLogoUpload(formData);
  const shouldRemoveLogo = formData.get("removeLogo") === "1";
  let churchLogoPath = shouldRemoveLogo ? "" : String(formData.get("churchLogoPath") ?? "").trim();

  if (logoUpload) {
    const savedLogo = await saveLogoUpload(logoUpload);
    if (savedLogo.error) {
      return {
        success: false,
        message: "Please correct the highlighted branding fields.",
        fieldErrors: {
          churchLogoFile: savedLogo.error,
        },
      };
    }

    churchLogoPath = savedLogo.path ?? churchLogoPath;
  }

  const values = {
    churchName: String(formData.get("churchName") ?? "").trim(),
    churchLogoPath,
    primaryBrandColor: String(formData.get("primaryBrandColor") ?? "").trim(),
    secondaryBrandColor: String(formData.get("secondaryBrandColor") ?? "").trim(),
    defaultFontFamily: String(formData.get("defaultFontFamily") ?? "").trim(),
    watermarkPosition: String(formData.get("watermarkPosition") ?? "").trim(),
    defaultCaptionStyleName: String(formData.get("defaultCaptionStyleName") ?? "").trim(),
  };

  const parsed = brandingSettingsSchema.safeParse(values);

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Please correct the highlighted branding fields.",
      fieldErrors: {
        churchName: fieldErrors.churchName?.[0],
        churchLogoPath: fieldErrors.churchLogoPath?.[0],
        primaryBrandColor: fieldErrors.primaryBrandColor?.[0],
        secondaryBrandColor: fieldErrors.secondaryBrandColor?.[0],
        defaultFontFamily: fieldErrors.defaultFontFamily?.[0],
        watermarkPosition: fieldErrors.watermarkPosition?.[0],
        defaultCaptionStyleName: fieldErrors.defaultCaptionStyleName?.[0],
      },
    };
  }

  try {
    const previous = await getBrandingSettings();
    await saveBrandingSettings(parsed.data);

    const brandingChanged = shouldInvalidateOverlayForBrandingChange(
      {
        churchName: previous.churchName,
        churchLogoPath: previous.churchLogoPath,
        primaryBrandColor: previous.primaryBrandColor,
        secondaryBrandColor: previous.secondaryBrandColor,
        defaultFontFamily: previous.defaultFontFamily,
        defaultCaptionStyleName: previous.defaultCaptionStyleName,
        watermarkPosition: previous.watermarkPosition,
      },
      {
        churchName: parsed.data.churchName,
        churchLogoPath: parsed.data.churchLogoPath,
        primaryBrandColor: parsed.data.primaryBrandColor,
        secondaryBrandColor: parsed.data.secondaryBrandColor,
        defaultFontFamily: parsed.data.defaultFontFamily,
        defaultCaptionStyleName: parsed.data.defaultCaptionStyleName,
        watermarkPosition: parsed.data.watermarkPosition,
      },
    );

    let invalidatedCount = 0;
    if (brandingChanged) {
      invalidatedCount = await invalidateAfterBrandingChange(
        "Branding settings changed. Prepared visual assets marked outdated.",
        {
          captionStyleChanged:
            previous.defaultCaptionStyleName !== parsed.data.defaultCaptionStyleName,
        },
      );
    }

    revalidatePath("/");
    revalidatePath("/settings/branding");
    revalidatePath("/sermons/[id]", "page");

    return {
      success: true,
      savedChurchLogoPath: parsed.data.churchLogoPath,
      message: brandingChanged
        ? `Branding settings saved. ${invalidatedCount} clip visual asset(s) marked outdated.`
        : "Branding settings saved. No overlay invalidation required.",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save branding settings.";
    return {
      success: false,
      message,
    };
  }
}
