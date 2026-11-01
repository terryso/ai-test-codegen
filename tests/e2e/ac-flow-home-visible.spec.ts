import { expect, test } from "@playwright/test";

// @generated pipeline:e2e
// criterion: AC-flow-home-visible
test("Open example", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("body")).toBeVisible();
});
