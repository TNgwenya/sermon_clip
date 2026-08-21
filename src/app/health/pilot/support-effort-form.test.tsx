import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("./support-effort-actions", () => ({
  recordPilotSupportEffortAction: vi.fn(),
}));

import { SupportEffortForm } from "./support-effort-form";

describe("support effort form", () => {
  it("offers only categorical/date/minute controls and no private-detail field", () => {
    const markup = renderToStaticMarkup(<SupportEffortForm today="2026-08-21" />);

    for (const field of ["boardCategory", "category", "severity", "status", "outcome", "incidentDate", "minutes"]) {
      expect(markup).toContain(`name="${field}"`);
    }
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toMatch(/name="(?:notes|title|sermonId|customerId|actorUserId|organizationId|campusId)"/u);
    expect(markup).toContain("Pastoral accuracy");
    expect(markup).toContain("Privacy security");
    expect(markup).toContain("Do not enter names, sermon details, notes, links, or incident identifiers.");
    expect(markup).toContain("aria-live=\"polite\"");
  });
});
