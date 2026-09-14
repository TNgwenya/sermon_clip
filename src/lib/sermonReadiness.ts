/** Use persisted fallback evidence, never a generated title, to classify a cut. */
export function isBasicFallbackClip(clip: { qualityDebugSnapshot?: unknown; qualityWarnings?: unknown }): boolean {
  if (Array.isArray(clip.qualityWarnings) && clip.qualityWarnings.includes("BASIC_CLIP_NO_TRANSCRIPT_INTELLIGENCE")) return true;
  const snapshot = clip.qualityDebugSnapshot;
  if (!snapshot || typeof snapshot !== "object" || !("fallback" in snapshot)) return false;
  const fallback = snapshot.fallback;
  return Boolean(fallback && typeof fallback === "object" && "kind" in fallback && fallback.kind === "BASIC_TIME_BASED_CLIP");
}

export function transcriptReadinessLabel(hasRecord: boolean, hasSegments: boolean, hasBasicFallback: boolean): string {
  if (!hasRecord || !hasSegments) return "Not ready";
  return hasBasicFallback ? "Saved — quality review required" : "Saved — verify wording";
}
