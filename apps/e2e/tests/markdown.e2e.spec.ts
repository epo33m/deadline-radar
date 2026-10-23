import { expect, test } from "./guardrails";

import { api, cleanupUser, registerUser, runTag, type TestUser } from "../fixtures";

const RUN = runTag();
let user: TestUser;
let courseId: string;
let taskId: string;

test.beforeAll(async () => {
  user = await registerUser(`markdown-${RUN}`);
  const courseRes = await api<{ course?: { id?: string } }>("/api/v1/courses", {
    method: "POST",
    token: user.token,
    body: { name: "Markdown Course" },
  });
  courseId = courseRes.body.course!.id!;
  const deadline = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const taskRes = await api<{ task?: { id?: string } }>("/api/v1/tasks", {
    method: "POST",
    token: user.token,
    body: {
      title: "Markdown Task",
      course_id: courseId,
      deadline,
      status: "todo",
      description: [
        "# Big heading",
        "",
        "A paragraph with **bold** and *italic*.",
        "",
        "| A | B |",
        "| --- | --- |",
        "| one | two |",
        "",
        "- [x] done item",
        "- [ ] open item",
        "",
        "[external](https://example.com) [internal](/tasks/123)",
        "",
        "```ts",
        "const answer = 42;",
        "```",
      ].join("\n"),
    },
  });
  taskId = taskRes.body.task!.id!;
});

test.afterAll(async () => {
  await cleanupUser(user, { taskIds: [taskId], courseIds: [courseId] });
});

test("markdown description renders structured elements safely", async ({ page }) => {
  await page.goto("/login");
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/summary", { timeout: 15_000 });

  await page.goto(`/tasks/${taskId}`);
  await expect(page.getByRole("heading", { name: "Big heading" })).toBeVisible();

  await expect(page.getByText("bold", { exact: true })).toBeVisible();
  await expect(page.locator("table")).toBeVisible();
  await expect(page.locator("td", { hasText: "one" })).toBeVisible();

  const checkboxes = page.locator('input[type="checkbox"]');
  await expect(checkboxes).toHaveCount(2);
  await expect(checkboxes.nth(0)).toBeChecked();
  await expect(checkboxes.nth(1)).not.toBeChecked();

  const external = page.getByRole("link", { name: "external" });
  await expect(external).toHaveAttribute("target", "_blank");
  await expect(external).toHaveAttribute("rel", "noopener noreferrer");

  const internal = page.getByRole("link", { name: "internal" });
  await expect(internal).toHaveAttribute("href", "/tasks/123");

  const pre = page.locator("pre").first();
  await expect(pre).toHaveAttribute("tabindex", "0");

  const bodyText = await page.locator("body").textContent();
  expect(bodyText ?? "").not.toContain("**bold**");
  expect(bodyText ?? "").not.toContain("<script");
});