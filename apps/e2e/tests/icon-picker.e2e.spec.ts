/**
 * E2E — course icon picker flow through the real user-facing web app.
 *
 * Boundary crossed per test (nothing mocked):
 *   Chromium -> Next.js (dev server) -> Server Action -> live Elysia API
 *   -> live Supabase Postgres -> real DOM.
 *
 * The picker flow itself (open form -> search -> pick -> save -> render) is
 * driven exclusively through the browser UI.
 */
import {
  expect,
  test,
  type Page,
} from "./guardrails";
import {
  cleanupUser,
  registerUser,
  runTag,
  type TestUser,
} from "../fixtures";

const RUN = runTag();

let user: TestUser;

/** Logs in through the real /login page (Supabase Auth cookies). */
async function loginAs(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  await page.locator("#login-email").fill(user.email);
  await page.locator("#login-password").fill(user.password);
  const signIn = page.getByRole("button", { name: "Sign in" });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await signIn.click();
    try {
      await expect(page).toHaveURL(/\/summary/, { timeout: 10_000 });
      return;
    } catch {
      await page.goto("/login");
      await page.locator("#login-email").fill(user.email);
      await page.locator("#login-password").fill(user.password);
    }
  }
  await expect(page).toHaveURL(/\/summary/);
}

test.beforeAll(async () => {
  user = await registerUser(`iconpicker-${RUN}`);
});

test.afterAll(async () => {
  await cleanupUser(user).catch((error) => {
    console.error("cleanup user failed:", String(error));
  });
});

test("E2E icon picker: open course form, search 'lab', pick, save, icon renders", async ({
  page,
}: {
  page: Page;
}) => {
  await loginAs(page, user);

  // Fresh user has no courses: empty state shows "New Course".
  await page.goto("/courses");
  await page.getByRole("button", { name: "New Course" }).click();

  // Fill the course name.
  await page.getByPlaceholder("Title").fill(`Course ${RUN}`);

  // Open the icon picker (trigger shows "None" when nothing selected).
  await page.getByRole("button", { name: "None" }).click();

  // Search for "lab" and pick the "Lab" option (flask-conical).
  const search = page.getByRole("combobox", { name: "Search icons" });
  await search.fill("lab");
  await page.getByRole("option", { name: "Lab" }).click();

  // Picker closes and the trigger now shows the chosen label.
  await expect(page.getByRole("button", { name: "Lab" })).toBeVisible();

  // Save the course.
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // Course appears in the list with the chosen icon rendered.
  await expect(
    page.getByText(`Course ${RUN}`),
  ).toBeVisible();
  await expect(page.locator("svg.lucide-flask-conical")).toBeVisible();
});
