import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import type { NextResponse } from "next/server";

import type { OAuthProvider } from "@/lib/socialAnalyticsConnectors";

export const OAUTH_STATE_TTL_SECONDS = 10 * 60;

const OAUTH_STATE_FUTURE_SKEW_SECONDS = 60;
const OAUTH_STATE_VERSION = "v2";
const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const OAUTH_SIGNATURE_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export type OAuthTenantBinding = Readonly<{
  organizationId: string;
  campusId: string | null;
  actorId: string;
}>;

type OAuthStateCookie = {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    sameSite: "lax";
    secure: boolean;
    path: string;
    maxAge: number;
  };
};

function cookieName(provider: OAuthProvider): string {
  return `sermon_clip_oauth_state_${provider}`;
}

function cookiePath(provider: OAuthProvider): string {
  return `/api/oauth/${provider}/callback`;
}

function secureCookies(): boolean {
  return process.env.NODE_ENV === "production";
}

function stateSecret(): string {
  const secret = process.env.AUTH_SECRET?.trim()
    || process.env.NEXTAUTH_SECRET?.trim()
    || process.env.OAUTH_TOKEN_ENCRYPTION_KEY?.trim();
  if (!secret) {
    throw new Error("AUTH_SECRET is required before starting social OAuth.");
  }
  return secret;
}

function encodeBindingPart(value: string | null): string {
  return value === null ? "~" : Buffer.from(value, "utf8").toString("base64url");
}

function oauthStateSignature(
  provider: OAuthProvider,
  issuedAt: number,
  state: string,
  binding: OAuthTenantBinding,
): string {
  return createHmac("sha256", stateSecret())
    .update([
      provider,
      String(issuedAt),
      state,
      binding.organizationId,
      binding.campusId ?? "",
      binding.actorId,
    ].join("\u001f"))
    .digest("base64url");
}

function readCookie(request: Request, name: string): string | null {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue;

    const value = part.slice(separator + 1).trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}

export function createOAuthState(
  provider: OAuthProvider,
  binding: OAuthTenantBinding,
  now: number = Date.now(),
): { state: string; cookie: OAuthStateCookie } {
  const state = randomBytes(32).toString("base64url");
  const issuedAt = Math.floor(now / 1_000);

  return {
    state,
    cookie: {
      name: cookieName(provider),
      value: [
        OAUTH_STATE_VERSION,
        issuedAt,
        state,
        encodeBindingPart(binding.organizationId),
        encodeBindingPart(binding.campusId),
        encodeBindingPart(binding.actorId),
        oauthStateSignature(provider, issuedAt, state, binding),
      ].join("."),
      options: {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies(),
        path: cookiePath(provider),
        maxAge: OAUTH_STATE_TTL_SECONDS,
      },
    },
  };
}

export function setOAuthStateCookie(response: NextResponse, cookie: OAuthStateCookie): void {
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(cookie.name, cookie.value, cookie.options);
}

export function clearOAuthStateCookie(response: NextResponse, provider: OAuthProvider): void {
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(cookieName(provider), "", {
    httpOnly: true,
    sameSite: "lax",
    secure: secureCookies(),
    path: cookiePath(provider),
    maxAge: 0,
    expires: new Date(0),
  });
}

export function validateOAuthCallbackState(
  request: Request,
  provider: OAuthProvider,
  receivedState: string | null,
  binding: OAuthTenantBinding,
  now: number = Date.now(),
): boolean {
  if (!receivedState || !OAUTH_STATE_PATTERN.test(receivedState)) return false;

  const stored = readCookie(request, cookieName(provider));
  if (!stored) return false;

  const [
    version,
    issuedAtValue,
    expectedState,
    organizationPart,
    campusPart,
    actorPart,
    signature,
    ...extra
  ] = stored.split(".");
  if (
    version !== OAUTH_STATE_VERSION
    || extra.length > 0
    || !OAUTH_STATE_PATTERN.test(expectedState ?? "")
    || !OAUTH_SIGNATURE_PATTERN.test(signature ?? "")
  ) {
    return false;
  }

  const issuedAt = Number(issuedAtValue);
  if (!Number.isSafeInteger(issuedAt)) return false;

  const nowSeconds = Math.floor(now / 1_000);
  const age = nowSeconds - issuedAt;
  if (age > OAUTH_STATE_TTL_SECONDS || age < -OAUTH_STATE_FUTURE_SKEW_SECONDS) return false;

  const expected = Buffer.from(expectedState, "utf8");
  const received = Buffer.from(receivedState, "utf8");
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    return false;
  }

  if (
    organizationPart !== encodeBindingPart(binding.organizationId)
    || campusPart !== encodeBindingPart(binding.campusId)
    || actorPart !== encodeBindingPart(binding.actorId)
  ) {
    return false;
  }

  const expectedSignature = Buffer.from(
    oauthStateSignature(provider, issuedAt, expectedState, binding),
    "utf8",
  );
  const receivedSignature = Buffer.from(signature, "utf8");
  return expectedSignature.length === receivedSignature.length
    && timingSafeEqual(expectedSignature, receivedSignature);
}
