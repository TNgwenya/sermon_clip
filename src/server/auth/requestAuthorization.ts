import { headers } from "next/headers";

import { prisma } from "@/lib/prisma";
import {
  readTenantRequestContext,
  type TenantRequestContext,
} from "@/lib/tenancy/requestHeaders";
import {
  canActor,
  requireActorCapability,
  isOrganizationRole,
  type AuthorizationActor,
  type AuthorizationCapability,
  type AuthorizationContext,
  type AuthorizationResource,
} from "@/server/auth/authorization";

export async function getTenantRequestContext(): Promise<TenantRequestContext> {
  return readTenantRequestContext(await headers());
}

type PersistedAuthorizationPrincipal = Readonly<{
  id: string;
  status: string;
  memberships: ReadonlyArray<{
    organizationId: string;
    campusId: string | null;
    role: string;
    status: string;
    expiresAt: Date | null;
    organization: {
      status: string;
    };
    campus: {
      organizationId: string;
      status: string;
    } | null;
  }>;
}>;

export function actorFromPersistedPrincipal(
  requestContext: TenantRequestContext,
  principal: PersistedAuthorizationPrincipal | null,
): AuthorizationActor | null {
  if (!principal || principal.id !== requestContext.actorId) {
    return null;
  }

  const roleBindings: AuthorizationActor["roleBindings"] = principal.memberships
    .filter((membership) => (
      membership.organizationId === requestContext.organizationId
      && membership.status === "ACTIVE"
      && membership.organization.status === "ACTIVE"
      && (
        membership.campusId === null
        || (
          membership.campus?.organizationId === membership.organizationId
          && membership.campus.status === "ACTIVE"
        )
      )
      && isOrganizationRole(membership.role)
    ))
    .map((membership) => ({
      role: membership.role as AuthorizationActor["roleBindings"][number]["role"],
      scope: membership.campusId
        ? { kind: "CAMPUS" as const, campusId: membership.campusId }
        : { kind: "ORGANIZATION" as const },
      expiresAt: membership.expiresAt,
    }));

  return {
    userId: principal.id,
    organizationId: requestContext.organizationId,
    active: principal.status === "ACTIVE",
    roleBindings,
  };
}

export function requestedCampusIsActiveForOrganization(
  requestContext: Pick<TenantRequestContext, "organizationId" | "campusId">,
  campus: {
    id: string;
    organizationId: string;
    status: string;
  } | null,
): boolean {
  if (requestContext.campusId === null) {
    return true;
  }

  return campus?.id === requestContext.campusId
    && campus.organizationId === requestContext.organizationId
    && campus.status === "ACTIVE";
}

export async function loadRequestAuthorizationActor(
  requestContext: TenantRequestContext,
): Promise<AuthorizationActor | null> {
  const [principal, requestedCampus] = await Promise.all([
    prisma.user.findUnique({
      where: { id: requestContext.actorId },
      select: {
        id: true,
        status: true,
        memberships: {
          where: {
            organizationId: requestContext.organizationId,
            status: "ACTIVE",
          },
          select: {
            organizationId: true,
            campusId: true,
            role: true,
            status: true,
            expiresAt: true,
            organization: {
              select: {
                status: true,
              },
            },
            campus: {
              select: {
                organizationId: true,
                status: true,
              },
            },
          },
        },
      },
    }),
    requestContext.campusId
      ? prisma.campus.findFirst({
          where: {
            id: requestContext.campusId,
            organizationId: requestContext.organizationId,
            status: "ACTIVE",
          },
          select: {
            id: true,
            organizationId: true,
            status: true,
          },
        })
      : Promise.resolve(null),
  ]);

  if (!requestedCampusIsActiveForOrganization(
    requestContext,
    requestedCampus,
  )) {
    return null;
  }

  return actorFromPersistedPrincipal(requestContext, principal);
}

export async function requireRequestCapability(
  capability: AuthorizationCapability,
  options?: Readonly<{
    campusId?: string | null;
    resource?: AuthorizationResource | null;
  }>,
): Promise<TenantRequestContext> {
  const requestContext = await getTenantRequestContext();
  return requirePersistedTenantCapability(
    requestContext,
    capability,
    options,
  );
}

export async function requirePersistedTenantCapability(
  requestContext: TenantRequestContext,
  capability: AuthorizationCapability,
  options: Readonly<{
    campusId?: string | null;
    resource?: AuthorizationResource | null;
  }> = {},
): Promise<TenantRequestContext> {
  const authorizationContext: AuthorizationContext = {
    organizationId: requestContext.organizationId,
    campusId: options.campusId === undefined
      ? requestContext.campusId
      : options.campusId,
    resource: options.resource ?? null,
  };

  requireActorCapability(
    await loadRequestAuthorizationActor(requestContext),
    capability,
    authorizationContext,
  );

  return requestContext;
}

export async function canPersistedTenantCapability(
  requestContext: TenantRequestContext,
  capability: AuthorizationCapability,
  options: Readonly<{
    campusId?: string | null;
    resource?: AuthorizationResource | null;
  }> = {},
): Promise<boolean> {
  const authorizationContext: AuthorizationContext = {
    organizationId: requestContext.organizationId,
    campusId: options.campusId === undefined
      ? requestContext.campusId
      : options.campusId,
    resource: options.resource ?? null,
  };

  return canActor(
    await loadRequestAuthorizationActor(requestContext),
    capability,
    authorizationContext,
  );
}

export const __requestAuthorizationTestUtils = {
  actorFromPersistedPrincipal,
  requestedCampusIsActiveForOrganization,
};
