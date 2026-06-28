import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, SectionCard } from "@/components/ui";

export const metadata: Metadata = {
  title: "Privacy Policy | Sermon Clip",
  description: "Privacy Policy for Sermon Clip.",
};

export default function PrivacyPage() {
  return (
    <main className="media-workspace stack-lg">
      <PageHeader
        eyebrow="Legal"
        title="Privacy Policy"
        description="This policy explains how Sermon Clip handles app data, media, and social posting credentials."
        actions={[
          { label: "Terms", href: "/terms", variant: "secondary" },
          { label: "Dashboard", href: "/", variant: "tertiary" },
        ]}
      />

      <SectionCard title="Overview">
        <div className="stack-md">
          <p className="muted small">Last updated: June 28, 2026</p>
          <p>
            Sermon Clip helps churches prepare sermon clips, captions, posting packages,
            and scheduled social media posts. This policy explains what information is used
            and why.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Information We Process">
        <ul className="stack-sm">
          <li>Sermon metadata such as title, speaker, church name, dates, workflow status, and processing logs.</li>
          <li>Clip metadata such as titles, captions, hashtags, quality scores, timestamps, and publishing readiness.</li>
          <li>Posting metadata such as selected platforms, scheduled time, worker status, published URLs, platform post IDs, and error messages.</li>
          <li>Branding settings such as church names, colors, logos, and visual preferences.</li>
          <li>Social platform credentials or tokens that you provide or authorize for YouTube, Facebook, TikTok, Instagram, Threads, or related services.</li>
        </ul>
      </SectionCard>

      <SectionCard title="Media File Storage">
        <div className="stack-md">
          <p>
            Sermon Clip is currently configured so video and audio files can remain on the
            user&apos;s local Mac. The Vercel-hosted control panel is intended to show metadata,
            schedules, and worker status, not to store or stream local media files.
          </p>
          <p>
            Cloud storage may be used for lightweight metadata and schedule state, such as
            records stored in a managed Postgres database.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="How Information Is Used">
        <ul className="stack-sm">
          <li>To process sermons into suggested clips and ready-to-post packages.</li>
          <li>To generate, display, and copy titles, captions, hashtags, and publishing checklists.</li>
          <li>To schedule posts and let a local worker upload approved clips to connected social platforms.</li>
          <li>To show publishing state, platform errors, published URLs, and worker attempts.</li>
          <li>To troubleshoot failed media preparation, failed uploads, and API permission issues.</li>
        </ul>
      </SectionCard>

      <SectionCard title="Third-Party Services">
        <p>
          Sermon Clip may interact with third-party APIs and services you configure, including
          YouTube, Google APIs, Facebook, Meta APIs, TikTok, Instagram, Threads, Vercel, Neon,
          and OpenAI. Those services process data according to their own terms and privacy
          policies.
        </p>
      </SectionCard>

      <SectionCard title="Tokens and Revocation">
        <div className="stack-md">
          <p>
            Social platform tokens are used only to perform the actions you authorize, such as
            reading channel/page metadata, checking analytics, or uploading scheduled posts.
          </p>
          <p>
            You can revoke access at any time from the relevant platform account settings,
            such as Google Account permissions, Facebook/Meta business integrations, or
            TikTok app permissions. You can also remove tokens from Sermon Clip&apos;s local
            environment variables or connected credential storage.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Contact">
        <p>
          For privacy questions or token removal requests, contact the Sermon Clip operator
          at <a className="text-link" href="mailto:thabangngwenya@gmail.com">thabangngwenya@gmail.com</a>.
        </p>
        <p className="muted small">
          See the <Link className="text-link" href="/terms">Terms of Service</Link> for usage responsibilities.
        </p>
      </SectionCard>
    </main>
  );
}
