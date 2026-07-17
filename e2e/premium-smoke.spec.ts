import { expect, test } from "@playwright/test";

test("pastor can reach the core content workflow", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Your message. Ready to move." })).toBeVisible();

  await page.goto("/sermons/new");
  await expect(page.getByRole("heading", { name: "Create clips from one message." })).toBeVisible();
  await page.getByRole("radio", { name: "Upload media Choose the recording from this device" }).click();
  await expect(page.getByRole("button", { name: "Upload a recording" })).toBeVisible();

  await page.goto("/opportunities");
  await expect(page.getByRole("heading", { name: "Create post ideas from sermons" })).toBeVisible();

  await page.goto("/weekly-plan");
  await expect(page.getByRole("heading", { name: "One reviewed ministry week" })).toBeVisible();

  await page.goto("/ready-to-post");
  await expect(page.getByRole("heading", { name: "Prepare your next post" })).toBeVisible();

  await page.goto("/growth");
  await expect(page.getByRole("heading", { name: "Next best post", level: 1 })).toBeVisible();

  await page.goto("/intelligence-dashboard");
  await expect(page.getByRole("heading", { name: "What your sermons are teaching" })).toBeVisible();
});

test("health reports operational truth", async ({ page }) => {
  await page.goto("/health");
  await expect(
    page.getByRole("heading", {
      name: /^(Workspace needs attention|Sermon Clip is operational)$/,
    }),
  ).toBeVisible();
  await expect(page.getByText("Automatic publishing worker", { exact: true })).toBeVisible();
});

test.describe("mobile navigation", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("keeps every primary workspace reachable", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Mobile navigation" })).toBeVisible();
    await page.locator('summary[aria-label="More navigation options"]').click();
    await expect(page.getByRole("link", { name: "Weekly planner" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Content ideas" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Social channels" })).toBeVisible();
  });
});
