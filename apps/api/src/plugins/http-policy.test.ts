import { describe, expect, test } from "bun:test";

import { httpPolicyPlugin } from "../plugins/http-policy";
import { Elysia } from "elysia";

describe("httpPolicyPlugin", () => {
  test("sets HSTS in production", async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";
    try {
      const app = new Elysia().use(httpPolicyPlugin).get("/api/ping", () => ({
        ok: true,
      }));
      const response = await app.handle(
        new Request("http://localhost/api/ping"),
      );
      expect(response.headers.get("Strict-Transport-Security")).toContain(
        "max-age=",
      );
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
