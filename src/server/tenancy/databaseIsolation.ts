import { prisma } from "@/lib/prisma";

type DatabaseTenantTransaction = Omit<
  typeof prisma,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends"
>;

export type DatabaseTenantContext = Readonly<{
  organizationId: string;
  campusId?: string | null;
}>;

function requiredSetting(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized) {
    throw new Error(`${label} is required to establish database tenant isolation.`);
  }
  return normalized;
}

/**
 * Runs database work with transaction-local tenant settings used by the
 * additive PostgreSQL RLS policies. `SET LOCAL` semantics are provided by
 * `set_config(..., true)`, so pooled connections cannot retain tenant state.
 */
export async function withDatabaseTenantIsolation<T>(
  context: DatabaseTenantContext,
  operation: (transaction: DatabaseTenantTransaction) => Promise<T>,
): Promise<T> {
  const organizationId = requiredSetting(context.organizationId, "Organization id");
  const campusId = context.campusId?.trim() ?? "";

  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      SELECT
        set_config('sermon_clip.organization_id', ${organizationId}, true),
        set_config('sermon_clip.campus_id', ${campusId}, true)
    `;
    return operation(transaction);
  });
}
