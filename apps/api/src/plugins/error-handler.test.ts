import { describe, expect, mock, test } from "bun:test";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "./error-handler";

/**
 * Issue #139: a client-side body parse failure (Elysia `code: "PARSE"`,
 * thrown for truncated/multipart bodies on TypeBox-validated routes) must
 * answer with the standard 400 envelope and must never reach Sentry — it is a
 * client error, not a server fault.
 */
const sentryExceptionCalls: unknown[][] = [];

mock.module("@sentry/bun", () => ({
  withScope: (cb: (scope: unknown) => void) =>
    cb({ setLevel: () => undefined, setExtras: () => undefined }),
  captureMessage: () => undefined,
  captureException: (...args: unknown[]) => {
    sentryExceptionCalls.push(args);
  },
}));

function parseError(): Error & { code: string; status: number } {
  // Mirrors elysia/dist/error.js ParseError: code "PARSE", status 400.
  const err = new Error("Bad Request") as Error & {
    code: string;
    status: number;
  };
  err.code = "PARSE";
  err.status = 400;
  return err;
}

describe("errorHandlerPlugin — PostgreSQL 23503 handling", () => {
  test("maps PostgreSQL 23503 foreign key violation to 400 validation error envelope", async () => {
    const app = new Elysia()
      .use(errorHandlerPlugin)
      .get("/test-fk-error", () => {
        const err = new Error("insert or update on table violates foreign key constraint") as Error & { code: string };
        err.code = "23503";
        throw err;
      });

    const response = await app.handle(new Request("http://localhost/test-fk-error"));
    expect(response.status).toBe(400);

    const body = (await response.json()) as {
      error: {
        code: string;
        message: string;
        details: Array<{ message: string }>;
      };
      requestId: string;
    };

    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Invalid referenced resource or cross-owner violation");
    expect(body.error.details[0].message).toBe("Referenced resource does not exist or owner mismatch");
    expect(typeof body.requestId).toBe("string");
  });
});

describe("errorHandlerPlugin — Elysia PARSE handling (#139)", () => {
  test("maps a malformed-body PARSE failure to the 400 validation envelope", async () => {
    const app = new Elysia()
      .use(errorHandlerPlugin)
      .post("/test-parse-error", () => {
        throw parseError();
      });

    const response = await app.handle(
      new Request("http://localhost/test-parse-error", { method: "POST" }),
    );
    expect(response.status).toBe(400);

    const body = (await response.json()) as {
      error: {
        code: string;
        message: string;
        details: Array<{ message: string }>;
      };
      requestId: string;
    };

    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(body.error.message).toBe("Request validation failed");
    expect(body.error.details[0].message).toBe("Invalid request");
    expect(typeof body.requestId).toBe("string");
    expect(response.headers.get("x-request-id")).toBe(body.requestId);
  });

  test("never reports a client parse failure to Sentry", async () => {
    const before = sentryExceptionCalls.length;

    const app = new Elysia()
      .use(errorHandlerPlugin)
      .post("/test-parse-error-sentry", () => {
        throw parseError();
      });

    const response = await app.handle(
      new Request("http://localhost/test-parse-error-sentry", { method: "POST" }),
    );
    expect(response.status).toBe(400);
    expect(sentryExceptionCalls.length).toBe(before);
  });

  test("still reports genuine server faults to Sentry", async () => {
    const before = sentryExceptionCalls.length;

    const app = new Elysia()
      .use(errorHandlerPlugin)
      .get("/test-internal-error", () => {
        const err = new Error("boom") as Error & { code: string };
        err.code = "INTERNAL_SERVER_ERROR";
        throw err;
      });

    const response = await app.handle(
      new Request("http://localhost/test-internal-error"),
    );
    expect(response.status).toBe(500);
    expect(sentryExceptionCalls.length).toBe(before + 1);
  });
});
