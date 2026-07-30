import { describe, expect, it, vi } from "vitest";

import type { TenantRequestContext } from "@/lib/tenancy/requestHeaders";
import {
  AuthorizedResourceNotFoundError,
  createResourceAuthorizationService,
} from "@/server/auth/resourceAuthorization";

const context: TenantRequestContext = {
  organizationId: "org_one",
  campusId: "campus_one",
  actorId: "user_one",
  authenticationMethod: "local-development",
};

function service(resource = {
  id: "resource_one",
  organizationId: "org_one",
  campusId: "campus_one",
}) {
  const authorize = vi.fn(async (requestContext) => requestContext);
  const repository = {
    findSermon: vi.fn(async () => resource),
    findClip: vi.fn(async () => resource),
    findContentAsset: vi.fn(async () => resource),
    findContentOpportunity: vi.fn(async () => resource),
  };
  return {
    authorize,
    repository,
    service: createResourceAuthorizationService(repository, authorize),
  };
}

describe("resource authorization loader", () => {
  it("loads inside trusted tenant scope before evaluating the exact resource", async () => {
    const fixture = service();

    await expect(fixture.service.authorizeClip(
      context,
      "content.read",
      "resource_one",
    )).resolves.toMatchObject({ id: "resource_one" });
    expect(fixture.repository.findClip).toHaveBeenCalledWith(
      context,
      "resource_one",
    );
    expect(fixture.authorize).toHaveBeenCalledWith(
      context,
      "content.read",
      {
        campusId: "campus_one",
        resource: {
          kind: "CONTENT_ITEM",
          id: "resource_one",
        },
      },
    );
  });

  it("does not invoke policy evaluation for a cross-tenant missing resource", async () => {
    const fixture = service(null as never);

    await expect(fixture.service.authorizeSermon(
      context,
      "sermons.read",
      "sermon_other",
    )).rejects.toBeInstanceOf(AuthorizedResourceNotFoundError);
    expect(fixture.authorize).not.toHaveBeenCalled();
  });

  it("rejects malformed identifiers before any database lookup", async () => {
    const fixture = service();

    await expect(fixture.service.authorizeContentAsset(
      context,
      "content.read",
      " asset ",
    )).rejects.toBeInstanceOf(AuthorizedResourceNotFoundError);
    expect(fixture.repository.findContentAsset).not.toHaveBeenCalled();
  });

  it("authorizes an opportunity as the exact content item", async () => {
    const fixture = service();

    await expect(fixture.service.authorizeContentOpportunity(
      context,
      "content.update",
      "resource_one",
    )).resolves.toMatchObject({ id: "resource_one" });
    expect(fixture.repository.findContentOpportunity).toHaveBeenCalledWith(
      context,
      "resource_one",
    );
    expect(fixture.authorize).toHaveBeenCalledWith(
      context,
      "content.update",
      {
        campusId: "campus_one",
        resource: {
          kind: "CONTENT_ITEM",
          id: "resource_one",
        },
      },
    );
  });
});
