import { revokeOwnSession } from "@/server/auth/accountSecurity";

import {
  accountErrorResponse,
  accountJson,
  clearAccountSessionCookie,
  requireAccountRouteContext,
} from "../../_security";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function DELETE(request: Request, route: RouteContext) {
  const authorized = await requireAccountRouteContext(request);
  if (authorized.error) return authorized.error;
  const { id } = await route.params;

  try {
    const result = await revokeOwnSession(authorized.context, id);
    const response = accountJson({ success: true, ...result });
    if (result.revokedCurrentSession) {
      clearAccountSessionCookie(response);
    }
    return response;
  } catch (error) {
    return accountErrorResponse(error);
  }
}
