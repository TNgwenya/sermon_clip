import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ recording: { id: "audit-recording", organizationId: "audit-org", title: "Audit", durationSeconds: 60, receivedAt: new Date(), sermonId: null as string | null, sermon: null as {id:string} | null, status: "MATERIALIZING", liveIntake: { id: "audit-intake", organizationId: "audit-org", campusId: null, status: "READY" } }, uploads: [] as string[], queue: vi.fn().mockRejectedValue(new Error("simulated queue outage")) }));
vi.mock("@/lib/prisma", () => {
  const db = {
    $queryRaw: vi.fn(),
    liveRecording: { findUnique: async () => ({...state.recording}), update: async ({data}: {data:{sermonId:string}}) => { state.recording.sermonId=data.sermonId; state.recording.sermon={id:data.sermonId}; }, updateMany: vi.fn().mockResolvedValue({count:1}) },
    organization: {findUnique: async () => ({name:"Audit", defaultLanguage:"en"})},
    sermon: {create: vi.fn(), findFirst: async () => ({id:state.recording.sermonId})},
    sermonSourceAsset: {create:vi.fn()}, auditEvent: {create:vi.fn()}
  };
  return {prisma:{...db, $transaction: async (run: (tx: typeof db)=>unknown) => run(db)}};
});
vi.mock("@/server/agents/processing",()=>({queueSermonProcessingJob:state.queue}));
vi.mock("@/server/media/storageCapacity",()=>({assertMediaStorageCapacity:vi.fn()}));
vi.mock("@/server/media/s3SourceStorage",()=>({assertS3SourceObjectOwnedBy:vi.fn(), uploadTrustedSourceStream:async ({owner}: {owner:{sermonId:string}})=>{state.uploads.push(owner.sermonId);return {bucket:"audit",objectKey:owner.sermonId,region:"test",sizeBytes:4,contentType:"video/mp4",originalFileName:"audit.mp4",status:"READY"};}}));
vi.mock("./cloudflareStream",()=>({prepareCloudflareRecordingMp4:async()=>({state:"ready",downloadUrl:"https://customer.cloudflarestream.com/audit.mp4"})}));
import {materializeCloudflareRecording} from "./materializeCloudflareRecording";
it("resumes a linked recording after a queue outage without another provider transfer",async()=>{
  vi.stubGlobal("fetch",vi.fn().mockImplementation(async()=>new Response("abcd",{headers:{"content-length":"4","content-type":"video/mp4"}})));
  const candidate={id:"audit-recording",organizationId:"audit-org",providerRecordingId:"audit-provider",durationSeconds:60};
  try {
    await expect(materializeCloudflareRecording(candidate)).rejects.toThrow("simulated queue outage");
    const linked=state.recording.sermonId;
    expect(linked).toBeTruthy();
    // The worker marks FAILED and then claims MATERIALIZING before retrying.
    state.recording.status="MATERIALIZING";
    state.queue.mockResolvedValueOnce({ id: "recovered-job", reusedExisting: false });
    await expect(materializeCloudflareRecording(candidate)).resolves.toEqual({state:"materialized",sermonId:linked});
    expect(state.uploads).toHaveLength(1);
    expect(state.uploads[0]).toEqual(linked);
    expect(state.queue).toHaveBeenCalledTimes(2);
  } finally {vi.unstubAllGlobals();}
});
