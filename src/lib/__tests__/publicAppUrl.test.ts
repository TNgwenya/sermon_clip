import { afterEach, describe, expect, it, vi } from "vitest";

import { publicAppUrl } from "@/lib/publicAppUrl";

function request(
  url = "http://localhost:3000/api/auth/login",
  headers: HeadersInit = {},
): Request {
  return new Request(url, { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("publicAppUrl", () => {
  it("uses the server-only public origin when it is configured", () => {
    vi.stubEnv("APP_URL", "https://ec2.example.test");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://vercel.example.test");

    expect(publicAppUrl(request(), "/week-drafts").toString()).toBe(
      "https://ec2.example.test/week-drafts",
    );
  });

  it("falls back to the public client origin", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://app.example.test/");

    expect(publicAppUrl(request(), "/login?reset=complete").toString()).toBe(
      "https://app.example.test/login?reset=complete",
    );
  });

  it("uses trusted proxy headers when no origin is configured", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    expect(publicAppUrl(request(undefined, {
      host: "localhost:3000",
      "x-forwarded-host": "church.example.test",
      "x-forwarded-proto": "https",
    }), "/login").toString()).toBe("https://church.example.test/login");
  });

  it("falls back to the request URL for local development", () => {
    vi.stubEnv("APP_URL", "");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "");

    expect(publicAppUrl(request(), "/login").toString()).toBe(
      "http://localhost:3000/login",
    );
  });
});
