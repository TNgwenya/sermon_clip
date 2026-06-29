import type { Metadata } from "next";
import Link from "next/link";

import { PageHeader, SectionCard } from "@/components/ui";

export const metadata: Metadata = {
  title: "User Data Deletion | Sermon Clip",
  description: "Instructions for requesting deletion of Sermon Clip user data.",
};

export default function DataDeletionPage() {
  return (
    <main className="media-workspace stack-lg">
      <PageHeader
        eyebrow="Legal"
        title="User Data Deletion"
        description="Instructions for requesting deletion of Sermon Clip data and connected social account credentials."
        actions={[
          { label: "Privacy Policy", href: "/privacy", variant: "secondary" },
          { label: "Terms", href: "/terms", variant: "tertiary" },
        ]}
      />

      <SectionCard title="How To Request Deletion">
        <div className="stack-md">
          <p>
            To request deletion of data connected to your Sermon Clip use, contact the
            Sermon Clip operator at{" "}
            <a className="text-link" href="mailto:thabangngwenya@gmail.com">
              thabangngwenya@gmail.com
            </a>
            .
          </p>
          <p>
            Include your name, the church or workspace you use Sermon Clip with, and the
            Facebook or Instagram account/page that was connected. This information helps
            verify the request and locate the correct records.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="What Can Be Deleted">
        <ul className="stack-sm">
          <li>Connected Meta, Facebook, or Instagram credential records.</li>
          <li>Social account records imported or created for publishing workflows.</li>
          <li>Posting metadata associated with the connected social account where deletion is requested and verified.</li>
          <li>Workspace records that the Sermon Clip operator controls and can safely remove.</li>
        </ul>
      </SectionCard>

      <SectionCard title="What Happens Next">
        <div className="stack-md">
          <p>
            After the request is verified, Sermon Clip will remove the applicable stored
            credentials and account records from its systems. Removing these records stops
            Sermon Clip from accessing Meta data or publishing through that connected
            Facebook or Instagram account.
          </p>
          <p>
            You can also revoke Sermon Clip access directly from your Meta, Facebook, or
            Instagram account settings at any time.
          </p>
        </div>
      </SectionCard>

      <SectionCard title="Related Policies">
        <p>
          See the <Link className="text-link" href="/privacy">Privacy Policy</Link> for
          more detail about data use, social platform credentials, and token removal.
        </p>
      </SectionCard>
    </main>
  );
}
