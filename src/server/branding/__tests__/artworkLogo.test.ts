import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolvePath: vi.fn(),
  stat: vi.fn(),
  sharp: vi.fn(),
  rotate: vi.fn(),
  resize: vi.fn(),
  png: vi.fn(),
  toBuffer: vi.fn(),
}));

vi.mock("node:fs/promises", () => ({ stat: mocks.stat }));
vi.mock("@/server/branding/logoStorage", () => ({
  resolveAvailableBrandingLogoPath: mocks.resolvePath,
}));
vi.mock("sharp", () => ({ default: mocks.sharp }));

import { readBrandingArtworkLogoDataUrl } from "@/server/branding/artworkLogo";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolvePath.mockResolvedValue("/managed/branding/logo.svg");
  mocks.stat.mockResolvedValue({ isFile: () => true, size: 2_048 });
  mocks.rotate.mockReturnValue({ resize: mocks.resize });
  mocks.resize.mockReturnValue({ png: mocks.png });
  mocks.png.mockReturnValue({ toBuffer: mocks.toBuffer });
  mocks.toBuffer.mockResolvedValue(Buffer.from("raster-logo"));
  mocks.sharp.mockReturnValue({ rotate: mocks.rotate });
});

describe("branding artwork logo", () => {
  it("rasterizes a managed logo into one bounded PNG data URL", async () => {
    await expect(readBrandingArtworkLogoDataUrl("/configured/logo.svg"))
      .resolves.toBe(`data:image/png;base64,${Buffer.from("raster-logo").toString("base64")}`);

    expect(mocks.sharp).toHaveBeenCalledWith("/managed/branding/logo.svg", {
      limitInputPixels: 24_000_000,
    });
    expect(mocks.resize).toHaveBeenCalledWith(expect.objectContaining({
      width: 420,
      height: 160,
      fit: "inside",
      withoutEnlargement: true,
    }));
  });

  it("omits unavailable or unreasonably large logo files", async () => {
    mocks.resolvePath.mockResolvedValueOnce(null);
    await expect(readBrandingArtworkLogoDataUrl("missing"))
      .resolves.toBeNull();
    expect(mocks.sharp).not.toHaveBeenCalled();

    mocks.stat.mockResolvedValueOnce({ isFile: () => true, size: 9 * 1024 * 1024 });
    await expect(readBrandingArtworkLogoDataUrl("large"))
      .resolves.toBeNull();
    expect(mocks.sharp).not.toHaveBeenCalled();
  });

  it("fails closed when an uploaded image cannot be decoded", async () => {
    mocks.toBuffer.mockRejectedValueOnce(new Error("invalid image"));
    await expect(readBrandingArtworkLogoDataUrl("broken"))
      .resolves.toBeNull();
  });
});
