import { describe, expect, it } from "vitest";

import { createZipArchive } from "@/lib/zipArchive";

function readEntryNames(zip: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;

  while (offset < zip.length) {
    const signature = zip.readUInt32LE(offset);
    if (signature !== 0x04034b50) {
      break;
    }

    const compressedSize = zip.readUInt32LE(offset + 18);
    const nameLength = zip.readUInt16LE(offset + 26);
    const extraLength = zip.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    names.push(zip.subarray(nameStart, nameStart + nameLength).toString());
    offset = nameStart + nameLength + extraLength + compressedSize;
  }

  return names;
}

describe("createZipArchive", () => {
  it("creates a zip file with the expected signatures and entries", () => {
    const zip = createZipArchive([
      { name: "clip/video.mp4", data: Buffer.from("video") },
      { name: "clip/captions/tiktok.txt", data: "caption" },
    ]);

    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    expect(zip.subarray(zip.length - 22).readUInt32LE(0)).toBe(0x06054b50);
    expect(readEntryNames(zip)).toEqual([
      "clip/video.mp4",
      "clip/captions/tiktok.txt",
    ]);
  });

  it("sanitizes unsafe path characters in entry names", () => {
    const zip = createZipArchive([
      { name: "/Prayer: healing?/caption.txt", data: "Amen" },
    ]);

    expect(readEntryNames(zip)).toEqual(["Prayer- healing-/caption.txt"]);
  });
});

