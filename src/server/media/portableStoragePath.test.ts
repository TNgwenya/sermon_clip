import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  PORTABLE_STORAGE_PATH_PREFIX,
  resolvePortableStoragePath,
  toPortableStoragePath,
  transformPortableMediaPathValues,
} from "./portableStoragePath";

const macRoot = "/Users/example/sermon-media";
const ec2Root = "/srv/sermon-clip/storage";

describe("portable sermon storage paths", () => {
  it("stores a path below the configured root without the machine-specific prefix", () => {
    expect(toPortableStoragePath(`${macRoot}/sermons/grace/source/source.mp4`, macRoot)).toBe(
      `${PORTABLE_STORAGE_PATH_PREFIX}sermons/grace/source/source.mp4`,
    );
  });

  it("resolves the same reference beneath a different machine root", () => {
    expect(resolvePortableStoragePath(
      `${PORTABLE_STORAGE_PATH_PREFIX}sermons/grace/source/source.mp4`,
      ec2Root,
    )).toBe(path.join(ec2Root, "sermons/grace/source/source.mp4"));
  });

  it("leaves paths outside sermon storage unchanged", () => {
    expect(toPortableStoragePath("/tmp/unmanaged.mp4", macRoot)).toBe("/tmp/unmanaged.mp4");
    expect(resolvePortableStoragePath("https://cdn.example/video.mp4", ec2Root)).toBe(
      "https://cdn.example/video.mp4",
    );
  });

  it("rejects traversal in portable references", () => {
    expect(() => resolvePortableStoragePath(`${PORTABLE_STORAGE_PATH_PREFIX}../secret`, ec2Root)).toThrow(
      "Invalid portable sermon storage path",
    );
  });

  it("transforms nested Prisma inputs and results only for known path fields", () => {
    const stored = transformPortableMediaPathValues({
      data: {
        sourceVideoPath: `${macRoot}/sermons/grace/source/source.mp4`,
        unrelatedPath: `${macRoot}/leave-this-alone`,
        clips: [{ filePath: `${macRoot}/sermons/grace/clips/clip.mp4` }],
      },
    }, "store", macRoot);

    expect(stored).toEqual({
      data: {
        sourceVideoPath: `${PORTABLE_STORAGE_PATH_PREFIX}sermons/grace/source/source.mp4`,
        unrelatedPath: `${macRoot}/leave-this-alone`,
        clips: [{ filePath: `${PORTABLE_STORAGE_PATH_PREFIX}sermons/grace/clips/clip.mp4` }],
      },
    });
  });

  it("does not flatten non-plain objects returned by Prisma", () => {
    class DecimalLike {
      constructor(readonly value: string) {}
    }
    const decimal = new DecimalLike("12.5");

    expect(transformPortableMediaPathValues({ amount: decimal }, "resolve", ec2Root)).toEqual({
      amount: decimal,
    });
  });
});
