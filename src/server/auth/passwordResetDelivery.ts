import type { PasswordResetDelivery } from "@/server/auth/passwordReset";

export class PasswordResetDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PasswordResetDeliveryError";
  }
}

function deliveryEndpoint(): URL {
  const raw = process.env.AUTH_TRANSACTIONAL_WEBHOOK_URL?.trim();
  const secret = process.env.AUTH_TRANSACTIONAL_WEBHOOK_SECRET?.trim();
  if (!raw || !secret || secret.length < 24) {
    throw new PasswordResetDeliveryError(
      "Password-reset delivery is not configured.",
    );
  }
  let endpoint: URL;
  try {
    endpoint = new URL(raw);
  } catch {
    throw new PasswordResetDeliveryError(
      "Password-reset delivery URL is invalid.",
    );
  }
  const localDevelopment = process.env.NODE_ENV !== "production"
    && ["localhost", "127.0.0.1", "::1"].includes(endpoint.hostname);
  if (endpoint.protocol !== "https:" && !localDevelopment) {
    throw new PasswordResetDeliveryError(
      "Password-reset delivery must use HTTPS.",
    );
  }
  return endpoint;
}

export async function deliverPasswordReset(input: Readonly<{
  delivery: PasswordResetDelivery;
  resetUrl: string;
}>): Promise<void> {
  const endpoint = deliveryEndpoint();
  const secret = process.env.AUTH_TRANSACTIONAL_WEBHOOK_SECRET!.trim();
  const response = await fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Authorization": `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      type: "password_reset",
      recipient: input.delivery.email,
      resetUrl: input.resetUrl,
      expiresAt: input.delivery.expiresAt.toISOString(),
    }),
  });
  if (!response.ok) {
    throw new PasswordResetDeliveryError(
      `Password-reset delivery failed with status ${response.status}.`,
    );
  }
}

export const __passwordResetDeliveryTestUtils = { deliveryEndpoint };
