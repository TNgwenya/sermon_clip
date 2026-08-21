import { createHash } from "node:crypto";

export const STRUCTURED_AI_CONTRACT_VERSION = "structured-ai-output-v1";

export type StructuredAiFailureKind =
  | "EMPTY"
  | "TOO_LARGE"
  | "UNSAFE_WRAPPER"
  | "INVALID_JSON"
  | "SCHEMA_MISMATCH"
  | "GROUNDING_FAILURE"
  | "SAFETY_FAILURE";

export type StructuredAiParseResult<T> =
  | { ok: true; value: T; normalizedJson: string; usedJsonFence: boolean }
  | {
      ok: false;
      kind: Exclude<StructuredAiFailureKind, "GROUNDING_FAILURE" | "SAFETY_FAILURE">;
      message: string;
      repairAllowed: boolean;
    };

export type StructuredAiTrace = {
  contractVersion: typeof STRUCTURED_AI_CONTRACT_VERSION;
  schemaVersion: string;
  promptVersion: string;
  model: string;
  inputFingerprint: string;
  cacheBoundary: string;
};

const DEFAULT_MAX_OUTPUT_CHARS = 250_000;

function exactJsonEnvelope(raw: string): { json: string; usedJsonFence: boolean } | null {
  const trimmed = raw.trim();
  const fence = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) return { json: fence[1].trim(), usedJsonFence: true };
  if (trimmed.startsWith("{")) {
    return { json: trimmed, usedJsonFence: false };
  }
  return null;
}

export function parseStructuredAiOutput<T>(input: {
  raw: string;
  validate: (value: unknown) => T;
  maxOutputChars?: number;
}): StructuredAiParseResult<T> {
  const raw = input.raw.trim();
  if (!raw) {
    return { ok: false, kind: "EMPTY", message: "AI output was empty.", repairAllowed: true };
  }
  if (raw.length > (input.maxOutputChars ?? DEFAULT_MAX_OUTPUT_CHARS)) {
    return {
      ok: false,
      kind: "TOO_LARGE",
      message: "AI output exceeded the bounded structured-output size.",
      repairAllowed: false,
    };
  }
  const envelope = exactJsonEnvelope(raw);
  if (!envelope) {
    return {
      ok: false,
      kind: "UNSAFE_WRAPPER",
      message: "AI output must contain exactly one JSON object, with no surrounding prose.",
      repairAllowed: true,
    };
  }
  let decoded: unknown;
  try {
    decoded = JSON.parse(envelope.json) as unknown;
  } catch (error) {
    return {
      ok: false,
      kind: "INVALID_JSON",
      message: error instanceof Error ? error.message : "AI output was not valid JSON.",
      repairAllowed: true,
    };
  }
  try {
    return {
      ok: true,
      value: input.validate(decoded),
      normalizedJson: JSON.stringify(decoded),
      usedJsonFence: envelope.usedJsonFence,
    };
  } catch (error) {
    return {
      ok: false,
      kind: "SCHEMA_MISMATCH",
      message: error instanceof Error ? error.message : "AI output did not match the required schema.",
      repairAllowed: true,
    };
  }
}

export function classifyStructuredAiRepair(input: {
  failureKind: StructuredAiFailureKind;
  repairsUsed: number;
  maxRepairs?: number;
}): { allowed: boolean; reason: string } {
  const maxRepairs = Math.max(0, Math.min(1, Math.floor(input.maxRepairs ?? 1)));
  if (input.repairsUsed >= maxRepairs) {
    return { allowed: false, reason: "The single bounded repair attempt has already been used." };
  }
  if (input.failureKind === "TOO_LARGE") {
    return { allowed: false, reason: "Oversized output is rejected rather than echoed into another model call." };
  }
  if (input.failureKind === "GROUNDING_FAILURE" || input.failureKind === "SAFETY_FAILURE") {
    return { allowed: false, reason: "Grounding and safety failures require regeneration or human review, not syntactic repair." };
  }
  return { allowed: true, reason: "One schema-only repair attempt is allowed." };
}

function canonical(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Trace input contains a non-finite number.");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    return `{${Object.keys(objectValue).sort().map((key) => `${JSON.stringify(key)}:${canonical(objectValue[key])}`).join(",")}}`;
  }
  throw new Error("Trace input must be portable JSON.");
}

export function buildStructuredAiTrace(input: {
  schemaVersion: string;
  promptVersion: string;
  model: string;
  canonicalInput: unknown;
}): StructuredAiTrace {
  const schemaVersion = input.schemaVersion.trim();
  const promptVersion = input.promptVersion.trim();
  const model = input.model.trim();
  if (!schemaVersion || !promptVersion || !model) {
    throw new Error("schemaVersion, promptVersion, and model are required for AI traceability.");
  }
  const inputFingerprint = createHash("sha256").update(canonical(input.canonicalInput)).digest("hex");
  return {
    contractVersion: STRUCTURED_AI_CONTRACT_VERSION,
    schemaVersion,
    promptVersion,
    model,
    inputFingerprint,
    cacheBoundary: `${promptVersion}:${schemaVersion}:${model}:${inputFingerprint}`,
  };
}
