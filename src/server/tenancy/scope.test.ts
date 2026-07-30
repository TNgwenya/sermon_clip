import { describe, expect, it } from "vitest";

import {
  organizationResourceScope,
  organizationScope,
  tenantResourceScope,
  tenantScope,
} from "@/server/tenancy/scope";

describe("organization query scope", () => {
  it("always takes the organization from trusted context", () => {
    const context = { organizationId: "org_one" };

    expect(organizationScope(context)).toEqual({
      organizationId: "org_one",
    });
    expect(organizationResourceScope(context, "sermon_one")).toEqual({
      id: "sermon_one",
      organizationId: "org_one",
    });
  });

  it("creates different predicates for the same resource in different organizations", () => {
    expect(organizationResourceScope(
      { organizationId: "org_one" },
      "shared-looking-id",
    )).not.toEqual(organizationResourceScope(
      { organizationId: "org_two" },
      "shared-looking-id",
    ));
  });

  it("rejects empty resource identifiers", () => {
    expect(() => organizationResourceScope(
      { organizationId: "org_one" },
      " ",
    )).toThrow("A resource id is required");
  });

  it("adds a campus predicate when trusted context selects a campus", () => {
    const context = { organizationId: "org_one", campusId: "campus_one" };

    expect(tenantScope(context)).toEqual({
      organizationId: "org_one",
      campusId: "campus_one",
    });
    expect(tenantResourceScope(context, "sermon_one")).toEqual({
      id: "sermon_one",
      organizationId: "org_one",
      campusId: "campus_one",
    });
  });

  it("keeps organization-wide context organization scoped", () => {
    expect(tenantScope({
      organizationId: "org_one",
      campusId: null,
    })).toEqual({ organizationId: "org_one" });
  });
});
