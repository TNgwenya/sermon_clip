import Link from "next/link";

import { canRunLocalMediaProcessing } from "@/server/runtime/workerRuntime";

import { NewSermonForm } from "./new-sermon-form";

type NewSermonSearchParams = {
  youtubeUrl?: string;
};

export default async function NewSermonPage({ searchParams }: { searchParams: Promise<NewSermonSearchParams> }) {
  const params = await searchParams;
  const canUploadMedia = canRunLocalMediaProcessing();

  return (
    <main id="main-content" className="upload-page-shell premium-intake-page stack-lg">
      <header className="upload-hero premium-intake-hero">
        <div className="stack-sm">
          <Link href="/" className="text-link">Back to your studio</Link>
          <p className="kicker">Add a sermon</p>
          <h1>Create clips from one message.</h1>
          <p className="muted">
            Bring in the recording. Sermon Clip will find complete, meaningful moments for your team to review.
          </p>
        </div>
        <span className="intake-step-label">Step 1 of 5</span>
      </header>

      <nav className="workflow-spine intake-workflow-spine" aria-label="Sermon Clip workflow">
        <ol>
          <li><span className="workflow-spine-step is-current" aria-current="step"><strong>01</strong> Add sermon</span></li>
          <li><span className="workflow-spine-step"><strong>02</strong> Analyze</span></li>
          <li><span className="workflow-spine-step"><strong>03</strong> Review clips</span></li>
          <li><span className="workflow-spine-step"><strong>04</strong> Edit &amp; brand</span></li>
          <li><span className="workflow-spine-step"><strong>05</strong> Prepare &amp; post</span></li>
        </ol>
      </nav>

      <div className="premium-intake-layout">
        <NewSermonForm initialYoutubeUrl={params.youtubeUrl ?? ""} canUploadMedia={canUploadMedia} />

        <aside className="upload-outcome-panel" aria-label="What Sermon Clip will prepare">
          <div className="stack-sm">
            <p className="kicker">What you will get</p>
            <h2>A thoughtful first cut, ready for human review.</h2>
            <p className="muted">
              Sermon Clip keeps the message intact while helping your team move faster.
            </p>
          </div>

          <div className="outcome-media-composition" aria-hidden="true">
            <div className="outcome-source-frame">
              <span>Full sermon</span>
              <strong>48:20</strong>
            </div>
            <span className="outcome-bridge">becomes</span>
            <div className="outcome-clip-stack">
              <div><span>Strong opening</span><strong>0:42</strong></div>
              <div><span>Teaching moment</span><strong>0:58</strong></div>
            </div>
          </div>

          <ol className="outcome-assurance-list">
            <li><strong>Meaningful moments</strong><span>Suggestions are chosen for clarity, context, and ministry value.</span></li>
            <li><strong>Your approval stays central</strong><span>Nothing moves to posting until your team reviews it.</span></li>
            <li><strong>Ready for every channel</strong><span>Edit captions, framing, branding, and post copy in one workflow.</span></li>
          </ol>
        </aside>
      </div>
    </main>
  );
}
