import type { TenantRequestContext } from "@/lib/tenancy/requestHeaders";

export type OrganizationScope = Readonly<{
  organizationId: string;
}>;

export type OrganizationResourceScope = Readonly<{
  id: string;
  organizationId: string;
}>;

export type TenantScope = Readonly<{
  organizationId: string;
  campusId?: string;
}>;

export type TenantResourceScope = Readonly<{
  id: string;
  organizationId: string;
  campusId?: string;
}>;

export function organizationScope(
  context: Pick<TenantRequestContext, "organizationId">,
): OrganizationScope {
  return { organizationId: context.organizationId };
}

export function organizationResourceScope(
  context: Pick<TenantRequestContext, "organizationId">,
  id: string,
): OrganizationResourceScope {
  if (!id.trim()) {
    throw new Error("A resource id is required for an organization-scoped query.");
  }

  return {
    id,
    organizationId: context.organizationId,
  };
}

export function tenantScope(
  context: Pick<TenantRequestContext, "organizationId" | "campusId">,
): TenantScope {
  return {
    organizationId: context.organizationId,
    ...(context.campusId ? { campusId: context.campusId } : {}),
  };
}

export function tenantResourceScope(
  context: Pick<TenantRequestContext, "organizationId" | "campusId">,
  id: string,
): TenantResourceScope {
  if (!id.trim()) {
    throw new Error("A resource id is required for a tenant-scoped query.");
  }

  return {
    id,
    ...tenantScope(context),
  };
}
