import Link from "next/link";

import { BrandingSettingsForm } from "./branding-settings-form";
import { getBrandingHelperPayload, getBrandingSettings } from "@/server/branding/settings";

export const dynamic = "force-dynamic";

export default async function BrandingSettingsPage() {
  const settings = await getBrandingSettings();
  const brandingHelper = getBrandingHelperPayload(settings);

  return (
    <main className="container brand-kit-shell stack-lg">
      <header className="brand-kit-hero">
        <div className="stack-sm">
          <p className="kicker">Church Brand Kit</p>
          <h1>Make every clip feel like your church.</h1>
          <p className="muted">Set the logo, colors, and caption style used when clips are prepared.</p>
        </div>
      </header>

      <BrandingSettingsForm settings={settings} helperPayload={brandingHelper} />

      <Link href="/" className="text-link">
        Back to dashboard
      </Link>
    </main>
  );
}
