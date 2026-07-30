import { disableOwnTotp } from "@/server/auth/accountSecurity";

import {
  accountErrorResponse,
  accountJson,
  requireAccountRouteContext,
} from "../../_security";

type DisableBody = {
  currentPassword?: unknown;
  authenticationCode?: unknown;
};

export async function POST(request: Request) {
  const authorized = await requireAccountRouteContext(request);
  if (authorized.error) return authorized.error;
  const body = await request.json().catch(() => null) as DisableBody | null;
  if (
    !body
    || typeof body.currentPassword !== "string"
    || typeof body.authenticationCode !== "string"
  ) {
    return accountJson(
      {
        success: false,
        message: "Enter your password and authentication code.",
      },
      400,
    );
  }

  try {
    const result = await disableOwnTotp(authorized.context, {
      currentPassword: body.currentPassword,
      authenticationCode: body.authenticationCode,
    });
    return accountJson({ success: true, ...result });
  } catch (error) {
    return accountErrorResponse(error);
  }
}
