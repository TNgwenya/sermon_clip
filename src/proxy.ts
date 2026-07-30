import { NextResponse, type NextRequest } from "next/server";

import {
  BOOTSTRAP_OWNER_USER_ID,
  DEFAULT_CAMPUS_ID,
  DEFAULT_ORGANIZATION_ID,
  SERMONCLIP_ACTOR_HEADER,
  SERMONCLIP_AUTHENTICATION_HEADER,
  SERMONCLIP_CAMPUS_HEADER,
  SERMONCLIP_ORGANIZATION_HEADER,
  SERMONCLIP_TRUSTED_REQUEST_HEADERS,
  type SermonClipAuthenticationMethod,
} from "@/lib/tenancy/requestHeaders";
import { getPrismaSessionService } from "@/server/auth/prismaSessionRepository";
import { SESSION_COOKIE_NAME } from "@/server/auth/sessionService";

const PUBLIC_FILE_PATTERN = /\.(?:ico|png|jpg|jpeg|svg|webp|gif|css|js|map|txt|xml)$/i;

function unauthorized(): NextResponse {
  return NextResponse.json({
    error: "authentication_required",
    message: "Sign in to continue.",
  }, {
    status: 401,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function loginRedirect(request: NextRequest): NextResponse {
  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  const returnTo = `${request.nextUrl.pathname}${request.nextUrl.search}`;
  if (returnTo !== "/") {
    loginUrl.searchParams.set("returnTo", returnTo);
  }
  return NextResponse.redirect(loginUrl, { status: 307 });
}

function unauthenticatedResponse(request: NextRequest): NextResponse {
  const acceptsHtml = request.headers.get("accept")?.includes("text/html")
    ?? false;
  const isPageNavigation = request.method === "GET"
    && !request.nextUrl.pathname.startsWith("/api/")
    && (
      acceptsHtml
      || request.headers.get("sec-fetch-mode") === "navigate"
      || request.headers.get("sec-fetch-dest") === "document"
    );
  return isPageNavigation ? loginRedirect(request) : unauthorized();
}

function missingProductionConfiguration(): NextResponse {
  return new NextResponse("Service temporarily unavailable.", {
    status: 503,
    headers: {
      "Cache-Control": "no-store",
    },
  });
}

function isAuthorized(request: NextRequest, password: string): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("basic ")) {
    return false;
  }

  try {
    const decoded = atob(authorization.slice("basic ".length));
    const separatorIndex = decoded.indexOf(":");
    const submittedPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";
    return submittedPassword === password;
  } catch {
    return false;
  }
}

function headersWithoutTrustedContext(request: NextRequest): Headers {
  const requestHeaders = new Headers(request.headers);
  for (const header of SERMONCLIP_TRUSTED_REQUEST_HEADERS) {
    requestHeaders.delete(header);
  }
  return requestHeaders;
}

function nextWithoutTrustedContext(request: NextRequest): NextResponse {
  return NextResponse.next({
    request: { headers: headersWithoutTrustedContext(request) },
  });
}

function nextWithBootstrapContext(
  request: NextRequest,
  authenticationMethod: SermonClipAuthenticationMethod,
): NextResponse {
  const requestHeaders = headersWithoutTrustedContext(request);

  requestHeaders.set(SERMONCLIP_ORGANIZATION_HEADER, DEFAULT_ORGANIZATION_ID);
  requestHeaders.set(SERMONCLIP_CAMPUS_HEADER, DEFAULT_CAMPUS_ID);
  requestHeaders.set(SERMONCLIP_ACTOR_HEADER, BOOTSTRAP_OWNER_USER_ID);
  requestHeaders.set(SERMONCLIP_AUTHENTICATION_HEADER, authenticationMethod);

  return NextResponse.next({
    request: { headers: requestHeaders },
  });
}

function nextWithSessionContext(
  request: NextRequest,
  context: Readonly<{
    organizationId: string;
    campusId: string | null;
    userId: string;
  }>,
): NextResponse {
  const requestHeaders = headersWithoutTrustedContext(request);
  requestHeaders.set(SERMONCLIP_ORGANIZATION_HEADER, context.organizationId);
  if (context.campusId) {
    requestHeaders.set(SERMONCLIP_CAMPUS_HEADER, context.campusId);
  }
  requestHeaders.set(SERMONCLIP_ACTOR_HEADER, context.userId);
  requestHeaders.set(SERMONCLIP_AUTHENTICATION_HEADER, "session");
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function hasSecureSessionConfiguration(): boolean {
  const secret = process.env.SESSION_TOKEN_PEPPER?.trim()
    || process.env.AUTH_SECRET?.trim();
  return Boolean(secret && secret.length >= 32);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const password = process.env.SCHEDULER_ADMIN_PASSWORD?.trim();
  const localBypass = process.env.ALLOW_LOCAL_ADMIN_BYPASS === "true"
    && process.env.NODE_ENV !== "production";

  if (
    !hasSecureSessionConfiguration()
    && process.env.NODE_ENV === "production"
  ) {
    return missingProductionConfiguration();
  }

  const { pathname } = request.nextUrl;
  const tiktokVerificationPath = pathname.match(/^\/(tiktok[A-Za-z0-9]+\.txt)\/+$/);
  if (tiktokVerificationPath) {
    const url = request.nextUrl.clone();
    url.pathname = `/${tiktokVerificationPath[1]}`;
    return NextResponse.rewrite(url, {
      request: { headers: headersWithoutTrustedContext(request) },
    });
  }

  if (
    pathname.startsWith("/_next/")
    || pathname.startsWith("/api/automation/")
    || pathname === "/login"
    || pathname === "/login/"
    || pathname === "/forgot-password"
    || pathname === "/forgot-password/"
    || pathname === "/reset-password"
    || pathname === "/reset-password/"
    || pathname === "/accept-invitation"
    || pathname === "/accept-invitation/"
    || pathname === "/api/auth/login"
    || pathname === "/api/auth/password-reset/request"
    || pathname === "/api/auth/password-reset/complete"
    || pathname === "/api/auth/invitations/accept"
    || pathname === "/api/auth/logout"
    || /^\/s\/[^/]+\/?$/.test(pathname)
    || pathname.startsWith("/api/public/")
    || /^\/tiktok[A-Za-z0-9]+\.txt$/.test(pathname)
    || pathname === "/data-deletion"
    || pathname === "/data-deletion/"
    || pathname === "/privacy"
    || pathname === "/privacy/"
    || pathname === "/terms"
    || pathname === "/terms/"
    || pathname === "/favicon.ico"
    || PUBLIC_FILE_PATTERN.test(pathname)
  ) {
    return nextWithoutTrustedContext(request);
  }

  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (sessionToken && hasSecureSessionConfiguration()) {
    try {
      const session = await getPrismaSessionService().resolveSession(sessionToken);
      return nextWithSessionContext(request, session);
    } catch {
      // Invalid, expired, revoked, or deactivated sessions receive no identity.
    }
  }

  if (!password || localBypass) {
    if (process.env.NODE_ENV === "production") {
      return unauthenticatedResponse(request);
    }
    return nextWithBootstrapContext(request, "local-development");
  }

  if (process.env.NODE_ENV === "production") {
    return unauthenticatedResponse(request);
  }

  return isAuthorized(request, password)
    ? nextWithBootstrapContext(request, "legacy-basic")
    : unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
