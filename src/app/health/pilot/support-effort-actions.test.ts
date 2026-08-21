import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireRequestCapability: vi.fn(),
  loadRequestAuthorizationActor: vi.fn(),
  record: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/server/auth/requestAuthorization", () => ({
  requireRequestCapability: mocks.requireRequestCapability,
  loadRequestAuthorizationActor: mocks.loadRequestAuthorizationActor,
}));
vi.mock("@/server/pilotTelemetry/supportEffort", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/pilotTelemetry/supportEffort")>();
  return {
    ...actual,
    SupportEffortService: class {
      record = mocks.record;
    },
  };
});

import {
  recordPilotSupportEffortAction,
} from "./support-effort-actions";
import { pilotSupportActorFromPersistedAuthorization } from "./support-effort-action-helpers";

const context = {
  organizationId: "org-1",
  campusId: "campus-1",
  actorId: "user-1",
  authenticationMethod: "session" as const,
};

function form(overrides: Record<string, string> = {}): FormData {
  const values = {
    boardCategory: "OPERATIONAL",
    category: "PROCESSING",
    severity: "MEDIUM",
    status: "RESOLVED",
    minutes: "25",
    incidentDate: "2026-08-21",
    outcome: "OPERATOR_ASSISTED",
    ...overrides,
  };
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireRequestCapability.mockResolvedValue(context);
  mocks.loadRequestAuthorizationActor.mockResolvedValue({
    userId: "user-1",
    organizationId: "org-1",
    active: true,
    roleBindings: [{ role: "ORG_ADMIN", scope: { kind: "ORGANIZATION" }, expiresAt: null }],
  });
  mocks.record.mockResolvedValue({});
});

describe("pilot support effort action", () => {
  it("maps only allowlisted operational values and derives tenant, campus, actor and role from persisted auth", async () => {
    const data = form();
    data.set("organizationId", "org-attacker");
    data.set("campusId", "campus-attacker");
    data.set("actorUserId", "user-attacker");
    data.set("role", "OWNER");
    data.set("notes", "private incident detail");

    const result = await recordPilotSupportEffortAction({ success: false, message: "" }, data);

    expect(result.success).toBe(true);
    expect(mocks.requireRequestCapability).toHaveBeenCalledWith("analytics.read");
    expect(mocks.loadRequestAuthorizationActor).toHaveBeenCalledWith(context);
    expect(mocks.record).toHaveBeenCalledWith({
      actor: expect.objectContaining({
        actorUserId: "user-1",
        organizationId: "org-1",
        campusId: "campus-1",
        role: "ORG_ADMIN",
      }),
      scope: { organizationId: "org-1", campusId: "campus-1" },
      effort: {
        boardCategory: "OPERATIONAL",
        category: "PROCESSING",
        severity: "MEDIUM",
        status: "RESOLVED",
        minutes: 25,
        incidentDate: "2026-08-21",
        outcome: "OPERATOR_ASSISTED",
      },
    });
    expect(JSON.stringify(mocks.record.mock.calls[0])).not.toMatch(/attacker|private incident detail/u);
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/health/pilot");
  });

  it("rejects invalid enum and minute input before authorization or persistence", async () => {
    const result = await recordPilotSupportEffortAction(
      { success: false, message: "" },
      form({ boardCategory: "PRIVATE_DETAIL", category: "CUSTOM_FREE_TEXT", minutes: "12.5" }),
    );

    expect(result).toMatchObject({ success: false, fieldErrors: { boardCategory: expect.any(String), category: expect.any(String), minutes: expect.any(String) } });
    expect(mocks.requireRequestCapability).not.toHaveBeenCalled();
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("fails closed for a persisted actor outside the exact campus scope", async () => {
    mocks.loadRequestAuthorizationActor.mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      active: true,
      roleBindings: [{ role: "CAMPUS_ADMIN", scope: { kind: "CAMPUS", campusId: "campus-2" }, expiresAt: null }],
    });

    const result = await recordPilotSupportEffortAction({ success: false, message: "" }, form());
    expect(result).toMatchObject({ success: false, message: expect.stringContaining("cannot record") });
    expect(mocks.record).not.toHaveBeenCalled();
  });

  it("does not accept expired or non-recording persisted roles", () => {
    const expired = pilotSupportActorFromPersistedAuthorization({
      requestContext: context,
      now: new Date("2026-08-21T12:00:00.000Z"),
      authorizationActor: {
        userId: "user-1",
        organizationId: "org-1",
        active: true,
        roleBindings: [{ role: "ORG_ADMIN", scope: { kind: "ORGANIZATION" }, expiresAt: "2026-08-20T00:00:00.000Z" }],
      },
    });
    const analyst = pilotSupportActorFromPersistedAuthorization({
      requestContext: context,
      authorizationActor: {
        userId: "user-1",
        organizationId: "org-1",
        active: true,
        roleBindings: [{ role: "ANALYST", scope: { kind: "ORGANIZATION" }, expiresAt: null }],
      },
    });
    const invalidExpiry = pilotSupportActorFromPersistedAuthorization({
      requestContext: context,
      authorizationActor: {
        userId: "user-1",
        organizationId: "org-1",
        active: true,
        roleBindings: [{ role: "ORG_ADMIN", scope: { kind: "ORGANIZATION" }, expiresAt: "not-a-date" }],
      },
    });
    expect(expired).toBeNull();
    expect(analyst).toBeNull();
    expect(invalidExpiry).toBeNull();
  });
});
