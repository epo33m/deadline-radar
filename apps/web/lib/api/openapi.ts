import createClient from "openapi-fetch";

import type { paths } from "./schema";

/** Browser OpenAPI client (same-origin /api rewrite → Elysia). */
export const api = createClient<paths>({
  baseUrl: "",
  credentials: "include",
});
