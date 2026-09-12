import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";

const screenshotDirectory = "artifacts/screenshots/premium-review-2026-09-12";

test.beforeEach(async ({ page }) => {
  if (!process.env.SCHEDULER_ADMIN_PASSWORD?.trim()) return;
  const password = process.env.BOOTSTRAP_OWNER_PASSWORD?.trim();
  if (!password) throw new Error("A local test owner password is required for this private workspace test.");
  await page.goto("/login");
  await page.getByLabel("Email").fill("owner@local.sermonclip.invalid");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in securely" }).click();
  await expect(page).toHaveURL("/");
});

test("live intake guides setup honestly when the provider is unavailable", async ({ page }) => {
  await page.goto("/settings/intake");
  const navigation = page.getByRole("navigation", { name: "Primary navigation", exact: true });
  await expect(navigation.getByRole("link", { name: "Sermon intake", exact: true })).toHaveAttribute("aria-current", "page");
  await page.getByRole("link", { name: "Set up live intake", exact: true }).click();
  await expect(page).toHaveURL("/settings/live-intake");
  await expect(page.getByRole("heading", { name: "Sunday arrives here." })).toBeVisible();
  await expect(navigation.getByRole("link", { name: "Sermon intake", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(page.getByText("Live intake is not enabled yet.", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect your encoder", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Send a spoken test, then stop", exact: true })).toBeVisible();
  await expect(page.getByText("Your first recording will appear here.", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create private stream", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Private stream key", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("link", { name: "add a sermon recording", exact: true })).toHaveAttribute("href", "/sermons/new");
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: `${screenshotDirectory}/live-intake-desktop.png`, fullPage: true });
});

test("live intake remains readable and reachable on mobile", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/settings/live-intake");
  await expect(page.getByRole("heading", { name: "Sunday arrives here." })).toBeVisible();
  const width = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  expect(width.document).toBeLessThanOrEqual(width.viewport);
  await mkdir(screenshotDirectory, { recursive: true });
  await page.screenshot({ path: `${screenshotDirectory}/live-intake-mobile.png`, fullPage: true });
  const navigation = page.getByRole("navigation", { name: "Mobile navigation", exact: true });
  await navigation.getByLabel("More navigation options", { exact: true }).click();
  await navigation.getByRole("link", { name: "Sermon intake", exact: true }).click();
  await expect(page).toHaveURL("/settings/intake");
});
