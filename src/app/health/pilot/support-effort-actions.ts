"use server";

import { revalidatePath } from "next/cache";

import {
  loadRequestAuthorizationActor,
  requireRequestCapability,
} from "@/server/auth/requestAuthorization";
import { SupportEffortService } from "@/server/pilotTelemetry/supportEffort";

import {
  parseSupportEffortFormData,
  pilotSupportActorFromPersistedAuthorization,
  type SupportEffortActionState,
} from "./support-effort-action-helpers";

export async function recordPilotSupportEffortAction(
  _previousState: SupportEffortActionState,
  formData: FormData,
): Promise<SupportEffortActionState> {
  const parsed = parseSupportEffortFormData(formData);
  if (!parsed.ok) return parsed.state;

  try {
    // analytics.read is the existing operational-metrics capability. The
    // narrower persisted role check below and SupportEffortService both apply
    // independently before the event can be written.
    const requestContext = await requireRequestCapability("analytics.read");
    const authorizationActor = await loadRequestAuthorizationActor(requestContext);
    const actor = pilotSupportActorFromPersistedAuthorization({ requestContext, authorizationActor });
    if (!actor) {
      return { success: false, message: "Your current church role cannot record pilot support effort." };
    }

    await new SupportEffortService().record({
      actor,
      scope: {
        organizationId: requestContext.organizationId,
        campusId: requestContext.campusId,
      },
      effort: parsed.effort,
    });
    revalidatePath("/health/pilot");
    return {
      success: true,
      message: "Support effort recorded. The pilot totals now include this operational event.",
    };
  } catch {
    return {
      success: false,
      message: "Support effort could not be recorded. Check your access and the selected values, then try again.",
    };
  }
}
