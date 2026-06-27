import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { prisma } from "@/lib/prisma";
import { createSocialAccount, listSocialAccounts, normalizeSocialPlatform } from "@/lib/socialAccounts";

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
      platform: "Facebook",
      label: uniqueLabel,
      handle: "@renewedlife",
    });
    createdAccountIds.push(account.id);

    const accounts = await listSocialAccounts();
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
