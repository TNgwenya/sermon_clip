import type { AiInvocationStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";
import { hashStableJson } from "@/server/utils/stableJson";

export type AiInvocationUsage = {
  inputTokens?: number | null;
  outputTokens?: number | null;
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
  latencyMs?: number | null;
  errorMessage?: string | null;
  metadata?: Prisma.InputJsonValue | null;
};

function normalizeTokenCount(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.floor(value)
    : null;
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
        outputTokens: normalizeTokenCount(input.usage?.outputTokens),
        totalTokens: normalizeTokenCount(input.usage?.totalTokens),
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
