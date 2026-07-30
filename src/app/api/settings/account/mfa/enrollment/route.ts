import { beginOwnTotpEnrollment } from "@/server/auth/accountSecurity";

import {
  accountErrorResponse,
  accountJson,
  requireAccountRouteContext,
} from "../../_security";

type EnrollmentBody = {
  currentPassword?: unknown;
};

export async function POST(request: Request) {
  const authorized = await requireAccountRouteContext(request);
  if (authorized.error) return authorized.error;
  const body = await request.json().catch(() => null) as EnrollmentBody | null;
  if (!body || typeof body.currentPassword !== "string") {
    return accountJson(
      { success: false, message: "Enter your current password." },
      400,
    );
  }

  try {
    const enrollment = await beginOwnTotpEnrollment(authorized.context, {
      currentPassword: body.currentPassword,
    });
    return accountJson({ success: true, enrollment }, 201);
  } catch (error) {
    return accountErrorResponse(error);
  }
}
