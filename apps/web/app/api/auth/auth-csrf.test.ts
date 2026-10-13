/**
 * #162: the auth bridges must not mint session cookies for cross-site requests.
 *
 * The defect was the ABSENCE of an origin check. Each bridge is therefore
 * exercised through its real entrypoint with the upstream fetch stubbed, in
 * both directions:
 *
 *  - a cross-site navigation is refused before any upstream fetch, with no
 *    `Set-Cookie` on the response;
 *  - a legitimate same-origin request still reaches the API and still receives
 *    both session cookies.
 *
 * The upstream call count is the important assertion: a 403 that had already
 * forwarded the attacker's credentials would still be vulnerable.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";

type UpstreamCall = { url: string; body: string | null };

const upstreamCalls: UpstreamCall[] = [];
const TEST_ORIGIN = "http://127.0.0.1:3025";
const savedWebOrigin = process.env.WEB_ORIGIN;
const savedFetch = globalThis.fetch;

function stubFetch(): void {
  upstreamCalls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    upstreamCalls.push({
      url,
      body: typeof init?.body === "string" ? init.body : null,
    });
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

function bridgeRequest(
  path: string,
  init: {
    body?: string | null;
    contentType?: string | null;
    origin?: string | null;
    referer?: string;
    secFetchSite?: string;
  } = {},
): NextRequest {
  const headers = new Headers();
  const origin = init.origin === undefined ? TEST_ORIGIN : init.origin;
  if (origin !== null) headers.set("origin", origin);
  const contentType =
    init.contentType === undefined ? "application/json" : init.contentType;
  if (contentType !== null) headers.set("content-type", contentType);
  if (init.referer !== undefined) headers.set("referer", init.referer);
  if (init.secFetchSite !== undefined) {
    headers.set("sec-fetch-site", init.secFetchSite);
  }
  return new NextRequest(`${TEST_ORIGIN}${path}`, {
    method: "POST",
    headers,
    body: init.body === undefined ? "{}" : init.body,
  });
}

process.env.AUTH_BRIDGE_SECRET = "test-bridge-secret";
process.env.API_ORIGIN = "http://127.0.0.1:4025";

const { POST: loginPost } = await import("./login/route");
const { POST: registerPost } = await import("./register/route");
const { POST: refreshPost } = await import("./refresh/route");

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

describe("#162 — cross-site auth bridges are refused before any upstream call", () => {
  test("login rejects a cross-site form navigation without setting cookies", async () => {
    const response = await loginPost(
      bridgeRequest("/api/auth/login", {
        origin: "https://evil.example",
        secFetchSite: "cross-site",
        contentType: "text/plain",
        body: '{"email":"attacker@evil.example","password":"pw=w0rd!"}\r\n',
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Cross-origin auth request rejected",
    });
    expect(upstreamCalls).toHaveLength(0);
    expect(responseSetCookies(response)).toHaveLength(0);
  });

  test("register rejects a cross-site request without setting cookies", async () => {
    const response = await registerPost(
      bridgeRequest("/api/auth/register", {
        origin: "https://evil.example",
        secFetchSite: "cross-site",
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Cross-origin auth request rejected",
    });
    expect(upstreamCalls).toHaveLength(0);
    expect(responseSetCookies(response)).toHaveLength(0);
  });

  test("refresh rejects a cross-site request without setting cookies", async () => {
    const response = await refreshPost(
      bridgeRequest("/api/auth/refresh", {
        origin: "https://evil.example",
        secFetchSite: "cross-site",
        contentType: null,
        body: null,
      }),
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: "Cross-origin auth request rejected",
    });
    expect(upstreamCalls).toHaveLength(0);
    expect(responseSetCookies(response)).toHaveLength(0);
  });

  test("login fails closed when there is no origin signal", async () => {
    const response = await loginPost(
      bridgeRequest("/api/auth/login", { origin: null }),
    );

    expect(response.status).toBe(403);
    expect(upstreamCalls).toHaveLength(0);
    expect(responseSetCookies(response)).toHaveLength(0);
  });
});

describe("#162 — JSON bodies are required for credential bridges", () => {
  test("login rejects a same-origin non-JSON request", async () => {
    const response = await loginPost(
      bridgeRequest("/api/auth/login", { contentType: "text/plain" }),
    );

    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      error: "Unsupported auth request content type",
    });
    expect(upstreamCalls).toHaveLength(0);
    expect(responseSetCookies(response)).toHaveLength(0);
  });

  test("register rejects a same-origin non-JSON request", async () => {
    const response = await registerPost(
      bridgeRequest("/api/auth/register", {
        contentType: "application/x-www-form-urlencoded",
      }),
    );

    expect(response.status).toBe(415);
    expect(upstreamCalls).toHaveLength(0);
    expect(responseSetCookies(response)).toHaveLength(0);
  });
});

describe("#162 — legitimate same-origin requests still mint sessions", () => {
  test("login forwards JSON and sets both cookies", async () => {
    const response = await loginPost(
      bridgeRequest("/api/auth/login", {
        body: JSON.stringify({
          email: "user@example.com",
          password: "correct horse battery staple",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
    expect(responseSetCookies(response)).toHaveLength(2);
  });

  test("register forwards JSON and sets both cookies", async () => {
    const response = await registerPost(
      bridgeRequest("/api/auth/register", {
        body: JSON.stringify({
          email: "user@example.com",
          password: "correct horse battery staple",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
    expect(responseSetCookies(response)).toHaveLength(2);
  });

  test("refresh works without a JSON body because it sends none upstream", async () => {
    const response = await refreshPost(
      bridgeRequest("/api/auth/refresh", { contentType: null, body: null }),
    );

    expect(response.status).toBe(200);
    expect(upstreamCalls).toHaveLength(1);
    expect(responseSetCookies(response)).toHaveLength(2);
  });
});
