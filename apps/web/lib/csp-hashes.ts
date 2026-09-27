/**
 * Static-page CSP hashes (SEC-002, hash variant).
 *
 * GENERATED FILE — do not edit by hand. Produced by
 * `apps/web/scripts/build-csp-hashes.ts` during `bun run build`
 * (double-build: build → hash → build → verify).
 *
 * Maps a prerendered-static pathname to the SHA-256 hashes of its inline
 * `<script>` / `<style>` blocks. `proxy.ts` serves these pathnames with a
 * hash-based CSP (no per-request nonce, no `x-nonce`), which keeps the
 * pages static and edge-cacheable without weakening the policy:
 * hashes are as strong as nonces for content that is byte-identical on
 * every serve — exactly what a prerendered page is.
 *
 * An EMPTY map is the safe fallback: `proxy.ts` treats a pathname with no
 * entry as dynamic and uses the nonce path. A stale map would break page
 * scripts, so the build `--verify` step fails the build on any drift
 * instead of deploying it.
 */

export type StaticCspHashes = {
  scripts: string[];
  styles: string[];
};

/** Pathname → hashes. Empty until the build generator fills it. */
export const STATIC_CSP_HASHES: Record<string, StaticCspHashes> = {};
