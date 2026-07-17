import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createResponse: vi.fn(),
  recordAiInvocation: vi.fn(),
  findCachedResponse: vi.fn(),
  upsertCachedResponse: vi.fn(),
  deleteCachedResponse: vi.fn(),
}));

vi.mock("@/server/ai/openaiClient", () => ({
  getOpenAiClient: () => ({
    responses: {
      create: mocks.createResponse,
    },
  }),
}));

vi.mock("@/server/ai/aiInvocationLogger", () => ({
  recordAiInvocation: mocks.recordAiInvocation,
  buildAiRequestHash: (value: unknown) => JSON.stringify(value),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    aiResponseCache: {
      findUnique: mocks.findCachedResponse,
      upsert: mocks.upsertCachedResponse,
      delete: mocks.deleteCachedResponse,
    },
  },
}));

import { createLoggedChatCompletion } from "@/server/ai/aiGateway";

const response = {
  id: "response-1",
  object: "response",
  created_at: 1,
  model: "gpt-test",
  status: "completed",
  output_text: "{\"sectionType\":\"OFFERING\"}",
  usage: {
    input_tokens: 21,
    input_tokens_details: { cached_tokens: 5 },
    output_tokens: 8,
    output_tokens_details: { reasoning_tokens: 3 },
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
    mocks.createResponse.mockReset();
    mocks.recordAiInvocation.mockReset();
    mocks.recordAiInvocation.mockResolvedValue(undefined);
    mocks.findCachedResponse.mockReset();
    mocks.findCachedResponse.mockResolvedValue(null);
    mocks.upsertCachedResponse.mockReset();
    mocks.upsertCachedResponse.mockResolvedValue(undefined);
    mocks.deleteCachedResponse.mockReset();
    mocks.deleteCachedResponse.mockResolvedValue(undefined);
  });

  it("records FAILED, not SUCCEEDED, when post-response validation fails", async () => {
    mocks.createResponse.mockResolvedValue(response);
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
        cachedInputTokens: 5,
        outputTokens: 8,
        reasoningTokens: 3,
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
    mocks.createResponse.mockResolvedValue(response);

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

  it("omits temperature when a GPT reasoning effort is configured", async () => {
    mocks.createResponse.mockResolvedValue(response);

    await createLoggedChatCompletion({
      ...baseInput(),
      model: "gpt-5.6-sol",
      temperature: 0.2,
      reasoningEffort: "high",
    });

    expect(mocks.createResponse).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-5.6-sol",
      temperature: undefined,
      reasoning: { effort: "high" },
      store: false,
    }));
  });

  it("reuses a validated cached result without making a provider request", async () => {
    mocks.findCachedResponse.mockResolvedValue({
      responseText: "{\"sectionType\":\"INTRODUCTION\"}",
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await createLoggedChatCompletion({
      ...baseInput(),
      promptVersion: "sermon-intelligence-v2",
      validateResponse: (cachedCompletion) => JSON.parse(
        cachedCompletion.choices[0]?.message?.content ?? "{}",
      ) as { sectionType: string },
    });

    expect(result).toEqual({ sectionType: "INTRODUCTION" });
    expect(mocks.createResponse).not.toHaveBeenCalled();
    expect(mocks.recordAiInvocation).toHaveBeenCalledWith(expect.objectContaining({
      status: "SUCCEEDED",
      cacheHit: true,
      providerRequestCount: 0,
    }));
  });

  it("coalesces concurrent identical requests into one provider call", async () => {
    mocks.createResponse.mockResolvedValue({
      ...response,
      output_text: "{\"sectionType\":\"INTRODUCTION\"}",
    });
    const input = {
      ...baseInput(),
      promptVersion: "sermon-intelligence-v2",
      validateResponse: (completion: Awaited<ReturnType<typeof createLoggedChatCompletion>>) => JSON.parse(
        "choices" in completion
          ? completion.choices[0]?.message?.content ?? "{}"
          : "{}",
      ) as { sectionType: string },
    };

    const [first, second] = await Promise.all([
      createLoggedChatCompletion(input),
      createLoggedChatCompletion(input),
    ]);

    expect(first).toEqual({ sectionType: "INTRODUCTION" });
    expect(second).toEqual(first);
    expect(mocks.createResponse).toHaveBeenCalledTimes(1);
    expect(mocks.recordAiInvocation).toHaveBeenCalledTimes(1);
  });
});
