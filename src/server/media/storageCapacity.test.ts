import { describe, expect, it } from "vitest";

import {
  GIBIBYTE,
  configuredMinimumFreeBytes,
  insufficientMediaStorageMessage,
  requiredMediaStorageBytes,
} from "./storageCapacity";

describe("media storage capacity", () => {
  it("uses an eight GiB reserve by default and accepts a positive configured value", () => {
    expect(configuredMinimumFreeBytes(undefined)).toBe(8 * GIBIBYTE);
    expect(configuredMinimumFreeBytes("3.5")).toBe(3.5 * GIBIBYTE);
    expect(configuredMinimumFreeBytes("0")).toBe(8 * GIBIBYTE);
  });

  it("includes the incoming upload in the free-space requirement", () => {
    expect(requiredMediaStorageBytes(2 * GIBIBYTE, 8 * GIBIBYTE)).toBe(10 * GIBIBYTE);
  });

  it("reports a practical error without exposing a filesystem path", () => {
    expect(insufficientMediaStorageMessage({
      availableBytes: 4 * GIBIBYTE,
      incomingBytes: 2 * GIBIBYTE,
      reserveBytes: 8 * GIBIBYTE,
    })).toContain("10.0 GiB free");
  });
});
