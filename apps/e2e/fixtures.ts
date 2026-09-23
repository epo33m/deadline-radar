/**
 * Shared fixtures for link-attachment E2E / HTTP tests.
 *
 * Discipline: every helper below crosses a REAL boundary —
 * real HTTP to the live API, real Supabase Auth, real Postgres.
 * No mocks, no `app.handle()`, no direct Server Action calls, no `safeParse()`.
 *
 * Isolation: each helper takes unique names/emails (see `runTag()`), and
 * `cleanupUser()` removes attachments → archives task/course → deletes the
 * auth user via the Supabase Admin API, leaving (near-)zero residue.
 */

export const API_ORIGIN =
  process.env.E2E_API_ORIGIN ??
  process.env.API_ORIGIN ??
  "http://127.0.0.1:4025";

function supabaseUrl(): string {
  const url =
    process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL (or NEXT_PUBLIC_…) is required");
  return url;
}

function supabaseAnonKey(): string {
  const key =
    process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!key) throw new Error("SUPABASE_ANON_KEY (or NEXT_PUBLIC_…) is required");
  return key;
}

function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("SUPABASE_SERVICE_ROLE_KEY is required");
  return key;
}

export type ApiResult<T = unknown> = { status: number; body: T };

export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; token?: string; headers?: Record<string, string> } = {},
): Promise<ApiResult<T>> {
  const headers = new Headers({ "content-type": "application/json" });
  if (options.headers) {
    for (const [k, v] of Object.entries(options.headers)) {
      headers.set(k, v);
    }
  }
  if (options.token) headers.set("authorization", `Bearer ${options.token}`);
  const res = await fetch(`${API_ORIGIN}${path}`, {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body: body as T };
}

/** Unique, email-safe tag per test run. Reruns never collide with leftovers. */
export function runTag(): string {
  return `${Date.now().toString(36)}${Math.floor(Math.random() * 0xffff).toString(36)}`;
}

export type TestUser = {
  email: string;
  password: string;
  userId: string;
  token: string;
};

/**
 * Register via the REAL `POST /api/v1/auth/register`, then obtain a real
 * access token via the REAL Supabase password grant (anon key).
 */
export async function registerUser(prefix: string): Promise<TestUser> {
  const tag = `${prefix}-${runTag()}`;
  const email = `e2e-${tag}@example.test`;
  const password = `E2ePass-${tag}-1!`;

  const reg = await api<{ user?: { id?: string } }>("/api/v1/auth/register", {
    method: "POST",
    body: { email, password },
  });
  if (reg.status !== 200 || !reg.body.user?.id) {
    throw new Error(`register failed (${reg.status}): ${JSON.stringify(reg.body)?.slice(0, 300)}`);
  }

  const tokRes = await fetch(
    `${supabaseUrl()}/auth/v1/token?grant_type=password`,
    {
      method: "POST",
      headers: {
        apikey: supabaseAnonKey(),
        "content-type": "application/json",
      },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15000),
    },
  );
  const tok = (await tokRes.json()) as { access_token?: string };
  if (tokRes.status !== 200 || !tok.access_token) {
    throw new Error(`password grant failed (${tokRes.status})`);
  }

  return { email, password, userId: reg.body.user.id, token: tok.access_token };
}

export async function createCourse(
  token: string,
  name: string,
): Promise<string> {
  const res = await api<{ course?: { id?: string } }>("/api/v1/courses", {
    method: "POST",
    body: { name },
    token,
  });
  if (res.status !== 200 || !res.body.course?.id) {
    throw new Error(`createCourse failed (${res.status}): ${JSON.stringify(res.body)?.slice(0, 300)}`);
  }
  return res.body.course.id;
}

export async function createTask(
  token: string,
  courseId: string,
  title: string,
): Promise<string> {
  const deadline = new Date(Date.now() + 30 * 86_400_000).toISOString();
  const res = await api<{ task?: { id?: string } }>("/api/v1/tasks", {
    method: "POST",
    body: { title, course_id: courseId, deadline, status: "todo" },
    token,
  });
  if (res.status !== 200 || !res.body.task?.id) {
    throw new Error(`createTask failed (${res.status}): ${JSON.stringify(res.body)?.slice(0, 300)}`);
  }
  return res.body.task.id;
}

export type LinkAttachment = {
  id: string;
  taskId: string;
  type: string;
  notes: string | null;
  storagePath: string | null;
  url: string | null;
  createdAt: string;
};

export async function createLink(
  token: string,
  taskId: string,
  url: string,
  notes?: string,
): Promise<ApiResult<{ attachment?: LinkAttachment }>> {
  return api<{ attachment?: LinkAttachment }>("/api/v1/attachments/link", {
    method: "POST",
    body: { task_id: taskId, url, notes },
    token,
  });
}

export async function listAttachments(
  token: string,
  taskId: string,
): Promise<LinkAttachment[]> {
  const res = await api<{ attachments?: LinkAttachment[] }>(
    `/api/v1/tasks/${taskId}`,
    { token },
  );
  if (res.status !== 200) {
    throw new Error(`task detail failed (${res.status})`);
  }
  return res.body.attachments ?? [];
}

export async function deleteAttachment(
  token: string,
  attachmentId: string,
): Promise<ApiResult> {
  return api(`/api/v1/attachments/${attachmentId}`, {
    method: "DELETE",
    token,
  });
}

/**
 * Full cleanup for one user's fixtures. Best-effort per step (collects errors,
 * throws at the end) so one failure doesn't strand the remaining rows.
 * Order matters: attachments → task (archive) → course (archive) → auth user.
 */
export async function cleanupUser(
  user: TestUser,
  fixture: { attachmentIds?: string[]; taskIds?: string[]; courseIds?: string[] } = {},
): Promise<void> {
  const failures: string[] = [];
  for (const id of fixture.attachmentIds ?? []) {
    try {
      const r = await deleteAttachment(user.token, id);
      if (r.status !== 200 && r.status !== 404) failures.push(`attachment ${id}: ${r.status}`);
    } catch (error) {
      failures.push(`attachment ${id}: ${String(error)}`);
    }
  }
  for (const id of fixture.taskIds ?? []) {
    try {
      const r = await api(`/api/v1/tasks/${id}`, { method: "DELETE", token: user.token });
      if (r.status !== 200 && r.status !== 404) failures.push(`task ${id}: ${r.status}`);
    } catch (error) {
      failures.push(`task ${id}: ${String(error)}`);
    }
  }
  for (const id of fixture.courseIds ?? []) {
    try {
      const r = await api(`/api/v1/courses/${id}`, { method: "DELETE", token: user.token });
      if (r.status !== 200 && r.status !== 404) failures.push(`course ${id}: ${r.status}`);
    } catch (error) {
      failures.push(`course ${id}: ${String(error)}`);
    }
  }
  try {
    const svc = serviceRoleKey();
    const del = await fetch(
      `${supabaseUrl()}/auth/v1/admin/users/${user.userId}`,
      {
        method: "DELETE",
        headers: { apikey: svc, Authorization: `Bearer ${svc}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (del.status !== 200 && del.status !== 404) {
      failures.push(`auth user ${user.userId}: ${del.status}`);
    }
  } catch (error) {
    failures.push(`auth user ${user.userId}: ${String(error)}`);
  }
  if (failures.length > 0) {
    throw new Error(`cleanup failures: ${failures.join("; ")}`);
  }
}
