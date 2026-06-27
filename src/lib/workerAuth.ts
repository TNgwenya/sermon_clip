import { NextResponse } from "next/server";

export function requireWorkerAuth(request: Request): NextResponse | null {
  const expectedToken = process.env.WORKER_API_TOKEN?.trim();
  const allowLocalBypass = process.env.ALLOW_LOCAL_WORKER_AUTH_BYPASS === "true"
    && process.env.NODE_ENV !== "production";

  if (!expectedToken && allowLocalBypass) {
    return null;
  }

  if (!expectedToken) {
    return NextResponse.json({ error: "Worker API token is not configured." }, { status: 503 });
  }

  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();

  if (token !== expectedToken) {
    return NextResponse.json({ error: "Unauthorized worker request." }, { status: 401 });
  }

  return null;
}

export function getWorkerId(value: unknown): string {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, 120)
    : "mac-worker";
}
