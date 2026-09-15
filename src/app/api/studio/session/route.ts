import { getTenantRequestContext } from "@/server/auth/requestAuthorization";

// This route is protected by the same authentication proxy as Studio.
export async function GET() {
  const context = await getTenantRequestContext();
  return Response.json({
    actorId: context.actorId,
    organizationId: context.organizationId,
  }, { headers: { "Cache-Control": "no-store" } });
}
