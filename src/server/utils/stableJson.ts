import crypto from "node:crypto";

export function stableJsonStringify(value: unknown): string {
  return JSON.stringify(normalizeStableJson(value));
}

export function hashStableJson(value: unknown): string {
  return crypto.createHash("sha256").update(stableJsonStringify(value)).digest("hex");
}

function normalizeStableJson(value: unknown): unknown {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(normalizeStableJson);
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nestedValue]) => [key, normalizeStableJson(nestedValue)]),
  );
}
