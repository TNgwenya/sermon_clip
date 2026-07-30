import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRequestCapability: vi.fn(),
  socialAccountFindFirst: vi.fn(),
  settingsFindUnique: vi.fn(),
  settingsUpsert: vi.fn(),
  auditCreate: vi.fn(),
  transaction: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("@/server/auth/requestAuthorization", () => ({
  requireRequestCapability: mocks.requireRequestCapability,
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    socialAccount: { findFirst: mocks.socialAccountFindFirst },
    organizationAutomationSettings: {
      findUnique: mocks.settingsFindUnique,
      upsert: mocks.settingsUpsert,
    },
    auditEvent: { create: mocks.auditCreate },
    $transaction: mocks.transaction,
  },
}));

import { saveYoutubeIntakeSettingsAction } from "./actions";

function settingsForm(overrides: Record<string, string> = {}): FormData {
  const values = {
    youtubeSocialAccountId: "youtube-account-1",
    rightsConfirmed: "on",
    automaticYoutubeImportEnabled: "on",
    defaultSpeakerName: "Pastor Jane",
    defaultLanguage: "en",
    notificationEmail: "media@grace.example",
    postsPerWeek: "5",
    reviewDay: "MONDAY",
    ...overrides,
  };
  const formData = new FormData();
  Object.entries(values).forEach(([key, value]) => {
    if (value) formData.set(key, value);
  });
  return formData;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRequestCapability.mockResolvedValue({
    organizationId: "org-1",
    campusId: null,
    actorId: "user-1",
    authenticationMethod: "session",
  });
  mocks.socialAccountFindFirst.mockResolvedValue({
    id: "youtube-account-1",
    label: "Grace Church",
  });
  mocks.settingsFindUnique.mockResolvedValue(null);
  mocks.settingsUpsert.mockResolvedValue({ id: "settings-1" });
  mocks.auditCreate.mockResolvedValue({ id: "audit-1" });
  mocks.transaction.mockResolvedValue([]);
});

describe("YouTube intake settings action", () => {
  it("fails closed before a database lookup when enablement lacks explicit rights", async () => {
    const result = await saveYoutubeIntakeSettingsAction(
      { success: false, message: "" },
      settingsForm({ rightsConfirmed: "" }),
    );

    expect(result).toMatchObject({
      success: false,
      fieldErrors: {
        rightsConfirmed: expect.stringContaining("Confirm"),
      },
    });
    expect(mocks.socialAccountFindFirst).not.toHaveBeenCalled();
    expect(mocks.settingsUpsert).not.toHaveBeenCalled();
  });

  it("requires the selected account and connected YouTube credential to belong to the tenant", async () => {
    mocks.socialAccountFindFirst.mockResolvedValue(null);

    const result = await saveYoutubeIntakeSettingsAction(
      { success: false, message: "" },
      settingsForm(),
    );

    expect(result.success).toBe(false);
    expect(result.fieldErrors?.youtubeSocialAccountId).toContain("Reconnect YouTube");
    expect(mocks.socialAccountFindFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "youtube-account-1",
        organizationId: "org-1",
        platform: "YOUTUBE_SHORTS",
        status: "CONNECTED",
        credentials: {
          some: {
            provider: "YOUTUBE",
            status: "CONNECTED",
          },
        },
      }),
      select: {
        id: true,
        label: true,
      },
    });
    expect(mocks.settingsUpsert).not.toHaveBeenCalled();
  });

  it("persists every worker prerequisite when automatic intake is enabled", async () => {
    const result = await saveYoutubeIntakeSettingsAction(
      { success: false, message: "" },
      settingsForm(),
    );

    expect(result).toMatchObject({
      success: true,
      message: expect.stringContaining("Wait for the first recorded worker scan"),
    });
    expect(mocks.settingsUpsert).toHaveBeenCalledWith({
      where: { organizationId: "org-1" },
      create: expect.objectContaining({
        organizationId: "org-1",
        youtubeSocialAccountId: "youtube-account-1",
        automaticYoutubeImportEnabled: true,
        youtubeRightsConfirmedAt: expect.any(Date),
        youtubeRightsConfirmedByUserId: "user-1",
        defaultSpeakerName: "Pastor Jane",
        defaultLanguage: "en",
        notificationEmail: "media@grace.example",
        weeklyCadenceJson: {
          postsPerWeek: 5,
          reviewDay: "MONDAY",
        },
      }),
      update: expect.objectContaining({
        youtubeSocialAccountId: "youtube-account-1",
        automaticYoutubeImportEnabled: true,
      }),
    });
  });
});
