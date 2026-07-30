import { NextResponse } from "next/server";

import {
  issuePasswordReset,
  revokePasswordResetToken,
} from "@/server/auth/passwordReset";
import { deliverPasswordReset } from "@/server/auth/passwordResetDelivery";

function responseDestination(request: Request): URL {
  const destination = new URL("/forgot-password", request.url);
  destination.searchParams.set("sent", "1");
  return destination;
}

function passwordResetUrl(request: Request, token: string): URL {
  const configuredBaseUrl = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (process.env.NODE_ENV === "production" && !configuredBaseUrl) {
    throw new Error(
      "NEXT_PUBLIC_APP_URL is required for production password-reset delivery.",
    );
  }
  const resetUrl = new URL("/reset-password", configuredBaseUrl || request.url);
  if (process.env.NODE_ENV === "production" && resetUrl.protocol !== "https:") {
    throw new Error("Production password-reset links must use HTTPS.");
  }
  resetUrl.searchParams.set("token", token);
  return resetUrl;
}

export async function POST(request: Request): Promise<NextResponse> {
  const form = await request.formData();
  const email = String(form.get("email") ?? "");
  try {
    const delivery = await issuePasswordReset({ email });
    if (delivery) {
      try {
        await deliverPasswordReset({
          delivery,
          resetUrl: passwordResetUrl(request, delivery.token).toString(),
        });
      } catch (error) {
        await revokePasswordResetToken(delivery.token);
        console.error("Password-reset delivery is unavailable.", error);
      }
    }
  } catch (error) {
    console.error("Password-reset request could not be completed.", error);
  }
  const response = NextResponse.redirect(responseDestination(request), {
    status: 303,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
