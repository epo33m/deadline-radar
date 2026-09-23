import { ApiError } from "./errors";

/** Read JSON body without framework schema stripping (enables Zod .strict()). */
export async function readJsonBody(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text || text.trim().length === 0) {
    throw ApiError.validation("Request body is required");
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw ApiError.validation("Invalid JSON body");
  }
}
