import { describe, expect, it } from "vitest";

import {
  readTenantRequestContext,
  SERMONCLIP_ACTOR_HEADER,
  SERMONCLIP_AUTHENTICATION_HEADER,
  SERMONCLIP_CAMPUS_HEADER,
  SERMONCLIP_ORGANIZATION_HEADER,
} from "@/lib/tenancy/requestHeaders";

describe("tenant request context", () => {
  it("reads a trusted request context", () => {
    const headers = new Headers({
      [SERMONCLIP_ORGANIZATION_HEADER]: "org_one",
      [SERMONCLIP_CAMPUS_HEADER]: "campus_one",
      [SERMONCLIP_ACTOR_HEADER]: "user_one",
      [SERMONCLIP_AUTHENTICATION_HEADER]: "legacy-basic",
    });

    expect(readTenantRequestContext(headers)).toEqual({
      organizationId: "org_one",
      campusId: "campus_one",
      actorId: "user_one",
      authenticationMethod: "legacy-basic",
    });
  });

  it("accepts context established by a secure session", () => {
    const headers = new Headers({
      [SERMONCLIP_ORGANIZATION_HEADER]: "org_one",
      [SERMONCLIP_CAMPUS_HEADER]: "campus_one",
      [SERMONCLIP_ACTOR_HEADER]: "user_one",
      [SERMONCLIP_AUTHENTICATION_HEADER]: "session",
    });

    expect(readTenantRequestContext(headers)).toEqual({
      organizationId: "org_one",
      campusId: "campus_one",
      actorId: "user_one",
      authenticationMethod: "session",
    });
  });

  it("fails closed when identity was not established by the proxy", () => {
    expect(() => readTenantRequestContext(new Headers())).toThrow(
      "Missing trusted request context header",
    );
  });

  it("rejects unknown authentication methods", () => {
    const headers = new Headers({
      [SERMONCLIP_ORGANIZATION_HEADER]: "org_one",
      [SERMONCLIP_ACTOR_HEADER]: "user_one",
      [SERMONCLIP_AUTHENTICATION_HEADER]: "client-asserted",
    });

    expect(() => readTenantRequestContext(headers)).toThrow(
      "Unsupported trusted request authentication method",
    );
  });
});
