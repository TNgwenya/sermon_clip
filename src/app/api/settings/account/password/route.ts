import { changeOwnPassword } from "@/server/auth/accountSecurity";

import {
  accountErrorResponse,
  accountJson,
  requireAccountRouteContext,
} from "../_security";

type PasswordBody = {
  currentPassword?: unknown;
  newPassword?: unknown;
};

export async function POST(request: Request) {
  const authorized = await requireAccountRouteContext(request);
  if (authorized.error) return authorized.error;
  const body = await request.json().catch(() => null) as PasswordBody | null;
  if (
    !body
    || typeof body.currentPassword !== "string"
    || typeof body.newPassword !== "string"
  ) {
    return accountJson(
      { success: false, message: "Enter your current and new password." },
      400,
    );
  }

  try {
    const result = await changeOwnPassword(authorized.context, {
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    });
    return accountJson({ success: true, ...result });
  } catch (error) {
    return accountErrorResponse(error);
  }
}
