/**
 * #138: body-size cap must hold without a Content-Length header.
 * - Chunked JSON > MAX_JSON_BODY_BYTES → 413 PAYLOAD_TOO_LARGE envelope.
 * - Chunked upload > MAX_UPLOAD_BYTES → 413 (via t.File maxSize → 413 mapping).
 * - Normal-sized requests are unaffected.
 */
process.env.NODE_ENV = "test";

import { describe, expect, test } from "bun:test";
import { Elysia, t } from "elysia";

import { readJsonBody } from "../lib/api/read-json";
import {
  MAX_JSON_BODY_BYTES,
  MAX_UPLOAD_BYTES,
  assertUploadSize,
  bodyLimitPlugin,
} from "../plugins/body-limit";
import { errorHandlerPlugin } from "../plugins/error-handler";

function chunkedJsonRequest(url: string, jsonText: string): Request {
  const bytes = new TextEncoder().encode(jsonText);
  const mid = Math.floor(bytes.length / 2);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, mid));
      controller.enqueue(bytes.slice(mid));
      controller.close();
    },
  });
  return new Request(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "transfer-encoding": "chunked",
    },
    body: stream,
    duplex: "half",
  } as RequestInit);
}

const jsonApp = new Elysia()
  .use(errorHandlerPlugin)
  .use(bodyLimitPlugin)
  .post("/echo", async ({ request }) => {
    const body = await readJsonBody(request);
    return { ok: true, body };
  });

const uploadApp = new Elysia().use(errorHandlerPlugin).post(
  "/upload",
  () => ({ ok: true }),
  {
    body: t.Object({
      file: t.File({ type: ["application/pdf"], maxSize: "10m" }),
    }),
  },
);

function pdfFile(totalBytes: number): File {
  const header = new TextEncoder().encode("%PDF-1.4\n");
  const rest = new Uint8Array(Math.max(0, totalBytes - header.length)).fill(0x41);
  const merged = new Uint8Array(header.length + rest.length);
  merged.set(header, 0);
  merged.set(rest, header.length);
  return new File([merged], "big.pdf", { type: "application/pdf" });
}

type ErrorEnvelope = {
  error: { code: string; message: string; details: unknown[] };
  requestId: string;
};

describe("body-size cap without Content-Length (#138)", () => {
  test("readJsonBody parses a normal small body", async () => {
    const req = new Request("http://localhost/echo", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hello: "world" }),
    });
    expect(await readJsonBody(req)).toEqual({ hello: "world" });
  });

  test("readJsonBody rejects a chunked oversized stream with 413", async () => {
    const big = "x".repeat(MAX_JSON_BODY_BYTES + 1024);
    const req = chunkedJsonRequest(
      "http://localhost/echo",
      JSON.stringify({ data: big }),
    );
    expect(req.headers.get("content-length")).toBeNull();
    const err = await readJsonBody(req).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeNull();
    expect((err as { status?: number }).status).toBe(413);
    expect((err as { code?: string }).code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("chunked POST > cap to a JSON route → 413 envelope", async () => {
    const big = "y".repeat(MAX_JSON_BODY_BYTES + 1024);
    const res = await jsonApp.handle(
      chunkedJsonRequest("http://localhost/echo", JSON.stringify({ data: big })),
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(typeof body.requestId).toBe("string");
  });

  test("normal-sized chunked JSON is unaffected", async () => {
    const res = await jsonApp.handle(
      chunkedJsonRequest(
        "http://localhost/echo",
        JSON.stringify({ hello: "world" }),
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("lying Content-Length fast path still → 413", async () => {
    const res = await jsonApp.handle(
      new Request("http://localhost/echo", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(MAX_JSON_BODY_BYTES + 1),
        },
        body: JSON.stringify({ hello: "world" }),
      }),
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  test("assertUploadSize enforces the 10 MiB cap", async () => {
    expect(() => assertUploadSize(MAX_UPLOAD_BYTES)).not.toThrow();
    expect(() => assertUploadSize(MAX_UPLOAD_BYTES + 1)).toThrow(
      expect.objectContaining({ code: "PAYLOAD_TOO_LARGE" }),
    );
  });

  test("chunked upload > 10 MiB → 413 envelope", async () => {
    const form = new FormData();
    form.set("file", pdfFile(MAX_UPLOAD_BYTES + 1024));
    expect(form.get("file") instanceof File).toBe(true);
    const res = await uploadApp.handle(
      new Request("http://localhost/upload", { method: "POST", body: form }),
    );
    expect(res.status).toBe(413);
    const body = (await res.json()) as ErrorEnvelope;
    expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
    expect(typeof body.requestId).toBe("string");
  });

  test("normal-sized upload is unaffected", async () => {
    const form = new FormData();
    form.set("file", pdfFile(1024));
    const res = await uploadApp.handle(
      new Request("http://localhost/upload", { method: "POST", body: form }),
    );
    expect(res.status).toBe(200);
  });
});
