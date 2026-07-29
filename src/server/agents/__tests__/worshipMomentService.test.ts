import { describe, expect, it } from "vitest";

import {
  detectLyricLedWorshipMoments,
  excludeSermonWindowFromWorshipSegments,
  type WorshipTranscriptSegment,
} from "@/server/agents/worshipMomentService";

function segment(start: number, end: number, text: string): WorshipTranscriptSegment {
  return {
    startTimeSeconds: start,
    endTimeSeconds: end,
    text,
    confidence: 0.82,
  };
}

describe("lyric-led worship moment discovery", () => {
  it("finds a sustained English praise and worship refrain", () => {
    const candidates = detectLyricLedWorshipMoments([
      segment(0, 8, "You are holy, holy, Lord God Almighty."),
      segment(8.5, 17, "You are worthy, Jesus, we worship You."),
      segment(17.5, 28, "Hallelujah, glory and honour belong to You."),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      startTimeSeconds: 0,
      endTimeSeconds: 28,
      durationSeconds: 28,
    });
    expect(candidates[0].transcriptText).toContain("Hallelujah");
    expect(candidates[0].confidenceScore).toBeGreaterThan(0.8);
  });

  it("recognizes a lyric-led Zulu worship refrain", () => {
    const candidates = detectLyricLedWorshipMoments([
      segment(10, 18, "Siyakudumisa Jesu, siyakukhonza Nkosi."),
      segment(18.5, 27, "Siyakudumisa Jesu, siyakukhonza Nkosi."),
      segment(27.5, 38, "Haleluya, uyingcwele, udumo kuwe Jesu."),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0].startTimeSeconds).toBe(10);
    expect(candidates[0].endTimeSeconds).toBe(38);
  });

  it("does not mistake sermon teaching about worship for a worship performance", () => {
    const candidates = detectLyricLedWorshipMoments([
      segment(0, 10, "Today I want to teach you why worship matters in the life of the church."),
      segment(10.5, 21, "The Bible says that worship is a response to the goodness of God."),
      segment(21.5, 32, "My first point is that praise must come from a sincere heart."),
    ]);

    expect(candidates).toEqual([]);
  });

  it("does not create clips from instrumental-only transcript markers", () => {
    const candidates = detectLyricLedWorshipMoments([
      segment(0, 12, "[Music]"),
      segment(12.5, 25, "[Instrumental music continues]"),
      segment(25.5, 38, "[Applause]"),
    ]);

    expect(candidates).toEqual([]);
  });

  it("does not treat isolated praise language in spoken announcements as lyric-led worship", () => {
    const candidates = detectLyricLedWorshipMoments([
      segment(0, 25, "Praise the Lord Jesus Christ. Hallelujah. We are done. Give your neighbor a high five. Are you blessed, church?"),
      segment(26, 49, "Please join the WhatsApp group and RSVP for the conference. Hallelujah."),
      segment(50, 73, "The hospitality team needs volunteers, so kindly see us to sign up. Hallelujah."),
      segment(74, 92, "Membership training continues online this Saturday. Hallelujah."),
    ]);

    expect(candidates).toEqual([]);
  });

  it("does not join worship words across an announcement into a candidate", () => {
    const candidates = detectLyricLedWorshipMoments([
      segment(0, 8, "Hallelujah, You are holy, we worship You."),
      segment(8.5, 17, "Please RSVP for the conference using the WhatsApp group."),
      segment(17.5, 25, "Hallelujah, You are worthy, we worship You."),
      segment(25.5, 34, "Hallelujah, we praise Your name."),
    ]);

    expect(candidates).toEqual([]);
  });

  it("excludes the sermon window before looking for praise and worship moments", () => {
    const segments = [
      segment(0, 20, "Hallelujah, You are holy, we worship You."),
      segment(100, 120, "Today I want to teach from this passage."),
      segment(200, 220, "You are worthy, Jesus, we worship You."),
      segment(290, 310, "This segment overlaps the end of the sermon."),
    ];

    expect(excludeSermonWindowFromWorshipSegments(segments, 90, 300)).toEqual([
      segments[0],
    ]);
  });

  it("returns at most eight non-overlapping praise and worship suggestions", () => {
    const segments = Array.from({ length: 9 }, (_, groupIndex) => {
      const start = groupIndex * 100;
      return [
        segment(start, start + 8, "Hallelujah, You are holy, we worship You."),
        segment(start + 8.5, start + 17, "Hallelujah, You are worthy, we worship You."),
        segment(start + 17.5, start + 26, "We give glory to Jesus, we praise Your name."),
      ];
    }).flat();

    const candidates = detectLyricLedWorshipMoments(segments);

    expect(candidates).toHaveLength(8);
    expect(candidates.map((candidate) => candidate.startTimeSeconds)).toEqual([
      0,
      100,
      200,
      300,
      400,
      500,
      600,
      700,
    ]);
  });
});
