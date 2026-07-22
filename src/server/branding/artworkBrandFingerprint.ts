import { createHash } from "node:crypto";

export type ArtworkBrandFingerprintInput = {
  churchName: string;
  primaryColor: string;
  secondaryColor: string;
  fontFamily: string;
  logoDataUrl?: string | null;
};

function normalizedFingerprintInput(input: ArtworkBrandFingerprintInput): string {
  return JSON.stringify({
    version: 1,
    churchName: input.churchName.trim(),
    primaryColor: input.primaryColor.trim().toUpperCase(),
    secondaryColor: input.secondaryColor.trim().toUpperCase(),
    fontFamily: input.fontFamily.trim(),
    logoDataUrl: input.logoDataUrl?.trim() || null,
  });
}

/**
 * Identifies the exact brand inputs used by the deterministic artwork renderer.
 * It intentionally includes the logo bytes so replacing a logo at the same path
 * still invalidates previously approved artwork.
 */
export function createArtworkBrandFingerprint(
  input: ArtworkBrandFingerprintInput,
): string {
  const digest = createHash("sha256")
    .update(normalizedFingerprintInput(input))
    .digest("hex")
    .slice(0, 32);
  return `artwork-brand-v1-${digest}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function readArtworkBrandFingerprint(metadata: unknown): string | null {
  const metadataRecord = asRecord(metadata);
  const designStudio = asRecord(metadataRecord?.designStudio);
  const brandSnapshot = asRecord(designStudio?.brandSnapshot);
  return typeof brandSnapshot?.fingerprint === "string" && brandSnapshot.fingerprint.trim()
    ? brandSnapshot.fingerprint.trim()
    : null;
}
