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
          <p className="muted">Save your logo, colors, watermark placement, lower-third style, and default caption look for ready-to-post sermon clips.</p>
        </div>
        <div className="brand-kit-hero-meta" aria-label="Brand kit usage">
          <span>Used in Clip Studio</span>
          <span>Applied during preparation</span>
          <span>Ready-to-post defaults</span>
        </div>
      </header>

      <BrandingSettingsForm settings={settings} helperPayload={brandingHelper} />

      <Link href="/" className="text-link">
        Back to dashboard
      </Link>
    </main>
  );
}
