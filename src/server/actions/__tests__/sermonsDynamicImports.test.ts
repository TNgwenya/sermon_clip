import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const sermonsActionPath = join(currentDir, "..", "sermons.ts");

describe("sermon server action dynamic imports", () => {
  it("lets Turbopack resolve local app-code imports for server chunks", async () => {
    const source = await readFile(sermonsActionPath, "utf8");

    expect(source).toContain('import("@/server/agents/videoDownloadAgent")');
    expect(source).toContain('import("@/server/agents/smartCropDebugService")');
    expect(source).toContain('import("@/server/pipeline/processSermonPipeline")');
    expect(source).not.toContain("import(/* turbopackIgnore: true */");
  });
});
