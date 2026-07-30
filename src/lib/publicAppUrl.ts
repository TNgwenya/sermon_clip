type RequestWithOrigin = Pick<Request, "headers" | "url">;

function firstHeaderValue(value: string | null): string | null {
  return value?.split(",").at(0)?.trim() || null;
}

function httpOrigin(value: string | undefined): URL | null {
  if (!value?.trim()) return null;

  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url;
  } catch {
    return null;
  }
}

function forwardedOrigin(request: RequestWithOrigin): URL | null {
  const host = firstHeaderValue(request.headers.get("x-forwarded-host"))
    ?? firstHeaderValue(request.headers.get("host"));
  if (!host) return null;

  const protocol = firstHeaderValue(request.headers.get("x-forwarded-proto"))
    ?? (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return httpOrigin(`${protocol}://${host}`);
}

export function publicAppUrl(
  request: RequestWithOrigin,
  path: string,
): URL {
  const configuredOrigin = httpOrigin(process.env.APP_URL)
    ?? httpOrigin(process.env.NEXT_PUBLIC_APP_URL);
  const origin = configuredOrigin
    ?? forwardedOrigin(request)
    ?? httpOrigin(request.url);

  if (!origin) {
    throw new Error("A valid public application URL is required.");
  }

  return new URL(path, origin);
}
