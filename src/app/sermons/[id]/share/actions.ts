"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { AuthorizationError } from "@/server/auth/authorization";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import {
  PublicSermonNotFoundError,
  PublicSermonSourceUnavailableError,
  PublicSermonSlugConflictError,
  publicSermonManagementSchema,
  saveManagedPublicSermonPage,
} from "@/server/publicSermon/publicSermonService";
import { tenantScope } from "@/server/tenancy/scope";

export type PublicSermonActionState = {
  success: boolean;
  message: string;
  publishedSlug?: string;
  fieldErrors?: {
    slug?: string;
    title?: string;
    summary?: string;
    primaryCtaLabel?: string;
    primaryCtaUrl?: string;
  };
};

export async function savePublicSermonPageAction(
  sermonId: string,
  _previousState: PublicSermonActionState,
  formData: FormData,
): Promise<PublicSermonActionState> {
  let requestContext;
  try {
    requestContext = await requireRequestCapability("content.update");
  } catch (error) {
    return {
      success: false,
      message: error instanceof AuthorizationError
        ? "Your role can review this sermon but cannot manage its public page."
        : "Public page permissions could not be verified.",
    };
  }

  const intentValue = formData.get("intent");
  const rawInput = {
    sermonId,
    slug: formData.get("slug"),
    title: formData.get("title"),
    summary: formData.get("summary"),
    primaryCtaLabel: formData.get("primaryCtaLabel"),
    primaryCtaUrl: formData.get("primaryCtaUrl"),
    intent: intentValue,
    actorUserId: requestContext.actorId,
    tenantScope: tenantScope(requestContext),
  };
  const result = publicSermonManagementSchema.safeParse(rawInput);
  if (!result.success) {
    const fields = result.error.flatten().fieldErrors;
    return {
      success: false,
      message: "Correct the highlighted public page details.",
      fieldErrors: {
        slug: fields.slug?.[0],
        title: fields.title?.[0],
        summary: fields.summary?.[0],
        primaryCtaLabel: fields.primaryCtaLabel?.[0],
        primaryCtaUrl: fields.primaryCtaUrl?.[0],
      },
    };
  }

  try {
    const page = await saveManagedPublicSermonPage(result.data);
    revalidatePath(`/sermons/${encodeURIComponent(sermonId)}/share`);
    revalidatePath(`/s/${encodeURIComponent(page.slug)}`);
    revalidatePath("/s/[slug]", "page");
    return {
      success: true,
      publishedSlug: page.status === "PUBLISHED" ? page.slug : undefined,
      message: page.status === "PUBLISHED"
        ? "Public sermon hub is live."
        : page.status === "ARCHIVED"
          ? "Public sermon hub archived. Its public URL now returns not found."
          : "Public sermon hub saved as a private draft.",
    };
  } catch (error) {
    if (error instanceof PublicSermonSlugConflictError) {
      return {
        success: false,
        message: error.message,
        fieldErrors: { slug: error.message },
      };
    }
    if (error instanceof PublicSermonNotFoundError) {
      return { success: false, message: error.message };
    }
    if (error instanceof PublicSermonSourceUnavailableError) {
      return { success: false, message: error.message };
    }
    if (error instanceof z.ZodError) {
      return { success: false, message: "Correct the public page details and try again." };
    }
    return {
      success: false,
      message: "The public sermon hub could not be saved. Try again.",
    };
  }
}
