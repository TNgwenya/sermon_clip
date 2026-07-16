import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createCompletion: vi.fn(),
  recordAiInvocation: vi.fn(),
}));

vi.mock("@/server/ai/openaiClient", () => ({
  getOpenAiClient: () => ({
    chat: {
      completions: {
        create: mocks.createCompletion,
      },
    },
  }),
}));

vi.mock("@/server/ai/aiInvocationLogger", () => ({
  recordAiInvocation: mocks.recordAiInvocation,
}));

import { createLoggedChatCompletion } from "@/server/ai/aiGateway";

const completion = {
  id: "completion-1",
  object: "chat.completion",
  created: 1,
  model: "gpt-test",
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      logprobs: null,
      message: {
        role: "assistant",
        content: "{\"sectionType\":\"OFFERING\"}",
        refusal: null,
      },
    },
  ],
  usage: {
    prompt_tokens: 21,
    completion_tokens: 8,
    total_tokens: 29,
  },
};

function baseInput() {
  return {
    operation: "sermon_intelligence",
    sermonId: "sermon-1",
    model: "gpt-test",
    messages: [{ role: "user" as const, content: "Return JSON." }],
    metadata: { language: "English and Zulu" },
  };
}

describe("createLoggedChatCompletion response validation", () => {
  beforeEach(() => {
    mocks.createCompletion.mockReset();
    mocks.recordAiInvocation.mockReset();
    mocks.recordAiInvocation.mockResolvedValue(undefined);
  });

  it("records FAILED, not SUCCEEDED, when post-response validation fails", async () => {
    mocks.createCompletion.mockResolvedValue(completion);
    const diagnostic = "AI response validation failed: structureSections[0].sectionType: invalid_value; received=\"OFFERING\"; expected=[\"INTRODUCTION\", \"OTHER\"]";

    await expect(createLoggedChatCompletion({
      ...baseInput(),
      validateResponse: () => {
        throw new Error(diagnostic);
      },
    })).rejects.toThrow(diagnostic);

    expect(mocks.recordAiInvocation).toHaveBeenCalledTimes(1);
    expect(mocks.recordAiInvocation).toHaveBeenCalledWith(expect.objectContaining({
      operation: "sermon_intelligence",
      sermonId: "sermon-1",
      status: "FAILED",
      errorMessage: diagnostic,
      usage: {
        inputTokens: 21,
        outputTokens: 8,
        totalTokens: 29,
      },
      metadata: {
        language: "English and Zulu",
        failureStage: "response_validation",
      },
    }));
    expect(mocks.recordAiInvocation.mock.calls.map(([input]) => input.status)).toEqual(["FAILED"]);
  });

  it("records SUCCEEDED only after validation returns a value", async () => {
    mocks.createCompletion.mockResolvedValue(completion);

    const result = await createLoggedChatCompletion({
      ...baseInput(),
      validateResponse: (response) => ({
        parsed: JSON.parse(response.choices[0]?.message?.content ?? "{}") as unknown,
      }),
    });

    expect(result).toEqual({ parsed: { sectionType: "OFFERING" } });
    expect(mocks.recordAiInvocation).toHaveBeenCalledTimes(1);
    expect(mocks.recordAiInvocation).toHaveBeenCalledWith(expect.objectContaining({
      status: "SUCCEEDED",
      metadata: { language: "English and Zulu" },
    }));
  });
});
