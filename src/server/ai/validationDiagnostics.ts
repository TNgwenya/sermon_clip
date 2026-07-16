import type { ZodError } from "zod";

const MAX_DIAGNOSTIC_LENGTH = 1_800;
const MAX_ISSUES = 5;
const MAX_RECEIVED_LENGTH = 240;
const MAX_EXPECTED_LENGTH = 480;

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const marker = "…[truncated]";
  return `${value.slice(0, Math.max(0, maxLength - marker.length))}${marker}`;
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function snapshotValue(value: unknown, depth = 0): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";

  if (typeof value === "string") {
    const sample = value.length > 640 ? `${value.slice(0, 640)}…` : value;
    return JSON.stringify(truncate(compactText(sample), 160));
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return `${value.toString()}n`;
  }
  if (typeof value === "symbol" || typeof value === "function") {
    return `[${typeof value}]`;
  }

  if (depth >= 2) {
    return Array.isArray(value) ? `Array(${value.length})` : "{...}";
  }

  if (Array.isArray(value)) {
    const shown = value.slice(0, 12).map((item) => snapshotValue(item, depth + 1));
    if (value.length > shown.length) {
      shown.push(`…+${value.length - shown.length}`);
    }
    return `[${shown.join(", ")}]`;
  }

  try {
    const entries = Object.entries(value as Record<string, unknown>);
    const shown = entries.slice(0, 8).map(([key, item]) => (
      `${JSON.stringify(key)}:${snapshotValue(item, depth + 1)}`
    ));
    if (entries.length > shown.length) {
      shown.push(`"…":"+${entries.length - shown.length} fields"`);
    }
    return `{${shown.join(", ")}}`;
  } catch {
    return "[unavailable]";
  }
}

function boundedSnapshot(value: unknown, maxLength: number): string {
  return truncate(snapshotValue(value), maxLength);
}

function valueAtPath(value: unknown, path: PropertyKey[]): unknown {
  let current = value;

  for (const part of path) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }

    if (!Object.prototype.hasOwnProperty.call(current, part)) {
      return undefined;
    }
    current = (current as Record<PropertyKey, unknown>)[part];
  }

  return current;
}

function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) {
    return "<root>";
  }

  return path.reduce<string>((formatted, part) => {
    if (typeof part === "number") {
      return `${formatted}[${part}]`;
    }

    const key = typeof part === "symbol" ? String(part) : part;
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
      return formatted ? `${formatted}.${key}` : key;
    }
    return `${formatted}[${JSON.stringify(key)}]`;
  }, "");
}

function describeExpected(issue: ZodError["issues"][number]): string | null {
  const details = issue as unknown as Record<string, unknown>;

  if (Array.isArray(details.values)) {
    return boundedSnapshot(details.values, MAX_EXPECTED_LENGTH);
  }
  if (details.expected !== undefined) {
    return boundedSnapshot(details.expected, MAX_EXPECTED_LENGTH);
  }
  if (issue.code === "too_small" && details.minimum !== undefined) {
    return `${String(details.origin ?? "value")} >= ${boundedSnapshot(details.minimum, 80)}`;
  }
  if (issue.code === "too_big" && details.maximum !== undefined) {
    return `${String(details.origin ?? "value")} <= ${boundedSnapshot(details.maximum, 80)}`;
  }
  if (issue.code === "invalid_format" && details.format !== undefined) {
    return `format ${boundedSnapshot(details.format, 120)}`;
  }
  if (issue.code === "unrecognized_keys" && Array.isArray(details.keys)) {
    return `recognized object keys; unexpected=${boundedSnapshot(details.keys, MAX_EXPECTED_LENGTH)}`;
  }

  return null;
}

export function formatZodValidationDiagnostics(error: ZodError, received: unknown): string {
  const issueDetails = error.issues.slice(0, MAX_ISSUES).map((issue) => {
    const path = issue.path as PropertyKey[];
    const expected = describeExpected(issue);
    return [
      `${formatPath(path)}: ${issue.code}`,
      `received=${boundedSnapshot(valueAtPath(received, path), MAX_RECEIVED_LENGTH)}`,
      expected ? `expected=${expected}` : null,
    ].filter(Boolean).join("; ");
  });

  if (error.issues.length > issueDetails.length) {
    issueDetails.push(`…${error.issues.length - issueDetails.length} additional issue(s)`);
  }

  return truncate(`AI response validation failed: ${issueDetails.join(" | ")}`, MAX_DIAGNOSTIC_LENGTH);
}

export function formatInvalidJsonDiagnostics(rawContent: string, error: unknown): string {
  const reason = error instanceof Error ? compactText(error.message) : "JSON parsing failed";
  const diagnostic = [
    "AI response JSON validation failed at <root>",
    `reason=${truncate(reason, 240)}`,
    `received=${boundedSnapshot(rawContent, MAX_RECEIVED_LENGTH)}`,
  ].join("; ");

  return truncate(diagnostic, MAX_DIAGNOSTIC_LENGTH);
}
