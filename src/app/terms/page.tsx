import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, SectionCard } from "@/components/ui";

export const metadata: Metadata = {
  title: "Terms of Service | Sermon Clip",
  description: "Terms of Service for Sermon Clip.",
};

export default function TermsPage() {
  return (
    <main className="media-workspace stack-lg">
      <PageHeader
        eyebrow="Legal"
        title="Terms of Service"
        description="These terms describe acceptable use of Sermon Clip."
        actions={[
          { label: "Privacy Policy", href: "/privacy", variant: "secondary" },
          { label: "Dashboard", href: "/", variant: "tertiary" },
        ]}
      />

      <SectionCard title="Sermon Clip">
        <div className="stack-md">
          <p className="muted small">Last updated: June 28, 2026</p>
          <p>
            Sermon Clip helps churches and ministry teams prepare sermon clips, captions,
            posting packages, and scheduled social media publishing workflows.
          </p>
          <p>
            By using Sermon Clip, you agree to use the service responsibly and only with
            content, accounts, and permissions that you are authorized to manage.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Your Responsibilities">
        <ul className="stack-sm">
          <li>You are responsible for the sermons, clips, captions, and metadata you upload or create.</li>
          <li>You must have permission to use and publish the video, audio, images, logos, captions, and other materials you provide.</li>
          <li>You must review clips, captions, titles, hashtags, and scheduled posts before publishing.</li>
          <li>You must comply with the rules and terms of the social platforms you connect, including YouTube, Facebook, TikTok, Instagram, and related Meta services.</li>
          <li>You may not use Sermon Clip to publish unlawful, harmful, misleading, infringing, abusive, or unauthorized content.</li>
        </ul>
      </SectionCard>

      <SectionCard title="Social Platform Publishing">
        <div className="stack-md">
          <p>
            Sermon Clip may help create scheduled posting jobs and upload clips through
            official social platform APIs when you provide valid credentials and authorize
            access.
          </p>
          <p>
            Social platforms may reject, limit, remove, privatize, or review content based on
            their own policies, app review status, API permissions, account permissions, or
            platform availability. Sermon Clip cannot guarantee that any post will be accepted
            or publicly published by a third-party platform.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Local Media and Availability">
        <div className="stack-md">
          <p>
            Sermon Clip is currently designed so media files and posting workers can remain
            on the user&apos;s local Mac while cloud services store lightweight metadata and
            scheduling state.
          </p>
          <p>
            Automatic posting depends on the local worker being configured, awake, online,
            and authorized to access the relevant social accounts.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="No Warranties">
        <p>
          Sermon Clip is provided as-is. We do not guarantee uninterrupted operation,
          error-free generated captions or recommendations, successful third-party uploads,
          or continued access to third-party APIs.
        </p>
      </SectionCard>

      <SectionCard title="Contact">
        <p>
          For questions about these terms, contact the Sermon Clip operator at{" "}
          <a className="text-link" href="mailto:thabangngwenya@gmail.com">thabangngwenya@gmail.com</a>.
        </p>
        <p className="muted small">
          See the <Link className="text-link" href="/privacy">Privacy Policy</Link> for information about data use and token removal.
        </p>
      </SectionCard>
    </main>
  );
}
