import { describe, expect, it } from "vitest";

import { SermonStatusTransitionError, validateStatusTransition } from "@/server/status/sermonStatus";

describe("sermon status transitions", () => {
  it("allows forward transitions", () => {
    const result = validateStatusTransition("TRANSCRIBED", "GENERATING_CLIPS");
    expect(result.valid).toBe(true);
  });

  it("blocks skipping steps", () => {
    const result = validateStatusTransition("CREATED", "TRANSCRIBED");
    expect(result.valid).toBe(false);
    expect(result.reason).toContain("Invalid status transition");
  });

  it("carries correlation fields on transition errors", () => {
    const error = new SermonStatusTransitionError(
      "Invalid status transition: GENERATING_CLIPS -> TRANSCRIBING.",
      "sermon-1",
      "GENERATING_CLIPS",
      "TRANSCRIBING",
    );

    expect(error).toMatchObject({
      name: "SermonStatusTransitionError",
      code: "INVALID_SERMON_STATUS_TRANSITION",
      sermonId: "sermon-1",
      currentStatus: "GENERATING_CLIPS",
      nextStatus: "TRANSCRIBING",
    });
  });

  it("allows failure transitions from any active state", () => {
    const result = validateStatusTransition("EXPORTING", "FAILED");
    expect(result.valid).toBe(true);
  });

  it("allows recovery transitions from FAILED", () => {
    expect(validateStatusTransition("FAILED", "CREATED").valid).toBe(true);
    expect(validateStatusTransition("FAILED", "DOWNLOADING").valid).toBe(true);
    expect(validateStatusTransition("FAILED", "DOWNLOADED").valid).toBe(true);
    expect(validateStatusTransition("FAILED", "AUDIO_EXTRACTING").valid).toBe(true);
    expect(validateStatusTransition("FAILED", "AUDIO_EXTRACTED").valid).toBe(true);
    expect(validateStatusTransition("FAILED", "TRANSCRIBING").valid).toBe(true);
    expect(validateStatusTransition("FAILED", "TRANSCRIBED").valid).toBe(true);
    expect(validateStatusTransition("FAILED", "GENERATING_CLIPS").valid).toBe(true);
    expect(validateStatusTransition("FAILED", "CLIPS_GENERATED").valid).toBe(true);
    expect(validateStatusTransition("FAILED", "EXPORTING").valid).toBe(true);
    expect(validateStatusTransition("FAILED", "EXPORTED").valid).toBe(true);
  });

  it("blocks invalid transitions from FAILED", () => {
    const result = validateStatusTransition("FAILED", "REVIEWING");
    expect(result.valid).toBe(false);
  });

  it("allows explicit retry transitions", () => {
    expect(validateStatusTransition("DOWNLOADED", "DOWNLOADING").valid).toBe(true);
    expect(validateStatusTransition("AUDIO_EXTRACTED", "AUDIO_EXTRACTING").valid).toBe(true);
    expect(validateStatusTransition("TRANSCRIBED", "TRANSCRIBING").valid).toBe(true);
    expect(validateStatusTransition("CLIPS_GENERATED", "GENERATING_CLIPS").valid).toBe(true);
    expect(validateStatusTransition("EXPORTED", "EXPORTING").valid).toBe(true);
  });

  it("allows resumed pipelines to skip already-completed artifact steps", () => {
    expect(validateStatusTransition("DOWNLOADED", "TRANSCRIBING").valid).toBe(true);
    expect(validateStatusTransition("DOWNLOADED", "TRANSCRIBED").valid).toBe(true);
    expect(validateStatusTransition("AUDIO_EXTRACTED", "TRANSCRIBED").valid).toBe(true);
  });

  it("allows export kickoff from clip generation", () => {
    const result = validateStatusTransition("CLIPS_GENERATED", "EXPORTING");
    expect(result.valid).toBe(true);
  });
});
