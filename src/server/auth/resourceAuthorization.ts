import { prisma } from "@/lib/prisma";
import type { TenantRequestContext } from "@/lib/tenancy/requestHeaders";
import type {
  AuthorizationCapability,
  AuthorizationResourceKind,
} from "@/server/auth/authorization";
import {
  getTenantRequestContext,
  requirePersistedTenantCapability,
} from "@/server/auth/requestAuthorization";

export type AuthorizedResource = Readonly<{
  id: string;
  organizationId: string;
  campusId: string | null;
}>;

export class AuthorizedResourceNotFoundError extends Error {
  constructor() {
    super("The requested resource was not found.");
    this.name = "AuthorizedResourceNotFoundError";
  }
}

export class ResourceAuthenticationRequiredError extends Error {
  constructor() {
    super("Authentication is required.");
    this.name = "ResourceAuthenticationRequiredError";
  }
}

type ResourceAuthorizationRepository = {
  findSermon(
    context: TenantRequestContext,
    id: string,
  ): Promise<AuthorizedResource | null>;
  findClip(
    context: TenantRequestContext,
    id: string,
  ): Promise<AuthorizedResource | null>;
  findContentAsset(
    context: TenantRequestContext,
    id: string,
  ): Promise<AuthorizedResource | null>;
  findContentOpportunity(
    context: TenantRequestContext,
    id: string,
  ): Promise<AuthorizedResource | null>;
};

type CapabilityAuthorizer = (
  context: TenantRequestContext,
  capability: AuthorizationCapability,
  options: Readonly<{
    campusId: string | null;
    resource: {
      kind: AuthorizationResourceKind;
      id: string;
    };
  }>,
) => Promise<TenantRequestContext>;

function canonicalResourceId(id: string): string {
  const normalized = id.trim();
  if (!normalized || normalized !== id) {
    throw new AuthorizedResourceNotFoundError();
  }
  return normalized;
}

export function createResourceAuthorizationService(
  repository: ResourceAuthorizationRepository,
  authorize: CapabilityAuthorizer,
) {
  async function authorizeResource(
    context: TenantRequestContext,
    capability: AuthorizationCapability,
    resourceKind: AuthorizationResourceKind,
    id: string,
    load: (
      context: TenantRequestContext,
      id: string,
    ) => Promise<AuthorizedResource | null>,
  ): Promise<AuthorizedResource> {
    const resourceId = canonicalResourceId(id);
    const resource = await load(context, resourceId);
    if (!resource) {
      throw new AuthorizedResourceNotFoundError();
    }

    await authorize(context, capability, {
      campusId: resource.campusId,
      resource: {
        kind: resourceKind,
        id: resource.id,
      },
    });
    return resource;
  }

  return {
    authorizeSermon(
      context: TenantRequestContext,
      capability: AuthorizationCapability,
      id: string,
    ) {
      return authorizeResource(
        context,
        capability,
        "SERMON",
        id,
        repository.findSermon,
      );
    },
    authorizeClip(
      context: TenantRequestContext,
      capability: AuthorizationCapability,
      id: string,
    ) {
      return authorizeResource(
        context,
        capability,
        "CONTENT_ITEM",
        id,
        repository.findClip,
      );
    },
    authorizeContentAsset(
      context: TenantRequestContext,
      capability: AuthorizationCapability,
      id: string,
    ) {
      return authorizeResource(
        context,
        capability,
        "CONTENT_ITEM",
        id,
        repository.findContentAsset,
      );
    },
    authorizeContentOpportunity(
      context: TenantRequestContext,
      capability: AuthorizationCapability,
      id: string,
    ) {
      return authorizeResource(
        context,
        capability,
        "CONTENT_ITEM",
        id,
        repository.findContentOpportunity,
      );
    },
  };
}

const prismaResourceRepository: ResourceAuthorizationRepository = {
  findSermon(context, id) {
    return prisma.sermon.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
        ...(context.campusId ? { campusId: context.campusId } : {}),
      },
      select: {
        id: true,
        organizationId: true,
        campusId: true,
      },
    }).then((resource) => resource?.organizationId
      ? {
          id: resource.id,
          organizationId: resource.organizationId,
          campusId: resource.campusId,
        }
      : null);
  },
  findClip(context, id) {
    return prisma.clipCandidate.findFirst({
      where: {
        id,
        sermon: {
          organizationId: context.organizationId,
          ...(context.campusId ? { campusId: context.campusId } : {}),
        },
      },
      select: {
        id: true,
        sermon: {
          select: {
            organizationId: true,
            campusId: true,
          },
        },
      },
    }).then((resource) => resource?.sermon.organizationId
      ? {
          id: resource.id,
          organizationId: resource.sermon.organizationId,
          campusId: resource.sermon.campusId,
        }
      : null);
  },
  findContentAsset(context, id) {
    return prisma.contentAsset.findFirst({
      where: {
        id,
        organizationId: context.organizationId,
        ...(context.campusId ? { campusId: context.campusId } : {}),
      },
      select: {
        id: true,
        organizationId: true,
        campusId: true,
      },
    }).then((resource) => resource?.organizationId
      ? {
          id: resource.id,
          organizationId: resource.organizationId,
          campusId: resource.campusId,
        }
      : null);
  },
  findContentOpportunity(context, id) {
    const scope = {
      organizationId: context.organizationId,
      ...(context.campusId ? { campusId: context.campusId } : {}),
    };
    return prisma.contentOpportunity.findFirst({
      where: {
        id,
        ...scope,
        sermon: scope,
      },
      select: {
        id: true,
        organizationId: true,
        campusId: true,
      },
    }).then((resource) => resource?.organizationId
      ? {
          id: resource.id,
          organizationId: resource.organizationId,
          campusId: resource.campusId,
        }
      : null);
  },
};

const resourceAuthorization = createResourceAuthorizationService(
  prismaResourceRepository,
  requirePersistedTenantCapability,
);

async function getAuthenticatedTenantRequestContext(): Promise<TenantRequestContext> {
  try {
    return await getTenantRequestContext();
  } catch {
    throw new ResourceAuthenticationRequiredError();
  }
}

export async function requireSermonResource(
  capability: AuthorizationCapability,
  id: string,
): Promise<AuthorizedResource> {
  return resourceAuthorization.authorizeSermon(
    await getAuthenticatedTenantRequestContext(),
    capability,
    id,
  );
}

export async function requireClipResource(
  capability: AuthorizationCapability,
  id: string,
): Promise<AuthorizedResource> {
  return resourceAuthorization.authorizeClip(
    await getAuthenticatedTenantRequestContext(),
    capability,
    id,
  );
}

export async function requireContentAssetResource(
  capability: AuthorizationCapability,
  id: string,
): Promise<AuthorizedResource> {
  return resourceAuthorization.authorizeContentAsset(
    await getAuthenticatedTenantRequestContext(),
    capability,
    id,
  );
}

export async function requireContentOpportunityResource(
  capability: AuthorizationCapability,
  id: string,
): Promise<AuthorizedResource> {
  return resourceAuthorization.authorizeContentOpportunity(
    await getAuthenticatedTenantRequestContext(),
    capability,
    id,
  );
}
