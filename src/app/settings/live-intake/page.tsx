import Link from "next/link";
import { canPersistedTenantCapability, requireRequestCapability } from "@/server/auth/requestAuthorization";
import { liveIntakeProviderReady } from "@/server/liveIntake/cloudflareStream";
import { prisma } from "@/lib/prisma";
import { LiveIntakeForm } from "./live-intake-form";

export const dynamic = "force-dynamic";

export default async function LiveIntakePage() {
  const context = await requireRequestCapability("channels.read");
  const [canManage, intake] = await Promise.all([
    canPersistedTenantCapability(context, "channels.manage"),
    prisma.liveIntake.findFirst({ where: { organizationId: context.organizationId, campusId: context.campusId }, include: { recordings: { orderBy: { createdAt: "desc" }, take: 5 } } }),
  ]);
  return <main className="container stack-lg"><Link href="/settings/intake">← Sermon intake</Link><header><p>LIVE INTAKE · PILOT</p><h1>Receive Sunday directly</h1><p>Set up one private Sermon Clip destination in YoloBox or OBS. The church keeps streaming to YouTube and Facebook as normal. When the service ends, its recording enters the normal review-first sermon workflow.</p></header>
    {intake ? <section><h2>{intake.label}</h2><p>Status: <strong>{intake.status}</strong>. Provider key: never stored in Sermon Clip. Provider recording retention: {intake.recordingRetentionDays} days. Imported sermon files follow the church’s separate storage policy.</p><p>{intake.lastError || "No live-stream problem recorded."}</p></section> : null}
    <LiveIntakeForm enabled={liveIntakeProviderReady()} canManage={canManage} hasIntake={Boolean(intake)} />
    <section><h2>What happens each Sunday</h2><ol><li>The encoder sends a private RTMPS feed to Sermon Clip.</li><li>The provider finalizes a recording after the stream ends.</li><li>A trusted worker copies it to private source storage, then queues normal clip processing.</li><li>Your team reviews and approves clips. Nothing publishes automatically.</li></ol></section>
    {intake?.recordings.length ? <section><h2>Recent recordings</h2><ul>{intake.recordings.map((recording) => <li key={recording.id}>{recording.title || "Sunday live recording"} — {recording.status}</li>)}</ul></section> : null}
  </main>;
}
