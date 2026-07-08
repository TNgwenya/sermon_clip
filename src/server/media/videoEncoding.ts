export type VideoEncodingPurpose = "render" | "caption" | "overlay" | "export";

export const SOFTWARE_VIDEO_ENCODER = "libx264";
export const APPLE_HARDWARE_VIDEO_ENCODER = "h264_videotoolbox";

const PURPOSE_ENV_PREFIX: Record<VideoEncodingPurpose, string> = {
  render: "CLIP_RENDER",
  caption: "CLIP_CAPTION_BURN",
  overlay: "CLIP_OVERLAY",
  export: "CLIP_EXPORT",
};

const DEFAULT_SOFTWARE_PRESET: Record<VideoEncodingPurpose, string> = {
  render: "veryfast",
  caption: "veryfast",
  overlay: "veryfast",
  export: "medium",
};

const DEFAULT_SOFTWARE_CRF: Record<VideoEncodingPurpose, string> = {
  render: "21",
  caption: "20",
  overlay: "20",
  export: "18",
};

const DEFAULT_HARDWARE_BITRATE: Record<VideoEncodingPurpose, string> = {
  render: "8000k",
  caption: "8000k",
  overlay: "8000k",
  export: "12000k",
};

const DEFAULT_AUDIO_BITRATE: Record<VideoEncodingPurpose, string> = {
  render: "160k",
  caption: "160k",
  overlay: "160k",
  export: "192k",
};

function envValue(name: string): string | null {
  const value = process.env[name]?.trim();
  return value && value.length > 0 ? value : null;
}

function firstEnv(names: string[]): string | null {
  for (const name of names) {
    const value = envValue(name);
    if (value) {
      return value;
    }
  }

  return null;
}

function purposeEnvName(purpose: VideoEncodingPurpose, suffix: string): string {
  return `${PURPOSE_ENV_PREFIX[purpose]}_${suffix}`;
}

function defaultEncoderForPurpose(purpose: VideoEncodingPurpose): string {
  if (purpose === "export" || purpose === "overlay") {
    return SOFTWARE_VIDEO_ENCODER;
  }

  return process.platform === "darwin" ? APPLE_HARDWARE_VIDEO_ENCODER : SOFTWARE_VIDEO_ENCODER;
}

export function resolvePreferredVideoEncoder(purpose: VideoEncodingPurpose): string {
  const purposeSpecific = firstEnv([
    purpose === "export" ? "CLIP_FINAL_VIDEO_ENCODER" : "",
    purposeEnvName(purpose, "VIDEO_ENCODER"),
  ].filter(Boolean));

  if (purposeSpecific) {
    return purposeSpecific;
  }

  if (purpose === "caption") {
    const sharedPreviewEncoder = firstEnv([
      "CLIP_RENDER_VIDEO_ENCODER",
      "CLIP_PREVIEW_VIDEO_ENCODER",
      "CLIP_EXPORT_VIDEO_ENCODER",
    ]);
    return sharedPreviewEncoder ?? defaultEncoderForPurpose(purpose);
  }

  if (purpose === "overlay") {
    const sharedPreviewEncoder = firstEnv([
      "CLIP_RENDER_VIDEO_ENCODER",
      "CLIP_PREVIEW_VIDEO_ENCODER",
      "CLIP_EXPORT_VIDEO_ENCODER",
    ]);
    return sharedPreviewEncoder ?? defaultEncoderForPurpose(purpose);
  }

  if (purpose === "render") {
    const sharedPreviewEncoder = firstEnv([
      "CLIP_PREVIEW_VIDEO_ENCODER",
      "CLIP_EXPORT_VIDEO_ENCODER",
    ]);
    return sharedPreviewEncoder ?? defaultEncoderForPurpose(purpose);
  }

  return firstEnv([
    "CLIP_EXPORT_VIDEO_ENCODER",
    "CLIP_RENDER_VIDEO_ENCODER",
  ]) ?? defaultEncoderForPurpose(purpose);
}

export function shouldRetryWithSoftwareEncoder(encoder: string): boolean {
  return encoder !== SOFTWARE_VIDEO_ENCODER;
}

function resolveSoftwarePreset(purpose: VideoEncodingPurpose): string {
  return firstEnv([
    purpose === "export" ? "CLIP_FINAL_VIDEO_PRESET" : "",
    purposeEnvName(purpose, "VIDEO_PRESET"),
    purpose === "render" ? "CLIP_PREVIEW_VIDEO_PRESET" : "",
  ].filter(Boolean)) ?? DEFAULT_SOFTWARE_PRESET[purpose];
}

function resolveSoftwareCrf(purpose: VideoEncodingPurpose): string {
  return firstEnv([
    purpose === "export" ? "CLIP_FINAL_VIDEO_CRF" : "",
    purposeEnvName(purpose, "VIDEO_CRF"),
    purpose === "render" ? "CLIP_PREVIEW_VIDEO_CRF" : "",
  ].filter(Boolean)) ?? DEFAULT_SOFTWARE_CRF[purpose];
}

function resolveHardwareBitrate(purpose: VideoEncodingPurpose): string {
  return firstEnv([
    purpose === "export" ? "CLIP_FINAL_VIDEO_BITRATE" : "",
    purposeEnvName(purpose, "VIDEO_BITRATE"),
    purpose === "caption" || purpose === "overlay" ? "CLIP_RENDER_VIDEO_BITRATE" : "",
    purpose === "render" ? "CLIP_PREVIEW_VIDEO_BITRATE" : "",
    "CLIP_EXPORT_VIDEO_BITRATE",
    "CLIP_RENDER_VIDEO_BITRATE",
  ].filter(Boolean)) ?? DEFAULT_HARDWARE_BITRATE[purpose];
}

export function buildVideoEncoderArgs(encoder: string, purpose: VideoEncodingPurpose): string[] {
  if (encoder === APPLE_HARDWARE_VIDEO_ENCODER) {
    return [
      "-c:v",
      APPLE_HARDWARE_VIDEO_ENCODER,
      "-b:v",
      resolveHardwareBitrate(purpose),
      "-allow_sw",
      "1",
    ];
  }

  if (encoder !== SOFTWARE_VIDEO_ENCODER) {
    return ["-c:v", encoder];
  }

  return [
    "-c:v",
    SOFTWARE_VIDEO_ENCODER,
    "-preset",
    resolveSoftwarePreset(purpose),
    "-crf",
    resolveSoftwareCrf(purpose),
  ];
}

export function resolveAudioBitrate(purpose: VideoEncodingPurpose): string {
  return firstEnv([
    purpose === "export" ? "CLIP_FINAL_AUDIO_BITRATE" : "",
    purposeEnvName(purpose, "AUDIO_BITRATE"),
    purpose === "render" ? "CLIP_PREVIEW_AUDIO_BITRATE" : "",
    "CLIP_AUDIO_BITRATE",
  ].filter(Boolean)) ?? DEFAULT_AUDIO_BITRATE[purpose];
}

export const __videoEncodingTestUtils = {
  buildVideoEncoderArgs,
  resolveAudioBitrate,
  resolvePreferredVideoEncoder,
};
