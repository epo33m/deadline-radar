/**
 * #160: the regression lock for the five web-tier -> API forwarding sites.
 *
 * The defect was the ABSENCE of a header, which no unit test of the helper can
 * catch — the helper was correct while every caller left it unused. So each
 * site is exercised here through its real entrypoint, with `fetch` stubbed, and
 * asserted in both directions:
 *
 *  - gate off (the shipped default) -> upstream carries NO `x-forwarded-for`;
 *  - gate on -> upstream carries the caller's inbound value verbatim.
 *
 * A site that stops consulting the helper, or that forwards unconditionally,
 * fails one of these two assertions rather than degrading quietly.
 */
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

type UpstreamCall = { url: string; headers: Headers };

const upstreamCalls: UpstreamCall[] = [];

function stubFetch(body: unknown = {}): void {
  upstreamCalls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    const headers = new Headers(init?.headers);
    upstreamCalls.push({ url, headers });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

function lastUpstream(): UpstreamCall {
  const call = upstreamCalls[upstreamCalls.length - 1];
  if (!call) throw new Error("no upstream fetch was recorded");
  return call;
}

function post(url: string, xff?: string): NextRequest {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    // #162: these requests represent the legitimate same-origin browser caller,
    // so they carry the expected Origin and JSON content type.
    origin: "http://localhost",
  };
  if (xff !== undefined) headers["x-forwarded-for"] = xff;
  return new NextRequest(url, { method: "POST", headers, body: "{}" });
}

// The auth bridges read AUTH_BRIDGE_SECRET at call time and throw without it.
// Set before the imports below resolve the route modules. resolveApiOrigin
// runs at import time; point it at a non-routable origin so a stray real fetch
// is loud rather than silent.
process.env.AUTH_BRIDGE_SECRET = "test-bridge-secret";
process.env.API_ORIGIN = "http://127.0.0.1:4025";
// #162: the auth-bridge same-origin guard reads WEB_ORIGIN at request time.
const savedWebOrigin = process.env.WEB_ORIGIN;
process.env.WEB_ORIGIN = "http://localhost";

// apiFetch reads the request context through next/headers, which has no ambient
// request outside a render. A mutable store keeps these assertions honest about
// the inbound header the Server Action would have been called with.
const requestHeaders = new Headers();
mock.module("next/headers", () => ({
  headers: async () => requestHeaders,
  cookies: async () => ({ getAll: () => [], set: () => undefined }),
}));

const { POST: loginPost } = await import("./app/api/auth/login/route");
const { POST: registerPost } = await import("./app/api/auth/register/route");
const { POST: refreshPost } = await import("./app/api/auth/refresh/route");
const { proxy } = await import("./proxy");
const { apiFetch } = await import("./lib/api/server");

const ROUTES = [
  { name: "login bridge", path: "/api/auth/login", invoke: loginPost },
  { name: "register bridge", path: "/api/auth/register", invoke: registerPost },
  { name: "refresh bridge", path: "/api/auth/refresh", invoke: refreshPost },
] as const;

beforeEach(() => {
  // WEB_FORWARD_CLIENT_IP and WEB_ORIGIN are the env vars these tests mutate;
  // the rest are process-wide fixtures set above.
  delete process.env.WEB_FORWARD_CLIENT_IP;
  process.env.WEB_ORIGIN = "http://localhost";
  stubFetch({ accessToken: "a", refreshToken: "r", expiresIn: 60 });
});

afterEach(() => {
  delete process.env.WEB_FORWARD_CLIENT_IP;
  if (savedWebOrigin === undefined) {
    delete process.env.WEB_ORIGIN;
  } else {
    process.env.WEB_ORIGIN = savedWebOrigin;
  }
});

describe("#160 — auth bridges forward the client identity only when gated on", () => {
  for (const route of ROUTES) {
    describe(route.name, () => {
      test("sends no x-forwarded-for while the gate is off", async () => {
        await route.invoke(post(`http://localhost${route.path}`, "203.0.113.9"));
        expect(lastUpstream().headers.has("x-forwarded-for")).toBe(false);
      });

      test("forwards the inbound value verbatim when gated on", async () => {
        process.env.WEB_FORWARD_CLIENT_IP = "true";
        await route.invoke(post(`http://localhost${route.path}`, "203.0.113.9"));
        expect(lastUpstream().headers.get("x-forwarded-for")).toBe("203.0.113.9");
      });

      test("still omits the header when gated on but the caller sent none", async () => {
        process.env.WEB_FORWARD_CLIENT_IP = "true";
        await route.invoke(post(`http://localhost${route.path}`));
        expect(lastUpstream().headers.has("x-forwarded-for")).toBe(false);
      });
    });
  }
});

describe("#160 — the auth bridges keep their existing upstream headers", () => {
  test("login/register keep content-type and the bridge secret", async () => {
    process.env.WEB_FORWARD_CLIENT_IP = "true";
    await loginPost(post("http://localhost/api/auth/login", "203.0.113.9"));
    const headers = lastUpstream().headers;
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-dr-auth-bridge")).toBe("test-bridge-secret");
  });

  test("the gates are independent: refresh never sends content-type", async () => {
    // Pre-existing shape, pinned because the conditional spread sits directly
    // above it and a merge gone wrong would silently add a header.
    process.env.WEB_FORWARD_CLIENT_IP = "true";
    await refreshPost(post("http://localhost/api/auth/refresh", "203.0.113.9"));
    const headers = lastUpstream().headers;
    expect(headers.has("content-type")).toBe(false);
    expect(headers.get("x-dr-auth-bridge")).toBe("test-bridge-secret");
  });
});

describe("#160 — proxy silent refresh (the 60/min auth bucket)", () => {
  function navigation(xff?: string): NextRequest {
    const headers = new Headers({ cookie: "dr_refresh_token=refresh-value" });
    if (xff !== undefined) headers.set("x-forwarded-for", xff);
    return new NextRequest("http://localhost/tasks", { headers });
  }

  test("sends no x-forwarded-for while the gate is off", async () => {
    await proxy(navigation("203.0.113.9"));
    expect(lastUpstream().url).toContain("/api/v1/auth/refresh");
    expect(lastUpstream().headers.has("x-forwarded-for")).toBe(false);
  });

  test("forwards the inbound value verbatim when gated on", async () => {
    process.env.WEB_FORWARD_CLIENT_IP = "true";
    await proxy(navigation("203.0.113.9"));
    expect(lastUpstream().headers.get("x-forwarded-for")).toBe("203.0.113.9");
  });
});

describe("#160 — apiFetch forwards identity for every Server Action", () => {
  test("sends no x-forwarded-for while the gate is off", async () => {
    requestHeaders.set("x-forwarded-for", "203.0.113.9");
    await apiFetch("/api/v1/summary");
    expect(lastUpstream().headers.has("x-forwarded-for")).toBe(false);
    requestHeaders.delete("x-forwarded-for");
  });

  test("forwards the inbound value verbatim when gated on", async () => {
    process.env.WEB_FORWARD_CLIENT_IP = "true";
    requestHeaders.set("x-forwarded-for", "203.0.113.9");
    await apiFetch("/api/v1/summary");
    expect(lastUpstream().headers.get("x-forwarded-for")).toBe("203.0.113.9");
    requestHeaders.delete("x-forwarded-for");
  });

  test("keeps the forwarded host/proto it already sent", async () => {
    // The conditional spread is inserted among these; a regression that dropped
    // them would change request routing, which is louder than this issue but
    // must not be traded for a fix that is not.
    process.env.WEB_FORWARD_CLIENT_IP = "true";
    requestHeaders.set("x-forwarded-host", "web.example.com");
    requestHeaders.set("x-forwarded-proto", "https");
    requestHeaders.set("x-forwarded-for", "203.0.113.9");
    await apiFetch("/api/v1/summary");
    const headers = lastUpstream().headers;
    expect(headers.get("x-forwarded-host")).toBe("web.example.com");
    expect(headers.get("x-forwarded-proto")).toBe("https");
    expect(headers.get("x-forwarded-for")).toBe("203.0.113.9");
    for (const key of ["x-forwarded-host", "x-forwarded-proto", "x-forwarded-for"]) {
      requestHeaders.delete(key);
    }
  });
});