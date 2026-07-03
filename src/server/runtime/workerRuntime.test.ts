import { afterEach, describe, expect, it } from "vitest";

import {
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
    delete process.env.VERCEL;
    delete process.env.CONTROL_PANEL_MODE;
    delete process.env.WORKER_ENABLED;

    expect(isControlPanelRuntime()).toBe(false);
    expect(canRunLocalMediaProcessing()).toBe(true);
  });

  it("blocks ffmpeg/sharp work in control-panel deployments", () => {
    process.env.VERCEL = "1";
    process.env.WORKER_ENABLED = "true";

    expect(isControlPanelRuntime()).toBe(true);
    expect(canRunLocalMediaProcessing()).toBe(false);
    expect(localMediaProcessingUnavailableMessage("Clip render")).toBe(
      "Clip render was queued or saved, but media processing must run on your local worker because this deployment cannot run ffmpeg/sharp jobs.",
    );
  });
});
