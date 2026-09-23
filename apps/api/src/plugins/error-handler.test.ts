import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { errorHandlerPlugin } from "./error-handler";

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
