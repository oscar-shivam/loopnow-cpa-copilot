import { expect, test, type Page } from "@playwright/test";

async function selectReceipt(page: Page, receiptNumber: string): Promise<void> {
  await page.getByRole("button", { name: new RegExp(`Receipt ${receiptNumber}`) }).click();
  await expect(page.getByText(`Receipt ${receiptNumber}`, { exact: false }).last()).toBeVisible();
}

async function processSelectedReceipt(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Process selected receipt" }).click();
}

test.describe("bookkeeping workflow", () => {
  test("persists the office-supplies result and presents its audit replay", async ({ page }) => {
    await page.goto("/dashboard");
    await selectReceipt(page, "001");
    await processSelectedReceipt(page);

    await expect(page.getByText("Processing complete")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".explanation")).toContainText("Office Expenses");
    await expect(page.locator(".explanation")).toContainText("$4.10");

    await page.getByRole("button", { name: "Load replay" }).click();
    await expect(page.getByText("get current receipt")).toBeVisible();
    await expect(page.getByText("update expense classification")).toBeVisible();
  });

  test("applies the ordinary-meal limitation", async ({ page }) => {
    await page.goto("/dashboard");
    await selectReceipt(page, "002");
    await processSelectedReceipt(page);

    await expect(page.getByText("Processing complete")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".explanation")).toContainText("Meals & Entertainment");
    await expect(page.locator(".explanation")).toContainText("$6.00");
  });

  test("routes missing evidence and instruction injection to review", async ({ page }) => {
    await page.goto("/dashboard");
    await selectReceipt(page, "003");
    await processSelectedReceipt(page);
    await expect(page.getByText("Human review required")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".explanation")).toContainText("no final GST/HST claim is approved automatically");

    await selectReceipt(page, "005");
    await processSelectedReceipt(page);
    await expect(page.getByText("Human review required")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator(".explanation")).toContainText("no final GST/HST claim is approved automatically");
    await expect(page.locator(".explanation")).not.toContainText("system prompt");
  });
});
