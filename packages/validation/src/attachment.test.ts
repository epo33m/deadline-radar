import { describe, expect, test } from "bun:test";
import {
  attachmentObjectKey,
  buildAttachmentStoragePath,
  fileAttachmentSchema,
  isSafeExternalHttpUrl,
  linkAttachmentSchema,
} from "./attachment";

describe("linkAttachmentSchema", () => {
  test("accepts an absolute URL without notes", () => {
    const result = linkAttachmentSchema.safeParse({
      url: "https://drive.google.com/file/d/abc",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        type: "link",
        url: "https://drive.google.com/file/d/abc",
        notes: null,
        storage_path: null,
      });
    }
  });

  test("accepts optional notes", () => {
    const result = linkAttachmentSchema.safeParse({
      url: "https://drive.google.com/file/d/abc",
      notes: "Reference material",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe("Reference material");
    }
  });

  test("treats blank notes as null", () => {
    const result = linkAttachmentSchema.safeParse({
      url: "https://drive.google.com/file/d/abc",
      notes: "   ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBeNull();
    }
  });

  test("rejects notes over 1000 characters", () => {
    const result = linkAttachmentSchema.safeParse({
      url: "https://drive.google.com/file/d/abc",
      notes: "x".repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  test("rejects a missing URL", () => {
    const result = linkAttachmentSchema.safeParse({
      url: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a relative URL", () => {
    const result = linkAttachmentSchema.safeParse({
      url: "/local/path",
    });
    expect(result.success).toBe(false);
  });

  test("rejects nonempty storage_path for links", () => {
    const result = linkAttachmentSchema.safeParse({
      url: "https://example.com/doc",
      storage_path: "attachments/u/t/file.pdf",
    });
    expect(result.success).toBe(false);
  });
});

describe("fileAttachmentSchema", () => {
  test("accepts a storage_path without notes", () => {
    const result = fileAttachmentSchema.safeParse({
      storage_path:
        "attachments/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/brief.pdf",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        type: "file",
        storage_path:
          "attachments/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/brief.pdf",
        notes: null,
        url: null,
      });
    }
  });

  test("rejects missing storage_path", () => {
    const result = fileAttachmentSchema.safeParse({
      storage_path: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects nonempty url for files", () => {
    const result = fileAttachmentSchema.safeParse({
      storage_path:
        "attachments/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/brief.pdf",
      url: "https://example.com/leak",
    });
    expect(result.success).toBe(false);
  });
});

describe("buildAttachmentStoragePath", () => {
  test("builds attachments/{user_id}/{task_id}/{attachment_id}/{filename}", () => {
    expect(
      buildAttachmentStoragePath(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
        "notes.pdf",
      ),
    ).toBe(
      "attachments/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/notes.pdf",
    );
  });

  test("strips path separators from filename", () => {
    expect(
      buildAttachmentStoragePath(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "33333333-3333-4333-8333-333333333333",
        "../../etc/passwd",
      ),
    ).toBe(
      "attachments/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/passwd",
    );
  });
});

describe("attachmentObjectKey", () => {
  test("strips the attachments/ bucket prefix", () => {
    expect(
      attachmentObjectKey(
        "attachments/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/notes.pdf",
      ),
    ).toBe(
      "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333/notes.pdf",
    );
  });
});

describe("isSafeExternalHttpUrl (SEC-006)", () => {
  test("accepts absolute http(s) URLs", () => {
    expect(isSafeExternalHttpUrl("https://example.com/doc")).toBe(true);
    expect(isSafeExternalHttpUrl("http://example.com:8080/a?b=c#d")).toBe(
      true,
    );
  });

  test("rejects scheme payloads and non-absolute inputs", () => {
    expect(isSafeExternalHttpUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeExternalHttpUrl("JaVaScRiPt:alert(1)")).toBe(false);
    expect(isSafeExternalHttpUrl("data:text/html,<h1>x</h1>")).toBe(false);
    expect(isSafeExternalHttpUrl("//evil.com/phish")).toBe(false);
    expect(isSafeExternalHttpUrl("/tasks")).toBe(false);
    expect(isSafeExternalHttpUrl("")).toBe(false);
    expect(isSafeExternalHttpUrl(undefined)).toBe(false);
    expect(isSafeExternalHttpUrl(null)).toBe(false);
  });
});

describe("linkAttachmentSchema scheme allow-list (SEC-006)", () => {
  test("rejects javascript: and data: URLs at the API boundary", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "//evil.com/phish",
    ]) {
      expect(linkAttachmentSchema.safeParse({ url }).success).toBe(false);
    }
  });
});
