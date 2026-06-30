import Link from "next/link";

import { NewSermonForm } from "./new-sermon-form";

type NewSermonSearchParams = {
  youtubeUrl?: string;
};

export default async function NewSermonPage({ searchParams }: { searchParams: Promise<NewSermonSearchParams> }) {
  const params = await searchParams;

  return (
    <main className="upload-page-shell stack-lg">
      <header className="upload-hero stack-sm">
        <Link href="/" className="text-link">Back to dashboard</Link>
        <p className="kicker">Long sermon to clips</p>
        <h1>Start with one sermon. Leave with polished clips.</h1>
      </header>

      <NewSermonForm initialYoutubeUrl={params.youtubeUrl ?? ""} />

      <section className="card workflow-card stack-sm">
        <h2>What happens next</h2>
        <div className="workflow-strip">
          <div className="workflow-step done">Add sermon</div>
          <div className="workflow-step pending">Find best moments</div>
          <div className="workflow-step pending">Approve clips</div>
          <div className="workflow-step pending">Prepare clips</div>
          <div className="workflow-step pending">Download and post</div>
        </div>
      </section>

      <section className="upload-preview-band">
        <div className="sermon-before-frame">
          <span className="small muted">Source sermon</span>
          <div className="wide-video-placeholder" />
        </div>
        <div className="flow-arrow">to</div>
        <div className="shorts-stack-preview" aria-label="Generated clip preview">
          <div className="shorts-card-preview">
            <span>Prayer moment</span>
          </div>
          <div className="shorts-card-preview second">
            <span>Quote clip</span>
          </div>
        </div>
      </section>
    </main>
  );
}
