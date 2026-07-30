import { describe, expect, it } from "vitest";

import { AuthorizationError } from "@/server/auth/authorization";
import {
  AuthorizedResourceNotFoundError,
  ResourceAuthenticationRequiredError,
} from "@/server/auth/resourceAuthorization";
import { resourceAuthorizationErrorResponse } from "@/server/auth/resourceRouteAuthorization";

describe("resource route authorization responses", () => {
  it("returns an authentication challenge without disclosing a resource", async () => {
    const response = resourceAuthorizationErrorResponse(
      new ResourceAuthenticationRequiredError(),
      "Clip not found.",
    );

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toEqual({
      error: "Authentication is required.",
    });
  });

  it.each([
    new AuthorizedResourceNotFoundError(),
    new AuthorizationError("CAPABILITY_MISSING"),
  ])("collapses tenant and capability denials into the same not-found response", async (error) => {
    const response = resourceAuthorizationErrorResponse(error, "Clip not found.");

    expect(response?.status).toBe(404);
    await expect(response?.json()).resolves.toEqual({
      error: "Clip not found.",
    });
  });

  it("leaves unexpected infrastructure errors for framework error handling", () => {
    expect(resourceAuthorizationErrorResponse(
      new Error("database unavailable"),
      "Clip not found.",
    )).toBeNull();
  });
});
