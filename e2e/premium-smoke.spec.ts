import { expect, test, type Page } from "@playwright/test";

async function openWorkspaceRoute(page: Page, path: string) {
  const response = await page.goto(path);

  expect(response, `${path} should return a document response`).not.toBeNull();
  expect(response?.ok(), `${path} should return a successful status`).toBe(true);
  await expect(page.locator("main").last()).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
}

test("pastor can reach the core content workflow", async ({ page }) => {
  await openWorkspaceRoute(page, "/");
  await expect(page.getByRole("link", { name: "Create", exact: true })).toHaveAttribute("href", "/sermons/new");

  await openWorkspaceRoute(page, "/sermons/new");
  await expect(page.getByRole("radiogroup", { name: "Recording source" })).toBeVisible();
  await expect(page.getByLabel("Sermon video link")).toBeVisible();
  await expect(page.getByRole("button", { name: "Analyze this sermon" })).toBeVisible();

  await openWorkspaceRoute(page, "/opportunities");
  await expect(page.getByRole("heading", { name: "Plan, preview, then publish" })).toBeVisible();

  await openWorkspaceRoute(page, "/week-drafts");
  await expect(page.getByRole("heading", { name: "Your week, already drafted." })).toBeVisible();

  await openWorkspaceRoute(page, "/inbox");
  await expect(page.getByRole("heading", { name: "What needs me today?" })).toBeVisible();

  await openWorkspaceRoute(page, "/weekly-plan");
  await expect(page.getByRole("navigation", { name: "Weekly plan actions" })).toBeVisible();

  await openWorkspaceRoute(page, "/ready-to-post");
  await expect(page.getByRole("heading", { name: "Your sermons, ready to share." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Choose a sermon. See everything it created." })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Publishing desk sections" })).toBeVisible();

  await openWorkspaceRoute(page, "/growth");
  await expect(page.getByRole("navigation", { name: "Growth actions" })).toBeVisible();

  await openWorkspaceRoute(page, "/intelligence-dashboard");
  await expect(page.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/");

  await openWorkspaceRoute(page, "/knowledge-base");
  await expect(page.getByRole("heading", { name: "Search your sermon knowledge" })).toBeVisible();

  await openWorkspaceRoute(page, "/settings/team");
  await expect(page.getByRole("heading", { name: "Give every person the right seat." })).toBeVisible();
});

test("Brand Kit loads as an interactive browser-safe workspace", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  await openWorkspaceRoute(page, "/settings/branding");
  await expect(page.getByLabel("Church Name")).toHaveValue(/\S+/);
  await expect(page.getByRole("textbox", { name: "Main Theme Color", exact: true })).toBeVisible();
  const saveButton = page.getByRole("button", { name: "Save Brand Kit" }).first();
  await expect(saveButton).toBeEnabled();
  await saveButton.click();
  await expect(page.getByRole("status")).toContainText("Branding settings saved.");

  expect(pageErrors, "Brand Kit should hydrate without client runtime errors").toEqual([]);
});

test("health reports operational truth", async ({ page }) => {
  await openWorkspaceRoute(page, "/health");
  await expect(
    page.getByRole("heading", {
      name: /^(Workspace needs attention|Sermon Clip is operational)$/,
    }),
  ).toBeVisible();
  await expect(page.getByText("Automatic publishing worker", { exact: true })).toBeVisible();
});

test("owner can use secure sign-in and reach private account controls", async ({ page }) => {
  const bootstrapPassword = process.env.BOOTSTRAP_OWNER_PASSWORD?.trim();
  test.skip(!bootstrapPassword, "BOOTSTRAP_OWNER_PASSWORD is required for secure-login smoke.");

  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@local.sermonclip.invalid");
  await page.getByLabel("Password").fill(bootstrapPassword!);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL("/");

  await openWorkspaceRoute(page, "/settings/account");
  await expect(page.getByRole("heading", { name: "How your team sees you" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Change your password" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Authenticator app" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where you’re signed in" })).toBeVisible();
});

test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps every primary workspace reachable", async ({ page }) => {
    await openWorkspaceRoute(page, "/");
    const mobileNavigation = page.getByRole("navigation", { name: "Mobile navigation" });

    await expect(mobileNavigation).toBeVisible();
    await mobileNavigation.locator('summary[aria-label="More navigation options"]').click();
    await expect(mobileNavigation.getByRole("link", { name: "Week drafts", exact: true })).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "Weekly plan", exact: true })).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "Content ideas", exact: true })).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "Brand kit", exact: true })).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "Social channels", exact: true })).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "Team & access", exact: true })).toBeVisible();
    await expect(mobileNavigation.getByRole("link", { name: "Account & security", exact: true })).toBeVisible();
  });
});
