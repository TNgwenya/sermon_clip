import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { __transcriptionTestUtils } from "@/server/agents/transcriptionAgent";

const strongSermonLines = [
  "Faith keeps walking when pressure comes because God is still faithful to his people today.",
  "Paul tells Timothy to stir up the gift that was placed inside him by prayer.",
  "That means spiritual gifts can become quiet when fear and disappointment take over.",
  "But the Spirit of God has not given us fear but power love and discipline.",
  "Some of you have been waiting for confidence when obedience is the doorway to courage.",
  "The church needs what God placed in you because ministry is not only for the platform.",
  "When you serve with your gift another believer receives strength for their own journey.",
  "So this week take one practical step and use what is already in your hand.",
  "Pray again call the person encourage the family and show up with faith.",
  "God is not finished with the gift and he is not finished with your obedience.",
  "The moment you move in faith you discover grace was already available for the assignment.",
  "Do not bury what heaven gave you because someone needs the testimony in your mouth.",
];

const baseTranscript = {
  fullText: "Welcome everyone. Worship song. Main sermon starts now. Strong sermon teaching. Closing prayer.",
  language: "en",
  provider: "openai" as const,
  model: "whisper-1",
  segments: [
    { startTimeSeconds: 0, endTimeSeconds: 30, text: "Welcome everyone." },
    { startTimeSeconds: 30, endTimeSeconds: 120, text: "Worship song." },
    { startTimeSeconds: 120, endTimeSeconds: 180, text: "Main sermon starts now." },
    { startTimeSeconds: 180, endTimeSeconds: 260, text: "Strong sermon teaching." },
    { startTimeSeconds: 260, endTimeSeconds: 320, text: "Closing prayer." },
  ],
  raw: {},
};

describe("transcription sermon segment filtering", () => {
  it("rejects missing or empty audio before transcription", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "transcription-audio-"));
    const emptyAudioPath = join(tempDir, "audio.mp3");

    try {
      await writeFile(emptyAudioPath, Buffer.alloc(0));

      await expect(
        __transcriptionTestUtils.assessAudioFileReadinessForTranscription(join(tempDir, "missing.mp3")),
      ).resolves.toMatchObject({
        ready: false,
        reason: "The media file is missing or empty.",
      });
      await expect(
        __transcriptionTestUtils.assessAudioFileReadinessForTranscription(emptyAudioPath),
      ).resolves.toMatchObject({
        ready: false,
        reason: "The media file is missing or empty.",
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps local language auto-detection while supplying non-translating sermon vocabulary context", () => {
    const result = __transcriptionTestUtils.buildTranscriptionLanguageHint("Xhosa and English");

    expect(result?.intendedLanguage).toBe("Xhosa and English");
    expect(result?.openAiLanguage).toBeUndefined();
    expect(result?.prompt).toContain("Xhosa and English");
    expect(result?.prompt).toContain("rather than translating");
  });

  it("supplies code-switch context without forcing an unsupported provider language code", () => {
    const result = __transcriptionTestUtils.buildTranscriptionLanguageHint("English, Zulu, Xhosa");

    expect(result?.openAiLanguage).toBeUndefined();
    expect(result?.prompt).toContain("English, Zulu, Xhosa");
  });

  it("adds sermon title, preacher, and church context to improve proper-name transcription", () => {
    const result = __transcriptionTestUtils.buildTranscriptionLanguageHint("English", {
      sermonTitle: "Stirring Up Your Gift",
      speakerName: "Pastor Thabang Ngwenya",
      churchName: "Melusi Christian Fellowship",
    });

    expect(result?.prompt).toContain("Known sermon terms: Stirring Up Your Gift, Pastor Thabang Ngwenya, Melusi Christian Fellowship.");
    expect(result?.prompt).not.toContain("Use these known names and title words");
  });

  it("normalizes long sermon context values before adding them to the transcription prompt", () => {
    const result = __transcriptionTestUtils.buildTranscriptionLanguageHint("English", {
      sermonTitle: ` ${"Gift ".repeat(40)} `,
      speakerName: "  Pastor   Test  ",
      churchName: "",
    });

    const prompt = result?.prompt ?? "";
    expect(prompt).toContain("Pastor Test");
    expect(prompt).not.toContain("  Pastor   Test");
    expect(prompt).not.toContain("Church name");
    const titleMatch = prompt.match(/Known sermon terms: ([^,]+),/);
    expect(titleMatch?.[1].length).toBeLessThanOrEqual(140);
  });

  it("does not pass Zulu as an OpenAI language parameter", () => {
    const result = __transcriptionTestUtils.buildTranscriptionLanguageHint("Zulu");

    expect(result?.intendedLanguage).toBe("Zulu");
    expect(result?.openAiLanguage).toBeUndefined();
    expect(result?.prompt).toContain("Languages spoken may include: Zulu");
  });

  it("passes supported language codes when available", () => {
    const result = __transcriptionTestUtils.buildTranscriptionLanguageHint("Afrikaans and English");

    expect(result?.openAiLanguage).toBe("af");
  });

  it("still sends a prompt when the entered language cannot be mapped to an OpenAI code", () => {
    const result = __transcriptionTestUtils.buildTranscriptionLanguageHint("Local church language");

    expect(result?.intendedLanguage).toBe("Local church language");
    expect(result?.openAiLanguage).toBeUndefined();
    expect(result?.prompt).toContain("Local church language");
  });

  it("adds previous transcript context to chunk prompts without replacing the language hint", () => {
    const languageHint = __transcriptionTestUtils.buildTranscriptionLanguageHint("English");
    const tail = __transcriptionTestUtils.getTranscriptTail(
      "God is faithful when the church keeps praying and the pastor reminds us to stir up the gift again",
      8,
    );
    const prompt = __transcriptionTestUtils.buildChunkTranscriptionPrompt(languageHint, tail);

    expect(tail).toBe("reminds us to stir up the gift again");
    expect(prompt).toContain("Languages spoken may include: English.");
    expect(prompt).toContain("Previous transcript context");
    expect(prompt).not.toContain("continue from the next spoken words");
    expect(prompt).not.toContain("do not invent bridge wording");
    expect(prompt).not.toContain("do not repeat unless spoken again");
    expect(prompt).toContain("stir up the gift again");
  });

  it("carries exact previous context across local multilingual chunks", () => {
    const languageHint = __transcriptionTestUtils.buildTranscriptionLanguageHint("English and Zulu");
    const prompt = __transcriptionTestUtils.buildChunkTranscriptionPrompt(languageHint, "power of life and death");

    expect(languageHint?.prompt).toContain("English and Zulu");
    expect(prompt).toContain("Previous transcript context");
    expect(prompt).toContain("power of life and death");
  });

  it("keeps chunked transcript timestamps on the original sermon timeline", () => {
    const chunkOffset = __transcriptionTestUtils.getChunkTimelineOffsetSeconds(1);
    const shifted = __transcriptionTestUtils.offsetChunkTranscriptSegments([
      { startTimeSeconds: 0, endTimeSeconds: 12, text: "Second chunk starts here." },
      { startTimeSeconds: 14.25, endTimeSeconds: 19.75, text: "The sermon continues." },
    ], chunkOffset);

    expect(chunkOffset).toBe(1200);
    expect(shifted[0]).toMatchObject({
      startTimeSeconds: 1200,
      endTimeSeconds: 1212,
      text: "Second chunk starts here.",
    });
    expect(shifted[1]).toMatchObject({
      startTimeSeconds: 1214.25,
      endTimeSeconds: 1219.75,
    });
  });

  it("preserves provider confidence while shifting chunk timestamps", () => {
    const shifted = __transcriptionTestUtils.offsetChunkTranscriptSegments([
      {
        startTimeSeconds: 1,
        endTimeSeconds: 4,
        text: "Timestamped sermon words.",
        confidence: 0.71,
      },
    ], 300);

    expect(shifted).toEqual([
      {
        startTimeSeconds: 301,
        endTimeSeconds: 304,
        text: "Timestamped sermon words.",
        confidence: 0.71,
      },
    ]);
  });

  it("stores missing provider confidence as unknown instead of inventing a score", () => {
    expect(__transcriptionTestUtils.buildTranscriptSegmentRecord({
      sermonId: "sermon-1",
      transcriptId: "transcript-1",
      segment: {
        startTimeSeconds: 0,
        endTimeSeconds: 3,
        text: "Words without provider diagnostics.",
      },
    })).toMatchObject({ confidence: null });

    expect(__transcriptionTestUtils.buildTranscriptSegmentRecord({
      sermonId: "sermon-1",
      transcriptId: "transcript-1",
      segment: {
        startTimeSeconds: 3,
        endTimeSeconds: 6,
        text: "Words with provider diagnostics.",
        confidence: 0.68,
      },
    })).toMatchObject({ confidence: 0.68 });
  });

  it("uses shorter transcription chunks for declared local multilingual sermons", () => {
    const localHint = __transcriptionTestUtils.buildTranscriptionLanguageHint("English, Zulu, Xhosa");
    const englishHint = __transcriptionTestUtils.buildTranscriptionLanguageHint("English");

    expect(__transcriptionTestUtils.resolveTranscriptionChunkDurationSeconds(localHint)).toBe(300);
    expect(__transcriptionTestUtils.resolveTranscriptionChunkDurationSeconds(englishHint)).toBe(1200);
  });

  it("uses measured chunk durations to avoid long-sermon timestamp drift", () => {
    const timeline = __transcriptionTestUtils.buildCumulativeChunkTimelineOffsets([
      1198.432,
      1201.25,
      937.4,
    ]);
    const shifted = __transcriptionTestUtils.offsetChunkTranscriptSegments([
      { startTimeSeconds: 2, endTimeSeconds: 9.5, text: "Third chunk sermon point." },
    ], timeline.offsets[2]);

    expect(timeline.fallbackCount).toBe(0);
    expect(timeline.offsets).toEqual([0, 1198.432, 2399.682]);
    expect(shifted[0]).toMatchObject({
      startTimeSeconds: 2401.682,
      endTimeSeconds: 2409.182,
      text: "Third chunk sermon point.",
    });
  });

  it("falls back to nominal chunk duration when a chunk duration cannot be measured", () => {
    const timeline = __transcriptionTestUtils.buildCumulativeChunkTimelineOffsets([
      1198.432,
      null,
      938,
    ]);

    expect(timeline.fallbackCount).toBe(1);
    expect(timeline.offsets).toEqual([0, 1198.432, 2398.432]);
  });

  it("caches completed chunk transcripts so interrupted transcription can resume", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "transcription-chunk-cache-"));
    const chunkPath = join(tempDir, "chunk-000.mp3");
    const cachePath = __transcriptionTestUtils.buildChunkTranscriptCachePath(tempDir, chunkPath);
    const transcript = {
      fullText: "God is faithful in every season.",
      language: "en",
      provider: "openai" as const,
      model: "whisper-1",
      segments: [
        {
          startTimeSeconds: 0,
          endTimeSeconds: 6,
          text: "God is faithful in every season.",
          confidence: 0.73,
        },
      ],
      raw: {},
    };

    try {
      await writeFile(chunkPath, Buffer.alloc(24));
      const payload = __transcriptionTestUtils.buildChunkTranscriptCachePayload({
        chunkPath,
        bytes: 24,
        durationSeconds: 6,
        languageCode: "en",
        transcript,
      });
      expect(payload.version).toBe(4);
      await __transcriptionTestUtils.writeCachedChunkTranscript(
        cachePath,
        payload,
      );

      await expect(
        __transcriptionTestUtils.readCachedChunkTranscript({
          cachePath,
          chunkPath,
          bytes: 24,
          durationSeconds: 6,
          languageCode: "en",
        }),
      ).resolves.toMatchObject({
        fullText: "God is faithful in every season.",
        segments: [{ startTimeSeconds: 0, endTimeSeconds: 6, confidence: 0.73 }],
      });

      await expect(
        __transcriptionTestUtils.readCachedChunkTranscript({
          cachePath,
          chunkPath,
          bytes: 25,
          durationSeconds: 6,
          languageCode: "en",
        }),
      ).resolves.toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("ignores legacy chunk transcript caches after prompt behavior changes", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "transcription-chunk-cache-"));
    const chunkPath = join(tempDir, "chunk-000.mp3");
    const cachePath = __transcriptionTestUtils.buildChunkTranscriptCachePath(tempDir, chunkPath);

    try {
      await writeFile(chunkPath, Buffer.alloc(24));
      await writeFile(cachePath, JSON.stringify({
        version: 1,
        chunkFileName: "chunk-000.mp3",
        bytes: 24,
        durationSeconds: 6,
        languageCode: "en",
        transcript: {
          fullText: "Keep filler words, repeated pastoral phrases.",
          provider: "openai",
          model: "whisper-1",
          segments: [
            {
              startTimeSeconds: 0,
              endTimeSeconds: 6,
              text: "Keep filler words, repeated pastoral phrases.",
            },
          ],
          raw: {},
        },
      }), "utf8");

      await expect(
        __transcriptionTestUtils.readCachedChunkTranscript({
          cachePath,
          chunkPath,
          bytes: 24,
          durationSeconds: 6,
          languageCode: "en",
        }),
      ).resolves.toBeNull();
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("keeps original and speech-enhanced chunk work in separate namespaces", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "transcription-chunk-namespaces-"));

    try {
      const original = await __transcriptionTestUtils.resolveChunkWorkingDirectories({
        transcriptDir: tempDir,
        audioPath: join(tempDir, "sermon-window-audio.mp3"),
      });
      const enhanced = await __transcriptionTestUtils.resolveChunkWorkingDirectories({
        transcriptDir: tempDir,
        audioPath: join(tempDir, "speech-enhanced-audio.mp3"),
      });

      expect(original.chunkDir).toContain("sermon-window-audio");
      expect(original.chunkTranscriptCacheDir).toContain("sermon-window-audio");
      expect(enhanced.chunkDir).toContain("speech-enhanced-audio");
      expect(enhanced.chunkTranscriptCacheDir).toContain("speech-enhanced-audio");
      expect(enhanced.chunkDir).not.toBe(original.chunkDir);
      expect(enhanced.chunkTranscriptCacheDir).not.toBe(original.chunkTranscriptCacheDir);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it("removes repeated leading transcript segments at chunk seams", () => {
    const previousSegments = [
      { startTimeSeconds: 1188, endTimeSeconds: 1196, text: "God is faithful in every season." },
    ];
    const nextSegments = [
      { startTimeSeconds: 1200, endTimeSeconds: 1205, text: "God is faithful in every season." },
      { startTimeSeconds: 1206, endTimeSeconds: 1214, text: "The church can keep walking by faith." },
    ];

    const merged = __transcriptionTestUtils.mergeChunkTranscriptSegments(previousSegments, nextSegments);

    expect(merged.removedDuplicateCount).toBe(1);
    expect(merged.segments.map((segment) => segment.text)).toEqual([
      "God is faithful in every season.",
      "The church can keep walking by faith.",
    ]);
  });

  it("removes repeated leading transcript segments when chunk timestamps slightly overlap", () => {
    const previousSegments = [
      { startTimeSeconds: 1188, endTimeSeconds: 1201.5, text: "God is faithful in every season." },
    ];
    const nextSegments = [
      { startTimeSeconds: 1199.75, endTimeSeconds: 1205, text: "God is faithful in every season." },
      { startTimeSeconds: 1206, endTimeSeconds: 1214, text: "The church can keep walking by faith." },
    ];

    const merged = __transcriptionTestUtils.mergeChunkTranscriptSegments(previousSegments, nextSegments);

    expect(merged.removedDuplicateCount).toBe(1);
    expect(merged.segments.map((segment) => segment.text)).toEqual([
      "God is faithful in every season.",
      "The church can keep walking by faith.",
    ]);
  });

  it("removes contained leading transcript fragments at chunk seams", () => {
    const previousSegments = [
      {
        startTimeSeconds: 1188,
        endTimeSeconds: 1199,
        text: "The church can keep walking by faith because God is faithful in every season.",
      },
    ];
    const nextSegments = [
      {
        startTimeSeconds: 1201,
        endTimeSeconds: 1205,
        text: "God is faithful in every season.",
      },
      {
        startTimeSeconds: 1206,
        endTimeSeconds: 1214,
        text: "So this week choose prayer again and keep walking.",
      },
    ];

    const merged = __transcriptionTestUtils.mergeChunkTranscriptSegments(previousSegments, nextSegments);

    expect(merged.removedDuplicateCount).toBe(1);
    expect(merged.segments.map((segment) => segment.text)).toEqual([
      "The church can keep walking by faith because God is faithful in every season.",
      "So this week choose prayer again and keep walking.",
    ]);
  });

  it("keeps near-seam follow-up phrases that add new sermon substance", () => {
    const previousSegments = [
      {
        startTimeSeconds: 1188,
        endTimeSeconds: 1199,
        text: "The church can keep walking by faith because God is faithful in every season.",
      },
    ];
    const nextSegments = [
      {
        startTimeSeconds: 1201,
        endTimeSeconds: 1208,
        text: "God is faithful in every season, and this week choose prayer again.",
      },
    ];

    const merged = __transcriptionTestUtils.mergeChunkTranscriptSegments(previousSegments, nextSegments);

    expect(merged.removedDuplicateCount).toBe(0);
    expect(merged.segments.map((segment) => segment.text)).toEqual([
      "The church can keep walking by faith because God is faithful in every season.",
      "God is faithful in every season, and this week choose prayer again.",
    ]);
  });

  it("keeps repeated sermon phrases when they are not at a chunk seam", () => {
    const previousSegments = [
      { startTimeSeconds: 1000, endTimeSeconds: 1008, text: "God is faithful in every season." },
    ];
    const nextSegments = [
      { startTimeSeconds: 1200, endTimeSeconds: 1205, text: "God is faithful in every season." },
      { startTimeSeconds: 1206, endTimeSeconds: 1214, text: "The church can keep walking by faith." },
    ];

    const merged = __transcriptionTestUtils.mergeChunkTranscriptSegments(previousSegments, nextSegments);

    expect(merged.removedDuplicateCount).toBe(0);
    expect(merged.segments.map((segment) => segment.text)).toEqual([
      "God is faithful in every season.",
      "God is faithful in every season.",
      "The church can keep walking by faith.",
    ]);
  });

  it("keeps repeated sermon phrases when chunk overlap is too large to be a seam duplicate", () => {
    const previousSegments = [
      { startTimeSeconds: 1188, endTimeSeconds: 1210, text: "God is faithful in every season." },
    ];
    const nextSegments = [
      { startTimeSeconds: 1200, endTimeSeconds: 1205, text: "God is faithful in every season." },
      { startTimeSeconds: 1206, endTimeSeconds: 1214, text: "The church can keep walking by faith." },
    ];

    const merged = __transcriptionTestUtils.mergeChunkTranscriptSegments(previousSegments, nextSegments);

    expect(merged.removedDuplicateCount).toBe(0);
    expect(merged.segments.map((segment) => segment.text)).toEqual([
      "God is faithful in every season.",
      "God is faithful in every season.",
      "The church can keep walking by faith.",
    ]);
  });

  it("builds speech-enhanced audio args for more reliable transcription retries", () => {
    const args = __transcriptionTestUtils.buildSpeechEnhancedAudioArgs("/tmp/source.mp3", "/tmp/enhanced.mp3");

    expect(args).toContain("-ac");
    expect(args).toContain("1");
    expect(args).toContain("-ar");
    expect(args).toContain("16000");
    expect(args).toContain("-af");
    expect(args).toContain("highpass=f=80,lowpass=f=8000,dynaudnorm=f=150:g=15");
    expect(args[args.length - 1]).toBe("/tmp/enhanced.mp3");
  });

  it("scores a clipping-ready transcription retry above a sparse first attempt", () => {
    const sparse = __transcriptionTestUtils.assessTranscriptQualityForClipping([
      { startTimeSeconds: 0, endTimeSeconds: 10, text: "Amen." },
      { startTimeSeconds: 10, endTimeSeconds: 20, text: "Yes." },
    ]);
    const ready = __transcriptionTestUtils.assessTranscriptQualityForClipping(
      strongSermonLines.map((text, index) => ({
        startTimeSeconds: index * 10,
        endTimeSeconds: index * 10 + 9,
        text,
      })),
    );

    expect(ready.ready).toBe(true);
    expect(__transcriptionTestUtils.transcriptQualityScore(ready)).toBeGreaterThan(
      __transcriptionTestUtils.transcriptQualityScore(sparse),
    );
  });

  it("selects the best transcript attempt for downstream clipping", () => {
    const sparseQuality = __transcriptionTestUtils.assessTranscriptQualityForClipping([
      { startTimeSeconds: 0, endTimeSeconds: 10, text: "Amen." },
      { startTimeSeconds: 10, endTimeSeconds: 20, text: "Yes." },
    ]);
    const readySegments = strongSermonLines.map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 9,
      text,
    }));
    const readyQuality = __transcriptionTestUtils.assessTranscriptQualityForClipping(readySegments);
    const readyTranscript = {
      ...baseTranscript,
      fullText: readySegments.map((segment) => segment.text).join(" "),
      segments: readySegments,
    };

    const selected = __transcriptionTestUtils.selectBestTranscriptAttempt([
      {
        source: "original",
        audioPath: "/tmp/original.mp3",
        transcript: baseTranscript,
        windowed: { transcript: baseTranscript, applied: false },
        quality: sparseQuality,
      },
      {
        source: "speech_enhanced",
        audioPath: "/tmp/enhanced.mp3",
        transcript: readyTranscript,
        windowed: { transcript: readyTranscript, applied: false },
        quality: readyQuality,
      },
    ]);

    expect(selected.source).toBe("speech_enhanced");
  });

  it("prefers a reliable full-duration retry over a clean but incomplete transcript", () => {
    const partialSegments = strongSermonLines.map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 9,
      text,
    }));
    const fullDurationSegments = strongSermonLines.map((text, index) => ({
      startTimeSeconds: index * 20,
      endTimeSeconds: index * 20 + 8,
      text,
    }));
    const partialQuality = __transcriptionTestUtils.assessTranscriptQualityForClipping(partialSegments);
    const fullQuality = __transcriptionTestUtils.assessTranscriptQualityForClipping(fullDurationSegments);

    expect(partialQuality.ready).toBe(true);
    expect(fullQuality.ready).toBe(true);
    expect(__transcriptionTestUtils.transcriptQualityScore(partialQuality)).toBeGreaterThan(
      __transcriptionTestUtils.transcriptQualityScore(fullQuality),
    );
    expect(__transcriptionTestUtils.isTranscriptReliableEnoughForClipping(partialQuality, {
      expectedDurationSeconds: 360,
    })).toBe(false);
    expect(__transcriptionTestUtils.isTranscriptReliableEnoughForClipping(fullQuality, {
      expectedDurationSeconds: 360,
    })).toBe(true);

    const selected = __transcriptionTestUtils.selectBestTranscriptAttempt([
      {
        source: "original",
        audioPath: "/tmp/original.mp3",
        transcript: {
          ...baseTranscript,
          fullText: partialSegments.map((segment) => segment.text).join(" "),
          segments: partialSegments,
        },
        windowed: {
          transcript: {
            ...baseTranscript,
            fullText: partialSegments.map((segment) => segment.text).join(" "),
            segments: partialSegments,
          },
          applied: false,
        },
        quality: partialQuality,
      },
      {
        source: "speech_enhanced",
        audioPath: "/tmp/enhanced.mp3",
        transcript: {
          ...baseTranscript,
          fullText: fullDurationSegments.map((segment) => segment.text).join(" "),
          segments: fullDurationSegments,
        },
        windowed: {
          transcript: {
            ...baseTranscript,
            fullText: fullDurationSegments.map((segment) => segment.text).join(" "),
            segments: fullDurationSegments,
          },
          applied: false,
        },
        quality: fullQuality,
      },
    ], {
      expectedDurationSeconds: 360,
    });

    expect(selected.source).toBe("speech_enhanced");
  });

  it("retries with speech-enhanced audio when a transcript is usable but suspicious", () => {
    const sparseCoverageSegments = strongSermonLines.slice(0, 10).map((text, index) => ({
      startTimeSeconds: index * 50,
      endTimeSeconds: index * 50 + 15,
      text,
    }));
    const quality = __transcriptionTestUtils.assessTranscriptQualityForClipping(sparseCoverageSegments);

    expect(quality.ready).toBe(true);
    expect(quality.warnings).toContain("LOW_TRANSCRIPT_COVERAGE");
    expect(__transcriptionTestUtils.isTranscriptReliableEnoughForClipping(quality)).toBe(false);
    expect(__transcriptionTestUtils.finalTranscriptReliabilityIssue(quality)).toContain("coverage");
    expect(__transcriptionTestUtils.shouldRetryWithSpeechEnhancedAudio(quality)).toBe(true);
  });

  it("allows meaningful sparse transcripts as degraded for local multilingual sermons", () => {
    const localHint = __transcriptionTestUtils.buildTranscriptionLanguageHint("English, Zulu, Xhosa");
    const englishHint = __transcriptionTestUtils.buildTranscriptionLanguageHint("English");
    const uniqueTails = [
      "leadership calling prayer wisdom scripture obedience testimony service courage",
      "family discipleship stewardship humility authority patience ministry witness",
      "Timothy encouragement spiritual gifts boldness love discipline faithful action",
      "church responsibility servant leadership sacrifice grace renewal perseverance",
      "Christ example following integrity compassion holiness mission formation",
      "pastoral care intercession community forgiveness restoration hope endurance",
      "workplace faithfulness generosity discernment character scripture application",
      "young believers mentorship accountability worship surrender daily obedience",
      "calling maturity correction teaching exhortation comfort kingdom fruitfulness",
      "heavenly Father prayer boldness wisdom conviction repentance transformation",
      "servants equipping congregation unity mercy justice hospitality devotion",
      "gospel witness resurrection promise covenant courage spiritual inheritance",
      "Bible study reflection learning obedience listening response preparation",
      "ministry assignment availability humility excellence trustworthiness service",
      "prayerful leadership vision responsibility submission guidance discernment",
      "testimony encouragement perseverance hardship victory compassion generosity",
      "faith action application commitment renewal obedience practical surrender",
      "discipleship growth stewardship calling wisdom scripture pastoral care",
    ];
    const sparseMultilingualSegments = Array.from({ length: 18 }, (_, index) => ({
      startTimeSeconds: index * 240,
      endTimeSeconds: index * 240 + 18,
      text: `${strongSermonLines[index % strongSermonLines.length]} ${uniqueTails[index]}.`,
    }));
    const quality = __transcriptionTestUtils.assessTranscriptQualityForClipping(sparseMultilingualSegments);

    expect(quality.wordCount).toBeGreaterThanOrEqual(220);
    expect(quality.ready).toBe(false);
    expect(quality.reason).toMatch(/coverage|gaps/);
    expect(__transcriptionTestUtils.isDegradedTranscriptUsableForLocalMultilingualClipping(quality, localHint)).toBe(true);
    expect(__transcriptionTestUtils.isDegradedTranscriptUsableForLocalMultilingualClipping(quality, englishHint)).toBe(false);
  });

  it("retries with speech-enhanced audio when transcript timestamps are too coarse for polished captions", () => {
    const coarseTimingSegments = strongSermonLines.map((text, index) => ({
      startTimeSeconds: index * 32,
      endTimeSeconds: index * 32 + 31,
      text,
    }));
    const quality = __transcriptionTestUtils.assessTranscriptQualityForClipping(coarseTimingSegments);

    expect(quality.ready).toBe(true);
    expect(quality.warnings).toContain("COARSE_TRANSCRIPT_TIMING");
    expect(quality.averageSegmentDurationSeconds).toBeGreaterThanOrEqual(30);
    expect(__transcriptionTestUtils.isTranscriptReliableEnoughForClipping(quality)).toBe(false);
    expect(__transcriptionTestUtils.finalTranscriptReliabilityIssue(quality)).toContain("too coarse");
    expect(__transcriptionTestUtils.shouldRetryWithSpeechEnhancedAudio(quality)).toBe(true);
  });

  it("rejects wordy transcripts with too few timestamp anchors for precise clipping", () => {
    const thinTimestampSegments = strongSermonLines.slice(0, 9).map((text, index) => ({
      startTimeSeconds: index * 64,
      endTimeSeconds: index * 64 + 20,
      text,
    }));
    const quality = __transcriptionTestUtils.assessTranscriptQualityForClipping(thinTimestampSegments);

    expect(quality.wordCount).toBeGreaterThanOrEqual(120);
    expect(quality.coverageRatio).toBeGreaterThanOrEqual(0.24);
    expect(quality.maxSegmentDurationSeconds).toBeLessThan(30);
    expect(quality.largeGapCount).toBe(0);
    expect(quality.meaningfulSegmentsPerMinute).toBeLessThan(1.2);
    expect(quality.ready).toBe(false);
    expect(quality.warnings).toContain("LOW_TIMESTAMP_DENSITY");
    expect(quality.reason).toContain("too few timestamp anchors");
    expect(__transcriptionTestUtils.shouldRetryWithSpeechEnhancedAudio(quality)).toBe(true);
  });

  it("rejects wordy transcripts that are mostly filler instead of sermon substance", () => {
    const fillerLines = [
      "Amen come on church amen yes now come on today.",
      "Come on amen church today yes amen come on now.",
      "Church come on today amen yes now amen come on.",
      "Yes amen come on now church today come on amen.",
      "Today church amen come on yes amen now come on.",
      "Come on today amen church now yes come on amen.",
      "Amen yes church come on today amen come on now.",
      "Now come on church amen today yes amen come on.",
      "Church today come on amen now come on amen yes.",
      "Yes come on today church amen now amen come on.",
      "Today amen yes come on church amen come on now.",
      "Come on church amen now today yes amen come on.",
      "Amen today come on church yes come on now amen.",
      "Now amen come on today church amen yes come on.",
    ];
    const fillerSegments = fillerLines.map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 9,
      text,
    }));

    const quality = __transcriptionTestUtils.assessTranscriptQualityForClipping(fillerSegments);

    expect(quality.wordCount).toBeGreaterThanOrEqual(120);
    expect(quality.repeatedSegmentRatio).toBeLessThanOrEqual(0.28);
    expect(quality.ready).toBe(false);
    expect(quality.warnings).toContain("LOW_TRANSCRIPT_DISTINCT_SERMON_SUBSTANCE");
    expect(quality.reason).toContain("too little distinct sermon substance");
    expect(__transcriptionTestUtils.shouldRetryWithSpeechEnhancedAudio(quality)).toBe(true);
  });

  it("rejects transcripts with repeated hallucinated sermon phrases across varied segments", () => {
    const uniqueTails = [
      "mercy awakens families to worship with courage compassion patience and witness",
      "disciples carry scripture into Monday work friendship pressure and hidden obedience",
      "prayer restores weary hearts through repentance service generosity and faithful attention",
      "leaders equip ordinary believers for ministry hospitality justice comfort and mission",
      "children watch faith become visible through forgiveness humility kindness and endurance",
      "neighbors encounter grace when testimony becomes practical sacrifice blessing and presence",
      "calling grows stronger as servants choose discipline devotion wisdom and tenderness",
      "hope becomes embodied when the church remembers resurrection covenant and promise",
      "spiritual gifts mature through correction encouragement training discernment and perseverance",
      "families heal as confession opens trust renewal peace and holy imagination",
      "worship moves beyond songs into stewardship reconciliation courage and daily surrender",
      "the gospel forms resilient people who practice mercy truth and patient love",
      "mission advances when hidden servants bring meals counsel prayer and friendship",
      "the altar call invites honest response renewed obedience and deeper surrender",
    ];
    const repeatedPhraseSegments = uniqueTails.map((tail, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 9,
      text: `God strengthens weary believers through faithful prayer and ${tail}.`,
    }));

    const quality = __transcriptionTestUtils.assessTranscriptQualityForClipping(repeatedPhraseSegments);

    expect(quality.wordCount).toBeGreaterThanOrEqual(120);
    expect(quality.distinctSermonTokenCount).toBeGreaterThanOrEqual(32);
    expect(quality.warnings).toContain("REPEATED_TRANSCRIPT_PHRASES");
    expect(quality.ready).toBe(false);
    expect(quality.reason).toContain("repeated phrases");
    expect(__transcriptionTestUtils.shouldRetryWithSpeechEnhancedAudio(quality)).toBe(true);
  });

  it("does not retry clean clipping-ready transcripts with speech enhancement", () => {
    const cleanSegments = strongSermonLines.map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 9,
      text,
    }));
    const quality = __transcriptionTestUtils.assessTranscriptQualityForClipping(cleanSegments);

    expect(quality.ready).toBe(true);
    expect(quality.warnings).toHaveLength(0);
    expect(quality.repeatedPhraseRatio).toBe(0);
    expect(__transcriptionTestUtils.isTranscriptReliableEnoughForClipping(quality)).toBe(true);
    expect(__transcriptionTestUtils.shouldRetryWithSpeechEnhancedAudio(quality)).toBe(false);
  });

  it("rejects internally clean transcripts that cover only a small slice of the expected sermon", () => {
    const cleanSegments = strongSermonLines.map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 9,
      text,
    }));
    const quality = __transcriptionTestUtils.assessTranscriptQualityForClipping(cleanSegments);

    expect(quality.ready).toBe(true);
    expect(__transcriptionTestUtils.finalTranscriptReliabilityIssue(quality)).toBeNull();
    expect(__transcriptionTestUtils.finalTranscriptReliabilityIssue(quality, {
      expectedDurationSeconds: 3600,
    })).toContain("expected sermon duration");
    expect(__transcriptionTestUtils.isTranscriptReliableEnoughForClipping(quality, {
      expectedDurationSeconds: 3600,
    })).toBe(false);
    expect(__transcriptionTestUtils.shouldRetryWithSpeechEnhancedAudio(quality, {
      expectedDurationSeconds: 3600,
    })).toBe(true);
  });

  it("derives expected transcript duration from sermon trim settings", () => {
    expect(__transcriptionTestUtils.resolveExpectedTranscriptDurationSeconds({
      sermonStartSeconds: 120,
      sermonEndSeconds: 720,
      analyzeFullRecording: false,
      knownDurationSeconds: 1800,
    })).toBe(600);
    expect(__transcriptionTestUtils.resolveExpectedTranscriptDurationSeconds({
      sermonStartSeconds: 120,
      sermonEndSeconds: null,
      analyzeFullRecording: false,
      knownDurationSeconds: 1800,
    })).toBe(1680);
    expect(__transcriptionTestUtils.resolveExpectedTranscriptDurationSeconds({
      sermonStartSeconds: 120,
      sermonEndSeconds: 720,
      analyzeFullRecording: true,
      knownDurationSeconds: 1800,
    })).toBe(1800);
  });

  it("removes non-speech and duplicate spam while preserving audience-response evidence", () => {
    const transcript = {
      ...baseTranscript,
      fullText: "Music. God is faithful today. God is faithful today. God is faithful today. Amen. The church must use every gift with courage.",
      segments: [
        { startTimeSeconds: 0, endTimeSeconds: 4, text: "Music" },
        { startTimeSeconds: 4, endTimeSeconds: 10, text: "God is faithful today." },
        { startTimeSeconds: 10, endTimeSeconds: 16, text: "God is faithful today." },
        { startTimeSeconds: 16, endTimeSeconds: 22, text: "God is faithful today." },
        { startTimeSeconds: 22, endTimeSeconds: 24, text: "Amen." },
        { startTimeSeconds: 24, endTimeSeconds: 34, text: "The church must use every gift with courage." },
      ],
    };

    const cleaned = __transcriptionTestUtils.cleanupTranscriptForClipping(transcript);

    expect(cleaned.segments.map((segment) => segment.text)).toEqual([
      "God is faithful today.",
      "God is faithful today.",
      "Amen.",
      "The church must use every gift with courage.",
    ]);
    expect(cleaned.fullText).not.toContain("Music");
    expect(cleaned.fullText).toContain("Amen");
    expect((cleaned.raw as { cleanup?: { removedSegmentCount: number } }).cleanup?.removedSegmentCount).toBe(2);
  });

  it("keeps Unicode letters intact when normalizing multilingual transcript text", () => {
    expect(
      __transcriptionTestUtils.normalizeTranscriptTextForCleanup("Lefatše — tšepo, Môre!"),
    ).toBe("lefatše tšepo môre");
  });

  it("reuses saved transcripts only when they are clipping-ready", () => {
    const readySegments = strongSermonLines.map((text, index) => ({
      startTimeSeconds: index * 10,
      endTimeSeconds: index * 10 + 9,
      text,
    }));

    const result = __transcriptionTestUtils.assessReusableTranscriptForClipping({
      transcriptExists: true,
      transcriptJsonExists: true,
      segments: readySegments,
    });

    expect(result.reusable).toBe(true);
    expect(result.reason).toContain("clipping-ready");
    expect(result.quality?.ready).toBe(true);
  });

  it("rejects saved transcripts that exist but are too weak for clipping", () => {
    const result = __transcriptionTestUtils.assessReusableTranscriptForClipping({
      transcriptExists: true,
      transcriptJsonExists: true,
      segments: [
        { startTimeSeconds: 0, endTimeSeconds: 10, text: "Amen." },
        { startTimeSeconds: 10, endTimeSeconds: 20, text: "Yes." },
      ],
    });

    expect(result.reusable).toBe(false);
    expect(result.reason).toContain("not clipping-ready");
  });

  it("does not reuse saved transcripts with coarse timestamps", () => {
    const result = __transcriptionTestUtils.assessReusableTranscriptForClipping({
      transcriptExists: true,
      transcriptJsonExists: true,
      segments: strongSermonLines.map((text, index) => ({
        startTimeSeconds: index * 52,
        endTimeSeconds: index * 52 + 50,
        text,
      })),
    });

    expect(result.reusable).toBe(false);
    expect(result.reason).toContain("not clipping-ready");
    expect(result.quality?.warnings).toContain("COARSE_TRANSCRIPT_TIMING");
    expect(result.quality?.reason).toContain("timestamps are too coarse");
  });

  it("does not reuse saved transcripts that are technically ready but unreliable", () => {
    const sparseCoverageSegments = strongSermonLines.slice(0, 10).map((text, index) => ({
      startTimeSeconds: index * 50,
      endTimeSeconds: index * 50 + 15,
      text,
    }));

    const result = __transcriptionTestUtils.assessReusableTranscriptForClipping({
      transcriptExists: true,
      transcriptJsonExists: true,
      segments: sparseCoverageSegments,
    });

    expect(result.quality?.ready).toBe(true);
    expect(result.reusable).toBe(false);
    expect(result.reason).toContain("not reliable enough");
  });

  it("filters segments to the configured sermon window", () => {
    const result = __transcriptionTestUtils.applySermonSegmentWindowToTranscript(baseTranscript, {
      sermonStartSeconds: 120,
      sermonEndSeconds: 260,
      analyzeFullRecording: false,
      knownDurationSeconds: 400,
    });

    expect(result.applied).toBe(true);
    expect(result.transcript.segments).toHaveLength(2);
    expect(result.transcript.segments[0]?.startTimeSeconds).toBe(120);
    expect(result.transcript.segments[1]?.endTimeSeconds).toBe(260);
    expect(result.transcript.fullText).toContain("Main sermon starts now");
    expect(result.transcript.fullText).toContain("Strong sermon teaching");
    expect(result.transcript.fullText).not.toContain("Worship song");
  });

  it("keeps original timestamp reference for clip mapping", () => {
    const result = __transcriptionTestUtils.applySermonSegmentWindowToTranscript(baseTranscript, {
      sermonStartSeconds: 120,
      sermonEndSeconds: 260,
      analyzeFullRecording: false,
      knownDurationSeconds: 400,
    });

    expect(result.transcript.segments[0]?.startTimeSeconds).toBe(120);
    expect(result.transcript.segments[1]?.endTimeSeconds).toBe(260);
  });

  it("resolves a smaller transcription input from the selected sermon window", () => {
    const result = __transcriptionTestUtils.resolveManualTranscriptionWindow({
      sermonStartSeconds: 9540,
      sermonEndSeconds: 13560,
      analyzeFullRecording: false,
      knownDurationSeconds: 14585,
    });

    expect(result).toEqual({
      startTimeSeconds: 9540,
      endTimeSeconds: 13560,
      durationSeconds: 4020,
    });
  });

  it("does not trim transcription input when the user asks to analyze the full recording", () => {
    const result = __transcriptionTestUtils.resolveManualTranscriptionWindow({
      sermonStartSeconds: 9540,
      sermonEndSeconds: 13560,
      analyzeFullRecording: true,
      knownDurationSeconds: 14585,
    });

    expect(result).toBeNull();
  });

  it("adds the sermon-window offset back onto transcribed timestamps", () => {
    const result = __transcriptionTestUtils.offsetTranscriptTimeline(
      {
        fullText: "Faith comes by hearing.",
        provider: "openai",
        model: "whisper-1",
        segments: [
          { startTimeSeconds: 0, endTimeSeconds: 3.2, text: "Faith comes" },
          { startTimeSeconds: 3.2, endTimeSeconds: 6.4, text: "by hearing." },
        ],
        raw: {},
      },
      9540,
    );

    expect(result.segments[0]?.startTimeSeconds).toBe(9540);
    expect(result.segments[0]?.endTimeSeconds).toBe(9543.2);
    expect(result.segments[1]?.startTimeSeconds).toBe(9543.2);
    expect(result.segments[1]?.endTimeSeconds).toBe(9546.4);
  });

  it("falls back to full-video transcript when no window is provided", () => {
    const result = __transcriptionTestUtils.applySermonSegmentWindowToTranscript(baseTranscript, {
      sermonStartSeconds: null,
      sermonEndSeconds: null,
      analyzeFullRecording: false,
      knownDurationSeconds: 400,
    });

    expect(result.applied).toBe(false);
    expect(result.transcript.segments).toHaveLength(baseTranscript.segments.length);
  });

  it("respects analyze full recording even when start/end values exist", () => {
    const result = __transcriptionTestUtils.applySermonSegmentWindowToTranscript(baseTranscript, {
      sermonStartSeconds: 120,
      sermonEndSeconds: 260,
      analyzeFullRecording: true,
      knownDurationSeconds: 400,
    });

    expect(result.applied).toBe(false);
    expect(result.transcript.segments).toHaveLength(baseTranscript.segments.length);
  });

  it("throws friendly error when end is before start", () => {
    expect(() =>
      __transcriptionTestUtils.applySermonSegmentWindowToTranscript(baseTranscript, {
        sermonStartSeconds: 300,
        sermonEndSeconds: 120,
        analyzeFullRecording: false,
        knownDurationSeconds: 400,
      }),
    ).toThrow("Sermon end time must be after the start time.");
  });

  it("throws friendly error when end exceeds known duration", () => {
    expect(() =>
      __transcriptionTestUtils.applySermonSegmentWindowToTranscript(baseTranscript, {
        sermonStartSeconds: 120,
        sermonEndSeconds: 600,
        analyzeFullRecording: false,
        knownDurationSeconds: 400,
      }),
    ).toThrow("Sermon end time is longer than the video duration.");
  });
});
