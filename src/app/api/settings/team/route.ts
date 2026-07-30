import {
  canPersistedTenantCapability,
} from "@/server/auth/requestAuthorization";
import {
  listOrganizationTeamDirectory,
} from "@/server/organizations/teamDirectory";

import {
  requireTeamRouteContext,
  teamJson,
} from "./_security";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const authorized = await requireTeamRouteContext(request, "members.read");
  if (authorized.error) {
    return authorized.error;
  }

  try {
    const includeInvitations = await canPersistedTenantCapability(
      authorized.context,
      "invitations.manage",
    );
    const directory = await listOrganizationTeamDirectory(
      {
        organizationId: authorized.context.organizationId,
        campusId: authorized.context.campusId,
      },
      { includeInvitations },
    );

    return teamJson({ success: true, directory });
  } catch (error) {
    console.error("Team directory lookup failed.", error);
    return teamJson(
      {
        success: false,
        message: "The team service is temporarily unavailable.",
      },
      503,
    );
  }
}
