/**
 * #62 — staging auth journey, both engines (chromium + webkit projects).
 *
 * Boundary crossed (nothing mocked):
 *   browser -> Next.js (`next start`) -> Elysia API -> live Supabase Postgres.
 *
 * One end-to-end flow per engine: landing → register → login → the protected
 * routes that require a session → reload persistence → logout → post-logout
 * gate. The styling defect that started this work only reproduced in WebKit,
 * so every interactivity assertion below runs in both engines via the
 * playwright projects — a Chromium-only or WebKit-only regression in this
 * flow cannot slip through.
 *
 * The registered user is created through the real UI form; its id/token for
 * teardown come from one API login in `afterAll` (best-effort: the test has
 * already failed if that user does not exist).
 *
 * Serial by design (playwright.config.ts: workers: 1).
 */
import { expect, test } from "./guardrails";

import { api, cleanupUser, runTag, type TestUser } from "../fixtures";
import { expectNoPasswordInUrl } from "./auth-url";

const RUN = runTag();
const email = `journey-${RUN}@example.test`;
const password = `Journey-${RUN}-1!`;

async function fetchUserId(): Promise<string> {
  // Direct API login returns { user, redirectTo } plus flat tokens only for
  // the trusted bridge; the id is what teardown needs for cleanupUser.
  const login = await api<{ user?: { id?: string } }>("/api/v1/auth/login", {
    method: "POST",
    body: { email, password },
  });
  const id = login.body.user?.id;
  if (login.status !== 200 || !id) {
    throw new Error(
      `teardown login failed (${login.status}): ${JSON.stringify(login.body)?.slice(0, 200)}`,
    );
  }
  return id;
}

test.describe("Staging auth journey (#62)", () => {
  test.afterAll(async () => {
    // Best-effort: if the journey failed before the user existed, warn
    // instead of masking the real failure. No fixtures are created, so no
    // user token is needed for cleanup.
    try {
      const userId = await fetchUserId();
      const user: TestUser = { email, password, userId, token: "" };
      await cleanupUser(user);
    } catch (error) {
      console.warn(`journey teardown skipped: ${String(error)}`);
    }
  });

  test("landing → register → login → protected routes → reload → logout → gate", async ({
    page,
  }) => {
    // 1. Landing renders; the CTA goes to /login, whose footer links on to
    // /register — both client-side navigations.
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Deadline Radar" }),
    ).toBeVisible();
    await page.getByRole("link", { name: /see your deadlines/i }).click();
    await page.waitForURL("**/login", { timeout: 15_000 });
    await expectNoPasswordInUrl(page, password);
    await page.getByRole("link", { name: /create an account/i }).click();
    await page.waitForURL("**/register", { timeout: 15_000 });
    await expectNoPasswordInUrl(page, password);

    // 2. Registration validates, then creates the account (confirmation
    // message — register does not auto-login by design).
    await expect(
      page.getByRole("heading", { name: "Create Your account" }),
    ).toBeVisible();
    await page.fill('input[name="email"]', "not-an-email");
    await page.fill('input[name="password"]', password);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/register");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.getByRole("button", { name: "Create account" }).click();
    // Staging registers with the session inline (no email gate): success is
    // EITHER the confirmation message OR an instant login, which lands on
    // /settings (the API's register redirectTo — verified by screenshot, not
    // /summary). Measured ~7s on staging; the suite default covers it.
    await expect(
      page
        .getByText(/check your email/i)
        .or(page.getByRole("heading", { name: "Settings" })),
    ).toBeVisible({ timeout: 15_000 });
    await expectNoPasswordInUrl(page, password);

    // Normalize to logged-out: when registration logged straight in, sign
    // back out so the login section below always starts from /login.
    if (new URL(page.url()).pathname !== "/register") {
      await page.getByRole("button", { name: /account menu/i }).click();
      await page.getByRole("button", { name: "Sign out" }).click();
      await page.waitForURL("**/login", { timeout: 15_000 });
    }
    expect(new URL(page.url()).pathname).toBe("/login");

    // 3. Login: toggle both ways, wrong password stays with an inline error,
    // correct credentials land on /summary. When registration ended on the
    // confirmation message, the register page's own Sign in link is the way
    // over (a third client-side navigation proof).
    if (new URL(page.url()).pathname !== "/login") {
      await page.getByRole("link", { name: /sign in/i }).click();
      await page.waitForURL("**/login", { timeout: 15_000 });
    }
    const passwordField = page.locator('input[name="password"]');
    await page.locator('button[aria-label="Show password"]').click();
    await expect(passwordField).toHaveAttribute("type", "text");
    await page.locator('button[aria-label="Hide password"]').click();
    await expect(passwordField).toHaveAttribute("type", "password");
    await page.fill('input[name="email"]', email);
    await passwordField.fill(`Wrong-${password}`);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    expect(new URL(page.url()).pathname).toBe("/login");
    await expectNoPasswordInUrl(page, password);
    await page.fill('input[name="email"]', email);
    await passwordField.fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("**/summary", { timeout: 15_000 });
    await expect(
      page.getByRole("heading", { name: "Hello" }),
    ).toBeVisible();
    await expectNoPasswordInUrl(page, password);

    // 4. Protected sweep: every session-gated area renders for this user.
    const protectedPages = [
      { path: "/tasks", heading: "Tasks" },
      { path: "/calendar", heading: "Calendar" },
      { path: "/courses", heading: "Courses" },
      { path: "/settings", heading: "Settings" },
    ] as const;
    for (const { path, heading } of protectedPages) {
      await page.goto(path);
      expect(new URL(page.url()).pathname).toBe(path);
      await expect(
        page.getByRole("heading", { name: heading }).first(),
      ).toBeVisible();
      // Let in-flight RSC prefetches settle before the next navigation.
      // WebKit surfaces superseded prefetches as uncaught pageerrors while
      // Chromium aborts them silently; moving on mid-flight turns engine
      // noise into guardrail findings. Real usage paces slower than this.
      await page.waitForLoadState("networkidle", { timeout: 15_000 });
      await expectNoPasswordInUrl(page, password);
    }

    // 5. Reload on a protected page keeps the session (no bounce to /login).
    await page.goto("/tasks");
    await page.reload();
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
    expect(new URL(page.url()).pathname).toBe("/tasks");
    await expect(
      page.getByRole("heading", { name: "Tasks" }).first(),
    ).toBeVisible();

    // 6. Logout returns to /login through the defined server action…
    await page.getByRole("button", { name: /account menu/i }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("**/login", { timeout: 15_000 });

    // …and the session is truly dead: a direct protected visit bounces.
    await page.goto("/summary");
    await page.waitForURL("**/login", { timeout: 15_000 });
    await expectNoPasswordInUrl(page, password);
  });
});
