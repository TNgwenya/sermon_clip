import { revokeAllOwnSessions } from "@/server/auth/accountSecurity";

import {
  accountErrorResponse,
  accountJson,
  clearAccountSessionCookie,
  requireAccountRouteContext,
} from "../../_security";

type RevokeAllBody = {
  currentPassword?: unknown;
};

export async function POST(request: Request) {
  const authorized = await requireAccountRouteContext(request);
  if (authorized.error) return authorized.error;
  const body = await request.json().catch(() => null) as RevokeAllBody | null;
  if (!body || typeof body.currentPassword !== "string") {
    return accountJson(
      { success: false, message: "Enter your current password." },
      400,
    );
  }

  try {
    const result = await revokeAllOwnSessions(authorized.context, {
      currentPassword: body.currentPassword,
    });
    const response = accountJson({ success: true, ...result });
    clearAccountSessionCookie(response);
    return response;
  } catch (error) {
    return accountErrorResponse(error);
  }
}
