import { NextResponse } from "next/server";

import {
  AuthorizationError,
} from "@/server/auth/authorization";
import {
  AccountSecurityError,
  type AccountSecurityContext,
} from "@/server/auth/accountSecurity";
import {
  requirePersistedTenantCapability,
} from "@/server/auth/requestAuthorization";
import { getPrismaSessionService } from "@/server/auth/prismaSessionRepository";
import {
  clearSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/server/auth/sessionService";
import {
  readTenantRequestContext,
} from "@/lib/tenancy/requestHeaders";
import { publicAppUrl } from "@/lib/publicAppUrl";

type AccountContextResult =
  | Readonly<{ context: AccountSecurityContext; error?: never }>
  | Readonly<{ context?: never; error: NextResponse }>;

function cookieValue(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

function requestIsSameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return false;
  try {
    return new URL(origin).origin === publicAppUrl(request, "/").origin;
  } catch {
    return false;
  }
}

export async function requireAccountRouteContext(
  request: Request,
): Promise<AccountContextResult> {
  if (!requestIsSameOrigin(request)) {
    return {
      error: accountJson(
        { success: false, message: "The security request could not be verified." },
        403,
      ),
    };
  }

  let trustedContext;
  try {
    trustedContext = readTenantRequestContext(request.headers);
  } catch {
    return {
      error: accountJson(
        { success: false, message: "Authentication is required." },
        401,
      ),
    };
  }
  if (trustedContext.authenticationMethod !== "session") {
    return {
      error: accountJson(
        { success: false, message: "Sign in securely to manage your account." },
        401,
      ),
    };
  }

  try {
    await requirePersistedTenantCapability(
      trustedContext,
      "organization.read",
    );
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        error: accountJson(
          { success: false, message: "Authentication is required." },
          401,
        ),
      };
    }
    console.error("Account authorization lookup failed.", error);
    return {
      error: accountJson(
        { success: false, message: "Account security is temporarily unavailable." },
        503,
      ),
    };
  }

  const token = cookieValue(request, SESSION_COOKIE_NAME);
  if (!token) {
    return {
      error: accountJson(
        { success: false, message: "Authentication is required." },
        401,
      ),
    };
  }
  try {
    const session = await getPrismaSessionService().resolveSession(token);
    if (
      session.userId !== trustedContext.actorId
      || session.organizationId !== trustedContext.organizationId
      || session.campusId !== trustedContext.campusId
    ) {
      return {
        error: accountJson(
          { success: false, message: "Authentication is required." },
          401,
        ),
      };
    }
    return {
      context: {
        actorUserId: trustedContext.actorId,
        organizationId: trustedContext.organizationId,
        campusId: trustedContext.campusId,
        currentSessionId: session.sessionId,
        requestId: request.headers.get("x-request-id")?.trim() || null,
      },
    };
  } catch {
    return {
      error: accountJson(
        { success: false, message: "Authentication is required." },
        401,
      ),
    };
  }
}

export function accountJson(
  body: unknown,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Pragma": "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export function accountErrorResponse(error: unknown): NextResponse {
  if (!(error instanceof AccountSecurityError)) {
    console.error("Account security operation failed.", error);
    return accountJson(
      {
        success: false,
        message: "Account security is temporarily unavailable.",
      },
      503,
    );
  }
  switch (error.code) {
    case "INVALID_INPUT":
      return accountJson({ success: false, message: error.message }, 400);
    case "REAUTHENTICATION_FAILED":
      return accountJson(
        { success: false, message: "Your identity could not be verified." },
        403,
      );
    case "CONFLICT":
      return accountJson({ success: false, message: error.message }, 409);
    case "NOT_FOUND":
      return accountJson(
        {
          success: false,
          message: "The requested security record is unavailable.",
        },
        404,
      );
  }
}

export function clearAccountSessionCookie(response: NextResponse): void {
  response.headers.set("Set-Cookie", clearSessionCookie());
}

export const __accountRouteSecurityTestUtils = {
  cookieValue,
  requestIsSameOrigin,
};
