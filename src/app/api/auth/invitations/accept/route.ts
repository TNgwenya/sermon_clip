import { NextResponse } from "next/server";

import { publicAppUrl } from "@/lib/publicAppUrl";
import {
  completeInvitationOnboarding,
  InvitationOnboardingError,
} from "@/server/auth/invitationOnboarding";
import { getPrismaSessionService } from "@/server/auth/prismaSessionRepository";

function invitationFailure(request: Request, token: string, code: string) {
  const url = publicAppUrl(request, "/accept-invitation");
  if (token) url.searchParams.set("token", token);
  url.searchParams.set("error", code);
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  try {
    const accepted = await completeInvitationOnboarding({
      token,
      displayName: String(form.get("displayName") ?? ""),
      password: String(form.get("password") ?? ""),
    });
    const session = await getPrismaSessionService().createSession({
      userId: accepted.userId,
      organizationId: accepted.organizationId,
      campusId: accepted.campusId,
      userAgentHash: null,
      ipAddressHash: null,
    });
    const response = NextResponse.redirect(
      publicAppUrl(request, "/week-drafts?welcome=1"),
      { status: 303 },
    );
    response.headers.set("Set-Cookie", session.cookie);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof InvitationOnboardingError) {
      return invitationFailure(
        request,
        token,
        error.code.toLowerCase(),
      );
    }
    console.error("Invitation onboarding failed.", error);
    return invitationFailure(request, token, "temporarily_unavailable");
  }
}
