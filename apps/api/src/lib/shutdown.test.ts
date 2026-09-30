import { describe, expect, test } from "bun:test";

import { createShutdownHandler, type ShutdownDeps } from "./shutdown";

function setup(overrides: Partial<ShutdownDeps> = {}) {
  const calls: string[] = [];
  const logs: string[] = [];
  const exits: number[] = [];
  const deps: ShutdownDeps = {
    stopServer: () => {
      calls.push("stop");
    },
    closePool: async () => {
      calls.push("close");
    },
    exit: (code: number) => {
      exits.push(code);
    },
    log: (message: string) => {
      logs.push(message);
    },
    ...overrides,
  };
  return {
    handler: createShutdownHandler(deps),
    calls,
    logs,
    exits,
    exited: () => exits.at(-1) ?? null,
  };
}

describe("createShutdownHandler", () => {
  test("drains in order — stop server, close pool — then exits 0", async () => {
    const { handler, calls, logs, exited } = setup();
    await handler("SIGTERM");
    expect(calls).toEqual(["stop", "close"]);
    expect(exited()).toBe(0);
    expect(logs.join("\n")).toContain("SIGTERM received");
    expect(logs.join("\n")).toContain("pool drained");
  });

  test("a second signal during shutdown force-exits 1 without rerunning", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { handler, calls, exits } = setup({
      stopServer: () => {
        calls.push("stop");
        return gate;
      },
    });
    const first = handler("SIGTERM");
    await handler("SIGTERM");
    // A real process is dead after exit(1); only the forced code matters.
    expect(exits).toEqual([1]);
    release();
    await first;
    // The first handler ran exactly once — no rerun, no duplicate drain.
    expect(calls).toEqual(["stop", "close"]);
  });

  test("a failing server stop still drains the pool and exits 0", async () => {
    const { handler, calls, logs, exited } = setup({
      stopServer: () => {
        throw new Error("stop boom");
      },
    });
    await handler("SIGINT");
    expect(calls).toEqual(["close"]);
    expect(exited()).toBe(0);
    expect(logs.join("\n")).toContain("server stop failed");
  });

  test("a failing pool drain is logged and still exits 0", async () => {
    const { handler, calls, logs, exited } = setup({
      closePool: async () => {
        throw new Error("drain boom");
      },
    });
    await handler("SIGTERM");
    expect(calls).toEqual(["stop"]);
    expect(exited()).toBe(0);
    expect(logs.join("\n")).toContain("pool drain failed");
  });
});
