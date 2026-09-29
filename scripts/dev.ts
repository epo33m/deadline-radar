/**
 * Start API (:4025) and web (:3025) together.
 * Frees those ports first so re-runs don't hit EADDRINUSE.
 *
 * The env file is passed as argv[2] (default `.env.local`, i.e. production)
 * so the API child can be pinned to a different one — `dev:staging` runs the
 * whole stack against `.env.staging`. The parent process must be launched
 * with the matching `bun --env-file=<same file>` so the web env below is
 * sanitized from the right source.
 */
const root = import.meta.dir.replace(/\/scripts$/, "");
const envFile = process.argv[2] ?? ".env.local";
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

// Guard: the Supabase project ref in DATABASE_URL must match the one in
// SUPABASE_URL. A mixed env file (staging keys + production pooler, or the
// reverse) writes to the wrong database and is otherwise invisible.
//
// This runs BEFORE the port cleanup below. Killing a developer's running API
// and web server is a side effect; validating the env file is not, so a bad env
// file should cost nothing rather than taking the working stack down first.
const projectRef = (value: string): string | null =>
  value.match(/postgres\.([a-z]{20})[:@]/)?.[1] ??
  value.match(/@db\.([a-z]{20})\.supabase\.co/)?.[1] ??
  value.match(/^https?:\/\/([a-z]{20})\.supabase\.co/)?.[1] ??
  null;
const dbRef = projectRef(process.env.DATABASE_URL ?? "");
const urlRef = projectRef(process.env.SUPABASE_URL ?? "");

if (dbRef && urlRef && dbRef !== urlRef) {
  console.error("\n✗ Refusing to start: DATABASE_URL and SUPABASE_URL point at different");
  console.error(`  Supabase projects (${dbRef} vs ${urlRef}) in ${envFile}.`);
  console.error("  Pick one project per env file.");
  process.exit(1);
}

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
