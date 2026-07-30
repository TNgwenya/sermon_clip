import { createHmac } from "node:crypto";

import { NextResponse } from "next/server";

import {
  authenticatePasswordLogin,
  PasswordLoginError,
} from "@/server/auth/passwordLogin";
import { getPrismaSessionService } from "@/server/auth/prismaSessionRepository";

function safeReturnPath(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "/";
  const path = value.trim();
  return path.startsWith("/") && !path.startsWith("//") ? path : "/";
}

function privacyHash(value: string | null): string | null {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!value || !secret || secret.length < 32) {
    return null;
  }
  return createHmac("sha256", secret).update(value).digest("hex");
}

function loginFailure(
  request: Request,
  returnTo: string,
  code: string,
): NextResponse {
  const url = new URL("/login", request.url);
  url.searchParams.set("error", code);
  if (returnTo !== "/") {
    url.searchParams.set("returnTo", returnTo);
  }
  return NextResponse.redirect(url, { status: 303 });
}

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");
  const organizationSlug = String(form.get("organization") ?? "");
  const campusSlug = String(form.get("campus") ?? "");
  const totpCode = String(form.get("totpCode") ?? "");
  const recoveryCode = String(form.get("recoveryCode") ?? "");
  const returnTo = safeReturnPath(form.get("returnTo"));

  try {
    const authenticated = await authenticatePasswordLogin({
      email,
      password,
      organizationSlug: organizationSlug || null,
      campusSlug: campusSlug || null,
      totpCode: totpCode || null,
      recoveryCode: recoveryCode || null,
    });
    const session = await getPrismaSessionService().createSession({
      userId: authenticated.userId,
      organizationId: authenticated.workspace.organizationId,
      campusId: authenticated.workspace.campusId,
      ipAddressHash: privacyHash(
        request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      ),
      userAgentHash: privacyHash(request.headers.get("user-agent")),
    });
    const response = NextResponse.redirect(new URL(returnTo, request.url), {
      status: 303,
    });
    response.headers.set("Set-Cookie", session.cookie);
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PasswordLoginError) {
      return loginFailure(
        request,
        returnTo,
        error.code === "MFA_REQUIRED"
          ? "mfa_required"
          : error.code === "WORKSPACE_REQUIRED"
            ? "workspace_required"
            : "invalid_credentials",
      );
    }
    console.error("Secure login failed.", error);
    return loginFailure(request, returnTo, "temporarily_unavailable");
  }
}
