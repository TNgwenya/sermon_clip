import { describe, expect, it } from "vitest";

import {
  FIXTURE_CONTACT_TIMES_SECONDS,
  FRAMING_FIXTURE_CASES,
  MOVING_SPEAKER_TRACKING_POINTS,
  buildFixtureFramingFilter,
  buildFixturePlans,
  buildMissingTrackingFallbackPlan,
  buildSyntheticSpeakerOverlayExpressions,
  buildTrackingBoxManifest,
} from "../framing-moving-speaker-fixture.ts";

describe("moving-speaker framing visual fixture", () => {
  it("covers three scenes with deterministic horizontal and vertical subject movement", () => {
    const sceneIds = new Set(MOVING_SPEAKER_TRACKING_POINTS.map((point) => point.sceneId));
    const centerXs = MOVING_SPEAKER_TRACKING_POINTS.map((point) => point.centerX);
    const centerYs = MOVING_SPEAKER_TRACKING_POINTS.map((point) => point.centerY ?? 0.5);

    expect(sceneIds).toEqual(new Set([
      "scene-left-to-right",
      "scene-right-to-left",
      "scene-rise-and-cross",
    ]));
    expect(Math.min(...centerXs)).toBeLessThanOrEqual(0.2);
    expect(Math.max(...centerXs)).toBeGreaterThanOrEqual(0.8);
    expect(Math.min(...centerYs)).toBeLessThanOrEqual(0.3);
    expect(Math.max(...centerYs)).toBeGreaterThanOrEqual(0.65);
    expect(FIXTURE_CONTACT_TIMES_SECONDS).toEqual([0.5, 6, 11.5]);
  });

  it("emits normalized tracking boxes that match every timeline point", () => {
    const boxes = buildTrackingBoxManifest();

    expect(boxes).toHaveLength(MOVING_SPEAKER_TRACKING_POINTS.length);
    for (const box of boxes) {
      expect(box.width).toBeGreaterThan(0);
      expect(box.height).toBeGreaterThan(0);
      expect(box.left).toBeGreaterThanOrEqual(0);
      expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.left + box.width).toBeLessThanOrEqual(1);
      expect(box.top + box.height).toBeLessThanOrEqual(1);
    }
  });

  it("keeps all six Studio choices distinct at the requested plan boundary", () => {
    expect(FRAMING_FIXTURE_CASES.map((fixtureCase) => fixtureCase.id)).toEqual([
      "auto-intelligent",
      "speaker-focus",
      "worship-wide",
      "full-stage",
      "centre-crop",
      "blurred-background",
    ]);

    const plans = buildFixturePlans();
    expect(plans).toHaveLength(6);
    expect(plans.find(({ fixtureCase }) => fixtureCase.id === "auto-intelligent")?.plan.requested)
      .toEqual({ layout: "SMART_CROP", personality: "AUTO_INTELLIGENT" });
    expect(plans.find(({ fixtureCase }) => fixtureCase.id === "speaker-focus")?.plan.requested)
      .toEqual({ layout: "SMART_CROP", personality: "SPEAKER_FOCUS" });
    expect(plans.find(({ fixtureCase }) => fixtureCase.id === "worship-wide")?.plan.requested)
      .toEqual({ layout: "SMART_CROP", personality: "WORSHIP_WIDE" });
    expect(plans.find(({ fixtureCase }) => fixtureCase.id === "full-stage")?.plan.requested)
      .toEqual({ layout: "SMART_CROP", personality: "SAFE_FULL_STAGE" });
    expect(plans.find(({ fixtureCase }) => fixtureCase.id === "centre-crop")?.plan.requested.layout)
      .toBe("CENTER_CROP");
    expect(plans.find(({ fixtureCase }) => fixtureCase.id === "blurred-background")?.plan.requested.layout)
      .toBe("FIT_BLURRED_BACKGROUND");
  });

  it("uses canonical plans for tracked crops and genuine blurred full-frame outputs", () => {
    const plans = buildFixturePlans();
    const auto = plans.find(({ fixtureCase }) => fixtureCase.id === "auto-intelligent")?.plan;
    const speaker = plans.find(({ fixtureCase }) => fixtureCase.id === "speaker-focus")?.plan;
    const worship = plans.find(({ fixtureCase }) => fixtureCase.id === "worship-wide")?.plan;
    const fullStage = plans.find(({ fixtureCase }) => fixtureCase.id === "full-stage")?.plan;
    const centre = plans.find(({ fixtureCase }) => fixtureCase.id === "centre-crop")?.plan;
    const blurred = plans.find(({ fixtureCase }) => fixtureCase.id === "blurred-background")?.plan;

    expect(auto?.effective.layout).toBe("SMART_CROP");
    expect(speaker?.effective.layout).toBe("SMART_CROP");
    expect(auto?.effective.treatment).toBe("AUTO_CONTEXTUAL");
    expect(speaker?.effective.treatment).toBe("SPEAKER_FOCUS");
    expect(auto?.effective.zoom).not.toBe(speaker?.effective.zoom);
    expect(auto?.tracking.timeline.length).toBeGreaterThan(2);
    expect(speaker?.tracking.timeline.length).toBeGreaterThan(2);

    expect(worship?.effective.layout).toBe("FIT_BLURRED_BACKGROUND");
    expect(worship?.effective.treatment).toBe("WORSHIP_WIDE");
    expect(worship && buildFixtureFramingFilter(worship)).toContain("scale=1040:1840");

    expect(fullStage?.effective.layout).toBe("FIT_BLURRED_BACKGROUND");
    expect(fullStage?.effective.treatment).toBe("FULL_STAGE");
    expect(fullStage && buildFixtureFramingFilter(fullStage)).toContain("scale=918:1632");

    expect(blurred?.effective.layout).toBe("FIT_BLURRED_BACKGROUND");
    expect(blurred?.effective.treatment).toBe("BLURRED_BACKGROUND");
    expect(blurred && buildFixtureFramingFilter(blurred)).toContain("boxblur=20:1");
    expect(blurred && buildFixtureFramingFilter(blurred)).toContain("overlay=(W-w)/2:(H-h)/2");

    expect(centre?.effective.layout).toBe("CENTER_CROP");
    expect(centre?.effective.treatment).toBe("CENTER_CROP");
    expect(centre && buildFixtureFramingFilter(centre)).not.toContain("boxblur");

    expect(new Set(plans.map(({ plan }) => buildFixtureFramingFilter(plan))).size).toBe(6);
  });

  it("represents missing model tracking as an explicit honest fallback", () => {
    const fallback = buildMissingTrackingFallbackPlan();

    expect(fallback.requested).toEqual({
      layout: "SMART_CROP",
      personality: "SPEAKER_FOCUS",
    });
    expect(fallback.tracking.status).toBe("UNAVAILABLE");
    expect(fallback.tracking.timeline).toEqual([]);
    expect(fallback.effective.layout).toBe("FIT_BLURRED_BACKGROUND");
    expect(fallback.effective.treatment).toBe("BLURRED_BACKGROUND");
    expect(fallback.resolution.status).toBe("FALLBACK");
    expect(fallback.resolution.fallbackCode).toBe("MODEL_TRACKING_UNAVAILABLE");
    expect(buildFixtureFramingFilter(fallback)).toContain("boxblur=20:1");
  });

  it("builds frame-evaluated overlay expressions for both axes", () => {
    const expressions = buildSyntheticSpeakerOverlayExpressions();

    expect(expressions.x).toContain("if(lte(t\\,");
    expect(expressions.y).toContain("if(lte(t\\,");
    expect(expressions.x).toContain("min(max((t-");
    expect(expressions.y).toContain("min(max((t-");
  });
});
