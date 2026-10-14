#!/usr/bin/env bun
/**
 * Docs-language guard (English-only mandate).
 *
 * Fails when non-archived Markdown docs contain Indonesian prose.
 * Historical audit/sign-off reports are exempt: any file carrying the
 * "original language preserved" marker is skipped.
 *
 * Usage:
 *   bun run check:docs-language
 *
 * Runs in feature CI (`ci-dev.yml`). See CONTRIBUTING.md.
 */

import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const ARCHIVE_MARKER = "original language preserved";
const MAX_HITS = 2;

// Common Indonesian words with (practically) no English collision.
// Deliberately excludes ambiguous ones (dan, pada, atau, ini, status,
// target, format, versi …) to avoid false positives.
const STOPWORDS = [
  "yang", "untuk", "dengan", "adalah", "tidak", "dari", "sebagai",
  "serta", "dalam", "telah", "sudah", "juga", "harus", "wajib",
  "setiap", "semua", "bukan", "oleh", "saat", "jika", "kalau",
  "karena", "tetapi", "namun", "kemudian", "panduan", "dokumen",
  "rilis", "catatan", "tambah", "ubah", "hapus", "perlu", "hanya",
  "masih", "belum", "pengaturan", "menjadi", "berikut", "contoh",
  "aturan", "deskripsi", "langsung", "menyimpan", "silakan", "lihat",
  "terima kasih",
];

const pattern = new RegExp(`\\b(${STOPWORDS.map(escape).join("|")})\\b`, "gi");

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function trackedMarkdown(): string[] {
  const out = execSync(`git ls-files "*.md"`, { cwd: rootDir, encoding: "utf8" });
  return out.split("\n")
    .map((s) => s.trim())
    .filter((f) => f.length > 0
      && !f.includes("node_modules")
      && !f.startsWith("graphify-out/")
      && !f.startsWith(".agents/"));
}

let failed = false;
for (const file of trackedMarkdown()) {
  const text = readFileSync(join(rootDir, file), "utf8");
  if (text.includes(ARCHIVE_MARKER)) continue;
  const matches = text.match(pattern) ?? [];
  if (matches.length > MAX_HITS) {
    failed = true;
    console.error(`❌ ${file}: ${matches.length} Indonesian hits (max ${MAX_HITS})`);
    const lines = text.split("\n");
    let shown = 0;
    lines.forEach((line, i) => {
      if (shown >= 5) return;
      pattern.lastIndex = 0;
      if (pattern.test(line)) {
        shown++;
        console.error(`   L${i + 1}: ${line.trim().slice(0, 120)}`);
      }
    });
  }
}

if (failed) {
  console.error("\nFix: write docs in English, or mark a frozen historical file with the archive header (see AGENTS.md).");
  process.exit(1);
}
console.log("✅ Docs language OK: non-archived Markdown is English.");
