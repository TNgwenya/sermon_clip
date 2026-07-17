import { afterEach, describe, expect, it } from "vitest";

import {
  resolveOpenAIChatModel,
  resolveOpenAIReasoningEffort,
} from "@/server/ai/modelConfig";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("OpenAI workload model configuration", () => {
  it("uses the balanced model and medium reasoning for clip selection", () => {
    delete process.env.OPENAI_CHAT_MODEL;
    delete process.env.OPENAI_REASONING_EFFORT;
    delete process.env.OPENAI_CLIP_SELECTION_MODEL;
    delete process.env.OPENAI_CLIP_SELECTION_MODEL_REASONING_EFFORT;

    const model = resolveOpenAIChatModel("clipSelection");

    expect(model).toBe("gpt-5.6-terra");
    expect(resolveOpenAIReasoningEffort("clipSelection", model)).toBe("medium");
  });

  it("uses the high-volume model and low reasoning for routine structured tasks", () => {
    delete process.env.OPENAI_CHAT_MODEL;
    delete process.env.OPENAI_REASONING_EFFORT;
    delete process.env.OPENAI_CONTENT_MULTIPLICATION_MODEL;
    delete process.env.OPENAI_CONTENT_MULTIPLICATION_MODEL_REASONING_EFFORT;

    const model = resolveOpenAIChatModel("contentMultiplication");

    expect(model).toBe("gpt-5.6-luna");
    expect(resolveOpenAIReasoningEffort("contentMultiplication", model)).toBe("low");
  });

  it("preserves lower-cost legacy overrides without sending unsupported reasoning fields", () => {
    process.env.OPENAI_CLIP_SELECTION_MODEL = "gpt-4o-mini";

    const model = resolveOpenAIChatModel("clipSelection");

    expect(model).toBe("gpt-4o-mini");
    expect(resolveOpenAIReasoningEffort("clipSelection", model)).toBeUndefined();
  });

  it("accepts explicit task reasoning overrides for GPT-5 models", () => {
    process.env.OPENAI_SERMON_INTELLIGENCE_MODEL_REASONING_EFFORT = "xhigh";

    expect(resolveOpenAIReasoningEffort("sermonIntelligence", "gpt-5.6-sol")).toBe("xhigh");
  });

  it("honors the documented content-multiplication override and its legacy alias", () => {
    process.env.OPENAI_CONTENT_MULTIPLICATION_MODEL_REASONING_EFFORT = "xhigh";
    expect(resolveOpenAIReasoningEffort("contentMultiplication", "gpt-5.6-sol")).toBe("xhigh");

    delete process.env.OPENAI_CONTENT_MULTIPLICATION_MODEL_REASONING_EFFORT;
    process.env.OPENAI_CONTENT_MULTIPLICATION_REASONING_EFFORT = "low";
    expect(resolveOpenAIReasoningEffort("contentMultiplication", "gpt-5.6-sol")).toBe("low");
  });
});
