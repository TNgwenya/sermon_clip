import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { proxy } from "@/proxy";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("admin proxy", () => {
  it("fails closed in production when the admin password is missing", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "");
    vi.stubEnv("ALLOW_LOCAL_ADMIN_BYPASS", "true");

    const response = proxy(new NextRequest("https://church.example/sermons"));

    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-middleware-next")).toBeNull();
  });

  it("allows local development without an admin password", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "");

    const response = proxy(new NextRequest("http://localhost:3000/sermons"));

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("still requires valid Basic authentication when production is configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SCHEDULER_ADMIN_PASSWORD", "premium-password");
    const unauthorized = proxy(new NextRequest("https://church.example/sermons"));
    const authorization = `Basic ${Buffer.from("admin:premium-password").toString("base64")}`;
    const authorized = proxy(new NextRequest("https://church.example/sermons", {
      headers: { authorization },
    }));

    expect(unauthorized.status).toBe(401);
    expect(authorized.status).toBe(200);
    expect(authorized.headers.get("x-middleware-next")).toBe("1");
  });
});
