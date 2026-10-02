import { describe, expect, mock, test } from "bun:test";

// bun's client react build makes `cache()` a passthrough (no server
// dispatcher), so simulate the Next render-pass memoization semantics
// here: per (fn, args) identity, exactly one evaluation.
// This isolates *our* contract — one upstream fetch per (id, fetchJson) —
// from React runtime internals.
const fnIds = new WeakMap<object, number>();
let nextFnId = 0;
function argKey(arg: unknown): string {
  if (typeof arg === "function" || (typeof arg === "object" && arg !== null)) {
    let id = fnIds.get(arg as object);
    if (id === undefined) {
      id = ++nextFnId;
      fnIds.set(arg as object, id);
    }
    return `fn:${id}`;
  }
  return String(arg);
}

mock.module("react", () => ({
  cache: <A extends unknown[], R>(
    fn: (...args: A) => R,
  ): ((...args: A) => R) => {
    const seen = new Map<string, R>();
    return (...args: A) => {
      const key = args.map(argKey).join("|");
      if (seen.has(key)) return seen.get(key)!;
      const out = fn(...args);
      seen.set(key, out);
      return out;
    };
  },
}));

const fetchSpy = async () => ({}) as never;

mock.module("@/lib/api/server", () => ({
  apiFetch: async () => {
    throw new Error("apiFetch is stubbed in course.test.ts");
  },
  apiJson: fetchSpy as never,
  clearLocalAuthCookies: async () => undefined,
}));

const { getCourse } = await import("./course");

describe("getCourse", () => {
  test("fetch spy == 1 for repeated calls with the same id in one pass", async () => {
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      return { course: { name: "Matematika" } } as never;
    };
    const a = await getCourse("c1", fetchJson);
    const b = await getCourse("c1", fetchJson);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  test("dedupes concurrent calls through the cached wrapper", async () => {
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      return { course: { name: "X" } } as never;
    };
    const [a, b] = await Promise.all([getCourse("c1", fetchJson), getCourse("c1", fetchJson)]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  test("different ids fetch separately", async () => {
    let calls = 0;
    const fetchJson = async () => {
      calls += 1;
      return {} as never;
    };
    await getCourse("c1", fetchJson);
    await getCourse("c2", fetchJson);
    expect(calls).toBe(2);
  });

  test("error payload passes through untouched (notFound wiring)", async () => {
    const fetchJson = async () => ({ error: "Course not found" }) as never;
    const result = await getCourse("nope", fetchJson);
    expect(result.error).toBe("Course not found");
    expect(result.course).toBeUndefined();
  });

  test("metadata title contract: name when present, fallback otherwise", async () => {
    const found = await getCourse(
      "c9",
      (async () => ({ course: { name: "Fisika" } })) as never,
    );
    const missing = await getCourse("c10", (async () => ({})) as never);
    expect(found.course?.name ?? "Course").toBe("Fisika");
    expect(missing.course?.name ?? "Course").toBe("Course");
  });
});
