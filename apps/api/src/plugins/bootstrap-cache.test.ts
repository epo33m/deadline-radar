process.env.NODE_ENV = "test";
import { afterEach, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";

import {
  getCachedBootstrap,
  invalidateBootstrapCache,
  isBootstrapInvalidating,
  resetBootstrapCache,
  setCachedBootstrap,
} from "../lib/bootstrap-cache";
import { bootstrapCachePlugin } from "./bootstrap-cache";

describe("isBootstrapInvalidating", () => {
  test("mutating 2xx with a user evicts", () => {
    for (const method of ["POST", "PATCH", "PUT", "DELETE"]) {
      expect(isBootstrapInvalidating(method, 200, "u1")).toBe(true);
      expect(isBootstrapInvalidating(method, 201, "u1")).toBe(true);
    }
  });

  test("reads, errors, redirects, and anonymous requests never evict", () => {
    expect(isBootstrapInvalidating("GET", 200, "u1")).toBe(false);
    expect(isBootstrapInvalidating("POST", 401, "u1")).toBe(false);
    expect(isBootstrapInvalidating("POST", 500, "u1")).toBe(false);
    expect(isBootstrapInvalidating("POST", 302, "u1")).toBe(false);
    expect(isBootstrapInvalidating("POST", 200, null)).toBe(false);
    expect(isBootstrapInvalidating("POST", 200, "")).toBe(false);
    expect(isBootstrapInvalidating("POST", undefined, "u1")).toBe(false);
  });
});

describe("bootstrap cache TTL", () => {
  afterEach(() => {
    resetBootstrapCache();
    delete process.env.BOOTSTRAP_CACHE_TTL_MS;
  });

  test("serves fresh entries, expires them, isolates users", async () => {
    process.env.BOOTSTRAP_CACHE_TTL_MS = "60000";
    const response = { user: { id: "u1" } };
    setCachedBootstrap("u1", response);
    expect(getCachedBootstrap("u1")).toBe(response);
    expect(getCachedBootstrap("u2")).toBeNull();
    invalidateBootstrapCache("u1");
    expect(getCachedBootstrap("u1")).toBeNull();
  });

  test("TTL 0 disables the cache", () => {
    process.env.BOOTSTRAP_CACHE_TTL_MS = "0";
    setCachedBootstrap("u1", { user: { id: "u1" } });
    expect(getCachedBootstrap("u1")).toBeNull();
  });

  test("expired entries are treated as misses", async () => {
    process.env.BOOTSTRAP_CACHE_TTL_MS = "10";
    setCachedBootstrap("u1", { user: { id: "u1" } });
    expect(getCachedBootstrap("u1")).not.toBeNull();
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(getCachedBootstrap("u1")).toBeNull();
  });
});

describe("bootstrapCachePlugin", () => {
  afterEach(() => {
    resetBootstrapCache();
  });

  function testApp() {
    return new Elysia()
      .use(bootstrapCachePlugin)
      .derive(() => ({ user: { id: "u1" } }))
      .post("/thing", () => ({ ok: true }))
      .patch("/thing", ({ set }) => {
        set.status = 200;
        return { ok: true };
      })
      .get("/thing", () => ({ ok: true }));
  }

  test("POST without explicit status evicts", async () => {
    const app = testApp();
    setCachedBootstrap("u1", { user: { id: "u1" } });
    const response = await app.handle(
      new Request("http://localhost/thing", { method: "POST" }),
    );
    expect(response.status).toBe(200);
    expect(getCachedBootstrap("u1")).toBeNull();
  });

  test("PATCH with explicit status evicts", async () => {
    const app = testApp();
    setCachedBootstrap("u1", { user: { id: "u1" } });
    await app.handle(new Request("http://localhost/thing", { method: "PATCH" }));
    expect(getCachedBootstrap("u1")).toBeNull();
  });

  test("GET never evicts", async () => {
    const app = testApp();
    const cached = { user: { id: "u1" } };
    setCachedBootstrap("u1", cached);
    await app.handle(new Request("http://localhost/thing"));
    expect(getCachedBootstrap("u1")).toBe(cached);
  });

  test("error responses never evict", async () => {
    const app = new Elysia()
      .use(bootstrapCachePlugin)
      .derive(() => ({ user: { id: "u1" } }))
      .onError(({ set }) => {
        set.status = 400;
        return { error: "bad" };
      })
      .post("/broken", () => {
        throw new Error("nope");
      });
    const cached = { user: { id: "u1" } };
    setCachedBootstrap("u1", cached);
    const response = await app.handle(
      new Request("http://localhost/broken", { method: "POST" }),
    );
    expect(response.status).toBe(400);
    expect(getCachedBootstrap("u1")).toBe(cached);
  });
});
