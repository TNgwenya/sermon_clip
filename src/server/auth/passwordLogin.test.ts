import { describe, expect, it } from "vitest";

import {
  PasswordLoginError,
  selectLoginWorkspace,
} from "@/server/auth/passwordLogin";

const now = new Date("2026-07-29T12:00:00.000Z");

function membership(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: "org_one",
    campusId: null,
    role: "OWNER" as const,
    status: "ACTIVE",
    expiresAt: null,
    organization: {
      slug: "hope-church",
      name: "Hope Church",
      status: "ACTIVE",
    },
    campus: null,
    ...overrides,
  };
}

describe("login workspace selection", () => {
  it("selects the only active workspace", () => {
    expect(selectLoginWorkspace([membership()], { now })).toMatchObject({
      organizationId: "org_one",
      organizationSlug: "hope-church",
      campusId: null,
    });
  });

  it("filters inactive and expired membership bindings", () => {
    expect(() => selectLoginWorkspace([
      membership({ status: "SUSPENDED" }),
      membership({ expiresAt: new Date("2026-07-28T00:00:00.000Z") }),
    ], { now })).toThrow(PasswordLoginError);
  });

  it("requires an explicit workspace when more than one church matches", () => {
    expect(() => selectLoginWorkspace([
      membership(),
      membership({
        organizationId: "org_two",
        organization: {
          slug: "grace-church",
          name: "Grace Church",
          status: "ACTIVE",
        },
      }),
    ], { now })).toThrowError(
      expect.objectContaining({ code: "WORKSPACE_REQUIRED" }),
    );
  });

  it("supports a campus-specific membership without granting another campus", () => {
    const selected = selectLoginWorkspace([
      membership({
        campusId: "campus_north",
        campus: {
          slug: "north",
          name: "North Campus",
          status: "ACTIVE",
          organizationId: "org_one",
        },
      }),
    ], {
      organizationSlug: "hope-church",
      campusSlug: "north",
      now,
    });

    expect(selected.campusId).toBe("campus_north");
  });
});
