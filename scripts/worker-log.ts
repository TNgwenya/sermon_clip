type LogLevel = "info" | "success" | "warn" | "error";

type LogFields = Record<string, unknown>;

type WorkerLogger = {
  banner: (title: string, fields?: LogFields) => void;
  info: (message: string, fields?: LogFields) => void;
  success: (message: string, fields?: LogFields) => void;
  warn: (message: string, fields?: LogFields) => void;
  error: (message: string, fields?: LogFields) => void;
};

const levelLabels: Record<LogLevel, string> = {
  info: "INFO",
  success: "DONE",
  warn: "WARN",
  error: "FAIL",
};

const levelColors: Record<LogLevel, string> = {
  info: "\x1b[36m",
  success: "\x1b[32m",
  warn: "\x1b[33m",
  error: "\x1b[31m",
};

const mutedColor = "\x1b[90m";
const resetColor = "\x1b[0m";

function colorEnabled(): boolean {
  return Boolean(process.stdout.isTTY && !process.env.NO_COLOR);
}

function colorize(value: string, color: string): string {
  return colorEnabled() ? `${color}${value}${resetColor}` : value;
}

function timestamp(now = new Date()): string {
  return now.toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
}

function truncate(value: string, maxLength = 180): string {
  if (value.length <= maxLength) {
    return value;
  }

  if (maxLength <= 3) {
    return ".".repeat(Math.max(0, maxLength));
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function errorCode(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = String((error as { code?: unknown }).code ?? "").trim();
  return code || undefined;
}

function errorCause(error: Error): string | undefined {
  if (error.cause === undefined || error.cause === null) {
    return undefined;
  }

  const cause = error.cause;
  if (cause instanceof Error) {
    const code = errorCode(cause);
    return truncate(`${cause.name}${code ? ` [${code}]` : ""}: ${cause.message}`, 360);
  }

  if (typeof cause === "string") {
    return truncate(cause, 360);
  }

  try {
    return truncate(JSON.stringify(cause), 360);
  } catch {
    return truncate(String(cause), 360);
  }
}

function shortStack(error: Error): string | undefined {
  const lines = error.stack
    ?.split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);

  return lines && lines.length > 0 ? truncate(lines.join(" | "), 1_000) : undefined;
}

function formatValue(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (value instanceof Error) {
    return truncate(value.message);
  }

  if (typeof value === "string") {
    return /\s/.test(value) ? JSON.stringify(truncate(value)) : truncate(value);
  }

  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }

  try {
    return truncate(JSON.stringify(value));
  } catch {
    return truncate(String(value));
  }
}

function compactFields(fields?: LogFields): string {
  if (!fields) {
    return "";
  }

  return Object.entries(fields)
    .map(([key, value]) => {
      const formattedValue = formatValue(value);
      return formattedValue ? `${key}=${formattedValue}` : null;
    })
    .filter((entry): entry is string => Boolean(entry))
    .join(" ");
}

function print(level: LogLevel, workerName: string, message: string, fields?: LogFields): void {
  const time = colorize(timestamp(), mutedColor);
  const worker = colorize(workerName.padEnd(7), mutedColor);
  const label = colorize(levelLabels[level].padEnd(4), levelColors[level]);
  const details = compactFields(fields);
  const suffix = details ? `  ${details}` : "";

  console.log(`${time} ${worker} ${label} ${message}${suffix}`);
}

export function createWorkerLogger(workerName: string): WorkerLogger {
  return {
    banner(title, fields) {
      print("info", workerName, title, fields);
    },
    info(message, fields) {
      print("info", workerName, message, fields);
    },
    success(message, fields) {
      print("success", workerName, message, fields);
    },
    warn(message, fields) {
      print("warn", workerName, message, fields);
    },
    error(message, fields) {
      print("error", workerName, message, fields);
    },
  };
}

export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) {
    return "0ms";
  }

  if (milliseconds < 1000) {
    return `${Math.round(milliseconds)}ms`;
  }

  const seconds = milliseconds / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 || value >= 10 ? 0 : 1)}${units[unitIndex]}`;
}

export function errorFields(error: unknown): LogFields {
  const message = error instanceof Error ? error.message : String(error);
  const code = errorCode(error);

  return {
    error: truncate(message, 1_000),
    name: error instanceof Error ? error.name : typeof error,
    code,
    cause: error instanceof Error ? errorCause(error) : undefined,
    stack: error instanceof Error ? shortStack(error) : undefined,
  };
}

/**
 * Builds one readable, bounded line for persistence in a ProcessingJob log.
 * Console output remains compact, while the database retains enough context to
 * correlate a failure with its worker claim and a short stack trace.
 */
export function formatDiagnosticLogEntry(
  message: string,
  fields: LogFields,
  maxLength = 2_000,
): string {
  const normalizedMaxLength = Number.isFinite(maxLength) && maxLength > 0
    ? Math.floor(maxLength)
    : 2_000;
  const details = compactFields(fields);
  return truncate(details ? `${message}. ${details}` : message, normalizedMaxLength);
}
