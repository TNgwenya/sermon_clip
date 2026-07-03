export const CLIP_STUDIO_TRANSCRIPT_COMMAND_EVENT = "clip-studio-transcript-command";

export type ClipStudioTranscriptCommand =
  | "set-start"
  | "set-end"
  | "set-start-seconds"
  | "set-end-seconds"
  | "snap-to-sentence"
  | "reset-ai"
  | "update-text"
  | "reset-text";

export type ClipStudioTranscriptCommandDetail = {
  command: ClipStudioTranscriptCommand;
  segmentId?: string;
  seconds?: number;
  text?: string;
};
