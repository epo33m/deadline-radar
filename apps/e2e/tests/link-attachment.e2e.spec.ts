/**
 * TRUE E2E — link attachment flow through the real user-facing web app.
 *
 * Boundary crossed per test (nothing mocked):
 *   Chromium -> Next.js (dev server) -> Server Action -> live Elysia API
 *   -> live Supabase Postgres -> Server Component re-render -> real DOM.
 *
 * Fixtures (users/courses/tasks) are created via REAL HTTP to the live API;
 * the LINK flow itself (dialog -> submit -> render -> remove) is driven
 * exclusively through the browser UI.
 *
 * Serial by design (playwright.config.ts: workers: 1). Every test is
 * self-sufficient: it does not depend on another test having run first.
 * All URLs carry a per-run suffix so reruns never collide with leftovers.
 */
import {
  expect,
  test,
  INTENTIONAL_ERROR_PAGE,
  type Page,
} from "./guardrails";
import {
  cleanupUser,
  createCourse,
  createLink,
  createTask,
  deleteAttachment,
  listAttachments,
  registerUser,
  runTag,
  type TestUser,
} from "../fixtures";

const RUN = runTag();
const urlFor = (slug: string) => `https://www.example.com/e2e/${RUN}/${slug}`;

let userA: TestUser;
let userB: TestUser;
let courseA = "";
let taskA = "";
let courseB = "";
let taskB = "";
let attachmentB = "";

test.beforeAll(async () => {
  userA = await registerUser("linkA");
  userB = await registerUser("linkB");
  courseA = await createCourse(userA.token, `E2E Links Course A ${RUN}`);
  taskA = await createTask(userA.token, courseA, `E2E links task A ${RUN}`);
  courseB = await createCourse(userB.token, `E2E Links Course B ${RUN}`);
  taskB = await createTask(userB.token, courseB, `E2E links task B ${RUN}`);
  const created = await createLink(
    userB.token,
    taskB,
    `https://www.example.com/e2e/${RUN}/user-b-original`,
  );
  if (created.status !== 200 || !created.body.attachment?.id) {
    throw new Error("fixture: user B link creation failed");
  }
  attachmentB = created.body.attachment.id;
});

test.afterAll(async () => {
  const leftoversA = await listAttachments(userA.token, taskA).catch(
    () => [],
  );
  await cleanupUser(userA, {
    attachmentIds: leftoversA.map((a) => a.id),
    taskIds: [taskA],
    courseIds: [courseA],
  }).catch((error) => {
    console.error("cleanup userA failed:", String(error));
  });
  const leftoversB = await listAttachments(userB.token, taskB).catch(
    () => [],
  );
  await cleanupUser(userB, {
    attachmentIds: leftoversB.map((a) => a.id),
    taskIds: [taskB],
    courseIds: [courseB],
  }).catch((error) => {
    console.error("cleanup userB failed:", String(error));
  });
});

/**
 * Retries a LOGIN click only. Scoped to /login on purpose: a pre-hydration
 * click on the Sign in button triggers a native GET submit (credentials land
 * in the URL query), so recovery is goto(/login) + refill. Never reuse this
 * for other pages — a blind goto(/login) would yank the test off-task.
 */
async function loginAs(page: Page, user: TestUser): Promise<void> {
  await page.goto("/login");
  // Stable ids from auth-forms.tsx (login-email / login-password); the
  // "Show password" toggle makes getByLabel("Password") ambiguous.
  await page.locator("#login-email").fill(user.email);
  await page.locator("#login-password").fill(user.password);
  const signIn = page.getByRole("button", { name: "Sign in" });
  // A pre-hydration click causes a native GET submit (credentials land in the
  // URL query). Detect that and refill before retrying.
  for (let attempt = 0; attempt < 5; attempt++) {
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

async function openAttachments(page: Page, taskId: string): Promise<void> {
  await page.goto(`/tasks/${taskId}`);
  const sections = page
    .getByRole("navigation", { name: "Task sections" })
    .first();
  // Plain click: Playwright already retries actionability (visible, stable,
  // enabled, receiving events) for 15s. No custom retry loop — a blind
  // recovery navigation here once dragged a failing test back to /summary
  // and masked the real state.
  await sections.getByRole("button", { name: "Attachments" }).click();
  // The "Attachments" heading exists twice (desktop + mobile markup), so
  // assert on the manager's unique subheading instead of the heading.
  await expect(
    page.getByText("Add files and links to this task."),
  ).toBeVisible();
}

/** Opens the add-attachment dialog whether the list is empty or not. */
async function openAddDialog(page: Page): Promise<void> {
  const emptyState = page.getByRole("button", { name: "New attachment" });
  if ((await emptyState.count()) > 0) {
    await emptyState.click();
  } else {
    await page.getByRole("button", { name: "Add attachment" }).click();
  }
  await expect(page.getByPlaceholder("URL")).toBeVisible();
}

/** Submits a link through the real dialog form (Server Action path). */
async function submitLink(page: Page, url: string): Promise<void> {
  await openAddDialog(page);
  await page.getByPlaceholder("URL").fill(url);
  await page.getByRole("button", { name: "Save", exact: true }).click();
}

function anchorFor(page: Page, url: string) {
  return page.locator(`a[href="${url}"]`);
}

test("E2E-01 — create valid link renders clickable anchor with safe attrs", async ({
  page,
}) => {
  const url = urlFor("guide");
  await loginAs(page, userA);
  await openAttachments(page, taskA);

  await submitLink(page, url);

  // Dialog closes on success (it stays open on error: AddAttachmentForm only
  // calls onSuccess when there is no error).
  await expect(page.getByPlaceholder("URL")).toBeHidden();

  const anchor = anchorFor(page, url);
  await expect(anchor).toBeVisible();
  // No error surfaced on the new row (scoped: the page always contains
  // Next.js's hidden __next-route-announcer__ with role=alert, so a global
  // alert count would be a false positive).
  await expect(
    page.locator("li", { has: anchor }).getByRole("alert"),
  ).toHaveCount(0);
  await expect(anchor).toBeVisible();
  await expect(anchor).toHaveText("Open");
  await expect(anchor).toHaveAttribute("href", url);
  await expect(anchor).toHaveAttribute("target", "_blank");
  const rel = await anchor.getAttribute("rel");
  expect(rel?.split(/\s+/)).toEqual(
    expect.arrayContaining(["noopener", "noreferrer"]),
  );
});

test("E2E-02 — attachment persists across a full page reload", async ({
  page,
}) => {
  const url = urlFor("guide");
  // Self-sufficient: create via UI if a previous run/test left nothing behind.
  const existing = await listAttachments(userA.token, taskA);
  await loginAs(page, userA);
  await openAttachments(page, taskA);
  if (!existing.some((a) => a.url === url)) {
    await submitLink(page, url);
    await expect(anchorFor(page, url)).toBeVisible();
  }

  // Prove server-side persistence, not React state: hard reload, then assert.
  await page.reload();
  await openAttachments(page, taskA);

  const anchor = anchorFor(page, url);
  await expect(anchor).toBeVisible();
  await expect(anchor).toHaveAttribute("href", url);
});

test("E2E-03 — remove deletes the row and it stays gone after reload", async ({
  page,
}) => {
  const url = urlFor("removable");
  await loginAs(page, userA);
  await openAttachments(page, taskA);

  // Create the victim through the UI so this test needs no other test.
  await submitLink(page, url);
  const anchor = anchorFor(page, url);
  await expect(anchor).toBeVisible();

  const row = page.locator("li", { has: anchor });
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(anchor).toHaveCount(0);

  await page.reload();
  await openAttachments(page, taskA);
  await expect(anchorFor(page, url)).toHaveCount(0);

  // Confirm at the persistence layer too: the row is really gone.
  const remaining = await listAttachments(userA.token, taskA);
  expect(remaining.map((a) => a.url)).not.toContain(url);
});

test("E2E-04 — invalid URL is rejected, surfaced, and never persisted", async ({
  page,
}) => {
  const bad = "/not-a-url";
  await loginAs(page, userA);
  await openAttachments(page, taskA);

  const before = await listAttachments(userA.token, taskA);

  await openAddDialog(page);
  const urlInput = page.getByPlaceholder("URL");
  await urlInput.fill(bad);
  await page.getByRole("button", { name: "Save", exact: true }).click();

  // Either the browser's native validation or the server error keeps the
  // dialog open with a user-visible error signal. Scope the alert search to
  // the open dialog: the page always contains Next.js's hidden
  // __next-route-announcer__ (role=alert), which must not count as an error.
  await expect(urlInput).toBeVisible();
  const serverAlert = page.getByRole("dialog").getByRole("alert");
  const nativeMessage = await urlInput.evaluate(
    (el: HTMLInputElement) => el.validationMessage,
  );
  expect(
    (await serverAlert.count()) > 0 || nativeMessage.length > 0,
    "expected a server alert or native validation message",
  ).toBe(true);

  await page.keyboard.press("Escape");
  await expect(page.locator(`a[href="${bad}"]`)).toHaveCount(0);

  await page.reload();
  const after = await listAttachments(userA.token, taskA);
  expect(after.length).toBe(before.length);
  expect(after.map((a) => a.url)).not.toContain(bad);
});

test("E2E-05 — dangerous schemes never become clickable hrefs", async ({
  page,
}) => {
  const payloads = ["javascript:alert(1)", "data:text/html,<h1>xss</h1>"];
  await loginAs(page, userA);
  await openAttachments(page, taskA);

  for (const payload of payloads) {
    await openAddDialog(page);
    await page.getByPlaceholder("URL").fill(payload);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    // Rejected: the dialog stays open (server 400 surfaced as alert, or
    // native validation blocks the submit). Either way no row is created.
    await expect(page.getByPlaceholder("URL")).toBeVisible();
    await page.keyboard.press("Escape");
  }

  // No dangerous href may exist anywhere in the rendered UI…
  await expect(page.locator('a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator('a[href^="data:"]')).toHaveCount(0);

  // …and the backend independently rejects both schemes (live API, no mocks).
  for (const payload of payloads) {
    const res = await createLink(userA.token, taskA, payload);
    expect(res.status).toBe(400);
  }
  const stored = (await listAttachments(userA.token, taskA)).map((a) => a.url);
  for (const payload of payloads) {
    expect(stored).not.toContain(payload);
  }
});

test("E2E-06 — user A cannot touch user B's task attachments", async ({
  page,
}) => {
  // Contract-exact assertions against the LIVE API (no mocks, no app.handle):
  // cross-user create -> 404 Task not found (ownedTask miss).
  const crossCreate = await createLink(
    userA.token,
    taskB,
    `https://www.example.com/e2e/${RUN}/intrusion`,
  );
  expect(crossCreate.status).toBe(404);

  // Cross-user delete -> 404 Attachment not found (ownedAttachment miss).
  const crossDelete = await deleteAttachment(userA.token, attachmentB);
  expect(crossDelete.status).toBe(404);

  // No identity at all -> 401 (fail-closed auth).
  const anon = await createLink(
    "",
    taskA,
    `https://www.example.com/e2e/${RUN}/anon-intrusion`,
  );
  expect([401, 403]).toContain(anon.status);

  // Victim data is untouched.
  const victimRows = await listAttachments(userB.token, taskB);
  expect(victimRows.map((a) => a.id)).toContain(attachmentB);

  // UI spot-check: B's task page is not readable as A (server 404s).
  // That 404 is the assertion — but Next's default 404 page injects inline
  // styles the strict CSP blocks, so the guardrail would fire on it. This
  // exempts the whole test; the healthy pages visited above (login, task
  // pages) stay covered by E2E-01..05 and the login-hydration journey.
  test.info().annotations.push({
    type: INTENTIONAL_ERROR_PAGE,
    description: "E2E-06 asserts GET /tasks/:other-user-id → 404",
  });
  await loginAs(page, userA);
  const response = await page.goto(`/tasks/${taskB}`);
  expect(response?.status()).toBe(404);
});
