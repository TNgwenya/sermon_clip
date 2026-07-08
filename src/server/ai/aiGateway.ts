import { getOpenAiClient } from "@/server/ai/openaiClient";
import { recordAiInvocation, type AiInvocationUsage } from "@/server/ai/aiInvocationLogger";
import type { Prisma } from "@prisma/client";

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type JsonObjectResponseFormat = {
  type: "json_object";
};

type LoggedChatCompletionInput = {
  operation: string;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  response_format?: JsonObjectResponseFormat;
  sermonId?: string | null;
  clipCandidateId?: string | null;
  promptVersion?: string | null;
  metadata?: Prisma.InputJsonValue;
  missingKeyMessage?: string;
};

const DEFAULT_CHAT_MAX_ATTEMPTS = 3;
const DEFAULT_CHAT_RETRY_BASE_DELAY_MS = 1_500;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const direct = "status" in error ? (error as { status?: unknown }).status : undefined;
  if (typeof direct === "number" && Number.isFinite(direct)) {
    return direct;
  }

  const response = "response" in error ? (error as { response?: { status?: unknown } }).response : undefined;
  return typeof response?.status === "number" && Number.isFinite(response.status)
    ? response.status
    : undefined;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isRetryableOpenAIChatError(error: unknown): boolean {
  const status = errorStatus(error);
  if (status && RETRYABLE_STATUS_CODES.has(status)) {
    return true;
  }

  const message = errorMessage(error).toLowerCase();
  return (
    message.includes("rate limit") ||
    message.includes("timeout") ||
    message.includes("temporarily unavailable") ||
    message.includes("socket") ||
    message.includes("network")
  );
}

function resolvePositiveIntegerEnv(name: string, fallback: number): number {
  const configured = process.env[name]?.trim();
  if (!configured) {
    return fallback;
  }

  const value = Number(configured);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function usageFromCompletion(completion: { usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number } | null }): AiInvocationUsage {
  return {
    inputTokens: completion.usage?.prompt_tokens ?? null,
    outputTokens: completion.usage?.completion_tokens ?? null,
    totalTokens: completion.usage?.total_tokens ?? null,
  };
}

async function runWithRetry<T>(operation: () => Promise<T>): Promise<T> {
  const maxAttempts = Math.max(
    1,
    resolvePositiveIntegerEnv("OPENAI_CHAT_MAX_ATTEMPTS", DEFAULT_CHAT_MAX_ATTEMPTS),
  );
  const baseDelayMs = Math.max(
    0,
    resolvePositiveIntegerEnv("OPENAI_CHAT_RETRY_BASE_DELAY_MS", DEFAULT_CHAT_RETRY_BASE_DELAY_MS),
  );

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts || !isRetryableOpenAIChatError(error)) {
        throw error;
      }

      const delayMs = baseDelayMs * (2 ** (attempt - 1));
      if (delayMs > 0) {
        await sleep(delayMs);
      }
    }
  }

  throw new Error("OpenAI chat retry loop exited unexpectedly.");
}

export async function createLoggedChatCompletion(input: LoggedChatCompletionInput) {
  const startedAt = Date.now();
  const request = {
    model: input.model,
    temperature: input.temperature,
    response_format: input.response_format,
    messages: input.messages,
  };

  try {
    const client = getOpenAiClient(input.missingKeyMessage);
    const completion = await runWithRetry(() => client.chat.completions.create(request));
    await recordAiInvocation({
      sermonId: input.sermonId,
      clipCandidateId: input.clipCandidateId,
      operation: input.operation,
      model: input.model,
      promptVersion: input.promptVersion,
      request,
      status: "SUCCEEDED",
      usage: usageFromCompletion(completion),
      latencyMs: Date.now() - startedAt,
      metadata: input.metadata,
    });
    return completion;
  } catch (error) {
    await recordAiInvocation({
      sermonId: input.sermonId,
      clipCandidateId: input.clipCandidateId,
      operation: input.operation,
      model: input.model,
      promptVersion: input.promptVersion,
      request,
      status: "FAILED",
      latencyMs: Date.now() - startedAt,
      errorMessage: errorMessage(error),
      metadata: input.metadata,
    });
    throw error;
  }
}
