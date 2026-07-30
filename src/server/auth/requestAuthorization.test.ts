import { describe, expect, it } from "vitest";

import {
  BOOTSTRAP_OWNER_USER_ID,
  DEFAULT_CAMPUS_ID,
  DEFAULT_ORGANIZATION_ID,
  type TenantRequestContext,
} from "@/lib/tenancy/requestHeaders";
import {
  __requestAuthorizationTestUtils,
} from "@/server/auth/requestAuthorization";

function context(
  overrides: Partial<TenantRequestContext> = {},
): TenantRequestContext {
  return {
    organizationId: DEFAULT_ORGANIZATION_ID,
    campusId: DEFAULT_CAMPUS_ID,
    actorId: BOOTSTRAP_OWNER_USER_ID,
    authenticationMethod: "legacy-basic",
    ...overrides,
  };
}

describe("request authorization bridge", () => {
  it("does not map a persisted principal with a different actor id", () => {
    expect(__requestAuthorizationTestUtils.actorFromPersistedPrincipal(
      context(),
      {
        id: "user_other",
        status: "ACTIVE",
        memberships: [],
      },
    )).toBeNull();
  });

  it("maps active persisted memberships without trusting another organization", () => {
    const actor = __requestAuthorizationTestUtils.actorFromPersistedPrincipal(
      context(),
      {
        id: BOOTSTRAP_OWNER_USER_ID,
        status: "ACTIVE",
        memberships: [
          {
            organizationId: DEFAULT_ORGANIZATION_ID,
            campusId: null,
            role: "OWNER",
            status: "ACTIVE",
            expiresAt: null,
            organization: { status: "ACTIVE" },
            campus: null,
          },
          {
            organizationId: "org_other",
            campusId: null,
            role: "OWNER",
            status: "ACTIVE",
            expiresAt: null,
            organization: { status: "ACTIVE" },
            campus: null,
          },
        ],
      },
    );

    expect(actor).toMatchObject({
      active: true,
      organizationId: DEFAULT_ORGANIZATION_ID,
      roleBindings: [{ role: "OWNER", scope: { kind: "ORGANIZATION" } }],
    });
  });

  it("keeps suspended persisted users inactive", () => {
    expect(__requestAuthorizationTestUtils.actorFromPersistedPrincipal(
      context(),
      {
        id: BOOTSTRAP_OWNER_USER_ID,
        status: "SUSPENDED",
        memberships: [],
      },
    )).toMatchObject({ active: false });
  });

  it("rejects memberships in a suspended organization", () => {
    expect(__requestAuthorizationTestUtils.actorFromPersistedPrincipal(
      context(),
      {
        id: BOOTSTRAP_OWNER_USER_ID,
        status: "ACTIVE",
        memberships: [{
          organizationId: DEFAULT_ORGANIZATION_ID,
          campusId: null,
          role: "OWNER",
          status: "ACTIVE",
          expiresAt: null,
          organization: { status: "SUSPENDED" },
          campus: null,
        }],
      },
    )).toMatchObject({ roleBindings: [] });
  });

  it("rejects inactive campuses and campuses owned by another organization", () => {
    const memberships = [
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        campusId: DEFAULT_CAMPUS_ID,
        role: "CAMPUS_ADMIN",
        status: "ACTIVE",
        expiresAt: null,
        organization: { status: "ACTIVE" },
        campus: {
          organizationId: DEFAULT_ORGANIZATION_ID,
          status: "INACTIVE",
        },
      },
      {
        organizationId: DEFAULT_ORGANIZATION_ID,
        campusId: "campus_other",
        role: "CAMPUS_ADMIN",
        status: "ACTIVE",
        expiresAt: null,
        organization: { status: "ACTIVE" },
        campus: {
          organizationId: "org_other",
          status: "ACTIVE",
        },
      },
    ];

    expect(__requestAuthorizationTestUtils.actorFromPersistedPrincipal(
      context(),
      {
        id: BOOTSTRAP_OWNER_USER_ID,
        status: "ACTIVE",
        memberships,
      },
    )).toMatchObject({ roleBindings: [] });
  });

  it("requires the selected campus itself to be active in the request organization", () => {
    const requestContext = context();
    const selectedCampusIsValid = (
      campus: {
        id: string;
        organizationId: string;
        status: string;
      } | null,
    ) => __requestAuthorizationTestUtils.requestedCampusIsActiveForOrganization(
      requestContext,
      campus,
    );

    expect(selectedCampusIsValid({
      id: DEFAULT_CAMPUS_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      status: "ACTIVE",
    })).toBe(true);
    expect(selectedCampusIsValid({
      id: DEFAULT_CAMPUS_ID,
      organizationId: DEFAULT_ORGANIZATION_ID,
      status: "INACTIVE",
    })).toBe(false);
    expect(selectedCampusIsValid({
      id: DEFAULT_CAMPUS_ID,
      organizationId: "org_other",
      status: "ACTIVE",
    })).toBe(false);
    expect(selectedCampusIsValid(null)).toBe(false);
  });
});
