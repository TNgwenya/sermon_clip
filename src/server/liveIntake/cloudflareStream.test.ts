import crypto from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  listReadyCloudflareRecordings,
  prepareCloudflareRecordingMp4,
  verifyLiveWebhook,
} from "./cloudflareStream";

const originalFetch = global.fetch;

function configureProvider() {
  process.env.CLOUDFLARE_ACCOUNT_ID = "account-1";
  process.env.CLOUDFLARE_STREAM_API_TOKEN = "stream-token";
}

afterEach(() => {
  global.fetch = originalFetch;
  delete process.env.CLOUDFLARE_ACCOUNT_ID;
  delete process.env.CLOUDFLARE_STREAM_API_TOKEN;
  delete process.env.LIVE_INTAKE_WEBHOOK_SECRET;
});

describe("Cloudflare live recording discovery", () => {
  it("returns only ready, usable recordings from the authenticated live input", async () => {
    configureProvider();
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: [
        { uid: "recording-ready", duration: 7200, meta: { name: "Sunday service" }, status: { state: "ready" } },
        { uid: "recording-live", duration: 3, status: { state: "live-inprogress" } },
        { uid: "recording-empty", duration: 0, status: { state: "ready" } },
      ],
    }), { status: 200 }));

    await expect(listReadyCloudflareRecordings("live-input-1")).resolves.toEqual([
      { providerRecordingId: "recording-ready", durationSeconds: 7200, title: "Sunday service", createdAt: undefined },
    ]);
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/account-1/stream/live_inputs/live-input-1/videos",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("reports a pending MP4 without exposing its eventual URL", async () => {
    configureProvider();
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { default: { status: "inprogress" } },
    }), { status: 200 }));

    await expect(prepareCloudflareRecordingMp4("recording-1")).resolves.toEqual({ state: "pending" });
  });

  it("returns a server-only URL only when Cloudflare marks the MP4 ready", async () => {
    configureProvider();
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { default: { status: "ready", url: "https://stream.example/download.mp4" } },
    }), { status: 200 }));

    await expect(prepareCloudflareRecordingMp4("recording-1")).resolves.toEqual({
      state: "ready",
      downloadUrl: "https://stream.example/download.mp4",
    });
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/account-1/stream/recording-1/downloads",
      expect.objectContaining({
        method: "POST",
        headers: { Authorization: "Bearer stream-token" },
        cache: "no-store",
      }),
    );
  });

  it("does not invent a download URL when Cloudflare says the MP4 export failed", async () => {
    configureProvider();
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      result: { default: { status: "error" } },
    }), { status: 200 }));

    await expect(prepareCloudflareRecordingMp4("recording-1")).resolves.toEqual({
      state: "failed",
      reason: "Cloudflare could not create an MP4 for this recording.",
    });
  });

  it("fails closed when Cloudflare rejects a recording list request", async () => {
    configureProvider();
    global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: false,
      errors: [{ message: "Input not found" }],
    }), { status: 404 }));

    await expect(listReadyCloudflareRecordings("input with spaces")).rejects.toThrow("Input not found");
    expect(global.fetch).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/account-1/stream/live_inputs/input%20with%20spaces/videos",
      expect.objectContaining({ headers: { Authorization: "Bearer stream-token" } }),
    );
  });

  it("accepts only an exact signed intake body and rejects altered events", () => {
    process.env.LIVE_INTAKE_WEBHOOK_SECRET = "test-secret";
    const body = JSON.stringify({ inputId: "input-1", recordingId: "recording-1" });
    const signature = crypto.createHmac("sha256", "test-secret").update(body).digest("hex");

    expect(verifyLiveWebhook(new Request("https://example.test/live", {
      method: "POST",
      headers: { "x-sermonclip-live-signature": signature },
    }), body)).toBe(true);
    expect(verifyLiveWebhook(new Request("https://example.test/live", {
      method: "POST",
      headers: { "x-sermonclip-live-signature": signature },
    }), `${body} altered`)).toBe(false);
    expect(verifyLiveWebhook(new Request("https://example.test/live", { method: "POST" }), body)).toBe(false);
  });
});
