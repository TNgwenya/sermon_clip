import { describe, expect, it } from "vitest";

import { estimateAiCostMicros, estimateTextAiCostMicros } from "@/server/ai/aiInvocationLogger";

describe("AI invocation cost estimation", () => {
  it("uses discounted pricing for cached input tokens", () => {
    expect(estimateTextAiCostMicros("gpt-5.6-luna", {
      inputTokens: 10_000,
      cachedInputTokens: 8_000,
      outputTokens: 1_000,
    })).toBe(BigInt(8_800));
  });

  it("returns null for models without an audited price", () => {
    expect(estimateTextAiCostMicros("custom-model", {
      inputTokens: 100,
      outputTokens: 20,
    })).toBeNull();
  });

  it("estimates timestamp and accuracy transcription from audio duration", () => {
    expect(estimateAiCostMicros({
      model: "gpt-4o-transcribe",
      audioDurationSeconds: 600,
    })).toBe(BigInt(60_000));
  });
});
