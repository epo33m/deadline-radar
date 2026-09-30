#!/usr/bin/env bun
/**
 * Seed the SUPABASE STAGING account with realistic data for UI review.
 *
 * Goes through the real API (no direct SQL, no mocks) so the seeded rows are
 * exactly the shapes the UI renders, and so default reminder thresholds get
 * created by the same code path production uses.
 *
 * Usage:
 *   bun --env-file=.env.staging run scripts/seed-staging.ts            # seed if empty
 *   bun --env-file=.env.staging run scripts/seed-staging.ts --reset    # archive + reseed
 *
 * Requires the API to be running on API_ORIGIN (bun run dev:staging, or
 * bun run dev:api with the staging env file).
 */
import { api } from "../apps/e2e/fixtures";
import { assertNoProductionEnv, ScriptTargetError } from "./lib/target";

const EMAIL = "ui-review@example.test";
const PASSWORD = "UiReview-Staging-1!";

/**
 * Refuse to seed anything that resolves to production.
 *
 * The script name and the README both say "staging", but nothing enforced it:
 * `bun --env-file=.env.local run scripts/seed-staging.ts` would have written a
 * known-password account and fixture rows into production, and `--reset` would
 * have archived real data first. That is the same class of mistake as #71 — a
 * credential reaching a process that was never meant to have it — and it is
 * silent, because a successful seed looks exactly like a correct one.
 *
 * The check lives in `scripts/lib/target.ts` (#63): one deny list for every
 * script, so copies cannot drift. Only key names are printed, never values.
 * This script is staging-only by name, so unlike migrate/dev there is no
 * `--allow-production` escape hatch here.
 */
try {
  assertNoProductionEnv(process.env, {
    context: "seed-staging",
    productionHint: "seed-staging is staging-only: there is no production escape hatch.",
  });
} catch (error) {
  if (error instanceof ScriptTargetError) {
    console.error(`\n✗ Refusing to seed: ${error.message}`);
    console.error(
      "\n  Seeding writes a known-password account and fixture rows, and --reset\n" +
        "  archives existing data first. Neither is safe against production.\n" +
        "\n  Use: bun run seed:staging        (passes --env-file=.env.staging)\n",
    );
    process.exit(1);
  }
  throw error;
}

const supabaseUrl = required("SUPABASE_URL");
const supabaseAnonKey = required("SUPABASE_ANON_KEY");

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

/** Day offset from today → ISO deadline at 23:59 local, so "today" reads as today. */
function at(days: number, hour = 23, minute = 59): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

type CourseSpec = {
  name: string;
  code: string;
  color: string;
  icon: string;
  description: string;
};

const COURSES: CourseSpec[] = [
  {
    name: "Kalkulus II",
    code: "MATH204",
    color: "#0088ff",
    icon: "sigma",
    description: "Integral tak hingga, teknik integrasi, dan applications of derivatives.",
  },
  {
    name: "Fisika Modern",
    code: "PHYS201",
    color: "#ff383c",
    icon: "atom",
    description: "Mekanika kuantum dasar dan relativitas khusus.",
  },
  {
    name: "Struktur Data",
    code: "CS210",
    color: "#34c759",
    icon: "braces",
    description: "Tree, graph, hash table, dan analisis kompleksitas.",
  },
  {
    name: "Ekonomi Makro",
    code: "ECON110",
    color: "#ffcc00",
    icon: "globe",
    description: "GDP, inflasi, dan kebijakan moneter.",
  },
  {
    // Intentionally task-less: exercises the empty state for a course.
    name: "Seni Rupa",
    code: "ART105",
    color: "#cb30e0",
    icon: "palette",
    description: "Studio practices and visual composition.",
  },
];

type TaskSpec = {
  title: string;
  course: string; // course name above
  due: string;
  status?: "todo" | "in_progress";
  description?: string;
  // Task create only accepts todo | in_progress; done is applied via PATCH.
  markDone?: boolean;
};

const TASKS: TaskSpec[] = [
  {
    title: "Tutorial 1 — Setup lab fisika",
    course: "Fisika Modern",
    due: at(-7),
    description: "Pasang oscilloscope virtual dan kerjakan sheet 1–4.",
    markDone: true,
  },
  {
    title: "Reading: Chapter 1–3",
    course: "Struktur Data",
    due: at(-5),
    markDone: true,
  },
  {
    title: "Problem Set 3 — Integration by Parts",
    course: "Kalkulus II",
    due: at(-2),
    status: "in_progress",
    description: "Soal 1–12. Sertakan langkah kerja, bukan hanya jawaban akhir.",
  },
  {
    title: "Lab report: gerak projectile",
    course: "Fisika Modern",
    due: at(-1),
    description: "Dikumpulkan lewat LMS. Batas file 10 MB.",
  },
  {
    title: "Reading quiz: Chapter 7",
    course: "Kalkulus II",
    due: at(0, 8, 0),
    status: "in_progress",
  },
  {
    title: "Assignment 2 — Red-black tree rotations",
    course: "Struktur Data",
    due: at(1),
    description: "Implementasikan insert/delete fixup dalam C++.",
  },
  {
    title: "Kuis tengah semester",
    course: "Ekonomi Makro",
    due: at(2, 10, 0),
  },
  {
    title: "Proposal slide — kelompok 3",
    course: "Ekonomi Makro",
    due: at(3),
    description: "12 slide maksimum, portada kelompok terpisah.",
  },
  {
    title: "Problem Set 4 — Improper integrals",
    course: "Kalkulus II",
    due: at(5),
    status: "in_progress",
  },
  {
    // Deliberately long: exercises title truncation / wrapping in cards,
    // calendar cells, and the task detail header.
    title:
      "Final Exam — Struktur Data (Bab 1–6, termasuk hashing, graph traversal, dan analisis amortized)",
    course: "Struktur Data",
    due: at(12, 9, 0),
    description:
      "Aka: 90 menit. Bawa kalkulator scientific. Soal open-book untuk bagian hashing.",
  },
  {
    title: "Esai — dampak suku bunga terhadap PDB",
    course: "Ekonomi Makro",
    due: at(20),
    description: "1500 kata, rujukan minimal 5 sumber akademik.",
  },
];

async function registerOrLogin(): Promise<{ token: string; userId: string }> {
  const reg = await api<{ user?: { id?: string } }>("/api/v1/auth/register", {
    method: "POST",
    body: { email: EMAIL, password: PASSWORD },
  });
  if (reg.status === 200 && reg.body.user?.id) {
    console.log(`  registered ${EMAIL}`);
    return { token: await passwordGrant(), userId: reg.body.user.id };
  }
  // Already registered (the normal re-run case) — just sign in.
  console.log(`  ${EMAIL} already exists, signing in`);
  return { token: await passwordGrant(), userId: "existing" };
}

/** Real Supabase password grant, mirroring fixtures.registerUser(). */
async function passwordGrant(): Promise<string> {
  const res = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: supabaseAnonKey, "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json()) as {
    access_token?: string;
    error_description?: string;
  };
  if (res.status !== 200 || !body.access_token) {
    throw new Error(
      `password grant failed (${res.status}): ${body.error_description ?? "no access_token"}` +
        "\nIf this says the email is unconfirmed, turn OFF 'Confirm email' in" +
        "\nSupabase → Authentication → User Signups.",
    );
  }
  return body.access_token;
}

async function listAll<T>(path: string, token: string): Promise<T[]> {
  const out: T[] = [];
  let cursor: string | undefined;
  do {
    const qs = new URLSearchParams({ limit: "100" });
    if (cursor) qs.set("cursor", cursor);
    const res = await api<{ data?: T[]; page?: { nextCursor?: string } }>(
      `${path}?${qs}`,
      { token },
    );
    if (res.status !== 200) {
      throw new Error(`list ${path} failed (${res.status}): ${JSON.stringify(res.body).slice(0, 200)}`);
    }
    out.push(...(res.body.data ?? []));
    cursor = res.body.page?.nextCursor;
  } while (cursor);
  return out;
}

const RESET = process.argv.includes("--reset");

console.log(`Seeding ${EMAIL} on ${process.env.API_ORIGIN ?? "http://127.0.0.1:4025"}`);
const { token } = await registerOrLogin();

const existingCourses = await listAll<{ id: string }>("/api/v1/courses", token);
if (existingCourses.length > 0 && !RESET) {
  console.log(`\n  ${existingCourses.length} course(s) already present — nothing to do.`);
  console.log("  Re-run with --reset to archive everything and reseed.\n");
  process.exit(0);
}

if (RESET && existingCourses.length > 0) {
  console.log(`  --reset: archiving ${existingCourses.length} course(s)…`);
  const tasks = await listAll<{ id: string }>("/api/v1/tasks", token);
  for (const t of tasks) {
    await api(`/api/v1/tasks/${t.id}`, { method: "DELETE", token });
  }
  for (const c of existingCourses) {
    await api(`/api/v1/courses/${c.id}`, { method: "DELETE", token });
  }
  console.log(`  archived ${tasks.length} task(s)`);
}

const courseIds = new Map<string, string>();
for (const spec of COURSES) {
  const res = await api<{ course?: { id?: string } }>("/api/v1/courses", {
    method: "POST",
    body: spec,
    token,
  });
  if (res.status !== 200 || !res.body.course?.id) {
    throw new Error(
      `createCourse "${spec.name}" failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`,
    );
  }
  courseIds.set(spec.name, res.body.course.id);
  console.log(`  course  ${spec.name}`);
}

let created = 0;
for (const spec of TASKS) {
  const courseId = courseIds.get(spec.course);
  if (!courseId) throw new Error(`unknown course in spec: ${spec.course}`);

  const res = await api<{ task?: { id?: string } }>("/api/v1/tasks", {
    method: "POST",
    body: {
      title: spec.title,
      course_id: courseId,
      deadline: spec.due,
      status: spec.status ?? "todo",
      description: spec.description ?? null,
    },
    token,
  });
  if (res.status !== 200 || !res.body.task?.id) {
    throw new Error(
      `createTask "${spec.title}" failed (${res.status}): ${JSON.stringify(res.body).slice(0, 300)}`,
    );
  }
  const taskId = res.body.task.id;
  created += 1;

  if (spec.markDone) {
    const done = await api(`/api/v1/tasks/${taskId}`, {
      method: "PATCH",
      body: { status: "done" },
      token,
    });
    if (done.status !== 200) {
      throw new Error(`mark done failed (${done.status}): ${JSON.stringify(done.body).slice(0, 300)}`);
    }
  }
  console.log(`  task    ${spec.markDone ? "[done] " : ""}${spec.title.slice(0, 60)}`);
}

console.log(`\n  ${COURSES.length} courses, ${created} tasks (1 course left empty on purpose).`);
console.log(`\n  Sign in at http://127.0.0.1:3025`);
console.log(`    email:    ${EMAIL}`);
console.log(`    password: ${PASSWORD}\n`);
