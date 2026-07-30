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

export type CollaborationActionTarget = Readonly<{
  id: string;
  organizationId: string;
  campusId: string | null;
  weekDraftId: string;
  weekDraftItemId: string | null;
}>;

export class CollaborationActionTargetNotFoundError extends Error {
  constructor() {
    super("The collaboration target was not found.");
    this.name = "CollaborationActionTargetNotFoundError";
  }
}

export type CollaborationActionTargetRepository = Readonly<{
  findWeekDraft(
    context: TenantRequestContext,
    id: string,
  ): Promise<CollaborationActionTarget | null>;
  findWeekDraftItem(
    context: TenantRequestContext,
    id: string,
  ): Promise<CollaborationActionTarget | null>;
  findAssignment(
    context: TenantRequestContext,
    id: string,
  ): Promise<CollaborationActionTarget | null>;
  findApprovalRequest(
    context: TenantRequestContext,
    id: string,
  ): Promise<CollaborationActionTarget | null>;
}>;

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

function canonicalId(value: string): string {
  const id = value.trim();
  if (!id || id !== value) {
    throw new CollaborationActionTargetNotFoundError();
  }
  return id;
}

export function createCollaborationActionAuthorizer(
  repository: CollaborationActionTargetRepository,
  authorize: CapabilityAuthorizer,
) {
  async function requireTarget(
    context: TenantRequestContext,
    capability: AuthorizationCapability,
    resourceKind: AuthorizationResourceKind,
    id: string,
    find: (
      context: TenantRequestContext,
      id: string,
    ) => Promise<CollaborationActionTarget | null>,
  ): Promise<CollaborationActionTarget> {
    const target = await find(context, canonicalId(id));
    if (!target) {
      throw new CollaborationActionTargetNotFoundError();
    }
    await authorize(context, capability, {
      campusId: target.campusId,
      resource: {
        kind: resourceKind,
        id: resourceKind === "WEEK_DRAFT" ? target.weekDraftId : target.id,
      },
    });
    return target;
  }

  return {
    requireWeekDraft(
      context: TenantRequestContext,
      capability: AuthorizationCapability,
      id: string,
    ) {
      return requireTarget(
        context,
        capability,
        "WEEK_DRAFT",
        id,
        repository.findWeekDraft,
      );
    },
    requireWeekDraftItem(
      context: TenantRequestContext,
      capability: AuthorizationCapability,
      id: string,
    ) {
      return requireTarget(
        context,
        capability,
        "WEEK_DRAFT",
        id,
        repository.findWeekDraftItem,
      );
    },
    requireAssignment(
      context: TenantRequestContext,
      capability: AuthorizationCapability,
      id: string,
    ) {
      return requireTarget(
        context,
        capability,
        "WEEK_DRAFT",
        id,
        repository.findAssignment,
      );
    },
    requireApprovalRequest(
      context: TenantRequestContext,
      capability: AuthorizationCapability,
      id: string,
    ) {
      return requireTarget(
        context,
        capability,
        "APPROVAL_REQUEST",
        id,
        repository.findApprovalRequest,
      );
    },
  };
}

function tenantWhere(context: TenantRequestContext) {
  return {
    organizationId: context.organizationId,
    ...(context.campusId ? { campusId: context.campusId } : {}),
  };
}

export const prismaCollaborationActionTargetRepository:
CollaborationActionTargetRepository = {
  findWeekDraft(context, id) {
    return prisma.weekDraft.findFirst({
      where: { id, ...tenantWhere(context) },
      select: {
        id: true,
        organizationId: true,
        campusId: true,
      },
    }).then((record) => record
      ? {
          ...record,
          weekDraftId: record.id,
          weekDraftItemId: null,
        }
      : null);
  },
  findWeekDraftItem(context, id) {
    return prisma.weekDraftItem.findFirst({
      where: { id, ...tenantWhere(context) },
      select: {
        id: true,
        organizationId: true,
        campusId: true,
        weekDraftId: true,
      },
    }).then((record) => record
      ? { ...record, weekDraftItemId: record.id }
      : null);
  },
  findAssignment(context, id) {
    return prisma.collaborationAssignment.findFirst({
      where: { id, ...tenantWhere(context) },
      select: {
        id: true,
        organizationId: true,
        campusId: true,
        weekDraftId: true,
        weekDraftItemId: true,
      },
    });
  },
  findApprovalRequest(context, id) {
    return prisma.approvalRequest.findFirst({
      where: { id, ...tenantWhere(context) },
      select: {
        id: true,
        organizationId: true,
        campusId: true,
        weekDraftId: true,
        weekDraftItemId: true,
      },
    });
  },
};

const collaborationActionAuthorizer = createCollaborationActionAuthorizer(
  prismaCollaborationActionTargetRepository,
  requirePersistedTenantCapability,
);

export async function requireWeekDraftActionTarget(
  capability: AuthorizationCapability,
  id: string,
): Promise<Readonly<{
  requestContext: TenantRequestContext;
  target: CollaborationActionTarget;
}>> {
  const requestContext = await getTenantRequestContext();
  return {
    requestContext,
    target: await collaborationActionAuthorizer.requireWeekDraft(
      requestContext,
      capability,
      id,
    ),
  };
}

export async function requireWeekDraftItemActionTarget(
  capability: AuthorizationCapability,
  id: string,
): Promise<Readonly<{
  requestContext: TenantRequestContext;
  target: CollaborationActionTarget;
}>> {
  const requestContext = await getTenantRequestContext();
  return {
    requestContext,
    target: await collaborationActionAuthorizer.requireWeekDraftItem(
      requestContext,
      capability,
      id,
    ),
  };
}

export async function requireAssignmentActionTarget(
  capability: AuthorizationCapability,
  id: string,
): Promise<Readonly<{
  requestContext: TenantRequestContext;
  target: CollaborationActionTarget;
}>> {
  const requestContext = await getTenantRequestContext();
  return {
    requestContext,
    target: await collaborationActionAuthorizer.requireAssignment(
      requestContext,
      capability,
      id,
    ),
  };
}

export async function requireApprovalRequestActionTarget(
  capability: AuthorizationCapability,
  id: string,
): Promise<Readonly<{
  requestContext: TenantRequestContext;
  target: CollaborationActionTarget;
}>> {
  const requestContext = await getTenantRequestContext();
  return {
    requestContext,
    target: await collaborationActionAuthorizer.requireApprovalRequest(
      requestContext,
      capability,
      id,
    ),
  };
}
