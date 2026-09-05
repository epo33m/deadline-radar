import { type NextRequest, NextResponse } from "next/server";

/**
 * Supabase email links still hit the web origin. Forward to the API confirm
 * handler so session cookies are set by the backend.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const apiOrigin = process.env.API_ORIGIN ?? "http://127.0.0.1:4025";
  const target = new URL("/api/auth/confirm", apiOrigin);
  searchParams.forEach((value, key) => {
    target.searchParams.set(key, value);
  });
  return NextResponse.redirect(target);
}
