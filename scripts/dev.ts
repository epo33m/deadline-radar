/**
 * Start API (:4025) and web (:3025) together.
 * Frees those ports first so re-runs don't hit EADDRINUSE.
 * Loads root `.env.local` via: bun --env-file=.env.local run scripts/dev.ts
 */
const root = import.meta.dir.replace(/\/scripts$/, "");
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

console.log("Freeing ports 3025 (web) and 4025 (api)…");
await Promise.all(ports.map((port) => freePort(port)));

const children = [
  Bun.spawn({
    cmd: ["bun", "--env-file=.env.local", "run", "--watch", "src/index.ts"],
    cwd: `${root}/apps/api`,
    stdout: "inherit",
    stderr: "inherit",
    stdin: "inherit",
  }),
  Bun.spawn({
    cmd: [
      "bun",
      "--env-file=.env.local",
      "run",
      "next",
      "dev",
      "--port",
      "3025",
    ],
    cwd: `${root}/apps/web`,
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
