import { describe, expect, it } from "vitest";

import {
  buildStructuredAiTrace,
  classifyStructuredAiRepair,
  parseStructuredAiOutput,
} from "../structuredAiContract";

function validateClips(value: unknown): { clips: Array<{ title: string }> } {
  if (!value || typeof value !== "object" || !Array.isArray((value as { clips?: unknown }).clips)) {
    throw new Error("clips must be an array");
  }
  const clips = (value as { clips: unknown[] }).clips.map((clip) => {
    if (!clip || typeof clip !== "object" || typeof (clip as { title?: unknown }).title !== "string") {
      throw new Error("clip title must be a string");
    }
    return { title: (clip as { title: string }).title };
  });
  return { clips };
}

describe("structured AI output contract", () => {
  it("accepts one exact JSON object or one exact JSON fence", () => {
    expect(parseStructuredAiOutput({ raw: '{"clips":[{"title":"Hope"}]}', validate: validateClips })).toMatchObject({ ok: true, usedJsonFence: false });
    expect(parseStructuredAiOutput({ raw: '```json\n{"clips":[]}\n```', validate: validateClips })).toMatchObject({ ok: true, usedJsonFence: true });
  });

  it("rejects prose wrappers instead of slicing from first to last brace", () => {
    expect(parseStructuredAiOutput({
      raw: 'Here is the answer: {"clips":[]}',
      validate: validateClips,
    })).toMatchObject({
      ok: false,
      kind: "UNSAFE_WRAPPER",
      repairAllowed: true,
    });
  });

  it("classifies invalid JSON, schema mismatch, and oversized output separately", () => {
    expect(parseStructuredAiOutput({ raw: '{"clips":', validate: validateClips })).toMatchObject({ ok: false, kind: "INVALID_JSON" });
    expect(parseStructuredAiOutput({ raw: '{"clips":"no"}', validate: validateClips })).toMatchObject({ ok: false, kind: "SCHEMA_MISMATCH" });
    expect(parseStructuredAiOutput({ raw: '{"value":"long"}', validate: validateClips, maxOutputChars: 5 })).toMatchObject({
      ok: false,
      kind: "TOO_LARGE",
      repairAllowed: false,
    });
  });

  it("permits at most one syntax repair and never repairs safety failures", () => {
    expect(classifyStructuredAiRepair({ failureKind: "INVALID_JSON", repairsUsed: 0 })).toMatchObject({ allowed: true });
    expect(classifyStructuredAiRepair({ failureKind: "INVALID_JSON", repairsUsed: 1 })).toMatchObject({ allowed: false });
    expect(classifyStructuredAiRepair({ failureKind: "SAFETY_FAILURE", repairsUsed: 0 })).toMatchObject({ allowed: false });
  });

  it("makes cache boundaries stable across object key order and sensitive to versions", () => {
    const left = buildStructuredAiTrace({
      schemaVersion: "clips-v2",
      promptVersion: "selection-v3",
      model: "model-a",
      canonicalInput: { transcript: [{ start: 1, end: 2, text: "Grace" }], language: "en" },
    });
    const reordered = buildStructuredAiTrace({
      schemaVersion: "clips-v2",
      promptVersion: "selection-v3",
      model: "model-a",
      canonicalInput: { language: "en", transcript: [{ text: "Grace", end: 2, start: 1 }] },
    });
    const changedPrompt = buildStructuredAiTrace({
      schemaVersion: "clips-v2",
      promptVersion: "selection-v4",
      model: "model-a",
      canonicalInput: { language: "en", transcript: [{ text: "Grace", end: 2, start: 1 }] },
    });

    expect(left.inputFingerprint).toBe(reordered.inputFingerprint);
    expect(left.cacheBoundary).toBe(reordered.cacheBoundary);
    expect(changedPrompt.cacheBoundary).not.toBe(left.cacheBoundary);
  });
});
