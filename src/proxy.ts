import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_FILE_PATTERN = /\.(?:ico|png|jpg|jpeg|svg|webp|gif|css|js|map|txt|xml)$/i;

function unauthorized(): NextResponse {
  return new NextResponse("Authentication required.", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Sermon Clip Scheduler"',
    },
  });
}

function isAuthorized(request: NextRequest, password: string): boolean {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.toLowerCase().startsWith("basic ")) {
    return false;
  }

  try {
    const decoded = atob(authorization.slice("basic ".length));
    const separatorIndex = decoded.indexOf(":");
    const submittedPassword = separatorIndex >= 0 ? decoded.slice(separatorIndex + 1) : "";
    return submittedPassword === password;
  } catch {
    return false;
  }
}

export function proxy(request: NextRequest): NextResponse {
  const password = process.env.SCHEDULER_ADMIN_PASSWORD?.trim();
  const localBypass = process.env.ALLOW_LOCAL_ADMIN_BYPASS === "true"
    && process.env.NODE_ENV !== "production";

  if (!password || localBypass) {
    return NextResponse.next();
  }

  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/_next/")
    || pathname.startsWith("/api/automation/")
    || pathname === "/favicon.ico"
    || PUBLIC_FILE_PATTERN.test(pathname)
  ) {
    return NextResponse.next();
  }

  return isAuthorized(request, password) ? NextResponse.next() : unauthorized();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
