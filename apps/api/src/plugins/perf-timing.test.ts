process.env.NODE_ENV = "test";
import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";

import { perfTimingPlugin } from "./perf-timing";

function captureLogs() {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  return {
    lines,
    restore: () => {
      console.log = original;
    },
  };
}

// NOTE: Elysia schedules afterResponse hooks after app.handle() resolves,
// so the test polls (bounded) instead of asserting synchronously.
async function waitForPerfLine(
  lines: string[],
  prefix: string,
  timeoutMs = 2000,
): Promise<string | null> {
  const started = Date.now();
  for (;;) {
    const found = lines.find((line) => line.startsWith(prefix));
    if (found) return found;
    if (Date.now() - started >= timeoutMs) return null;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("perfTimingPlugin", () => {
  test("passes the response through and logs one [perf] line", async () => {
    const { lines, restore } = captureLogs();
    try {
      const app = new Elysia().use(perfTimingPlugin).get("/ping", ({ set }) => {
        set.headers["X-Custom"] = "yes";
        return { ok: true };
      });

      const response = await app.handle(new Request("http://localhost/ping"));
      expect(response.status).toBe(200);
      expect(response.headers.get("X-Custom")).toBe("yes");
      expect(await response.json()).toEqual({ ok: true });

      const perf = await waitForPerfLine(lines, "[perf] GET /ping 200 ");
      expect(perf).toMatch(/^\[perf\] GET \/ping 200 \d+ms$/);
      expect(lines.filter((l) => l.startsWith("[perf]"))).toHaveLength(1);
    } finally {
      restore();
    }
  });

  test("logs the error path without changing the envelope", async () => {
    const { lines, restore } = captureLogs();
    try {
      const app = new Elysia()
        .use(perfTimingPlugin)
        .onError(({ set }) => {
          set.status = 401;
          return { error: "unauthorized" };
        })
        .get("/secret", () => {
          throw new Error("nope");
        });

      const response = await app.handle(
        new Request("http://localhost/secret"),
      );
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });

      const perf = await waitForPerfLine(lines, "[perf] GET /secret 401 ");
      expect(perf).toMatch(/^\[perf\] GET \/secret 401 \d+ms$/);
      expect(lines.filter((l) => l.startsWith("[perf]"))).toHaveLength(1);
    } finally {
      restore();
    }
  });
});
