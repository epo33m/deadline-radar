/**
 * Start API (:4025) and web (:3025) together.
 * Frees those ports first so re-runs don't hit EADDRINUSE.
 *
 * The env file is passed as argv[2] and is REQUIRED (#63): there is no
 * default, because the old default (`.env.local`, i.e. production) was a
 * default path from local tooling to production. Name the target explicitly:
 * `bun run dev:staging` passes `.env.staging`. The parent process must be
 * launched with the matching `bun --env-file=<same file>` so the web env
 * below is sanitized from the right source.
 *
 * Production is refused unless it is named explicitly AND deliberately:
 * pass the production env file plus `--allow-production`.
 */
import { assertNoProductionEnv, assertRefsMatch, projectRef, ScriptTargetError } from "./lib/target";

const root = import.meta.dir.replace(/\/scripts$/, "");
const envFile = process.argv[2];
if (!envFile || envFile.startsWith("--")) {
  console.error("");
  console.error("✗ Refusing to start: no env file was named.");
  console.error("");
  console.error("  Name the target explicitly, e.g.:");
  console.error("    bun run dev:staging   (env: .env.staging)");
  console.error("");
  process.exit(1);
}
const allowProduction = process.argv.includes("--allow-production");
const ports = [3025, 4025] as const;

async function freePort(port: number) {
  const proc = Bun.spawn({
    cmd: ["lsof", "-ti", `tcp:${port}`],
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = (await new Response(proc.stdout).text()).trim();
  await proc.exited;
  if (!out) return;

  const pids = [
    ...new Set(
      out
        .split(/\s+/)
        .map((p) => p.trim())
        .filter(Boolean),
    ),
  ];
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGTERM");
    } catch {
      // already gone
    }
  }

  // Brief wait, then force-kill leftovers
  await Bun.sleep(400);
  for (const pid of pids) {
    try {
      process.kill(Number(pid), "SIGKILL");
    } catch {
      // already gone
    }
  }
}

// Guard (#63, generalised in ./lib/target.ts): refuse production unless it
// was named explicitly and deliberately, and refuse a mixed env file whose
// DATABASE_URL and SUPABASE_URL name different Supabase projects — that
// writes to the wrong database and is otherwise invisible.
//
// This runs BEFORE the port cleanup below. Killing a developer's running API
// and web server is a side effect; validating the env file is not, so a bad env
// file should cost nothing rather than taking the working stack down first.
try {
  assertNoProductionEnv(process.env, { context: "dev", allowProduction });
  assertRefsMatch(process.env, envFile);
} catch (error) {
  if (error instanceof ScriptTargetError) {
    console.error(`\n✗ ${error.message}`);
    process.exit(1);
  }
  throw error;
}

const dbRef = projectRef(process.env.DATABASE_URL ?? "");

if (dbRef) {
  const isStagingRun = envFile.includes("staging");
  console.log(
    `\n  ${isStagingRun ? "staging" : "⚠️  NOT staging"} → Supabase project ${dbRef}\n`,
  );
}

console.log("Freeing ports 3025 (web) and 4025 (api)…");
await Promise.all(ports.map((port) => freePort(port)));

// Construct sanitized environment for Next.js web process (L-12 isolation)
// Excludes privileged database credentials, service role keys, and backend secrets.
const webEnv = { ...process.env };
delete webEnv.SUPABASE_SERVICE_ROLE_KEY;
delete webEnv.DATABASE_URL;
delete webEnv.DIRECT_URL;
delete webEnv.RESEND_API_KEY;
delete webEnv.CRON_SECRET;

const children = [
  Bun.spawn({
    cmd: ["bun", `--env-file=${envFile}`, "run", "--watch", "src/index.ts"],
    cwd: `${root}/apps/api`,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }),
  Bun.spawn({
    cmd: ["bun", "run", "next", "dev", "--port", "3025"],
    cwd: `${root}/apps/web`,
    env: webEnv,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }),
];

function shutdown() {
  for (const child of children) {
    try {
      child.kill();
    } catch {
      // ignore
    }
  }
  void Promise.all(ports.map((port) => freePort(port))).finally(() => {
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

const codes = await Promise.all(children.map((c) => c.exited));
await Promise.all(ports.map((port) => freePort(port)));
process.exit(codes.find((c) => c !== 0) ?? 0);
