import { describe, expect, test } from "bun:test";
import {
  attachmentObjectKey,
  buildAttachmentStoragePath,
  fileAttachmentSchema,
  linkAttachmentSchema,
} from "./attachment";

describe("linkAttachmentSchema", () => {
  test("accepts a name and absolute URL", () => {
    const result = linkAttachmentSchema.safeParse({
      name: "Syllabus",
      url: "https://drive.google.com/file/d/abc",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        type: "link",
        name: "Syllabus",
        url: "https://drive.google.com/file/d/abc",
        storage_path: null,
      });
    }
  });

  test("rejects a missing URL", () => {
    const result = linkAttachmentSchema.safeParse({
      name: "Syllabus",
      url: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects a relative URL", () => {
    const result = linkAttachmentSchema.safeParse({
      name: "Syllabus",
      url: "/local/path",
    });
    expect(result.success).toBe(false);
  });

  test("rejects nonempty storage_path for links", () => {
    const result = linkAttachmentSchema.safeParse({
      name: "Syllabus",
      url: "https://example.com/doc",
      storage_path: "attachments/u/t/file.pdf",
    });
    expect(result.success).toBe(false);
  });

  test("rejects blank name", () => {
    const result = linkAttachmentSchema.safeParse({
      name: "   ",
      url: "https://example.com/doc",
    });
    expect(result.success).toBe(false);
  });
});

describe("fileAttachmentSchema", () => {
  test("accepts a name and storage_path", () => {
    const result = fileAttachmentSchema.safeParse({
      name: "brief.pdf",
      storage_path:
        "attachments/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/brief.pdf",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        type: "file",
        name: "brief.pdf",
        storage_path:
          "attachments/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/brief.pdf",
        url: null,
      });
    }
  });

  test("rejects missing storage_path", () => {
    const result = fileAttachmentSchema.safeParse({
      name: "brief.pdf",
      storage_path: "",
    });
    expect(result.success).toBe(false);
  });

  test("rejects nonempty url for files", () => {
    const result = fileAttachmentSchema.safeParse({
      name: "brief.pdf",
      storage_path:
        "attachments/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/brief.pdf",
      url: "https://example.com/leak",
    });
    expect(result.success).toBe(false);
  });
});

describe("buildAttachmentStoragePath", () => {
  test("builds attachments/{user_id}/{task_id}/{filename}", () => {
    expect(
      buildAttachmentStoragePath(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "notes.pdf",
      ),
    ).toBe(
      "attachments/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/notes.pdf",
    );
  });

  test("strips path separators from filename", () => {
    expect(
      buildAttachmentStoragePath(
        "11111111-1111-4111-8111-111111111111",
        "22222222-2222-4222-8222-222222222222",
        "../../etc/passwd",
      ),
    ).toBe(
      "attachments/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/passwd",
    );
  });
});

describe("attachmentObjectKey", () => {
  test("strips the attachments/ bucket prefix", () => {
    expect(
      attachmentObjectKey(
        "attachments/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/notes.pdf",
      ),
    ).toBe(
      "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/notes.pdf",
    );
  });
});
