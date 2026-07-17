const RETRYABLE_PRISMA_CONNECTION_CODES = new Set([
  "P1001",
  "P1002",
  "P1008",
  "P1017",
]);

const RETRYABLE_CONNECTION_MESSAGE_PATTERNS = [
  /can't reach database server/i,
  /database server.*timed out/i,
  /server has closed the connection/i,
  /connection (?:closed|refused|reset|terminated)/i,
  /\b(?:EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b/i,
  /socket hang up/i,
];

function errorChain(error) {
  const errors = [];
  const visited = new Set();
  let current = error;

  while (current && (typeof current === "object" || typeof current === "function")) {
    if (visited.has(current)) break;
    visited.add(current);
    errors.push(current);
    current = current.cause;
  }

  return errors;
}

/**
 * Returns true only for errors that indicate the database connection is
 * temporarily unavailable. Schema, authentication, and migration errors stay
 * fatal so a deploy can never report success after skipping a failed migration.
 */
export function isRetryableDatabaseConnectionError(error) {
  return errorChain(error).some((candidate) => {
    const code = typeof candidate.code === "string" ? candidate.code : null;
    const errorCode = typeof candidate.errorCode === "string" ? candidate.errorCode : null;
    if (
      (code && RETRYABLE_PRISMA_CONNECTION_CODES.has(code))
      || (errorCode && RETRYABLE_PRISMA_CONNECTION_CODES.has(errorCode))
    ) {
      return true;
    }

    const message = typeof candidate.message === "string" ? candidate.message : "";
    return RETRYABLE_CONNECTION_MESSAGE_PATTERNS.some((pattern) => pattern.test(message));
  });
}

function validateRetryOptions({ maxAttempts, baseDelayMs, maxDelayMs }) {
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new TypeError("maxAttempts must be a positive integer.");
  }
  if (!Number.isFinite(baseDelayMs) || baseDelayMs < 0) {
    throw new TypeError("baseDelayMs must be a non-negative number.");
  }
  if (!Number.isFinite(maxDelayMs) || maxDelayMs < 0) {
    throw new TypeError("maxDelayMs must be a non-negative number.");
  }
}

function defaultSleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Retries a database operation with deterministic capped exponential backoff.
 * The original error is rethrown unchanged when it is fatal or attempts are
 * exhausted.
 */
export async function withDatabaseConnectionRetry(operation, options = {}) {
  const {
    maxAttempts = 4,
    baseDelayMs = 1_000,
    maxDelayMs = 8_000,
    sleep = defaultSleep,
    onRetry = () => undefined,
  } = options;

  validateRetryOptions({ maxAttempts, baseDelayMs, maxDelayMs });

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation({ attempt, maxAttempts });
    } catch (error) {
      if (!isRetryableDatabaseConnectionError(error) || attempt === maxAttempts) {
        throw error;
      }

      const delayMs = Math.min(maxDelayMs, baseDelayMs * (2 ** (attempt - 1)));
      await onRetry({
        attempt,
        nextAttempt: attempt + 1,
        maxAttempts,
        delayMs,
        error,
      });
      await sleep(delayMs);
    }
  }

  throw new Error("Database retry loop exited unexpectedly.");
}
