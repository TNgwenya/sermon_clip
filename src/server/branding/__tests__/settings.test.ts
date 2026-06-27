import { describe, expect, it } from "vitest";

import {
  __brandingTestUtils,
  LOCAL_BRANDING_SETTINGS_ID,
  type BrandingSettingsRecord,
} from "../settings";

function createInMemoryRepository() {
  let stored: BrandingSettingsRecord | null = null;

  return {
    repository: {
      async findById(id: string) {
        if (!stored || stored.id !== id) {
          return null;
        }

        return stored;
      },
      async create(data: Omit<BrandingSettingsRecord, "createdAt" | "updatedAt">) {
        const now = new Date();
        stored = {
          ...data,
          createdAt: now,
          updatedAt: now,
        };

        return stored;
      },
      async update(id: string, data: Partial<Omit<BrandingSettingsRecord, "id" | "createdAt" | "updatedAt">>) {
        if (!stored || stored.id !== id) {
          throw new Error("Branding settings missing.");
        }

        stored = {
          ...stored,
          ...data,
          updatedAt: new Date(),
        };

        return stored;
      },
    },
    getCurrent() {
      return stored;
    },
  };
}

describe("branding settings service", () => {
  it("creates default branding when none exists", async () => {
    const store = createInMemoryRepository();
    const service = __brandingTestUtils.createBrandingSettingsService(store.repository);

    const record = await service.getOrCreate();

    expect(record.id).toBe(LOCAL_BRANDING_SETTINGS_ID);
    expect(record.churchName).toBe(__brandingTestUtils.defaultBrandingSettings.churchName);
    expect(record.primaryBrandColor).toBe(__brandingTestUtils.defaultBrandingSettings.primaryBrandColor);
  });

  it("saves branding settings", async () => {
    const store = createInMemoryRepository();
    const service = __brandingTestUtils.createBrandingSettingsService(store.repository);

    const saved = await service.save({
      churchName: "Grace City Church",
      churchLogoPath: "/tmp/logo.png",
      primaryBrandColor: "#112233",
      secondaryBrandColor: "#abcdef",
      defaultFontFamily: "Montserrat",
      watermarkPosition: "TOP_RIGHT",
      defaultCaptionStyleName: "bold-sermon",
    });

    expect(saved.churchName).toBe("Grace City Church");
    expect(saved.churchLogoPath).toBe("/tmp/logo.png");
    expect(saved.watermarkPosition).toBe("TOP_RIGHT");
    expect(store.getCurrent()?.churchName).toBe("Grace City Church");
  });

  it("updates branding settings", async () => {
    const store = createInMemoryRepository();
    const service = __brandingTestUtils.createBrandingSettingsService(store.repository);

    await service.save({
      churchName: "Grace City Church",
      churchLogoPath: "",
      primaryBrandColor: "#112233",
      secondaryBrandColor: "#abcdef",
      defaultFontFamily: "Montserrat",
      watermarkPosition: "TOP_RIGHT",
      defaultCaptionStyleName: "bold-sermon",
    });

    const updated = await service.update({
      secondaryBrandColor: "#123456",
      defaultCaptionStyleName: "minimal-church",
    });

    expect(updated.secondaryBrandColor).toBe("#123456");
    expect(updated.defaultCaptionStyleName).toBe("minimal-church");
    expect(updated.churchName).toBe("Grace City Church");
  });

  it("rejects invalid values", () => {
    const parsed = __brandingTestUtils.brandingSettingsSchema.safeParse({
      churchName: "",
      churchLogoPath: "",
      primaryBrandColor: "teal",
      secondaryBrandColor: "#12",
      defaultFontFamily: "",
      watermarkPosition: "UPPER_LEFT",
      defaultCaptionStyleName: "",
    });

    expect(parsed.success).toBe(false);
  });
});
