import { verifyOwnTotpEnrollment } from "@/server/auth/accountSecurity";

import {
  accountErrorResponse,
  accountJson,
  requireAccountRouteContext,
} from "../../_security";

type VerificationBody = {
  factorId?: unknown;
  code?: unknown;
};

export async function POST(request: Request) {
  const authorized = await requireAccountRouteContext(request);
  if (authorized.error) return authorized.error;
  const body = await request.json().catch(() => null) as VerificationBody | null;
  if (
    !body
    || typeof body.factorId !== "string"
    || typeof body.code !== "string"
  ) {
    return accountJson(
      { success: false, message: "Enter a valid authentication code." },
      400,
    );
  }

  try {
    const result = await verifyOwnTotpEnrollment(authorized.context, {
      factorId: body.factorId,
      code: body.code,
    });
    return accountJson({ success: true, ...result });
  } catch (error) {
    return accountErrorResponse(error);
  }
}
