import { NextResponse } from "next/server";

import {
  AuthorizationError,
  type AuthorizationCapability,
} from "@/server/auth/authorization";
import {
  requirePersistedTenantCapability,
} from "@/server/auth/requestAuthorization";
import {
  readTenantRequestContext,
  type TenantRequestContext,
} from "@/lib/tenancy/requestHeaders";
import {
  OrganizationTrustError,
  type OrganizationTrustContext,
} from "@/server/organizations/trustService";

type TeamContextResult =
  | Readonly<{ context: TenantRequestContext; error?: never }>
  | Readonly<{ context?: never; error: NextResponse }>;

export async function requireTeamRouteContext(
  request: Request,
  capability: AuthorizationCapability,
  options: Readonly<{ campusId?: string | null }> = {},
): Promise<TeamContextResult> {
  let context: TenantRequestContext;
  try {
    context = readTenantRequestContext(request.headers);
  } catch {
    return {
      error: teamJson(
        { success: false, message: "Authentication is required." },
        401,
      ),
    };
  }

  try {
    await requirePersistedTenantCapability(context, capability, {
      campusId: options.campusId,
    });
    return { context };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return {
        error: teamJson(
          {
            success: false,
            message: "You do not have permission to manage this team.",
          },
          403,
        ),
      };
    }

    console.error("Team authorization lookup failed.", error);
    return {
      error: teamJson(
        {
          success: false,
          message: "The team service is temporarily unavailable.",
        },
        503,
      ),
    };
  }
}

export function organizationTrustContext(
  context: TenantRequestContext,
  request: Request,
): OrganizationTrustContext {
  return {
    organizationId: context.organizationId,
    campusId: context.campusId,
    actorUserId: context.actorId,
    requestId: request.headers.get("x-request-id")?.trim() || null,
  };
}

export function teamJson(
  body: unknown,
  status = 200,
): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Referrer-Policy": "same-origin",
    },
  });
}

export function trustErrorResponse(error: unknown): NextResponse {
  if (!(error instanceof OrganizationTrustError)) {
    console.error("Team trust operation failed.", error);
    return teamJson(
      {
        success: false,
        message: "The team service is temporarily unavailable.",
      },
      503,
    );
  }

  switch (error.code) {
    case "INVALID_INPUT":
      return teamJson({ success: false, message: error.message }, 400);
    case "NOT_AUTHORIZED":
      return teamJson(
        {
          success: false,
          message: "You do not have permission to manage this team.",
        },
        403,
      );
    case "INVITATION_CONFLICT":
    case "MEMBERSHIP_PROTECTED":
    case "REASSIGNMENT_CONFLICT":
    case "TRANSFER_CONFLICT":
      return teamJson({ success: false, message: error.message }, 409);
    case "ORGANIZATION_UNAVAILABLE":
    case "CAMPUS_UNAVAILABLE":
    case "USER_UNAVAILABLE":
    case "INVITATION_INVALID":
    case "INVITATION_EXPIRED":
    case "MEMBERSHIP_UNAVAILABLE":
    case "TRANSFER_INVALID":
    case "TRANSFER_EXPIRED":
      return teamJson(
        {
          success: false,
          message: "The requested team record is unavailable.",
        },
        404,
      );
  }
}
