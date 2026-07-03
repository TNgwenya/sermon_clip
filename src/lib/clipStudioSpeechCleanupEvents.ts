export const CLIP_STUDIO_SPEECH_CLEANUP_EDIT_EVENT = "clip-studio-speech-cleanup-edit";

export type ClipStudioSpeechCleanupEditCommand =
  | "add-cut"
  | "toggle-cut"
  | "set-all-cuts"
  | "delete-cut"
  | "update-cut"
  | "reset-cuts";

export type ClipStudioSpeechCleanupEditDetail = {
  command: ClipStudioSpeechCleanupEditCommand;
  cutId?: string;
  startSeconds?: number;
  endSeconds?: number;
  enabled?: boolean;
};
