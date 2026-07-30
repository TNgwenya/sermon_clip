import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import {
  getBrandingSettings,
  saveBrandingSettings,
} from "@/server/branding/settings";
import {
  organizationResourceScope,
  organizationScope,
} from "@/server/tenancy/scope";

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const firstOrganizationId = `isolation-org-a-${suffix}`;
const secondOrganizationId = `isolation-org-b-${suffix}`;
const firstSermonId = `isolation-sermon-a-${suffix}`;
const secondSermonId = `isolation-sermon-b-${suffix}`;

async function createSermon(id: string, organizationId: string, title: string) {
  return prisma.sermon.create({
    data: {
      id,
      organizationId,
      youtubeUrl: `https://example.test/${id}`,
      title,
      speakerName: "Isolation Test Pastor",
      churchName: title,
      language: "English",
      rightsConfirmed: true,
    },
  });
}

afterAll(async () => {
  await prisma.sermon.deleteMany({
    where: {
      id: { in: [firstSermonId, secondSermonId] },
    },
  });
  await prisma.organization.deleteMany({
    where: {
      id: { in: [firstOrganizationId, secondOrganizationId] },
    },
  });
});
describe("tenant isolation integration", () => {
  it("cannot enumerate or load another organization's sermons or Brand Kit", async () => {
    await prisma.organization.createMany({
      data: [
        {
          id: firstOrganizationId,
          slug: `isolation-a-${suffix}`,
          name: "Isolation Church A",
        },
        {
          id: secondOrganizationId,
          slug: `isolation-b-${suffix}`,
          name: "Isolation Church B",
        },
      ],
    });
    await Promise.all([
      createSermon(firstSermonId, firstOrganizationId, "Isolation Church A"),
      createSermon(secondSermonId, secondOrganizationId, "Isolation Church B"),
      saveBrandingSettings({
        churchName: "Isolation Church A",
        churchLogoPath: "",
        primaryBrandColor: "#112233",
        secondaryBrandColor: "#445566",
        defaultFontFamily: "Inter",
        watermarkPosition: "TOP_LEFT",
        defaultCaptionStyleName: "clean-lower",
      }, firstOrganizationId),
      saveBrandingSettings({
        churchName: "Isolation Church B",
        churchLogoPath: "",
        primaryBrandColor: "#778899",
        secondaryBrandColor: "#aabbcc",
        defaultFontFamily: "Montserrat",
        watermarkPosition: "BOTTOM_RIGHT",
        defaultCaptionStyleName: "minimal-church",
      }, secondOrganizationId),
    ]);

    const firstContext = { organizationId: firstOrganizationId };
    const firstVisibleSermons = await prisma.sermon.findMany({
      where: organizationScope(firstContext),
      select: { id: true },
    });
    const crossOrganizationRead = await prisma.sermon.findFirst({
      where: organizationResourceScope(firstContext, secondSermonId),
      select: { id: true },
    });
    const [firstBrand, secondBrand] = await Promise.all([
      getBrandingSettings(firstOrganizationId),
      getBrandingSettings(secondOrganizationId),
    ]);

    expect(firstVisibleSermons).toEqual([{ id: firstSermonId }]);
    expect(crossOrganizationRead).toBeNull();
    expect(firstBrand).toMatchObject({
      organizationId: firstOrganizationId,
      churchName: "Isolation Church A",
    });
    expect(secondBrand).toMatchObject({
      organizationId: secondOrganizationId,
      churchName: "Isolation Church B",
    });
  });
});
