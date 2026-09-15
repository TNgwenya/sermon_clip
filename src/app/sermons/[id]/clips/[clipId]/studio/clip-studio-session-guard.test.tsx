import { afterEach, describe, expect, it, vi } from "vitest";
import { checkStudioSession } from "./clip-studio-session-guard";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Studio session recovery", () => {
  it.each([
    ["original-user", "original-church", "active"],
    ["another-user", "original-church", "different"],
    ["original-user", "another-church", "different"],
  ])("accepts only the original account and church (%s, %s)", async (actorId, organizationId, state) => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ actorId, organizationId }));
    vi.stubGlobal("fetch", fetcher);
    expect(await checkStudioSession("original-user", "original-church")).toBe(state);
    expect(fetcher).toHaveBeenCalledWith("/api/studio/session", expect.objectContaining({
      credentials: "same-origin", cache: "no-store", signal: expect.any(AbortSignal),
    }));
  });

  it("recognizes expired sessions without navigating or reloading the editing tab", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    expect(await checkStudioSession("user", "church")).toBe("expired");
  });

  it("treats failed and malformed responses as connection failures", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response("<html>Sign in</html>"));
    vi.stubGlobal("fetch", fetcher);
    expect(await checkStudioSession("user", "church")).toBe("offline");
    expect(await checkStudioSession("user", "church")).toBe("offline");
  });

  it("bounds a stalled request so later connection checks can recover", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    })));
    const result = checkStudioSession("user", "church");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await result).toBe("offline");
    expect(vi.getTimerCount()).toBe(0);
  });
});
