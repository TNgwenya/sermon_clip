import { describe, expect, it, vi } from "vitest";

const recordClick = vi.hoisted(() => vi.fn());

vi.mock("@/server/publicSermon/publicSermonService", () => ({
  recordPublicSermonCtaClick: recordClick,
}));

import { POST } from "@/app/api/public/sermons/[slug]/cta/route";

describe("public sermon CTA route", () => {
  it("redirects only to the validated destination returned by the service", async () => {
    recordClick.mockResolvedValue("https://church.example/visit");

    const response = await POST(
      new Request("https://sermonclip.example/api/public/sermons/hope/cta", { method: "POST" }),
      { params: Promise.resolve({ slug: "hope" }) },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://church.example/visit");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("returns not found when the page is not live or has no safe CTA", async () => {
    recordClick.mockResolvedValue(null);

    const response = await POST(
      new Request("https://sermonclip.example/api/public/sermons/draft/cta", { method: "POST" }),
      { params: Promise.resolve({ slug: "draft" }) },
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
