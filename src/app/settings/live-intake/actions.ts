"use server";

import { revalidatePath } from "next/cache";
import { AuthorizationError } from "@/server/auth/authorization";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { provisionLiveIntake } from "@/server/liveIntake/service";
import { getCloudflareLiveInputCredentials } from "@/server/liveIntake/cloudflareStream";
import { prisma } from "@/lib/prisma";

export type LiveIntakeActionState = { success: boolean; message: string; ingestUrl?: string; streamKey?: string };

export async function provisionLiveIntakeAction(_: LiveIntakeActionState, formData: FormData): Promise<LiveIntakeActionState> {
  try {
    const context = await requireRequestCapability("channels.manage");
    const label = String(formData.get("label") || "Sunday service").trim().slice(0, 120) || "Sunday service";
    const provisioned = await provisionLiveIntake({ organizationId: context.organizationId, campusId: context.campusId, actorId: context.actorId }, label);
    revalidatePath("/settings/live-intake");
    return { success: true, message: "Private live stream created. Copy the address and key into your encoder.", ingestUrl: provisioned.ingestUrl, streamKey: provisioned.streamKey };
  } catch (error) {
    return { success: false, message: error instanceof AuthorizationError ? "Your role cannot configure live intake." : error instanceof Error ? error.message : "Live stream setup failed." };
  }
}

export async function revealLiveIntakeAction(): Promise<LiveIntakeActionState> {
  try {
    const context = await requireRequestCapability("channels.manage");
    const intake = await prisma.liveIntake.findFirst({ where: { organizationId: context.organizationId, campusId: context.campusId, status: "READY", provider: "CLOUDFLARE_STREAM" } });
    if (!intake) throw new Error("No active live stream is configured for this church.");
    const credentials = await getCloudflareLiveInputCredentials(intake.providerInputId);
    await prisma.auditEvent.create({ data: { organizationId: context.organizationId, campusId: context.campusId, actorType: "USER", actorUserId: context.actorId, action: "live_intake.credentials_revealed", targetType: "LiveIntake", targetId: intake.id } });
    return { success: true, message: "Keep this stream key private. Anyone with it can send a feed to this church.", ...credentials };
  } catch (error) {
    return { success: false, message: error instanceof AuthorizationError ? "Your role cannot configure live intake." : "The live stream credentials could not be retrieved. Please try again." };
  }
}
