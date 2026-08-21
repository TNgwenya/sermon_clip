import { z } from "zod";

import type { TenantRequestContext } from "@/lib/tenancy/requestHeaders";
import type { AuthorizationActor, OrganizationRole } from "@/server/auth/authorization";
import {
  SUPPORT_BOARD_CATEGORIES,
  SUPPORT_INCIDENT_CATEGORIES,
  SUPPORT_INCIDENT_OUTCOMES,
  SUPPORT_INCIDENT_SEVERITIES,
  SUPPORT_INCIDENT_STATUSES,
  type PilotTelemetryActor,
  type SupportEffortInput,
} from "@/server/pilotTelemetry/supportEffort";

export type SupportEffortActionState = {
  success: boolean;
  message: string;
  fieldErrors?: Partial<Record<"boardCategory" | "category" | "severity" | "status" | "minutes" | "incidentDate" | "outcome", string>>;
};

const SUPPORT_RECORD_ROLES = new Set<OrganizationRole>([
  "OWNER",
  "ORG_ADMIN",
  "CAMPUS_ADMIN",
  "CONTENT_LEAD",
]);

const supportEffortSchema = z.object({
  boardCategory: z.enum(SUPPORT_BOARD_CATEGORIES, "Choose a board incident category."),
  category: z.enum(SUPPORT_INCIDENT_CATEGORIES, "Choose an incident category."),
  severity: z.enum(SUPPORT_INCIDENT_SEVERITIES, "Choose an incident severity."),
  status: z.enum(SUPPORT_INCIDENT_STATUSES, "Choose the current incident status."),
  minutes: z.coerce.number("Enter whole support minutes.").int("Enter whole support minutes.").min(0, "Minutes cannot be negative.").max(1_440, "Minutes cannot exceed one day."),
  incidentDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Choose a valid incident date.").refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
  }, "Choose a valid incident date."),
  outcome: z.enum(SUPPORT_INCIDENT_OUTCOMES, "Choose an incident outcome."),
});

function bindingAppliesToContext(
  binding: AuthorizationActor["roleBindings"][number],
  context: TenantRequestContext,
  now: Date,
): boolean {
  if (binding.expiresAt) {
    const expiresAt = new Date(binding.expiresAt).getTime();
    if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return false;
  }
  if (binding.scope.kind === "ORGANIZATION") return true;
  return binding.scope.kind === "CAMPUS" && context.campusId !== null && binding.scope.campusId === context.campusId;
}

/** Client role, tenant, campus and user fields are deliberately not accepted. */
export function pilotSupportActorFromPersistedAuthorization(input: {
  requestContext: TenantRequestContext;
  authorizationActor: AuthorizationActor | null;
  now?: Date;
}): PilotTelemetryActor | null {
  const actor = input.authorizationActor;
  if (
    !actor
    || !actor.active
    || actor.userId !== input.requestContext.actorId
    || actor.organizationId !== input.requestContext.organizationId
  ) return null;

  const binding = actor.roleBindings.find((candidate) => (
    SUPPORT_RECORD_ROLES.has(candidate.role)
    && bindingAppliesToContext(candidate, input.requestContext, input.now ?? new Date())
  ));
  if (!binding) return null;

  return {
    actorUserId: actor.userId,
    organizationId: input.requestContext.organizationId,
    campusId: input.requestContext.campusId,
    role: binding.role,
    permissions: {
      recordSupportEffort: true,
      reviewPilotTelemetry: false,
      exportBoardMetrics: false,
    },
  };
}

export function parseSupportEffortFormData(formData: FormData):
  | { ok: true; effort: SupportEffortInput }
  | { ok: false; state: SupportEffortActionState } {
  const parsed = supportEffortSchema.safeParse({
    boardCategory: formData.get("boardCategory"),
    category: formData.get("category"),
    severity: formData.get("severity"),
    status: formData.get("status"),
    minutes: formData.get("minutes"),
    incidentDate: formData.get("incidentDate"),
    outcome: formData.get("outcome"),
  });
  if (parsed.success) return { ok: true, effort: parsed.data };
  const fields = parsed.error.flatten().fieldErrors;
  return {
    ok: false,
    state: {
      success: false,
      message: "Correct the highlighted support details.",
      fieldErrors: {
        boardCategory: fields.boardCategory?.[0],
        category: fields.category?.[0],
        severity: fields.severity?.[0],
        status: fields.status?.[0],
        minutes: fields.minutes?.[0],
        incidentDate: fields.incidentDate?.[0],
        outcome: fields.outcome?.[0],
      },
    },
  };
}
