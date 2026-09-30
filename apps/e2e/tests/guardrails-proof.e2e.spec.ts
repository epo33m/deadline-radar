/**
 * #61 — proof that the guardrails detect, not merely exist.
 *
 * Each test sabotages a healthy page and asserts the collector reports it.
 * Sabotage would trip the auto-asserting fixture, so these tests carry the
 * `INTENTIONAL_ERROR_PAGE` exemption (dogfooding the escape hatch E2E-06
 * uses) and assert on a manually attached report instead. If the collector
 * ever stops detecting, these tests go red — that is the point.
 *
 * No fixtures, no database: /login is server-static, so this file runs
 * against the web server alone.
 */
import {
  collectPageHealth,
  expect,
  INTENTIONAL_ERROR_PAGE,
  pageHealthErrors,
  test,
} from "./guardrails";

function exempt(reason: string): void {
  test.info().annotations.push({
    type: INTENTIONAL_ERROR_PAGE,
    description: reason,
  });
}

test.describe("guardrails detect sabotage (#61)", () => {
  test("aborted stylesheet is reported as a failed asset", async ({
    page,
  }) => {
    exempt("proof: stylesheet aborted to verify asset-request-failed fires");
    const report = collectPageHealth(page);
    await page.route("**/_next/static/chunks/*.css", (route) =>
      route.abort(),
    );
    await page.goto("/login");
    await page.waitForTimeout(1500);
    const errors = pageHealthErrors(report);
    expect(
      errors.some(
        (line) =>
          line.startsWith("[asset-request-failed]") && line.includes(".css"),
      ),
      `expected a failed-stylesheet finding, got: ${JSON.stringify(errors)}`,
    ).toBe(true);
  });

  test("chunk served as 500 is reported with its status", async ({
    page,
  }) => {
    exempt("proof: chunks served as 500 to verify asset-status fires");
    const report = collectPageHealth(page);
    await page.route("**/_next/static/chunks/*.js", (route) =>
      route.fulfill({ status: 500, body: "sabotaged" }),
    );
    await page.goto("/login");
    await page.waitForTimeout(1500);
    const errors = pageHealthErrors(report);
    expect(
      errors.some(
        (line) =>
          line.startsWith("[asset-status]") &&
          line.includes(".js") &&
          line.includes("500"),
      ),
      `expected a 500-chunk finding, got: ${JSON.stringify(errors)}`,
    ).toBe(true);
  });

  test("injected console error is reported", async ({ page }) => {
    exempt("proof: console.error injected to verify console-error fires");
    const report = collectPageHealth(page);
    await page.goto("/login");
    await page.evaluate(() => {
      console.error("PROOF-INDUCED console error");
    });
    await page.waitForTimeout(300);
    const errors = pageHealthErrors(report);
    expect(
      errors.some(
        (line) =>
          line.startsWith("[console-error]") &&
          line.includes("PROOF-INDUCED"),
      ),
      `expected a console-error finding, got: ${JSON.stringify(errors)}`,
    ).toBe(true);
  });

  test("healthy page reports nothing (control)", async ({ page }) => {
    const report = collectPageHealth(page);
    await page.goto("/login");
    await page.waitForTimeout(1500);
    expect(pageHealthErrors(report)).toEqual([]);
  });
});
