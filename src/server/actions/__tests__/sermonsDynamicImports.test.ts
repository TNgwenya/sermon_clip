import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

const currentDir = dirname(fileURLToPath(import.meta.url));
const sermonsActionPath = join(currentDir, "..", "sermons.ts");

describe("sermon server action dynamic imports", () => {
  it("uses a relative smart crop debug import so Turbopack server chunks can resolve it", async () => {
    const source = await readFile(sermonsActionPath, "utf8");

    expect(source).toContain('import(/* turbopackIgnore: true */ "../agents/smartCropDebugService")');
    expect(source).not.toContain('import(/* turbopackIgnore: true */ "@/server/agents/smartCropDebugService")');
  });
});
