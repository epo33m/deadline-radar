"use client";

import { useEffect } from "react";

/**
 * Root error fallback (W6). Next renders this when the app shell itself
 * fails — it must be self-contained (<html>/<body> included) and never
 * depend on app providers. Offers a retry; the error is also reported to
 * the console (and Sentry when configured) with its digest.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[web] global error", error.digest ?? "", error);
  }, [error]);

  return (
    <html lang="en">
      <body>
        <main
          style={{
            minHeight: "100vh",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 24,
            textAlign: "center",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 600 }}>
              Something went wrong
            </h1>
            <p style={{ marginTop: 8, opacity: 0.7 }}>
              The app hit an unexpected error.
              {error.digest ? ` ref: ${error.digest}` : null}
            </p>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                marginTop: 16,
                padding: "8px 20px",
                borderRadius: 999,
                border: "1px solid currentColor",
                background: "transparent",
                cursor: "pointer",
              }}
            >
              Try again
            </button>
          </div>
        </main>
      </body>
    </html>
  );
}
