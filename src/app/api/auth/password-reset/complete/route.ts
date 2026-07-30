import { NextResponse } from "next/server";

import { publicAppUrl } from "@/lib/publicAppUrl";
import {
  completePasswordReset,
  PasswordResetError,
} from "@/server/auth/passwordReset";

function resetFailure(request: Request, token: string, code: string) {
  const destination = publicAppUrl(request, "/reset-password");
  if (token) destination.searchParams.set("token", token);
  destination.searchParams.set("error", code);
  return NextResponse.redirect(destination, { status: 303 });
}

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const token = String(form.get("token") ?? "");
  const password = String(form.get("password") ?? "");
  const confirmation = String(form.get("passwordConfirmation") ?? "");
  if (password !== confirmation) {
    return resetFailure(request, token, "password_mismatch");
  }
  try {
    await completePasswordReset({ token, password });
    const destination = publicAppUrl(request, "/login");
    destination.searchParams.set("reset", "complete");
    const response = NextResponse.redirect(destination, { status: 303 });
    response.headers.set("Cache-Control", "no-store");
    return response;
  } catch (error) {
    if (error instanceof PasswordResetError) {
      return resetFailure(
        request,
        error.code === "INVALID_PASSWORD" ? token : "",
        error.code.toLowerCase(),
      );
    }
    console.error("Password reset could not be completed.", error);
    return resetFailure(request, token, "temporarily_unavailable");
  }
}
