/**
 * #60 — Login hydrates and never places the password in the URL.
 *
 * Boundary crossed per test (nothing mocked):
 *   Chromium -> Next.js (`next start`) -> Elysia API -> live Supabase
 *   Postgres, plus one pass with JavaScript disabled to exercise the native
 *   form fallback.
 *
 * The defect: the login `<form>` has no `method`, so any native submit (an
 * unhydrated form, JS disabled or failed) defaults to GET and serialises
 * `email` + `password` into the query string — `GET /login?email=…&password=…`,
 * landing the password in the address bar, history, and query-string logging.
 * The hardening is `method="post"`: the hydrated path is unchanged
 * (`preventDefault` + POST JSON), while the native fallback POSTs its body.
 *
 * Serial by design (playwright.config.ts: workers: 1). Self-sufficient:
 * registers its own user via the real API and deletes it afterwards.
 */
import {
  assertPageHealthy,
  collectPageHealth,
  expect,
  test,
  type Page,
} from "./guardrails";

import { cleanupUser, registerUser, runTag, type TestUser } from "../fixtures";

const RUN = runTag();

/**
 * The regression assertion. Checks the raw URL, the percent-decoded URL (a
 * browser encodes the credential), and the parameter name itself — any one of
 * them carrying the password fails.
 */
async function expectNoPasswordInUrl(page: Page, password: string) {
  const combined = async () => {
    const url = page.url();
    let decoded = url;
    try {
      decoded = decodeURIComponent(url);
    } catch {
      // Malformed escape: assert on the raw URL only.
    }
    return `${url} || ${decoded}`;
  };
  await expect
    .poll(combined, { timeout: 8_000 })
    .not.toContain(password);
  expect(page.url()).not.toMatch(/[?&]password=/);
}

test.describe("Login hydration (#60)", () => {
  let user: TestUser | undefined;

  test.beforeAll(async () => {
    user = await registerUser(`loginHyd-${RUN}`);
  });

  test.afterAll(async () => {
    if (user) await cleanupUser(user);
  });

  test("native submit without JS never places the password in the URL", async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    // Own context ⇒ outside the guarded `context` fixture: attach explicitly.
    const report = collectPageHealth(page);
    try {
      await page.goto("/login");
      await page.fill('input[name="email"]', user!.email);
      await page.fill('input[name="password"]', user!.password);
      // Native submit: no JS to intercept. Before the fix this GETs
      // /login?email=…&password=…; with method="post" the credentials travel
      // in the request body and the URL stays clean.
      await page.locator('button[type="submit"]').click();
      await expectNoPasswordInUrl(page, user!.password);
      // Documents the mechanism: the fallback is a POST, not a GET.
      const method = await page
        .locator('form:has(input[name="password"])')
        .first()
        .getAttribute("method");
      expect(method?.toLowerCase()).toBe("post");
      // With JS disabled the lone entry-chunk `<link rel="preload">` has no
      // executing consumer, and Chromium fails it with a CSP-attributed error
      // (verified: same nonce, same header, coalesces and succeeds with JS
      // enabled — the script could never execute here anyway). Tolerate exactly
      // that artifact; everything else in the report still fails the test.
      assertPageHealthy(report, (line) => line.endsWith(":: csp"));
    } finally {
      await context.close();
    }
  });

  test("hydrated journey: toggle, validation, failed and successful login, logout", async ({
    page,
  }) => {
    const password = user!.password;
    await page.goto("/login");

    // Toggle works in both directions.
    const passwordField = page.locator('input[name="password"]');
    await page.locator('button[aria-label="Show password"]').click();
    await expect(passwordField).toHaveAttribute("type", "text");
    await page.locator('button[aria-label="Hide password"]').click();
    await expect(passwordField).toHaveAttribute("type", "password");
    await expectNoPasswordInUrl(page, password);

    // Client-side validation runs: an invalid email blocks the submit, shows
    // an error, and navigates nowhere.
    await page.fill('input[name="email"]', "not-an-email");
    await passwordField.fill("short");
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");
    await expectNoPasswordInUrl(page, password);

    // Failed login shows an error inline, without a native submit.
    await page.fill('input[name="email"]', user!.email);
    await passwordField.fill(`Wrong-${password}`);
    await page.locator('button[type="submit"]').click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");
    await expectNoPasswordInUrl(page, password);

    // Successful login navigates client-side to /summary.
    await page.fill('input[name="email"]', user!.email);
    await passwordField.fill(password);
    await page.locator('button[type="submit"]').click();
    await page.waitForURL("**/summary", { timeout: 15_000 });
    await expectNoPasswordInUrl(page, password);

    // Logout returns to /login through the defined server action.
    await page.getByRole("button", { name: /account menu/i }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login", { timeout: 15_000 });
    await expectNoPasswordInUrl(page, password);
  });
});
