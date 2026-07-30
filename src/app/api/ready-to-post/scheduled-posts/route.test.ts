import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRequestCapability: vi.fn(),
  listScheduledPosts: vi.fn(),
  restoreScheduledPostStatus: vi.fn(),
  postScheduledPostNow: vi.fn(),
  updateScheduledPostSchedule: vi.fn(),
  updateScheduledPostStatus: vi.fn(),
  deleteScheduledPost: vi.fn(),
}));

vi.mock("@/server/auth/requestAuthorization", () => ({
  requireRequestCapability: mocks.requireRequestCapability,
}));

vi.mock("@/lib/scheduledPosts", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/scheduledPosts")>(),
  listScheduledPosts: mocks.listScheduledPosts,
  restoreScheduledPostStatus: mocks.restoreScheduledPostStatus,
  postScheduledPostNow: mocks.postScheduledPostNow,
  updateScheduledPostSchedule: mocks.updateScheduledPostSchedule,
  updateScheduledPostStatus: mocks.updateScheduledPostStatus,
  deleteScheduledPost: mocks.deleteScheduledPost,
}));

import {
  GET,
  PATCH,
} from "@/app/api/ready-to-post/scheduled-posts/route";

describe("scheduled-post publishing route tenant isolation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireRequestCapability.mockResolvedValue({
      actorId: "user-1",
      organizationId: "org-1",
      campusId: "campus-1",
      authenticationMethod: "session",
    });
    mocks.listScheduledPosts.mockResolvedValue([]);
    mocks.updateScheduledPostStatus.mockResolvedValue(null);
  });

  it("scopes publishing reads to the authenticated church and campus", async () => {
    const response = await GET(new Request(
      "https://app.example/api/ready-to-post/scheduled-posts"
        + "?scheduledPostId=post-other-tenant",
    ));

    expect(response.status).toBe(200);
    expect(mocks.requireRequestCapability).toHaveBeenCalledWith(
      "publishing.read",
    );
    expect(mocks.listScheduledPosts).toHaveBeenCalledWith({
      scheduledPostId: "post-other-tenant",
      contentAssetId: null,
      organizationId: "org-1",
      campusId: "campus-1",
      includeContentAssetFiles: false,
    });
  });

  it("passes tenant scope into id-based mutations and denies an absent match", async () => {
    const response = await PATCH(new Request(
      "https://app.example/api/ready-to-post/scheduled-posts",
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: "post-other-tenant",
          status: "SKIPPED",
        }),
      },
    ));

    expect(response.status).toBe(409);
    expect(mocks.requireRequestCapability).toHaveBeenCalledWith(
      "publishing.schedule",
    );
    expect(mocks.updateScheduledPostStatus).toHaveBeenCalledWith({
      tenantScope: {
        organizationId: "org-1",
        campusId: "campus-1",
      },
      id: "post-other-tenant",
      status: "SKIPPED",
    });
  });
});
