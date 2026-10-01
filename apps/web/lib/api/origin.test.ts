import { describe, expect, test, spyOn, afterEach } from "bun:test";

import {
  LOCAL_API_ORIGIN,
  isLocalApiOrigin,
  isProductionEnv,
  resetApiOriginWarningsForTests,
  resolveApiOrigin,
} from "./origin";

afterEach(() => {
  resetApiOriginWarningsForTests();
});

describe("resolveApiOrigin", () => {
  test("returns the configured origin trimmed", () => {
    expect(
      resolveApiOrigin({
        API_ORIGIN: "https://api.example.com ",
        NODE_ENV: "production",
      } as NodeJS.ProcessEnv),
    ).toBe("https://api.example.com");
  });

  test("falls back to localhost when unset (dev stays silent)", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const origin = resolveApiOrigin({ NODE_ENV: "development" });
      expect(origin).toBe(LOCAL_API_ORIGIN);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("warns once in production when API_ORIGIN is missing", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const origin = resolveApiOrigin({ NODE_ENV: "production" });
      expect(origin).toBe(LOCAL_API_ORIGIN);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("API_ORIGIN");
    } finally {
      warn.mockRestore();
    }
  });

  test("warns in production when API_ORIGIN is loopback", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const origin = resolveApiOrigin({
        NODE_ENV: "production",
        API_ORIGIN: "http://127.0.0.1:4025",
      } as NodeJS.ProcessEnv);
      expect(origin).toBe("http://127.0.0.1:4025");
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  test("stays silent in production when a public origin is set", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => {});
    try {
      resolveApiOrigin({
        NODE_ENV: "production",
        API_ORIGIN: "https://deadline-radar-api-production.up.railway.app",
      } as NodeJS.ProcessEnv);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  test("treats VERCEL=1 as production", () => {
    expect(
      isProductionEnv({ VERCEL: "1" } as unknown as NodeJS.ProcessEnv),
    ).toBe(true);
    expect(isProductionEnv({ NODE_ENV: "development" })).toBe(false);
  });
});

describe("isLocalApiOrigin", () => {
  test("detects loopback origins", () => {
    expect(isLocalApiOrigin("http://127.0.0.1:4025")).toBe(true);
    expect(isLocalApiOrigin("http://localhost:4025")).toBe(true);
    expect(
      isLocalApiOrigin("https://deadline-radar-api-production.up.railway.app"),
    ).toBe(false);
  });
});
