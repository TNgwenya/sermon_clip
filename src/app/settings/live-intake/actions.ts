"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/server/auth/authorization";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { provisionLiveIntake } from "@/server/liveIntake/service";

export type LiveIntakeActionState = { success: boolean; message: string; ingestUrl?: string; streamKey?: string };

export async function provisionLiveIntakeAction(_: LiveIntakeActionState, formData: FormData): Promise<LiveIntakeActionState> {
  try {
    const context = await requireRequestCapability("channels.manage");
    const label = String(formData.get("label") || "Sunday service").trim().slice(0, 120) || "Sunday service";
    const provisioned = await provisionLiveIntake({ organizationId: context.organizationId, campusId: context.campusId, actorId: context.actorId }, label);
    revalidatePath("/settings/live-intake");
    return { success: true, message: "Private live stream created. Copy the address and key now; the key is not stored in Sermon Clip.", ingestUrl: provisioned.ingestUrl, streamKey: provisioned.streamKey };
  } catch (error) {
    return { success: false, message: error instanceof AuthorizationError ? "Your role cannot configure live intake." : error instanceof Error ? error.message : "Live stream setup failed." };
  }
}
