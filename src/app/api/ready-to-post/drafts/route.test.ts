import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ clips: vi.fn(), authorize: vi.fn(), media: vi.fn(), preflight: vi.fn(), create: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { clipCandidate: { findMany: mocks.clips } } }));
vi.mock("@/server/auth/requestAuthorization", () => ({ requireRequestCapability: mocks.authorize }));
vi.mock("@/lib/readyMedia", () => ({ resolveReadyMedia: mocks.media }));
vi.mock("@/lib/publishingPreflightServer", () => ({ runPublishingPreflight: mocks.preflight }));
vi.mock("@/lib/postingDrafts", async (original) => ({ ...await original<typeof import("@/lib/postingDrafts")>(), createPostingDraft: mocks.create }));
import { POST } from "./route";
const request = () => new Request("https://example.test/api/ready-to-post/drafts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clipIds: ["clip-1"], platforms: ["Facebook"], automationMode: "AUTOMATIC", scheduledFor: "2099-09-16T10:00", timezone: "Africa/Johannesburg", socialAccountIdsByPlatform: { Facebook: ["page-1"] } }) });
describe("scheduling transcript review gate", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.authorize.mockResolvedValue({ actorId: "user-1", organizationId: "org-1", campusId: null }); mocks.media.mockResolvedValue({ mediaReady: true }); mocks.preflight.mockResolvedValue({ canSchedule: true, checks: [] }); mocks.create.mockResolvedValue({ id: "draft-1" }); });
  it("returns a specific review blocker and never creates a post before confirmation", async () => {
    mocks.clips.mockResolvedValue([{ id: "clip-1", transcriptSafetyStatus: "REVIEW_REQUIRED", exportStatus: "COMPLETED" }]);
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "TRANSCRIPT_REVIEW_REQUIRED", clipIds: ["clip-1"] });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.clips.mock.calls[0][0].where).not.toHaveProperty("transcriptSafetyStatus");
  });
  it("schedules reviewed media for the selected account and exact timezone-adjusted time", async () => {
    mocks.clips.mockResolvedValue([{ id: "clip-1", transcriptSafetyStatus: "REVIEWED", exportStatus: "COMPLETED" }]);
    const response = await POST(request());
    expect(response.status).toBe(201);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ socialAccountIdsByPlatform: { Facebook: ["page-1"] }, scheduledFor: new Date("2099-09-16T08:00:00Z"), tenantScope: { organizationId: "org-1", campusId: null } }));
  });
  it("still blocks a changed readiness result after transcript confirmation", async () => {
    mocks.clips.mockResolvedValue([{ id: "clip-1", transcriptSafetyStatus: "REVIEWED", exportStatus: "COMPLETED" }]);
    mocks.preflight.mockResolvedValue({ canSchedule: false, checks: [{ status: "BLOCKED", summary: "Reconnect the selected account." }] });
    const response = await POST(request());
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: "Reconnect the selected account." });
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
