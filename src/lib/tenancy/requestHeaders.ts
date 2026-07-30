export const SERMONCLIP_ORGANIZATION_HEADER = "x-sermonclip-organization-id";
export const SERMONCLIP_CAMPUS_HEADER = "x-sermonclip-campus-id";
export const SERMONCLIP_ACTOR_HEADER = "x-sermonclip-actor-id";
export const SERMONCLIP_AUTHENTICATION_HEADER = "x-sermonclip-authentication";

export const DEFAULT_ORGANIZATION_ID = "org_local_default";
export const DEFAULT_CAMPUS_ID = "campus_local_default";
export const BOOTSTRAP_OWNER_USER_ID = "user_local_bootstrap";

export const SERMONCLIP_TRUSTED_REQUEST_HEADERS = [
  SERMONCLIP_ORGANIZATION_HEADER,
  SERMONCLIP_CAMPUS_HEADER,
  SERMONCLIP_ACTOR_HEADER,
  SERMONCLIP_AUTHENTICATION_HEADER,
] as const;

export type SermonClipAuthenticationMethod =
  | "legacy-basic"
  | "local-development"
  | "session";

export type TenantRequestContext = {
  organizationId: string;
  campusId: string | null;
  actorId: string;
  authenticationMethod: SermonClipAuthenticationMethod;
};

type HeaderReader = Pick<Headers, "get">;

function requiredHeader(headers: HeaderReader, name: string): string {
  const value = headers.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing trusted request context header: ${name}`);
  }
  return value;
}

export function readTenantRequestContext(headers: HeaderReader): TenantRequestContext {
  const authenticationMethod = requiredHeader(
    headers,
    SERMONCLIP_AUTHENTICATION_HEADER,
  );

  if (
    authenticationMethod !== "legacy-basic"
    && authenticationMethod !== "local-development"
    && authenticationMethod !== "session"
  ) {
    throw new Error("Unsupported trusted request authentication method.");
  }

  return {
    organizationId: requiredHeader(headers, SERMONCLIP_ORGANIZATION_HEADER),
    campusId: headers.get(SERMONCLIP_CAMPUS_HEADER)?.trim() || null,
    actorId: requiredHeader(headers, SERMONCLIP_ACTOR_HEADER),
    authenticationMethod,
  };
}
