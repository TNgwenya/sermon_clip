import { beforeEach, describe, expect, it, vi } from "vitest";

const authenticatePasswordLogin = vi.hoisted(() => vi.fn());
const createSession = vi.hoisted(() => vi.fn());

vi.mock("@/server/auth/passwordLogin", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/server/auth/passwordLogin")
  >();
  return { ...actual, authenticatePasswordLogin };
});

vi.mock("@/server/auth/prismaSessionRepository", () => ({
  getPrismaSessionService: () => ({ createSession }),
}));

import { PasswordLoginError } from "@/server/auth/passwordLogin";
import { POST } from "./route";

function loginRequest(fields: Record<string, string>): Request {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    form.set(key, value);
  }
  return new Request("https://church.example/api/auth/login", {
    method: "POST",
    body: form,
  });
}

beforeEach(() => {
  authenticatePasswordLogin.mockReset();
  createSession.mockReset();
});

describe("secure login route", () => {
  it("creates a tenant-bound session and redirects only to a local path", async () => {
    authenticatePasswordLogin.mockResolvedValue({
      userId: "user_one",
      workspace: {
        organizationId: "org_one",
        campusId: "campus_one",
      },
    });
    createSession.mockResolvedValue({
      cookie: "__Host-sermonclip_session=scs_token; Path=/; HttpOnly; Secure",
    });

    const response = await POST(loginRequest({
      email: "pastor@example.com",
      password: "correct horse battery staple",
      returnTo: "/week-drafts/draft_one",
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location"))
      .toBe("https://church.example/week-drafts/draft_one");
    expect(response.headers.get("set-cookie"))
      .toContain("__Host-sermonclip_session=scs_token");
    expect(createSession).toHaveBeenCalledWith(expect.objectContaining({
      userId: "user_one",
      organizationId: "org_one",
      campusId: "campus_one",
    }));
  });

  it("does not accept an external return URL", async () => {
    authenticatePasswordLogin.mockResolvedValue({
      userId: "user_one",
      workspace: { organizationId: "org_one", campusId: null },
    });
    createSession.mockResolvedValue({
      cookie: "__Host-sermonclip_session=scs_token; Path=/; HttpOnly; Secure",
    });

    const response = await POST(loginRequest({
      email: "pastor@example.com",
      password: "correct horse battery staple",
      returnTo: "//attacker.example/steal",
    }));

    expect(response.headers.get("location")).toBe("https://church.example/");
  });

  it("keeps credential failures generic", async () => {
    authenticatePasswordLogin.mockRejectedValue(
      new PasswordLoginError("INVALID_CREDENTIALS"),
    );

    const response = await POST(loginRequest({
      email: "unknown@example.com",
      password: "incorrect",
    }));

    expect(response.status).toBe(303);
    expect(response.headers.get("location"))
      .toBe("https://church.example/login?error=invalid_credentials");
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});
