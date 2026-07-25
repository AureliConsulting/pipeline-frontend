import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Primary user flow (spec §17):
 * login → create CSV campaign → upload fixture → validate → select config →
 * start MOCK run → live progress → approve stage one → stage two → approve
 * final → download artifact → campaign appears in dashboard search.
 *
 * Requires E2E_EMAIL / E2E_PASSWORD and a mock-mode runner (see playwright.config.ts).
 */
const EMAIL = process.env.E2E_EMAIL ?? "";
const PASSWORD = process.env.E2E_PASSWORD ?? "";
const configured = EMAIL !== "" && PASSWORD !== "";

test.skip(!configured, "Set E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD and run a mock runner");

const CAMPAIGN_TITLE = `E2E Mock Campaign ${Date.now()}`;
const fixturePath = join(__dirname, "../../../fixtures/sample_leads.csv");

async function waitForRunStatus(page: Page, statuses: string[], timeoutMs: number) {
  await expect
    .poll(
      async () => page.locator('[data-testid="run-live"]').getAttribute("data-status"),
      { timeout: timeoutMs, intervals: [2000] },
    )
    .toMatch(new RegExp(statuses.join("|")));
}

test("primary flow: csv campaign through both approvals to download + search", async ({ page }) => {
  // 1. Log in
  await page.goto("/login");
  await page.getByTestId("login-email").fill(EMAIL);
  await page.getByTestId("login-password").fill(PASSWORD);
  await page.getByTestId("login-submit").click();
  await page.waitForURL("**/dashboard");
  await expect(page.getByTestId("user-email")).toContainText(EMAIL);

  // 2. Create a CSV campaign
  await page.getByTestId("new-campaign").click();
  await page.getByTestId("campaign-title").fill(CAMPAIGN_TITLE);
  await page.getByTestId("input-csv").check();
  await page.getByTestId("wizard-next-1").click();

  // 3-4. Upload the fixture and validate
  await page.getByTestId("csv-file-input").setInputFiles({
    name: "sample_leads.csv",
    mimeType: "text/csv",
    buffer: readFileSync(fixturePath),
  });
  await expect(page.getByTestId("csv-validation")).toContainText("Validation passed", {
    timeout: 30_000,
  });
  await expect(page.getByTestId("csv-validation")).toContainText("Total rows: 6");
  await page.getByTestId("wizard-next-2").click();

  // 5. Select / create a configuration (from canonical)
  await page.getByTestId("config-from-canonical").click();
  await page.getByTestId("config-name").fill("E2E canonical config");
  await page.getByTestId("config-save").click();
  await page.getByTestId("wizard-next-3").click();

  // 6. Start a MOCK run
  await page.getByTestId("mock-toggle").check();
  await page.getByTestId("start-pipeline").click();
  await page.waitForURL("**/runs/**/progress");

  // 7. Observe live progress → stage one pauses for approval
  await waitForRunStatus(page, ["awaiting_stage_one_approval"], 120_000);
  await expect(page.getByTestId("live-log")).toContainText("MOCK");

  // 8. Approve stage one
  await page.getByTestId("goto-review").click();
  await page.waitForURL("**/review");
  await page.getByTestId("approve-stage-one").click();
  await page.waitForURL("**/progress");

  // 9. Observe stage two → final approval
  await waitForRunStatus(page, ["awaiting_final_approval"], 120_000);

  // 10. Approve final results (complete without Instantly upload)
  await page.getByTestId("goto-results").click();
  await page.waitForURL("**/results");
  await page.getByTestId("final-complete").click();
  await expect(page.locator("body")).toContainText(/Completed/i, { timeout: 30_000 });

  // 11. Download an artifact (signed URL round-trip)
  const downloadButton = page.locator('[data-testid^="download-"]').first();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    downloadButton.click(),
  ]);
  expect(await download.failure()).toBeNull();

  // 12. Campaign appears in dashboard search
  await page.goto("/dashboard");
  await page.getByTestId("campaign-search").fill(CAMPAIGN_TITLE);
  await page.getByTestId("campaign-search-submit").click();
  await expect(page.getByTestId("campaign-table")).toContainText(CAMPAIGN_TITLE);
});
