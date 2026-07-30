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
      async findByOrganizationId(organizationId: string) {
        if (!stored || stored.organizationId !== organizationId) {
          return null;
        }

        return stored;
      },
      async create(data: Omit<BrandingSettingsRecord, "createdAt" | "updatedAt" | "id"> & { id?: string }) {
        const now = new Date();
        stored = {
          ...data,
          id: data.id ?? "generated-branding-id",
          createdAt: now,
          updatedAt: now,
        };

        return stored;
      },
      async updateByOrganizationId(
        organizationId: string,
        data: Partial<Omit<BrandingSettingsRecord, "id" | "organizationId" | "createdAt" | "updatedAt">>,
      ) {
        if (!stored || stored.organizationId !== organizationId) {
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
    expect(record.organizationId).toBe("org_local_default");
    expect(record.churchName).toBe(__brandingTestUtils.defaultBrandingSettings.churchName);
    expect(record.primaryBrandColor).toBe(__brandingTestUtils.defaultBrandingSettings.primaryBrandColor);
  });

  it("keeps each organization's Brand Kit isolated", async () => {
    const firstStore = createInMemoryRepository();
    const secondStore = createInMemoryRepository();
    const first = __brandingTestUtils.createBrandingSettingsService(
      firstStore.repository,
      { organizationId: "org_one", campusId: "campus_one" },
    );
    const second = __brandingTestUtils.createBrandingSettingsService(
      secondStore.repository,
      { organizationId: "org_two", campusId: "campus_two" },
    );

    await first.save({
      churchName: "First Church",
      churchLogoPath: "",
      primaryBrandColor: "#112233",
      secondaryBrandColor: "#abcdef",
      defaultFontFamily: "Montserrat",
      watermarkPosition: "TOP_RIGHT",
      defaultCaptionStyleName: "bold-sermon",
    });
    await second.save({
      churchName: "Second Church",
      churchLogoPath: "",
      primaryBrandColor: "#445566",
      secondaryBrandColor: "#fedcba",
      defaultFontFamily: "Inter",
      watermarkPosition: "BOTTOM_LEFT",
      defaultCaptionStyleName: "minimal-church",
    });

    expect((await first.getOrCreate()).churchName).toBe("First Church");
    expect((await second.getOrCreate()).churchName).toBe("Second Church");
    expect(firstStore.getCurrent()?.organizationId).toBe("org_one");
    expect(secondStore.getCurrent()?.organizationId).toBe("org_two");
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

  it("can save already-parsed settings when the optional logo is absent", async () => {
    const store = createInMemoryRepository();
    const service = __brandingTestUtils.createBrandingSettingsService(store.repository);
    const parsed = __brandingTestUtils.brandingSettingsSchema.parse({
      churchName: "Grace City Church",
      churchLogoPath: "",
      primaryBrandColor: "#112233",
      secondaryBrandColor: "#abcdef",
      defaultFontFamily: "Montserrat",
      watermarkPosition: "TOP_RIGHT",
      defaultCaptionStyleName: "bold-sermon",
    });

    const saved = await service.save(parsed);

    expect(saved.churchLogoPath).toBeNull();
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
