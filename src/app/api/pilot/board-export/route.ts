import { NextResponse } from "next/server";

import { serializePilotBoardJson } from "@/lib/pilotTelemetry/boardExport";
import { requireRequestCapability } from "@/server/auth/requestAuthorization";
import { getPilotBoardReadModel } from "@/server/pilotTelemetry/boardReadModel";

const PILOT_EXPORT_WINDOW_DAYS = 30;

function exportWindow(now: Date): { from: Date; until: Date } {
  return {
    from: new Date(now.getTime() - PILOT_EXPORT_WINDOW_DAYS * 24 * 60 * 60 * 1_000),
    until: now,
  };
}

export async function GET(request: Request): Promise<NextResponse> {
  const requestContext = await requireRequestCapability("analytics.export");
  const format = new URL(request.url).searchParams.get("format") === "csv" ? "csv" : "json";
  const now = new Date();
  const window = exportWindow(now);
  const model = await getPilotBoardReadModel({
    organizationId: requestContext.organizationId,
    campusId: requestContext.campusId,
    ...window,
    generatedAt: now,
  });
  const body = format === "csv" ? model.csv : serializePilotBoardJson(model.boardExport);
  const extension = format;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Disposition": `attachment; filename="pilot-board-evidence.${extension}"`,
      "Content-Type": format === "csv"
        ? "text/csv; charset=utf-8"
        : "application/json; charset=utf-8",
      "X-Pilot-Evidence": "directional-not-readiness-proof",
    },
  });
}

export const __pilotBoardExportRouteTestUtils = {
  PILOT_EXPORT_WINDOW_DAYS,
  exportWindow,
};
