import Link from "next/link";

import { BrandingSettingsForm } from "./branding-settings-form";
import {
  canPersistedTenantCapability,
  requireRequestCapability,
} from "@/server/auth/requestAuthorization";
import { getBrandingHelperPayload, getBrandingSettings } from "@/server/branding/settings";

export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  const requestContext = await requireRequestCapability("brand.read", {
    campusId: null,
  });
  const settings = await getBrandingSettings(requestContext.organizationId);
  const brandingHelper = getBrandingHelperPayload(settings);
  const canManage = await canPersistedTenantCapability(
    requestContext,
    "brand.manage",
    { campusId: null },
  );

  return (
    <main className="container brand-kit-shell stack-lg">
      <header className="brand-kit-hero">
        <div className="stack-sm">
          <p className="kicker">Church Brand Kit</p>
          <h1>Make every clip feel like your church.</h1>
          <p className="muted">Set the logo, colors, and caption style used when clips are prepared.</p>
        </div>
      </header>

      <BrandingSettingsForm
        settings={settings}
        helperPayload={brandingHelper}
        canManage={canManage}
      />

      <Link href="/" className="text-link">
        Back to dashboard
      </Link>
    </main>
  );
}
