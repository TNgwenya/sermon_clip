import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canRunInlineMediaProcessing,
  canRunLocalMediaProcessing,
  isControlPanelRuntime,
  localMediaProcessingUnavailableMessage,
} from "@/server/runtime/workerRuntime";

const originalEnv = { ...process.env };

describe("worker runtime detection", () => {
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("allows media processing in the local app runtime", () => {
    vi.stubEnv("NODE_ENV", "development");
    delete process.env.VERCEL;
    delete process.env.CONTROL_PANEL_MODE;
    delete process.env.WORKER_ENABLED;
    delete process.env.MEDIA_WORKER_RUNTIME;

    expect(isControlPanelRuntime()).toBe(false);
    expect(canRunLocalMediaProcessing()).toBe(true);
    expect(canRunInlineMediaProcessing()).toBe(true);
  });

  it("keeps EC2 storage available but queues heavy work outside the production web process", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.VERCEL;
    delete process.env.CONTROL_PANEL_MODE;
    delete process.env.WORKER_ENABLED;
    delete process.env.MEDIA_WORKER_RUNTIME;

    expect(isControlPanelRuntime()).toBe(false);
    expect(canRunLocalMediaProcessing()).toBe(true);
    expect(canRunInlineMediaProcessing()).toBe(false);
  });

  it("allows the persistent media worker to execute queued production work", () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.VERCEL;
    delete process.env.CONTROL_PANEL_MODE;
    process.env.WORKER_ENABLED = "true";
    process.env.MEDIA_WORKER_RUNTIME = "true";

    expect(canRunLocalMediaProcessing()).toBe(true);
    expect(canRunInlineMediaProcessing()).toBe(true);
  });

  it("blocks ffmpeg/sharp work in control-panel deployments", () => {
    process.env.VERCEL = "1";
    process.env.WORKER_ENABLED = "true";
    process.env.MEDIA_WORKER_RUNTIME = "true";

    expect(isControlPanelRuntime()).toBe(true);
    expect(canRunLocalMediaProcessing()).toBe(false);
    expect(canRunInlineMediaProcessing()).toBe(false);
    expect(localMediaProcessingUnavailableMessage("Clip render")).toBe(
      "Clip render was queued or saved, but media processing must run on your local worker because this deployment cannot run ffmpeg/sharp jobs.",
    );
  });
});
