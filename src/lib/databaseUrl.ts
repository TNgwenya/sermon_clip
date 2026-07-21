type DatabaseEnvironment = {
  DATABASE_POOL_URL?: string;
  DATABASE_URL?: string;
};

function normalizedUrl(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function resolveRuntimeDatabaseUrl(environment: DatabaseEnvironment = process.env as DatabaseEnvironment): string | null {
  return normalizedUrl(environment.DATABASE_POOL_URL)
    ?? normalizedUrl(environment.DATABASE_URL);
}

export function usesRuntimeDatabasePool(environment: DatabaseEnvironment = process.env as DatabaseEnvironment): boolean {
  return normalizedUrl(environment.DATABASE_POOL_URL) !== null;
}
