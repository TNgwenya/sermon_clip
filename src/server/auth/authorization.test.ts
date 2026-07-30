import { describe, expect, it } from "vitest";

import {
  AUTHORIZATION_CAPABILITIES,
  ORGANIZATION_ROLES,
  ROLE_CAPABILITIES,
  AuthorizationError,
  canActor,
  evaluateAuthorization,
  requireActorCapability,
  roleHasCapability,
  scopeAllowsContext,
  type AuthorizationActor,
  type AuthorizationCapability,
  type AuthorizationContext,
  type OrganizationRole,
} from "@/server/auth/authorization";

const EXPECTED_CAPABILITIES_BY_ROLE = {
  OWNER: AUTHORIZATION_CAPABILITIES,
  ORG_ADMIN: [
    "organization.read", "organization.update", "billing.read",
    "members.read", "members.manage", "invitations.manage",
    "campuses.read", "campuses.manage", "brand.read", "brand.manage",
    "sermons.read", "sermons.create", "sermons.update", "sermons.delete",
    "content.read", "content.create", "content.update", "content.delete",
    "content.export", "assignments.read", "assignments.manage",
    "comments.read", "comments.create", "comments.moderate",
    "approvals.read", "approvals.request", "approval_policies.manage",
    "channels.read", "channels.connect", "channels.manage",
    "calendar.read", "calendar.manage", "publishing.read",
    "analytics.read", "analytics.export", "audit.read", "audit.export",
  ],
  CAMPUS_ADMIN: [
    "organization.read", "members.read", "members.manage",
    "invitations.manage", "campuses.read", "campuses.manage", "brand.read",
    "brand.manage", "sermons.read", "sermons.create", "sermons.update",
    "sermons.delete", "content.read", "content.create", "content.update",
    "content.delete", "content.export", "assignments.read",
    "assignments.manage", "comments.read", "comments.create",
    "comments.moderate", "approvals.read", "approvals.request",
    "channels.read", "channels.connect", "channels.manage", "calendar.read",
    "calendar.manage", "publishing.read", "analytics.read",
    "analytics.export", "audit.read",
  ],
  PASTOR_APPROVER: [
    "organization.read", "campuses.read", "brand.read", "sermons.read",
    "content.read", "assignments.read", "comments.read", "comments.create",
    "approvals.read", "approvals.request", "approvals.decide",
    "calendar.read", "publishing.read", "analytics.read",
  ],
  CONTENT_LEAD: [
    "organization.read", "campuses.read", "brand.read", "sermons.read",
    "sermons.create", "sermons.update", "content.read", "content.create",
    "content.update", "content.delete", "content.export", "assignments.read",
    "assignments.manage", "comments.read", "comments.create",
    "comments.moderate", "approvals.read", "approvals.request",
    "channels.read", "calendar.read", "calendar.manage", "publishing.read",
    "analytics.read",
  ],
  EDITOR: [
    "organization.read", "campuses.read", "brand.read", "sermons.read",
    "content.read", "content.create", "content.update", "content.export",
    "assignments.read", "comments.read", "comments.create", "approvals.read",
    "approvals.request", "channels.read", "calendar.read",
  ],
  PUBLISHER: [
    "organization.read", "campuses.read", "brand.read", "sermons.read",
    "content.read", "content.export", "assignments.read", "comments.read",
    "comments.create", "approvals.read", "channels.read", "channels.connect",
    "channels.manage", "calendar.read", "calendar.manage", "publishing.read",
    "publishing.schedule", "publishing.publish", "publishing.reconcile",
    "analytics.read",
  ],
  ANALYST: [
    "organization.read", "campuses.read", "brand.read", "sermons.read",
    "content.read", "calendar.read", "publishing.read", "analytics.read",
    "analytics.export",
  ],
  VIEWER: [
    "organization.read", "campuses.read", "brand.read", "sermons.read",
    "content.read", "assignments.read", "comments.read", "approvals.read",
    "channels.read", "calendar.read", "publishing.read", "analytics.read",
  ],
  EXTERNAL_CONTRACTOR: [
    "organization.read", "campuses.read", "brand.read", "sermons.read",
    "content.read", "content.create", "content.update", "content.export",
    "assignments.read", "comments.read", "comments.create", "approvals.read",
    "approvals.request", "channels.read", "calendar.read",
  ],
} as const satisfies Readonly<
  Record<OrganizationRole, readonly AuthorizationCapability[]>
>;

const organizationContext: AuthorizationContext = {
  organizationId: "org-a",
  campusId: null,
  resource: null,
};

function actor(
  overrides: Partial<AuthorizationActor> = {},
): AuthorizationActor {
  return {
    userId: "user-a",
    organizationId: "org-a",
    active: true,
    roleBindings: [{
      role: "OWNER",
      scope: { kind: "ORGANIZATION" },
    }],
    ...overrides,
  };
}

describe("role capability matrix", () => {
  it("defines an exact, exhaustive capability set for every role", () => {
    expect(Object.keys(ROLE_CAPABILITIES).sort()).toEqual(
      [...ORGANIZATION_ROLES].sort(),
    );

    for (const role of ORGANIZATION_ROLES) {
      const expected = new Set<AuthorizationCapability>(
        EXPECTED_CAPABILITIES_BY_ROLE[role],
      );

      expect(new Set(ROLE_CAPABILITIES[role]), role).toEqual(expected);
      expect(ROLE_CAPABILITIES[role].length, `${role} has duplicates`).toBe(
        expected.size,
      );

      for (const capability of AUTHORIZATION_CAPABILITIES) {
        expect(
          roleHasCapability(role, capability),
          `${role} / ${capability}`,
        ).toBe(expected.has(capability));
      }
    }
  });

  it("keeps theology approval and public publishing separate", () => {
    expect(roleHasCapability("PASTOR_APPROVER", "approvals.decide")).toBe(true);
    expect(roleHasCapability("PASTOR_APPROVER", "publishing.publish")).toBe(false);
    expect(roleHasCapability("PUBLISHER", "publishing.publish")).toBe(true);
    expect(roleHasCapability("PUBLISHER", "approvals.decide")).toBe(false);
    expect(roleHasCapability("ORG_ADMIN", "approvals.decide")).toBe(false);
    expect(roleHasCapability("ORG_ADMIN", "publishing.publish")).toBe(false);
  });

  it("fails closed for unknown roles and capabilities", () => {
    expect(roleHasCapability("SUPER_ADMIN", "organization.read")).toBe(false);
    expect(roleHasCapability("OWNER", "system.root")).toBe(false);
    expect(roleHasCapability(null, null)).toBe(false);
  });
});

describe("organization and campus isolation", () => {
  it("allows an organization-scoped role inside its own organization", () => {
    expect(canActor(
      actor(),
      "content.read",
      {
        organizationId: "org-a",
        campusId: "campus-a",
        resource: { kind: "CONTENT_ITEM", id: "content-a" },
      },
    )).toBe(true);
  });

  it("denies every cross-organization access attempt before role evaluation", () => {
    for (const role of ORGANIZATION_ROLES) {
      const roleBindings: AuthorizationActor["roleBindings"] = role === "CAMPUS_ADMIN"
        ? [{ role, scope: { kind: "CAMPUS", campusId: "campus-a" } }]
        : role === "EXTERNAL_CONTRACTOR"
          ? [{
              role,
              scope: { kind: "CAMPUS", campusId: "campus-a" },
              expiresAt: "2030-01-01T00:00:00.000Z",
            }]
          : [{
              role,
              scope: role === "OWNER" || role === "ORG_ADMIN"
                ? { kind: "ORGANIZATION" }
                : { kind: "CAMPUS", campusId: "campus-a" },
            }];

      const decision = evaluateAuthorization(
        actor({ roleBindings }),
        "organization.read",
        { organizationId: "org-b", campusId: "campus-a", resource: null },
        { now: new Date("2029-01-01T00:00:00.000Z") },
      );

      expect(decision, role).toEqual({
        allowed: false,
        reason: "ORGANIZATION_MISMATCH",
      });
    }
  });

  it("allows campus roles only in their exact campus", () => {
    const campusActor = actor({
      roleBindings: [{
        role: "CAMPUS_ADMIN",
        scope: { kind: "CAMPUS", campusId: "campus-a" },
      }],
    });

    expect(canActor(
      campusActor,
      "content.update",
      {
        organizationId: "org-a",
        campusId: "campus-a",
        resource: { kind: "CONTENT_ITEM", id: "content-a" },
      },
    )).toBe(true);
    expect(evaluateAuthorization(
      campusActor,
      "content.update",
      {
        organizationId: "org-a",
        campusId: "campus-b",
        resource: { kind: "CONTENT_ITEM", id: "content-b" },
      },
    )).toEqual({ allowed: false, reason: "SCOPE_MISMATCH" });
    expect(canActor(campusActor, "campuses.read", organizationContext)).toBe(false);
  });

  it("does not accept an organization-scoped campus administrator binding", () => {
    const malformedActor = actor({
      roleBindings: [{
        role: "CAMPUS_ADMIN",
        scope: { kind: "ORGANIZATION" },
      }],
    });

    expect(canActor(malformedActor, "content.read", organizationContext)).toBe(false);
  });
});

describe("resource isolation", () => {
  const scopedContractor = actor({
    roleBindings: [{
      role: "EXTERNAL_CONTRACTOR",
      scope: {
        kind: "RESOURCE",
        campusId: "campus-a",
        resource: { kind: "CONTENT_ITEM", id: "content-a" },
      },
      expiresAt: "2030-01-01T00:00:00.000Z",
    }],
  });

  it("allows only the exact resource kind, id, and campus", () => {
    const exactContext: AuthorizationContext = {
      organizationId: "org-a",
      campusId: "campus-a",
      resource: { kind: "CONTENT_ITEM", id: "content-a" },
    };

    expect(canActor(
      scopedContractor,
      "content.update",
      exactContext,
      { now: new Date("2029-01-01T00:00:00.000Z") },
    )).toBe(true);

    const mismatches: AuthorizationContext[] = [
      { ...exactContext, campusId: "campus-b" },
      {
        ...exactContext,
        resource: { kind: "CONTENT_ITEM", id: "content-b" },
      },
      {
        ...exactContext,
        resource: { kind: "SERMON", id: "content-a" },
      },
      { ...exactContext, resource: null },
    ];

    for (const context of mismatches) {
      expect(canActor(
        scopedContractor,
        "content.update",
        context,
        { now: new Date("2029-01-01T00:00:00.000Z") },
      ), JSON.stringify(context)).toBe(false);
    }
  });

  it("allows a second valid binding without widening the first binding", () => {
    const multiCampusEditor = actor({
      roleBindings: [
        {
          role: "EDITOR",
          scope: { kind: "CAMPUS", campusId: "campus-a" },
        },
        {
          role: "EDITOR",
          scope: { kind: "CAMPUS", campusId: "campus-b" },
        },
      ],
    });

    expect(canActor(
      multiCampusEditor,
      "content.update",
      { organizationId: "org-a", campusId: "campus-b", resource: null },
    )).toBe(true);
    expect(canActor(
      multiCampusEditor,
      "content.update",
      { organizationId: "org-a", campusId: "campus-c", resource: null },
    )).toBe(false);
  });

  it("rejects malformed scopes rather than treating them as organization scope", () => {
    expect(scopeAllowsContext(
      { kind: "CAMPUS", campusId: "" },
      organizationContext,
    )).toBe(false);
    expect(scopeAllowsContext(
      { kind: "RESOURCE", campusId: null, resource: { kind: "SERMON", id: "" } },
      organizationContext,
    )).toBe(false);
  });
});

describe("actor lifecycle and fail-closed behavior", () => {
  it("denies inactive actors", () => {
    expect(evaluateAuthorization(
      actor({ active: false }),
      "content.read",
      organizationContext,
    )).toEqual({ allowed: false, reason: "INACTIVE_ACTOR" });
  });

  it("requires contractors to be scoped and unexpired", () => {
    const missingExpiry = actor({
      roleBindings: [{
        role: "EXTERNAL_CONTRACTOR",
        scope: { kind: "CAMPUS", campusId: "campus-a" },
      }],
    });
    const expired = actor({
      roleBindings: [{
        role: "EXTERNAL_CONTRACTOR",
        scope: { kind: "CAMPUS", campusId: "campus-a" },
        expiresAt: "2028-12-31T23:59:59.000Z",
      }],
    });
    const organizationScoped = actor({
      roleBindings: [{
        role: "EXTERNAL_CONTRACTOR",
        scope: { kind: "ORGANIZATION" },
        expiresAt: "2030-01-01T00:00:00.000Z",
      }],
    });
    const context: AuthorizationContext = {
      organizationId: "org-a",
      campusId: "campus-a",
      resource: null,
    };
    const now = new Date("2029-01-01T00:00:00.000Z");

    expect(canActor(missingExpiry, "content.read", context, { now })).toBe(false);
    expect(canActor(expired, "content.read", context, { now })).toBe(false);
    expect(canActor(organizationScoped, "content.read", context, { now })).toBe(false);
  });

  it("honors optional expiry for internal roles", () => {
    const temporaryEditor = actor({
      roleBindings: [{
        role: "EDITOR",
        scope: { kind: "CAMPUS", campusId: "campus-a" },
        expiresAt: "2029-01-02T00:00:00.000Z",
      }],
    });
    const context: AuthorizationContext = {
      organizationId: "org-a",
      campusId: "campus-a",
      resource: null,
    };

    expect(canActor(
      temporaryEditor,
      "content.update",
      context,
      { now: new Date("2029-01-01T00:00:00.000Z") },
    )).toBe(true);
    expect(canActor(
      temporaryEditor,
      "content.update",
      context,
      { now: new Date("2029-01-02T00:00:00.000Z") },
    )).toBe(false);
  });

  it("rejects invalid actor and context identifiers", () => {
    expect(evaluateAuthorization(
      actor({ userId: " " }),
      "content.read",
      organizationContext,
    )).toEqual({ allowed: false, reason: "INVALID_ACTOR" });
    expect(evaluateAuthorization(
      actor(),
      "content.read",
      { ...organizationContext, organizationId: "" },
    )).toEqual({ allowed: false, reason: "INVALID_CONTEXT" });
  });

  it("throws a typed, non-disclosing error from the assertion helper", () => {
    expect(() => requireActorCapability(
      actor({
        roleBindings: [{
          role: "VIEWER",
          scope: { kind: "CAMPUS", campusId: "campus-a" },
        }],
      }),
      "content.update",
      { organizationId: "org-a", campusId: "campus-a", resource: null },
    )).toThrowError(AuthorizationError);

    try {
      requireActorCapability(
        undefined,
        "content.read",
        organizationContext,
      );
    } catch (error) {
      expect(error).toMatchObject({
        name: "AuthorizationError",
        reason: "INVALID_ACTOR",
        message: "The actor is not authorized to perform this action.",
      });
    }
  });
});
