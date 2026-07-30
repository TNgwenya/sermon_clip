import { updateOwnProfile } from "@/server/auth/accountSecurity";

import {
  accountErrorResponse,
  accountJson,
  requireAccountRouteContext,
} from "../_security";

type ProfileBody = {
  displayName?: unknown;
  firstName?: unknown;
  lastName?: unknown;
  jobTitle?: unknown;
  phone?: unknown;
  timezone?: unknown;
};

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

export async function POST(request: Request) {
  const authorized = await requireAccountRouteContext(request);
  if (authorized.error) return authorized.error;
  const body = await request.json().catch(() => null) as ProfileBody | null;
  if (!body || typeof body.displayName !== "string") {
    return accountJson(
      { success: false, message: "Enter valid profile details." },
      400,
    );
  }

  try {
    const profile = await updateOwnProfile(authorized.context, {
      displayName: body.displayName,
      firstName: optionalString(body.firstName),
      lastName: optionalString(body.lastName),
      jobTitle: optionalString(body.jobTitle),
      phone: optionalString(body.phone),
      timezone: optionalString(body.timezone),
    });
    return accountJson({ success: true, profile });
  } catch (error) {
    return accountErrorResponse(error);
  }
}
