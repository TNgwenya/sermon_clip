import { describe, expect, it } from "vitest";

import { resolveRuntimeDatabaseUrl, usesRuntimeDatabasePool } from "@/lib/databaseUrl";

describe("runtime database URL", () => {
  it("prefers the pooled application URL", () => {
    const environment = {
      DATABASE_POOL_URL: " postgresql://pooled.example/app ",
      DATABASE_URL: "postgresql://direct.example/app",
    };

    expect(resolveRuntimeDatabaseUrl(environment)).toBe("postgresql://pooled.example/app");
    expect(usesRuntimeDatabasePool(environment)).toBe(true);
  });

  it("keeps the direct URL as a safe fallback", () => {
    const environment = {
      DATABASE_POOL_URL: "  ",
      DATABASE_URL: " postgresql://direct.example/app ",
    };

    expect(resolveRuntimeDatabaseUrl(environment)).toBe("postgresql://direct.example/app");
    expect(usesRuntimeDatabasePool(environment)).toBe(false);
  });

  it("returns null when no database URL is configured", () => {
    expect(resolveRuntimeDatabaseUrl({})).toBeNull();
  });
});
