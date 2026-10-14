/**
 * #167: the auth bridges must bound the unauthenticated request body before
 * buffering it.
 *
 * `register/route.ts` and `login/route.ts` used to call `request.text()`,
 * holding the whole attacker-supplied body as a string before any size gate
 * applied (the API-side cap runs downstream, after this tier already read
 * everything). Both bridges now read through a counting reader and answer
 * 413 past BRIDGE_BODY_MAX_BYTES (64 KiB; legitimate auth JSON is <1 KB).
 *
 * Each bridge is exercised through its real entrypoint with the upstream
 * fetch stubbed. The upstream call count is the important assertion: a 413
 * issued after forwarding would still have buffered and forwarded the body.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { NextRequest } from "next/server";

import { BRIDGE_BODY_MAX_BYTES } from "@/lib/api/body-limit";

const upstreamCalls: string[] = [];
const TEST_ORIGIN = "http://127.0.0.1:3025";
const savedWebOrigin = process.env.WEB_ORIGIN;
const savedFetch = globalThis.fetch;

function stubFetch(): void {
  upstreamCalls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    upstreamCalls.push(typeof input === "string" ? input : String(input));
    return new Response(
      JSON.stringify({
        accessToken: "access-token",
        refreshToken: "refresh-token",
        expiresIn: 3600,
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;
}

function responseSetCookies(response: Response): string[] {
  return typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
}

function bridgeRequest(path: string, body: string): NextRequest {
  const headers = new Headers();
  headers.set("origin", TEST_ORIGIN);
  headers.set("content-type", "application/json");
  return new NextRequest(`${TEST_ORIGIN}${path}`, {
    method: "POST",
    headers,
    body,
  });
}

/** A JSON body of exactly `size` bytes. */
function sizedBody(size: number): string {
  const padding = "a".repeat(Math.max(0, size - 10));
  const body = JSON.stringify({ p: padding });
  if (body.length === size) return body;
  // Adjust for JSON-quote overhead drift on repeat boundaries.
  const fixed = JSON.stringify({ p: "a".repeat(size) }).slice(0, size);
  return fixed.length === size ? fixed : body;
}

process.env.AUTH_BRIDGE_SECRET = "test-bridge-secret";
process.env.API_ORIGIN = "http://127.0.0.1:4025";

const { POST: loginPost } = await import("./login/route");
const { POST: registerPost } = await import("./register/route");

beforeEach(() => {
  process.env.WEB_ORIGIN = TEST_ORIGIN;
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = savedFetch;
  if (savedWebOrigin === undefined) {
    delete process.env.WEB_ORIGIN;
  } else {
    process.env.WEB_ORIGIN = savedWebOrigin;
  }
});

describe("#167 — oversized bridge bodies are rejected before upstream", () => {
  test("login answers 413 with no upstream call and no cookies", async () => {
    const response = await loginPost(
      bridgeRequest("/api/auth/login", sizedBody(BRIDGE_BODY_MAX_BYTES + 1)),
    );

    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({
      error: "Auth request body too large",
    });
    expect(upstreamCalls).toHaveLength(0);
    expect(responseSetCookies(response)).toHaveLength(0);
  });

  test("register answers 413 with no upstream call and no cookies", async () => {
    const response = await registerPost(
      bridgeRequest(
        "/api/auth/register",
        sizedBody(BRIDGE_BODY_MAX_BYTES + 1024),
      ),
    );

    expect(response.status).toBe(413);
    expect(upstreamCalls).toHaveLength(0);
    expect(responseSetCookies(response)).toHaveLength(0);
  });

  test("a body at exactly the cap still forwards", async () => {
    const response = await loginPost(
      bridgeRequest("/api/auth/login", sizedBody(BRIDGE_BODY_MAX_BYTES)),
    );

    expect(response.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
  });

  test("a normal auth body still forwards with cookies", async () => {
    const response = await registerPost(
      bridgeRequest(
        "/api/auth/register",
        JSON.stringify({ email: "user@example.com", password: "pw" }),
      ),
    );

    expect(response.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
    expect(responseSetCookies(response)).toHaveLength(2);
  });
});
