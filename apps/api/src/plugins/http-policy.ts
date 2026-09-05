import { Elysia } from "elysia";

/** Security + cache defaults for all API responses (backend-owned). */
export const httpPolicyPlugin = new Elysia({ name: "http-policy" })
  .onAfterHandle(({ request, set }) => {
    const pathname = new URL(request.url).pathname;
    set.headers["X-Content-Type-Options"] = "nosniff";
    set.headers["Referrer-Policy"] = "strict-origin-when-cross-origin";
    set.headers["X-Frame-Options"] = "DENY";

    if (pathname === "/health") {
      set.headers["Cache-Control"] = "no-store";
      return;
    }

    // Auth + user data must never be cached by browsers/CDNs.
    if (pathname.startsWith("/api/")) {
      set.headers["Cache-Control"] =
        "private, no-store, max-age=0, must-revalidate";
      set.headers["Pragma"] = "no-cache";
    }
  });
