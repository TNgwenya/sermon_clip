export const CLIP_STUDIO_LAYER_COMMAND_EVENT = "clip-studio-layer-command";

export type ClipStudioLayerCommand =
  | "toggle-captions"
  | "toggle-hook"
  | "toggle-broll-layer"
  | "toggle-broll-card";

export type ClipStudioLayerCommandDetail = {
  command: ClipStudioLayerCommand;
  cardId?: string;
};
