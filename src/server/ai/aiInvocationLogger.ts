import type { AiInvocationStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { hashStableJson } from "@/server/utils/stableJson";

export type AiInvocationUsage = {
  inputTokens?: number | null;
  cachedInputTokens?: number | null;
  outputTokens?: number | null;
  reasoningTokens?: number | null;
  totalTokens?: number | null;
};

export type RecordAiInvocationInput = {
  sermonId?: string | null;
  clipCandidateId?: string | null;
  provider?: string;
  operation: string;
  model: string;
  promptVersion?: string | null;
  request?: unknown;
  requestHash?: string | null;
  status: AiInvocationStatus;
  usage?: AiInvocationUsage | null;
  providerRequestCount?: number;
  cacheHit?: boolean;
  audioDurationSeconds?: number | null;
  latencyMs?: number | null;
  errorMessage?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

function normalizeTokenCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
}

type TextModelPrice = {
  inputMicrosPerToken: number;
  cachedInputMicrosPerToken: number;
  outputMicrosPerToken: number;
};

// Standard processing prices published by OpenAI on 2026-07-17. Keeping the
// estimator next to invocation persistence makes price changes explicit and
// prevents UI code from inventing its own calculations.
const TEXT_MODEL_PRICES: Record<string, TextModelPrice> = {
  "gpt-5.6-sol": { inputMicrosPerToken: 5, cachedInputMicrosPerToken: 0.5, outputMicrosPerToken: 30 },
  "gpt-5.6-terra": { inputMicrosPerToken: 2.5, cachedInputMicrosPerToken: 0.25, outputMicrosPerToken: 15 },
  "gpt-5.6-luna": { inputMicrosPerToken: 1, cachedInputMicrosPerToken: 0.1, outputMicrosPerToken: 6 },
  "gpt-4o": { inputMicrosPerToken: 2.5, cachedInputMicrosPerToken: 1.25, outputMicrosPerToken: 10 },
  "gpt-4o-mini": { inputMicrosPerToken: 0.15, cachedInputMicrosPerToken: 0.075, outputMicrosPerToken: 0.6 },
};

export function estimateTextAiCostMicros(model: string, usage?: AiInvocationUsage | null): bigint | null {
  const price = TEXT_MODEL_PRICES[model];
  const inputTokens = normalizeTokenCount(usage?.inputTokens);
  const cachedInputTokens = Math.min(
    inputTokens ?? 0,
    normalizeTokenCount(usage?.cachedInputTokens) ?? 0,
  );
  const outputTokens = normalizeTokenCount(usage?.outputTokens);
  if (!price || inputTokens === null || outputTokens === null) {
    return null;
  }

  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  return BigInt(Math.round(
    (uncachedInputTokens * price.inputMicrosPerToken) +
    (cachedInputTokens * price.cachedInputMicrosPerToken) +
    (outputTokens * price.outputMicrosPerToken),
  ));
}

export function estimateAiCostMicros(input: {
  model: string;
  usage?: AiInvocationUsage | null;
  audioDurationSeconds?: number | null;
}): bigint | null {
  const textEstimate = estimateTextAiCostMicros(input.model, input.usage);
  if (textEstimate !== null) return textEstimate;

  // Whisper and GPT-4o Transcribe are currently published at $0.006/minute,
  // which is 100 micro-dollars per audio second.
  if (
    ["whisper-1", "gpt-4o-transcribe"].includes(input.model) &&
    typeof input.audioDurationSeconds === "number" &&
    Number.isFinite(input.audioDurationSeconds) &&
    input.audioDurationSeconds >= 0
  ) {
    return BigInt(Math.round(input.audioDurationSeconds * 100));
  }

  return null;
}

export function buildAiRequestHash(value: unknown): string {
  return hashStableJson(value);
}

export async function recordAiInvocation(input: RecordAiInvocationInput): Promise<void> {
  try {
    await prisma.aiInvocation.create({
      data: {
        sermonId: input.sermonId ?? null,
        clipCandidateId: input.clipCandidateId ?? null,
        provider: input.provider ?? "openai",
        operation: input.operation,
        model: input.model,
        promptVersion: input.promptVersion ?? null,
        requestHash: input.requestHash ?? (input.request === undefined ? null : buildAiRequestHash(input.request)),
        status: input.status,
        inputTokens: normalizeTokenCount(input.usage?.inputTokens),
        cachedInputTokens: normalizeTokenCount(input.usage?.cachedInputTokens),
        outputTokens: normalizeTokenCount(input.usage?.outputTokens),
        reasoningTokens: normalizeTokenCount(input.usage?.reasoningTokens),
        totalTokens: normalizeTokenCount(input.usage?.totalTokens),
        estimatedCostMicros: estimateAiCostMicros({
          model: input.model,
          usage: input.usage,
          audioDurationSeconds: input.audioDurationSeconds,
        }),
        providerRequestCount: normalizeTokenCount(input.providerRequestCount) ?? 0,
        cacheHit: input.cacheHit ?? false,
        audioDurationSeconds: input.audioDurationSeconds ?? null,
        latencyMs: normalizeTokenCount(input.latencyMs),
        errorMessage: input.errorMessage?.slice(0, 2000) ?? null,
        metadataJson: input.metadata ?? undefined,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`AI invocation log skipped for ${input.operation}: ${message}`);
  }
}
