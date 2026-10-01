import { beforeEach, describe, expect, mock, test } from "bun:test";

type ApiJsonCall = {
  path: string;
  init?: RequestInit;
  headers?: Record<string, string>;
};

const apiJsonCalls: ApiJsonCall[] = [];
let mockApiJsonResult: Record<string, unknown> = {};

mock.module("next/cache", () => ({
  revalidatePath: () => undefined,
}));

mock.module("next/navigation", () => ({
  redirect: (url: string) => url,
}));

mock.module("@/lib/api/server", () => ({
  // `apiFetch` is stubbed (unused by these actions) so the mock keeps the
  // module's full export shape: `lib/calendar/load` and `lib/summary/load`
  // import it, and bun shares mocks across test files in one run.
  apiFetch: async () => {
    throw new Error("apiFetch is stubbed in idempotency.test.ts");
  },
  clearLocalAuthCookies: async () => undefined,
  apiJson: async (path: string, init: RequestInit = {}) => {
    const headersObj: Record<string, string> = {};
    if (init.headers) {
      if (init.headers instanceof Headers) {
        init.headers.forEach((v, k) => {
          headersObj[k] = v;
        });
      } else if (Array.isArray(init.headers)) {
        for (const [k, v] of init.headers) headersObj[k] = v;
      } else {
        Object.assign(headersObj, init.headers);
      }
    }
    apiJsonCalls.push({ path, init, headers: headersObj });
    return mockApiJsonResult;
  },
}));

const { createTask } = await import("./tasks");
const { createCourse } = await import("./courses");
const { addLinkAttachment, addFileAttachment } = await import("./attachments");

describe("F-04 Server Actions Idempotency-Key", () => {
  beforeEach(() => {
    apiJsonCalls.length = 0;
    mockApiJsonResult = {};
  });

  test("1. createTask sends valid Idempotency-Key header", async () => {
    mockApiJsonResult = { task: { id: "task-1" } };
    const formData = new FormData();
    formData.set("title", "New Task");
    formData.set("course_id", "course-1");
    formData.set("idempotency_key", "custom-task-key-123");

    await createTask({}, formData);

    expect(apiJsonCalls.length).toBe(1);
    expect(apiJsonCalls[0].path).toBe("/api/v1/tasks");
    expect(apiJsonCalls[0].init?.method).toBe("POST");
    expect(apiJsonCalls[0].headers?.["Idempotency-Key"]).toBe(
      "custom-task-key-123",
    );
  });

  test("1b. createTask generates a valid UUID key if client key is omitted", async () => {
    mockApiJsonResult = { task: { id: "task-1" } };
    const formData = new FormData();
    formData.set("title", "New Task");
    formData.set("course_id", "course-1");

    await createTask({}, formData);

    expect(apiJsonCalls.length).toBe(1);
    const key = apiJsonCalls[0].headers?.["Idempotency-Key"];
    expect(key).toBeDefined();
    expect(key?.length).toBeGreaterThanOrEqual(8);
    expect(key?.length).toBeLessThanOrEqual(128);
    expect(key).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  test("2. createCourse sends valid Idempotency-Key header", async () => {
    mockApiJsonResult = { course: { id: "course-1" } };
    const formData = new FormData();
    formData.set("name", "CS 101");
    formData.set("idempotency_key", "custom-course-key-456");

    await createCourse({}, formData);

    expect(apiJsonCalls.length).toBe(1);
    expect(apiJsonCalls[0].path).toBe("/api/v1/courses");
    expect(apiJsonCalls[0].init?.method).toBe("POST");
    expect(apiJsonCalls[0].headers?.["Idempotency-Key"]).toBe(
      "custom-course-key-456",
    );
  });

  test("3. addLinkAttachment sends valid Idempotency-Key header", async () => {
    mockApiJsonResult = { attachment: { id: "att-1" } };
    const formData = new FormData();
    formData.set("task_id", "task-123");
    formData.set("url", "https://example.com/doc");
    formData.set("idempotency_key", "custom-link-key-789");

    await addLinkAttachment({}, formData);

    expect(apiJsonCalls.length).toBe(1);
    expect(apiJsonCalls[0].path).toBe("/api/v1/attachments/link");
    expect(apiJsonCalls[0].init?.method).toBe("POST");
    expect(apiJsonCalls[0].headers?.["Idempotency-Key"]).toBe(
      "custom-link-key-789",
    );
  });

  test("4. addFileAttachment sends valid Idempotency-Key header for single file", async () => {
    mockApiJsonResult = { attachment: { id: "att-1" } };
    const formData = new FormData();
    formData.set("task_id", "task-123");
    formData.set("idempotency_key", "batch-key-111");
    formData.set(
      "file",
      new File(["content"], "test.pdf", { type: "application/pdf" }),
    );

    await addFileAttachment({}, formData);

    expect(apiJsonCalls.length).toBe(1);
    expect(apiJsonCalls[0].path).toBe("/api/v1/attachments/file");
    expect(apiJsonCalls[0].init?.method).toBe("POST");
    expect(apiJsonCalls[0].headers?.["Idempotency-Key"]).toBe(
      "batch-key-111-0",
    );
  });

  test("5. multi-file upload sends unique individual keys per file", async () => {
    mockApiJsonResult = { attachment: { id: "att-ok" } };
    const formData = new FormData();
    formData.set("task_id", "task-123");
    formData.set("idempotency_key", "batch-multi-key");
    formData.append(
      "file",
      new File(["file A"], "a.pdf", { type: "application/pdf" }),
    );
    formData.append(
      "file",
      new File(["file B"], "b.png", { type: "image/png" }),
    );
    formData.append(
      "file",
      new File(["file C"], "c.txt", { type: "text/plain" }),
    );

    await addFileAttachment({}, formData);

    expect(apiJsonCalls.length).toBe(3);
    const keyA = apiJsonCalls[0].headers?.["Idempotency-Key"];
    const keyB = apiJsonCalls[1].headers?.["Idempotency-Key"];
    const keyC = apiJsonCalls[2].headers?.["Idempotency-Key"];

    expect(keyA).toBe("batch-multi-key-0");
    expect(keyB).toBe("batch-multi-key-1");
    expect(keyC).toBe("batch-multi-key-2");

    expect(keyA).not.toBe(keyB);
    expect(keyB).not.toBe(keyC);
  });

  test("6. duplicate filename in multi-file batch still receives distinct keys", async () => {
    mockApiJsonResult = { attachment: { id: "att-ok" } };
    const formData = new FormData();
    formData.set("task_id", "task-123");
    formData.set("idempotency_key", "batch-dup-name");
    formData.append(
      "file",
      new File(["content 1"], "test.pdf", { type: "application/pdf" }),
    );
    formData.append(
      "file",
      new File(["content 2"], "test.pdf", { type: "application/pdf" }),
    );

    await addFileAttachment({}, formData);

    expect(apiJsonCalls.length).toBe(2);
    const key1 = apiJsonCalls[0].headers?.["Idempotency-Key"];
    const key2 = apiJsonCalls[1].headers?.["Idempotency-Key"];

    expect(key1).toBe("batch-dup-name-0");
    expect(key2).toBe("batch-dup-name-1");
    expect(key1).not.toBe(key2);
  });

  test("7. new submission generates a different key from previous submission", async () => {
    mockApiJsonResult = { task: { id: "task-1" } };
    const formData1 = new FormData();
    formData1.set("title", "Task 1");
    formData1.set("course_id", "course-1");
    await createTask({}, formData1);

    const formData2 = new FormData();
    formData2.set("title", "Task 2");
    formData2.set("course_id", "course-1");
    await createTask({}, formData2);

    expect(apiJsonCalls.length).toBe(2);
    const key1 = apiJsonCalls[0].headers?.["Idempotency-Key"];
    const key2 = apiJsonCalls[1].headers?.["Idempotency-Key"];

    expect(key1).toBeDefined();
    expect(key2).toBeDefined();
    expect(key1).not.toBe(key2);
  });

  test("8. retry of same form submission preserves the exact same idempotency keys", async () => {
    const sharedBatchKey = "fixed-batch-session-key";

    // Attempt 1: Upload 2 files
    const formData1 = new FormData();
    formData1.set("task_id", "task-123");
    formData1.set("idempotency_key", sharedBatchKey);
    formData1.append(
      "file",
      new File(["file 1"], "doc1.pdf", { type: "application/pdf" }),
    );
    formData1.append(
      "file",
      new File(["file 2"], "doc2.pdf", { type: "application/pdf" }),
    );
    await addFileAttachment({}, formData1);

    // Attempt 2 (Retry of the same logical form submission after error/timeout)
    const formData2 = new FormData();
    formData2.set("task_id", "task-123");
    formData2.set("idempotency_key", sharedBatchKey);
    formData2.append(
      "file",
      new File(["file 1"], "doc1.pdf", { type: "application/pdf" }),
    );
    formData2.append(
      "file",
      new File(["file 2"], "doc2.pdf", { type: "application/pdf" }),
    );
    await addFileAttachment({}, formData2);

    expect(apiJsonCalls.length).toBe(4);
    // Attempt 1 keys
    expect(apiJsonCalls[0].headers?.["Idempotency-Key"]).toBe(
      `${sharedBatchKey}-0`,
    );
    expect(apiJsonCalls[1].headers?.["Idempotency-Key"]).toBe(
      `${sharedBatchKey}-1`,
    );

    // Attempt 2 (retry) keys MUST match attempt 1 keys exactly
    expect(apiJsonCalls[2].headers?.["Idempotency-Key"]).toBe(
      `${sharedBatchKey}-0`,
    );
    expect(apiJsonCalls[3].headers?.["Idempotency-Key"]).toBe(
      `${sharedBatchKey}-1`,
    );
  });

  test("9. existing error handling and return state is preserved", async () => {
    mockApiJsonResult = {
      error: "Validation failed",
      fieldErrors: { title: ["Title is required"] },
    };
    const formData = new FormData();
    formData.set("title", "");

    const result = await createTask({}, formData);

    expect(result.error).toBe("Validation failed");
    expect(result.fieldErrors?.title).toEqual(["Title is required"]);
  });
});
