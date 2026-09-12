import { afterEach, describe, expect, it, vi } from "vitest";
const prepareMock = vi.hoisted(() => vi.fn());
const capacityMock = vi.hoisted(() => vi.fn());
const uploadMock = vi.hoisted(() => vi.fn());
const commitMock = vi.hoisted(() => vi.fn());
const resumeMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));

vi.mock("./cloudflareStream", () => ({ prepareCloudflareRecordingMp4: prepareMock }));
vi.mock("@/server/media/storageCapacity", () => ({ assertMediaStorageCapacity: capacityMock }));
vi.mock("@/server/media/s3SourceStorage", () => ({ uploadTrustedSourceStream: uploadMock }));
vi.mock("./service", () => ({ createAndQueueMaterializedLiveRecording: commitMock, resumeMaterializedLiveRecording: resumeMock }));

import {
  __cloudflareMaterializationTestUtils,
  materializeCloudflareRecording,
} from "./materializeCloudflareRecording";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
  prepareMock.mockReset();
  capacityMock.mockReset();
  uploadMock.mockReset();
  commitMock.mockReset();
  resumeMock.mockReset().mockResolvedValue(null);
  delete process.env.LIVE_INTAKE_MAX_RECORDING_BYTES;
});

describe("Cloudflare live recording materialization", () => {
  it("does nothing while Cloudflare is still preparing the private MP4", async () => {
    prepareMock.mockResolvedValue({ state: "pending" });
    global.fetch = vi.fn();
    await expect(materializeCloudflareRecording({ id: "live-1", providerRecordingId: "provider-1", organizationId: "org-1", durationSeconds: 60 })).resolves.toEqual({ state: "pending" });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("copies only a ready Cloudflare MP4 to private storage before creating the sermon", async () => {
    prepareMock.mockResolvedValue({ state: "ready", downloadUrl: "https://customer.cloudflarestream.com/download.mp4?opaque=one-time" });
    global.fetch = vi.fn().mockResolvedValue(new Response("abcd", {
      status: 200,
      headers: { "content-length": "4", "content-type": "video/mp4" },
    }));
    capacityMock.mockResolvedValue(undefined);
    uploadMock.mockResolvedValue({ bucket: "private", objectKey: "source", region: "eu-central-1", sizeBytes: 4, contentType: "video/mp4", originalFileName: "sunday-live-recording.mp4", versionId: null, status: "READY" });
    commitMock.mockResolvedValue(undefined);

    const result = await materializeCloudflareRecording({ id: "live-1", providerRecordingId: "provider-1", organizationId: "org-1", durationSeconds: 60 });

    expect(result.state).toBe("materialized");
    expect(capacityMock).toHaveBeenCalledWith({ incomingBytes: 4 });
    expect(uploadMock).toHaveBeenCalledWith(expect.objectContaining({
      owner: expect.objectContaining({ organizationId: "org-1" }),
      expectedSizeBytes: 4,
      contentType: "video/mp4",
    }));
    expect(commitMock).toHaveBeenCalledWith(expect.objectContaining({ recordingId: "live-1", sourceAsset: expect.objectContaining({ status: "READY" }) }));
  });

  it("rejects non-provider URLs, unknown length, and services over four hours before S3 upload", async () => {
    expect(() => __cloudflareMaterializationTestUtils.requireSafeCloudflareDownloadUrl("http://localhost/file.mp4")).toThrow(/unsafe/i);
    expect(() => __cloudflareMaterializationTestUtils.requiredContentLength(new Response("x"))).toThrow(/content length/i);
    await expect(materializeCloudflareRecording({ id: "live-1", providerRecordingId: "provider-1", organizationId: "org-1", durationSeconds: 14_401 })).rejects.toThrow(/four hours/i);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("validates MP4 response types without trusting a browser filename", () => {
    expect(__cloudflareMaterializationTestUtils.mp4ContentType(new Response("x", { headers: { "content-type": "video/mp4; charset=binary" } }))).toBe("video/mp4");
    expect(() => __cloudflareMaterializationTestUtils.mp4ContentType(new Response("x", { headers: { "content-type": "text/html" } }))).toThrow(/not an MP4/i);
  });
});
