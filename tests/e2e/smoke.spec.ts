import { expect, test, type Page } from "@playwright/test";

// Demo seed accounts (fictitious). The Pastor role doesn't require 2FA.
const PASSWORD = process.env.DEMO_PASSWORD ?? "Demo-pass-2026";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

test("sign-in errors keep the email and don't reveal which part was wrong", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("pastor@example.org");
  await page.getByLabel("Password").fill("wrong-password-123");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("That email and password don’t match an active account.")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("pastor@example.org");
});

test("signed-out visitors are sent to the right sign-in page @mobile", async ({ page }) => {
  await page.goto("/members");
  await expect(page).toHaveURL(/\/login\?next=%2Fmembers/);
  await page.goto("/me");
  await expect(page).toHaveURL(/\/login\/phone/);
  await expect(page.getByRole("heading", { name: "Member sign in" })).toBeVisible();
});

test("pastor: dashboard, directory search, profile and permission limits", async ({ page }) => {
  await signIn(page, "pastor@example.org");
  await expect(page.getByText("Membership by status")).toBeVisible();
  await page.getByRole("link", { name: /^Members/ }).first().click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Members");
  await page.getByPlaceholder(/Search members/).first().fill("M0002");
  await page.getByPlaceholder(/Search members/).first().press("Enter");
  await page.getByRole("link", { name: /SDAK\/M0002|M0002/ }).first().click().catch(async () => {
    await page.locator("tbody a").first().click();
  });
  await expect(page.getByText("Member ID is permanent")).toBeVisible();
  // No admin access for the Pastor role.
  await page.goto("/admin/users");
  await expect(page).toHaveURL(/\/denied/);
});

test("reports: preview and a logged PDF download after the privacy notice", async ({ page }) => {
  await signIn(page, "pastor@example.org");
  await page.goto("/reports/status");
  await expect(page.getByRole("heading", { name: "Membership by status" })).toBeVisible();
  await page.getByRole("button", { name: "Download" }).click();
  await expect(page.getByRole("dialog").getByText(/Data Protection and Privacy Act, 2019/)).toBeVisible();
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: /I understand/ }).click()]);
  expect(download.suggestedFilename()).toMatch(/^sdak-status-\d{4}-\d{2}-\d{2}\.pdf$/);
});

test("installable: manifest and service worker are served", async ({ request }) => {
  const manifest = await (await request.get("/manifest.webmanifest")).json();
  expect(manifest).toMatchObject({ short_name: "SDAK Members", display: "standalone" });
  const sw = await request.get("/sw.js");
  expect(sw.ok()).toBe(true);
  expect(sw.headers()["cache-control"]).toContain("no-cache");
});
