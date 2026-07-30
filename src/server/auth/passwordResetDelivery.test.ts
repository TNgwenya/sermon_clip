import { afterEach, describe, expect, it, vi } from "vitest";

import { deliverPasswordReset } from "@/server/auth/passwordResetDelivery";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("password reset delivery", () => {
  it("requires a configured HTTPS delivery endpoint", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_TRANSACTIONAL_WEBHOOK_URL", "http://mailer.example.test/reset");
    vi.stubEnv("AUTH_TRANSACTIONAL_WEBHOOK_SECRET", "a-secret-with-at-least-24-characters");

    await expect(deliverPasswordReset({
      delivery: {
        email: "pastor@example.com",
        token: `scpwr_${"a".repeat(48)}`,
        expiresAt: new Date("2026-07-29T10:30:00.000Z"),
      },
      resetUrl: "https://sermonclip.example/reset-password?token=redacted",
    })).rejects.toThrow("must use HTTPS");
  });

  it("sends the reset URL only to the configured transactional webhook", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("AUTH_TRANSACTIONAL_WEBHOOK_URL", "https://mailer.example.test/reset");
    vi.stubEnv("AUTH_TRANSACTIONAL_WEBHOOK_SECRET", "a-secret-with-at-least-24-characters");
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 202 }));
    vi.stubGlobal("fetch", fetchMock);

    await deliverPasswordReset({
      delivery: {
        email: "pastor@example.com",
        token: `scpwr_${"a".repeat(48)}`,
        expiresAt: new Date("2026-07-29T10:30:00.000Z"),
      },
      resetUrl: "https://sermonclip.example/reset-password?token=secret",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://mailer.example.test/reset"),
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer a-secret-with-at-least-24-characters",
        }),
      }),
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toMatchObject({
      type: "password_reset",
      recipient: "pastor@example.com",
      resetUrl: "https://sermonclip.example/reset-password?token=secret",
    });
  });
});
