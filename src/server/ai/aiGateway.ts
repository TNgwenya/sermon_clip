import { getOpenAiClient } from "@/server/ai/openaiClient";
import {
  buildAiRequestHash,
  recordAiInvocation,
  type AiInvocationUsage,
} from "@/server/ai/aiInvocationLogger";
import type { OpenAIReasoningEffort } from "@/server/ai/modelConfig";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import type { ChatCompletion } from "openai/resources/chat/completions";
import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from "openai/resources/responses/responses";

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
  reasoningEffort?: OpenAIReasoningEffort;
  response_format?: JsonObjectResponseFormat;
  sermonId?: string | null;
  clipCandidateId?: string | null;
  promptVersion?: string | null;
  metadata?: Prisma.InputJsonValue;
  missingKeyMessage?: string;
  bypassCache?: boolean;
};

type ValidatedLoggedChatCompletionInput<T> = LoggedChatCompletionInput & {
  validateResponse: (completion: ChatCompletion) => T | Promise<T>;
};

const DEFAULT_CHAT_MAX_ATTEMPTS = 3;
const DEFAULT_CHAT_RETRY_BASE_DELAY_MS = 1_500;
const DEFAULT_VALIDATED_RESPONSE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;
const MAX_PROMPT_CACHE_KEY_LENGTH = 64;
const RETRYABLE_STATUS_CODES = new Set([408, 409, 429, 500, 502, 503, 504]);
const inFlightRequests = new Map<string, Promise<unknown>>();

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

function buildPromptCacheKey(operation: string, promptVersion?: string | null): string {
  const cacheKey = `${operation}:${promptVersion ?? "unversioned"}`;
  if (cacheKey.length <= MAX_PROMPT_CACHE_KEY_LENGTH) {
    return cacheKey;
  }

  // Preserve a readable prefix, while the hash avoids collisions between long
  // operation/version combinations that share the same first characters.
  const hash = createHash("sha256").update(cacheKey).digest("hex").slice(0, 12);
  const prefixLength = MAX_PROMPT_CACHE_KEY_LENGTH - hash.length - 1;
  return `${cacheKey.slice(0, prefixLength)}:${hash}`;
}

function usageFromResponse(response: Response): AiInvocationUsage {
  return {
    inputTokens: response.usage?.input_tokens ?? null,
    cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? null,
    outputTokens: response.usage?.output_tokens ?? null,
    reasoningTokens: response.usage?.output_tokens_details?.reasoning_tokens ?? null,
    totalTokens: response.usage?.total_tokens ?? null,
  };
}

function asChatCompletion(response: Response): ChatCompletion {
  return {
    id: response.id,
    object: "chat.completion",
    created: response.created_at,
    model: response.model,
    choices: [{
      index: 0,
      finish_reason: response.status === "completed" ? "stop" : "length",
      logprobs: null,
      message: {
        role: "assistant",
        content: response.output_text,
        refusal: null,
      },
    }],
    usage: response.usage ? {
      prompt_tokens: response.usage.input_tokens,
      completion_tokens: response.usage.output_tokens,
      total_tokens: response.usage.total_tokens,
    } : undefined,
  } as ChatCompletion;
}

function cachedChatCompletion(model: string, responseText: string): ChatCompletion {
  return {
    id: "validated-response-cache",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      finish_reason: "stop",
      logprobs: null,
      message: { role: "assistant", content: responseText, refusal: null },
    }],
  } as ChatCompletion;
}

function mergeMetadata(
  metadata: Prisma.InputJsonValue | undefined,
  extra: Record<string, string | number | boolean | null>,
): Prisma.InputJsonValue {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return { ...metadata, ...extra };
  }
  return { ...extra, ...(metadata === undefined ? {} : { context: metadata }) };
}

function isValidatedCacheEnabled(input: LoggedChatCompletionInput | ValidatedLoggedChatCompletionInput<unknown>): boolean {
  return (
    "validateResponse" in input &&
    Boolean(input.promptVersion) &&
    !input.bypassCache &&
    process.env.OPENAI_VALIDATED_RESPONSE_CACHE_ENABLED?.trim().toLowerCase() !== "false"
  );
}

async function readValidatedResponseCache(requestHash: string): Promise<string | null> {
  try {
    const cached = await prisma.aiResponseCache.findUnique({ where: { requestHash } });
    if (!cached) return null;
    if (cached.expiresAt <= new Date()) {
      await prisma.aiResponseCache.delete({ where: { requestHash } });
      return null;
    }
    return cached.responseText;
  } catch (error) {
    console.warn(`AI validated response cache read skipped: ${errorMessage(error)}`);
    return null;
  }
}

async function writeValidatedResponseCache(input: {
  requestHash: string;
  operation: string;
  model: string;
  promptVersion?: string | null;
  responseText: string;
}): Promise<void> {
  const ttlSeconds = resolvePositiveIntegerEnv(
    "OPENAI_VALIDATED_RESPONSE_CACHE_TTL_SECONDS",
    DEFAULT_VALIDATED_RESPONSE_CACHE_TTL_SECONDS,
  );
  try {
    await prisma.aiResponseCache.upsert({
      where: { requestHash: input.requestHash },
      create: {
        ...input,
        promptVersion: input.promptVersion ?? null,
        expiresAt: new Date(Date.now() + (ttlSeconds * 1000)),
      },
      update: {
        responseText: input.responseText,
        expiresAt: new Date(Date.now() + (ttlSeconds * 1000)),
      },
    });
  } catch (error) {
    console.warn(`AI validated response cache write skipped: ${errorMessage(error)}`);
  }
}

function withFailureStageMetadata(
  metadata: Prisma.InputJsonValue | undefined,
  failureStage: "provider_request" | "response_validation",
): Prisma.InputJsonValue {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    return { ...metadata, failureStage };
  }

  return metadata === undefined
    ? { failureStage }
    : { failureStage, context: metadata };
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

export function createLoggedChatCompletion<T>(input: ValidatedLoggedChatCompletionInput<T>): Promise<T>;
export function createLoggedChatCompletion(input: LoggedChatCompletionInput): Promise<ChatCompletion>;
export async function createLoggedChatCompletion<T>(
  input: LoggedChatCompletionInput | ValidatedLoggedChatCompletionInput<T>,
): Promise<ChatCompletion | T> {
  const request: ResponseCreateParamsNonStreaming = {
    model: input.model,
    temperature: input.reasoningEffort ? undefined : input.temperature,
    reasoning: input.reasoningEffort ? { effort: input.reasoningEffort } : undefined,
    text: input.response_format ? { format: input.response_format } : undefined,
    input: input.messages,
    prompt_cache_key: buildPromptCacheKey(input.operation, input.promptVersion),
    store: false,
    stream: false,
  };
  const requestHash = buildAiRequestHash(request);
  const cacheEnabled = isValidatedCacheEnabled(input);

  const activeRequest = inFlightRequests.get(requestHash);
  if (activeRequest) {
    return activeRequest as Promise<T | ChatCompletion>;
  }

  const execution = (async (): Promise<ChatCompletion | T> => {
    const startedAt = Date.now();
    let response: Response | null = null;
    let completion: ChatCompletion | null = null;
    let providerRequestCount = 0;

    if (cacheEnabled && "validateResponse" in input) {
      const cachedResponseText = await readValidatedResponseCache(requestHash);
      if (cachedResponseText !== null) {
        const cachedCompletion = cachedChatCompletion(input.model, cachedResponseText);
        try {
          const cachedResult = await input.validateResponse(cachedCompletion);
          await recordAiInvocation({
            sermonId: input.sermonId,
            clipCandidateId: input.clipCandidateId,
            operation: input.operation,
            model: input.model,
            promptVersion: input.promptVersion,
            requestHash,
            status: "SUCCEEDED",
            providerRequestCount: 0,
            cacheHit: true,
            latencyMs: Date.now() - startedAt,
            metadata: mergeMetadata(input.metadata, { validatedResponseCacheHit: true }),
          });
          return cachedResult;
        } catch {
          try {
            await prisma.aiResponseCache.delete({ where: { requestHash } });
          } catch {
            // A stale or incompatible cache entry should never block a live request.
          }
        }
      }
    }

    try {
      const client = getOpenAiClient(input.missingKeyMessage);
      response = await runWithRetry(() => {
        providerRequestCount += 1;
        return client.responses.create(request);
      });
      completion = asChatCompletion(response);
      const result = "validateResponse" in input
        ? await input.validateResponse(completion)
        : completion;

      if (cacheEnabled) {
        await writeValidatedResponseCache({
          requestHash,
          operation: input.operation,
          model: input.model,
          promptVersion: input.promptVersion,
          responseText: response.output_text,
        });
      }

      await recordAiInvocation({
        sermonId: input.sermonId,
        clipCandidateId: input.clipCandidateId,
        operation: input.operation,
        model: input.model,
        promptVersion: input.promptVersion,
        request,
        status: "SUCCEEDED",
        usage: usageFromResponse(response),
        providerRequestCount,
        cacheHit: false,
        latencyMs: Date.now() - startedAt,
        metadata: input.metadata,
      });
      return result;
    } catch (error) {
      await recordAiInvocation({
        sermonId: input.sermonId,
        clipCandidateId: input.clipCandidateId,
        operation: input.operation,
        model: input.model,
        promptVersion: input.promptVersion,
        request,
        status: "FAILED",
        usage: response ? usageFromResponse(response) : undefined,
        providerRequestCount,
        cacheHit: false,
        latencyMs: Date.now() - startedAt,
        errorMessage: errorMessage(error),
        metadata: withFailureStageMetadata(
          input.metadata,
          completion ? "response_validation" : "provider_request",
        ),
      });
      throw error;
    }
  })();

  inFlightRequests.set(requestHash, execution);
  try {
    return await execution;
  } finally {
    inFlightRequests.delete(requestHash);
  }
}
