import { z } from "zod";
import { ApiError } from "./errors";

export const DEFAULT_PAGE_LIMIT = 50;
export const MAX_PAGE_LIMIT = 100;

export const paginationQuerySchema = z
  .object({
    limit: z
      .union([z.string(), z.number()])
      .optional()
      .transform((value, ctx) => {
        if (value === undefined) return DEFAULT_PAGE_LIMIT;
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isInteger(n) || n < 1) {
          ctx.addIssue({
            code: "custom",
            message: `limit must be an integer between 1 and ${MAX_PAGE_LIMIT}`,
          });
          return z.NEVER;
        }
        if (n > MAX_PAGE_LIMIT) {
          ctx.addIssue({
            code: "custom",
            message: `limit must be at most ${MAX_PAGE_LIMIT}`,
          });
          return z.NEVER;
        }
        return n;
      }),
    cursor: z.string().trim().max(512).optional(),
  })
  .strict();

export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export type PageMeta = {
  nextCursor: string | null;
  limit: number;
};

export type CursorPayload = {
  v: 1;
  /** Sort key value as ISO string or number string */
  k: string;
  /** Tie-break id */
  id: string;
};

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeCursor(cursor: string | undefined): CursorPayload | null {
  if (!cursor) return null;
  try {
    const raw = Buffer.from(cursor, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as CursorPayload;
    if (
      parsed?.v !== 1 ||
      typeof parsed.k !== "string" ||
      typeof parsed.id !== "string" ||
      parsed.id.length === 0
    ) {
      throw new Error("invalid");
    }
    return parsed;
  } catch {
    throw ApiError.validation("Invalid cursor", [
      { field: "cursor", message: "Cursor is invalid or expired" },
    ]);
  }
}

export function parsePaginationQuery(query: unknown): PaginationQuery {
  const parsed = paginationQuerySchema.safeParse(query ?? {});
  if (!parsed.success) {
    throw ApiError.validation(
      "Invalid pagination parameters",
      Object.entries(parsed.error.flatten().fieldErrors).flatMap(
        ([field, messages]) =>
          (messages ?? []).map((message) => ({ field, message })),
      ),
    );
  }
  return parsed.data;
}

export function pageMeta(
  limit: number,
  nextCursor: string | null,
): PageMeta {
  return { nextCursor, limit };
}
