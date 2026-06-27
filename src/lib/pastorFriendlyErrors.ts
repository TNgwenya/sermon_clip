export function pastorFriendlyError(message: string | null | undefined): string {
  if (!message?.trim()) {
    return "Something went wrong while preparing this clip. Please retry the step.";
  }

  const lower = message.toLowerCase();

  if (lower.includes("drawtext") || lower.includes("filter not found")) {
    return "Text or branding overlay rendering failed because this FFmpeg install is missing the text overlay filter. The clip may still be downloadable without that overlay.";
  }

  if (lower.includes("source video") || lower.includes("source clip") || lower.includes("does not exist")) {
    return "The app could not find the video file it needs. Check that the sermon media still exists, then retry.";
  }

  if (lower.includes("already in progress")) {
    return "This clip is already being processed. Wait for the current step to finish, then refresh.";
  }

  if (lower.includes("must be rendered")) {
    return "Render the clip first, then try this step again.";
  }

  if (lower.includes("must be approved")) {
    return "Approve this clip before running this step.";
  }

  return "This step failed. Please retry it, and check the technical details if it fails again.";
}