import { NextResponse } from "next/server";

import { AuthorizationError } from "@/server/auth/authorization";
import {
  AuthorizedResourceNotFoundError,
  ResourceAuthenticationRequiredError,
} from "@/server/auth/resourceAuthorization";

type RouteAuthorizationHeaders = HeadersInit | undefined;

function privateNoStoreHeaders(headers?: RouteAuthorizationHeaders): Headers {
  const responseHeaders = new Headers(headers);
  if (!responseHeaders.has("Cache-Control")) {
    responseHeaders.set("Cache-Control", "private, no-store");
  }
  return responseHeaders;
}

/**
 * Converts expected resource-authorization failures into non-enumerating HTTP
 * responses. Unexpected persistence/runtime failures remain visible to the
 * framework's error handling instead of being misreported as missing records.
 */
export function resourceAuthorizationErrorResponse(
  error: unknown,
  notFoundMessage: string,
  headers?: RouteAuthorizationHeaders,
): NextResponse | null {
  const responseHeaders = privateNoStoreHeaders(headers);

  if (error instanceof ResourceAuthenticationRequiredError) {
    return NextResponse.json(
      { error: "Authentication is required." },
      { status: 401, headers: responseHeaders },
    );
  }

  if (
    error instanceof AuthorizedResourceNotFoundError
    || error instanceof AuthorizationError
  ) {
    return NextResponse.json(
      { error: notFoundMessage },
      { status: 404, headers: responseHeaders },
    );
  }

  return null;
}
