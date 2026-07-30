import { NextResponse, type NextRequest } from "next/server";

import {
  clearSessionCookie,
  SESSION_COOKIE_NAME,
} from "@/server/auth/sessionService";
import { getPrismaSessionService } from "@/server/auth/prismaSessionRepository";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (token) {
    try {
      const service = getPrismaSessionService();
      const session = await service.resolveSession(token);
      await service.revokeSession(session.sessionId, "user_sign_out");
    } catch {
      // Signing out remains idempotent when a session is expired or revoked.
    }
  }

  const response = NextResponse.redirect(new URL("/login", request.url), {
    status: 303,
  });
  response.headers.set("Set-Cookie", clearSessionCookie());
  response.headers.set("Cache-Control", "no-store");
  return response;
}
