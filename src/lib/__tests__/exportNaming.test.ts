import { describe, expect, it } from "vitest";

import {
  buildClipDownloadFileName,
  buildClipExportBaseName,
  buildSermonExportDirectoryName,
  formatExportDate,
  slugifyExportName,
} from "@/lib/exportNaming";

describe("export naming", () => {
  it("creates safe names for sermons and clips", () => {
    expect(slugifyExportName("Faith & Fire: Week 2!")).toBe("faith-fire-week-2");
    expect(buildClipExportBaseName({ title: "Walking by Faith", index: 3 })).toBe("03_walking-by-faith");
  });

  it("normalizes accents and trims cleanly after truncating long names", () => {
    expect(slugifyExportName("Réveil à São Paulo: Faith!!!")).toBe("reveil-a-sao-paulo-faith");
    expect(slugifyExportName(`${"A".repeat(71)} & gift`)).toBe("a".repeat(71));
  });

  it("builds sermon directory names from title, pastor, and date", () => {
    expect(
      buildSermonExportDirectoryName({
        title: "Sunday Morning Service",
        speakerName: "Pastor Thabang",
        sermonDate: new Date("2026-06-21T09:00:00.000Z"),
      }),
    ).toBe("sunday-morning-service_pastor-thabang_2026-06-21");
  });

  it("uses undated and pastor fallbacks when sermon metadata is missing", () => {
    expect(
      buildSermonExportDirectoryName({
        title: "Hope",
        speakerName: "",
        sermonDate: null,
      }),
    ).toBe("hope_pastor_undated");
    expect(formatExportDate("not-a-date")).toBe("undated");
  });

  it("builds readable single clip download filenames", () => {
    expect(
      buildClipDownloadFileName({
        title: "Grace in the Valley",
        speakerName: "Pastor Melusi",
        sermonDate: "2026-06-21",
        clipTitle: "God Meets You There",
        index: 1,
        extension: ".mp4",
      }),
    ).toBe("grace-in-the-valley_pastor-melusi_2026-06-21_01_god-meets-you-there.mp4");
  });

  it("uses a description when the clip title is generic", () => {
    expect(
      buildClipExportBaseName({
        title: "Clip 1",
        description: "God gives courage to serve with your gift",
        index: 2,
      }),
    ).toBe("02_god-gives-courage-to-serve-with-your-gift");

    expect(
      buildClipDownloadFileName({
        title: "Sunday Morning Service",
        speakerName: "Pastor Thabang",
        sermonDate: "2026-06-21",
        clipTitle: "Untitled clip",
        description: "Use what God placed in your hand",
        index: 4,
      }),
    ).toBe("sunday-morning-service_pastor-thabang_2026-06-21_04_use-what-god-placed-in-your-hand.mp4");
  });
});
