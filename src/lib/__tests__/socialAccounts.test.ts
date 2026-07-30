import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createSocialAccount, listSocialAccounts, normalizeSocialPlatform } from "@/lib/socialAccounts";
import { DEFAULT_CAMPUS_ID, DEFAULT_ORGANIZATION_ID } from "@/lib/tenancy/requestHeaders";

let createdAccountIds: string[] = [];

describe("social accounts", () => {
  beforeEach(() => {
    createdAccountIds = [];
  });

  afterEach(async () => {
    if (createdAccountIds.length > 0) {
      await prisma.socialAccount.deleteMany({
        where: { id: { in: createdAccountIds } },
      });
    }
  });

  it("normalizes supported social platforms", () => {
    expect(normalizeSocialPlatform("Instagram")).toBe("Instagram");
    expect(normalizeSocialPlatform("LinkedIn")).toBeNull();
  });

  it("records local church social account placeholders", async () => {
    const uniqueLabel = `Renewed Life Church Page ${Date.now()}`;
    const account = await createSocialAccount({
      tenantScope: {
        organizationId: DEFAULT_ORGANIZATION_ID,
        campusId: DEFAULT_CAMPUS_ID,
      },
      platform: "Facebook",
      label: uniqueLabel,
      handle: "@renewedlife",
    });
    createdAccountIds.push(account.id);

    const accounts = await listSocialAccounts({
      organizationId: DEFAULT_ORGANIZATION_ID,
      campusId: DEFAULT_CAMPUS_ID,
    });
    const savedAccount = accounts.find((item) => item.id === account.id);

    expect(savedAccount).toMatchObject({
      id: account.id,
      platform: "Facebook",
      label: uniqueLabel,
      handle: "@renewedlife",
      status: "CONNECTED",
    });
  });
});
