import { describe, expect, it } from "vitest";

import { errorFields, formatDiagnosticLogEntry } from "../worker-log";

describe("worker diagnostics", () => {
  it("records an error name, code, cause, and bounded short stack", () => {
    const cause = Object.assign(new Error("database connection timed out"), { code: "P1001" });
    const error = Object.assign(new Error("processing failed", { cause }), { code: "MEDIA_FAILURE" });
    error.stack = [
      "Error: processing failed",
      "    at first (/workspace/worker.ts:10:2)",
      "    at second (/workspace/worker.ts:20:2)",
      "    at third (/workspace/worker.ts:30:2)",
      "    at fourth (/workspace/worker.ts:40:2)",
      "    at omitted (/workspace/worker.ts:50:2)",
    ].join("\n");

    expect(errorFields(error)).toEqual({
      error: "processing failed",
      name: "Error",
      code: "MEDIA_FAILURE",
      cause: "Error [P1001]: database connection timed out",
      stack: [
        "Error: processing failed",
        "at first (/workspace/worker.ts:10:2)",
        "at second (/workspace/worker.ts:20:2)",
        "at third (/workspace/worker.ts:30:2)",
        "at fourth (/workspace/worker.ts:40:2)",
      ].join(" | "),
    });
  });

  it("bounds the diagnostic line persisted with a processing job", () => {
    const diagnostic = formatDiagnosticLogEntry("Media worker job failed", {
      sermonId: "sermon-1",
      workerId: "worker-1",
      stack: "x".repeat(5_000),
    }, 240);

    expect(diagnostic).toHaveLength(240);
    expect(diagnostic).toContain("sermonId=sermon-1");
    expect(diagnostic).toContain("workerId=worker-1");
    expect(diagnostic.endsWith("...")).toBe(true);
  });
});
