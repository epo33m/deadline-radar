/**
 * CHARACTERIZATION — URL edge cases against the LIVE API + LIVE database.
 *
 * Type: HTTP integration (real Elysia API over HTTP, real Supabase Postgres).
 * This is NOT a browser E2E: no Chromium, no Server Action, no DOM.
 * It locks in the backend/DB contract that the browser E2E relies on, using
 * the exact behaviors observed by probing the real stack (see README).
 *
 * Serial by design (playwright.config.ts: workers: 1).
 */
import { expect, test } from "@playwright/test";
import {
  cleanupUser,
  createCourse,
  createLink,
  createTask,
  listAttachments,
  registerUser,
  runTag,
  type TestUser,
} from "../fixtures";

const RUN = runTag();

let user: TestUser;
let courseId = "";
let taskId = "";
const createdIds: string[] = [];

test.beforeAll(async () => {
  user = await registerUser("linkedge");
  courseId = await createCourse(user.token, `E2E Edge Course ${RUN}`);
  taskId = await createTask(user.token, courseId, `E2E edge task ${RUN}`);
});

test.afterAll(async () => {
  const remaining = await listAttachments(user.token, taskId).catch(() => []);
  for (const a of remaining) {
    if (!createdIds.includes(a.id)) createdIds.push(a.id);
  }
  await cleanupUser(user, {
    attachmentIds: createdIds,
    taskIds: [taskId],
    courseIds: [courseId],
  }).catch((error) => {
    console.error("edge cleanup failed:", String(error));
  });
});

async function storedUrls(): Promise<(string | null)[]> {
  return (await listAttachments(user.token, taskId)).map((a) => a.url);
}

test("HTTP-01 — http and https URLs persist verbatim", async () => {
  const https = `https://www.example.com/e2e/${RUN}/secure`;
  const http = `http://www.example.com/e2e/${RUN}/plain`;

  for (const url of [https, http]) {
    const res = await createLink(user.token, taskId, url);
    expect(res.status, url).toBe(200);
    if (res.body.attachment?.id) createdIds.push(res.body.attachment.id);
    expect(res.body.attachment?.url).toBe(url);
  }

  const urls = await storedUrls();
  expect(urls).toContain(https);
  expect(urls).toContain(http);
});

test("HTTP-02 — query params, fragments, and trailing slash persist verbatim", async () => {
  const url = `https://www.example.com/e2e/${RUN}/s?x=1&y=hello%20world#frag/trailing/`;
  const res = await createLink(user.token, taskId, url);
  expect(res.status).toBe(200);
  if (res.body.attachment?.id) createdIds.push(res.body.attachment.id);

  // No normalization, stripping, or re-encoding anywhere in the chain.
  expect(res.body.attachment?.url).toBe(url);
  expect(await storedUrls()).toContain(url);
});

test("HTTP-03 — leading/trailing whitespace is trimmed, not rejected", async () => {
  // QUIRK (characterized, not prescribed): the dispatcher trims only for the
  // empty-check, yet the stored value comes back trimmed — zod v4's z.url()
  // trims surrounding whitespace. Locked in so a future change is visible.
  const padded = `   https://www.example.com/e2e/${RUN}/padded   `;
  const res = await createLink(user.token, taskId, padded);
  expect(res.status).toBe(200);
  if (res.body.attachment?.id) createdIds.push(res.body.attachment.id);
  expect(res.body.attachment?.url).toBe(padded.trim());
});

test("HTTP-04 — uppercase scheme is accepted and stored verbatim", async () => {
  // QUIRK (characterized): protocol /^https?$/ reads case-sensitive, but zod
  // accepts the uppercase scheme anyway; the stored value keeps its case.
  const url = `HTTPS://www.example.com/e2e/${RUN}/upper`;
  const res = await createLink(user.token, taskId, url);
  expect(res.status).toBe(200);
  if (res.body.attachment?.id) createdIds.push(res.body.attachment.id);
  expect(res.body.attachment?.url).toBe(url);
});

test("HTTP-05 — localhost and IP literals are rejected (400)", async () => {
  // POLICY (characterized): hostname must look like a public domain
  // (z.regexes.domain), so intranet URLs are refused, not stored.
  for (const url of [
    `http://localhost:3000/e2e/${RUN}`,
    `http://127.0.0.1:8080/e2e/${RUN}`,
    `http://192.168.1.5/e2e/${RUN}`,
  ]) {
    const res = await createLink(user.token, taskId, url);
    expect(res.status, url).toBe(400);
  }
  const urls = await storedUrls();
  expect(urls).not.toContain(`http://localhost:3000/e2e/${RUN}`);
});

test("HTTP-06 — very long URL (3000 chars) is accepted (no max length)", async () => {
  // POLICY (characterized): neither Zod nor the DB (`text`) caps URL length.
  const url = `https://www.example.com/${"l".repeat(2980)}`;
  expect(url.length).toBeGreaterThan(2900);
  const res = await createLink(user.token, taskId, url);
  expect(res.status).toBe(200);
  if (res.body.attachment?.id) createdIds.push(res.body.attachment.id);
  expect(res.body.attachment?.url).toBe(url);
  expect(await storedUrls()).toContain(url);
});

test("HTTP-07 — duplicate URLs are allowed (no uniqueness constraint)", async () => {
  // POLICY (characterized): the same URL can be attached twice; each insert
  // yields a distinct row id. Delete + recreate (the IMMUTABLE design) relies
  // on this being unsurprising, so it is locked in explicitly.
  const url = `https://www.example.com/e2e/${RUN}/duplicate`;
  const first = await createLink(user.token, taskId, url);
  const second = await createLink(user.token, taskId, url);
  expect(first.status).toBe(200);
  expect(second.status).toBe(200);
  expect(first.body.attachment?.id).toBeTruthy();
  expect(second.body.attachment?.id).toBeTruthy();
  expect(second.body.attachment?.id).not.toBe(first.body.attachment?.id);
  if (first.body.attachment?.id) createdIds.push(first.body.attachment.id);
  if (second.body.attachment?.id) createdIds.push(second.body.attachment.id);
  const matches = (await storedUrls()).filter((u) => u === url);
  expect(matches.length).toBeGreaterThanOrEqual(2);
});

test("HTTP-08 — dangerous and non-absolute URLs are rejected (400) and never stored", async () => {
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,<h1>xss</h1>",
    `ftp://files.example.com/e2e/${RUN}`,
    `www.example.com/e2e/${RUN}/no-protocol`,
    "",
  ]) {
    const res = await createLink(user.token, taskId, url);
    expect(res.status, url).toBe(400);
  }
  const urls = await storedUrls();
  expect(urls).not.toContain("javascript:alert(1)");
  expect(urls).not.toContain("data:text/html,<h1>xss</h1>");
});
