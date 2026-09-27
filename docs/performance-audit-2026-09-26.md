# Performance Audit + Remediation — Deadline Radar

**Tanggal:** 2026-09-26
**Mode:** evidence-backed audit + implementasi (bukan read-only)
**Cakupan:** `apps/web` (Next.js 16.3.4), `apps/api` (Elysia/Bun), `packages/db` (Drizzle), topologi prod (Vercel + Railway + Supabase + Upstash)
**Pemicu:** keluhan "sangat lambat" pasca-deploy pertama
**Dokumen terkait:** `docs/performance-audit-2026-09-20.md` (P1/P2/P3 — sudah dikerjakan, §10–10c `PROD_ENV_CHECKLIST.md`), `docs/audit/archive/caching-data-fetching-audit.md` (HI-1 — sudah dikerjakan)

> Prinsip: setiap temuan wajib **Located** (`path:line`), **Explained** (mekanisme biaya), **Sized** (terukur), **Fixable** (perubahan spesifik). Angka baseline di §2 adalah hasil probe langsung ke prod dari vantage ≈ Jakarta (~40ms ke edge Singapore).

---

## 1. System map (aktual, terverifikasi 2026-09-26)

| Komponen | Lokasi (hasil verifikasi) | Cara verifikasi |
|---|---|---|
| Web function (Vercel) | `iad1` (Virginia, USA) — Hobby, terkunci | header `x-vercel-id: sin1::iad1::…` konsisten |
| API (Railway) | `sfo` → **dipindah ke US East** (Fase B) | `railway status` → `region: US East` |
| DB (Supabase) | `aws-0-ap-southeast-2` = **Sydney** → target `us-east-1` (Fase B, pending) | `DATABASE_URL` di `.env.production` |
| Redis (Upstash) | region tak terenkode; ~180ms dari Virginia → target US East (Fase D, pending) | `[perf]` split §2 |

Alur request: Browser (ID) → Vercel edge `sin1` → function `iad1` → Railway → Supabase/Upstash. Tiga benua per navigasi.

---

## 2. Baseline terukur (sebelum perbaikan)

Vantage ≈ Jakarta. Ulangi kapan saja: `sh scripts/perf-probe.sh` (Fase A).

| Probe | TTFB | Yang diisolasi |
|---|---|---|
| API `GET /health` (JSON statis, tanpa DB/Redis) | 307–392ms | edge `sin1` → container `sfo` |
| API `GET /openapi` (statis) | 309–322ms | idem |
| API `GET /health/cron` (1 query DB Sydney) | **1010–1772ms** | + RTT SFO↔Sydney |
| API `GET /api/v1/summary` tanpa token (401) | 790–808ms | + Redis `INCR` |
| Web `GET /login` (didokumentasi static) | 435–464ms + `x-vercel-cache: MISS` | edge → `iad1`, SSR tiap request |

Server-side (log `[perf]` pasca-deploy, container US East):

| Endpoint | Server time | Atribusi |
|---|---|---|
| `GET /health` | **1ms** | app murni — container TIDAK CPU-starved |
| `GET /api/v1/summary` 401 | **181ms** | Redis `INCR` jauh (satu-satunya biaya) |
| `GET /health/cron` | 458–637ms (2146ms cold) | Redis + 1–2 query Sydney |

Railway metrics (edge, 6h, pre-move): p50 188ms / p90 673ms / p95 1447ms.

**Kesimpulan baseline:** compute ≈ 1ms. Hampir semua latensi adalah geografi: SFO↔Sydney ~180ms/RTT, Redis ~180ms/op, `iad1` ~250ms/hop. Audit 2026-09-20 mengoptimasi jumlah round trip (benar), tetapi biaya per round trip-nya tidak pernah diukur.

### 2b. Sesudah — parsial (2026-09-27, Supabase us-east-1 live; Upstash masih APAC)

Server-side `[perf]` (container US East):

| Endpoint | Sebelum (SFO→Sydney) | Sesudah (US East→us-east-1) |
|---|---|---|
| `GET /health` | 1ms | **0–2ms** |
| `GET /health/cron` (Redis + DB) | 458–637ms | **487–488ms warm** (1613ms cold) |
| `GET /api/v1/*` 401 (Redis saja) | 181ms | **174ms** (tak berubah — Upstash masih jauh) |

`/login` (Vercel): 435–500ms MISS → **~230–330ms HIT** (`age` naik, hash-CSP tanpa nonce, `s-maxage=3600`).

Bacaan: pindah Supabase menghemat ~150–200ms di path DB, tetapi **Redis (~174ms) kini biaya server-side dominan** — gate Upstash→US East (§7.2) diproyeksi memangkasnya ke ~5–15ms, membawa `/health/cron` ke ~50–80ms.

### 2c. Transport comparison — TCP vs REST (2026-09-27, keduanya us-east-1)

DB Upstash baru (`flexible-ghost-305441`, console: N. Virginia / us-east-1) diuji
dua transport dari container Virginia:

| Transport | 401 warm (`INCR` saja) | Cold (connect) |
|---|---|---|
| ioredis TCP (`rediss://…:6379`) | **122–124ms stabil** | ~420ms |
| @upstash/redis REST | **121–136ms stabil** | ~322ms |

Identik → overhead BUKAN di transport atau region, melainkan di path
(Railway egress → Upstash gateway, ~120ms tetap). Proyeksi ~5–15ms GAGAL.
Opsi: (a) terima 120ms (masih 60ms lebih baik dari 181ms APAC); (b) Redis
plugin Railway (private network, ~1ms, berbayar) — keputusan pemilik.

---

## 3. Findings (ranked) + status

### [R1] API dan DB beda benua — DONE (Railway), PENDING (Supabase)

**Where** infra (bukan kode): Railway `sfo` vs Supabase `ap-southeast-2`.
**Cost** ~180ms per DB RTT; `/health/cron` 1010ms untuk 1 query.
**Fix** Railway → US East via CLI (`railway service scale us-east=1` + `sfo=0`, single replica dipertahankan). Supabase → project baru `us-east-1` (DB prod masih 0 tasks/deliveries/runs — migrasi = project baru + 41 migrasi + `verify-prod.sql`, tanpa backfill).
**Verify** `[perf] GET /health/cron`: 458ms → target ~150–250ms setelah Supabase pindah (Redis + query lokal Virginia).

### [R2] Vercel Hobby terkunci `iad1` — ACCEPTED (plafon)

**Where** `x-vercel-id: sin1::iad1::…`.
**Cost** ~400–500ms tak terhapuskan (edge `sin1` ↔ eksekusi `iad1`) untuk user Asia.
**Fix** Tidak ada di Hobby. Opsi struktural (ditolak untuk sekarang, lihat §6): pindah web ke Railway satu region dengan API, atau upgrade Vercel untuk pin `sin1`.

### [R3] Nonce per-request mematikan static rendering — DONE

**Where** `apps/web/proxy.ts:171,199-200` + `export const dynamic = "force-dynamic"` di 4 halaman (`app/page.tsx`, `app/(app)/login|register|forgot-password/page.tsx`).
**Cost** `/login` (19KB, statis secara konten) = 435–464ms + `x-vercel-cache: MISS` tiap hit; `Cache-Control: private, no-cache, no-store`.
**Fix** Hash-CSP (§4). SEC-002 tetap: tidak ada `unsafe-inline`, framing/object/base/form locks identik (diuji di `lib/security-headers.test.ts`).
**Verify** lokal (`next start`): `/login` → `script-src 'self' 'sha256-…' 'sha256-…' 'strict-dynamic'`, `Cache-Control: s-maxage=31536000`, hash HTML cocok dengan header (skrip dijamin jalan), 0 referensi nonce. `/tasks` tetap nonce-path.

### [R4] Redis `INCR` di hot path tiap `/api/*` — DONE (kode), PENDING (region)

**Where** `apps/api/src/plugins/rate-limit.ts:142` (via `getRedis()`, ioredis TCP).
**Cost** 181ms server-side per API call (diukur `[perf]` pada 401, tanpa DB).
**Fix**
- Kode: `withRedisTimeout` (`apps/api/src/lib/redis.ts`, default 250ms via `REDIS_TIMEOUT_MS`) + fallback bucket memory + warn; `pexpire` best-effort (sebelumnya bisa 500). Postur sama dengan Redis down (Finding #9).
- Infra (pending): Upstash DB → US East. Ekspektasi 181ms → ~5–15ms.
**Verify** `[perf]` pada 401 pasca-pindah; test `rate-limit.store.test.ts` (slow/throwing/fast).

### [R5] 3 API call per navigasi dingin, nol cache — DONE (bootstrap + cache)

**Where** `apps/web/lib/api/server.ts:130` (`no-store`), tiap page `requireSession()` + 2 call data.
**Cost** 3× (Redis + JWT + authz + DB) per halaman; `/tasks` = session + courses + tasks.
**Fix**
- `GET /api/v1/bootstrap` (`apps/api/src/routes/bootstrap.ts`): `{user, courses (cap 200), summary, progress}` dalam 1 call + 1 batch paralel. Kapabilitas = gabungan 3 endpoint, fail closed. `pendingEmail: null` (tak ada konsumen web; status email-change tetap di `/session` yang kontrak+test-nya tak tersentuh).
- Web: `lib/api/bootstrap.ts` (`getBootstrap` React-cache + `requireBootstrap`), `lib/api/session.ts` diturunkan dari bootstrap (1 call untuk SEMUA halaman termasuk settings/learn), 6 halaman + layout dimigrasi. `lib/summary/load.ts` (+test) dihapus — tak terpakai.
- Cache API per-user 30s (`apps/api/src/lib/bootstrap-cache.ts`, `BOOTSTRAP_CACHE_TTL_MS`, 0 = mati): hit → 0 query DB. Eviksi via SATU hook global (`plugins/bootstrap-cache.ts`): mutasi 2xx terautentikasi → evict; over-evict hanya buang refetch. Pola sama dengan `authorization/cache.ts`.
**Verify** test: `bootstrap.test.ts` (401/403/shape/UTC-fallback/cache-hit tanpa DB), `bootstrap-cache.test.ts` (TTL/isolasi/hook POST-tanpa-status/GET tak evict/error tak evict); OpenAPI coverage hijau.

### [R6] Bundle — BASELINE DICATAT, split DITAHAN

**Where** `motion`, `lucide-react`, `@base-ui/react`.
**Sized** total client chunks 2.0MB (~500KB gzip); chunk bersama terbesar 167KB gzip. `motion` diimpor **di mana pun** → dihapus dari `apps/web/package.json`.
**Fix** `@next/bundle-analyzer` terpasang (`ANALYZE=true`). `dynamic()` split DITAHAN sampai angka per-route menuntutnya (sesuai audit 2026-09-20 P3).

### [R7] Perceived speed — DONE (parsial)

**Where** hanya `summary/loading.tsx` yang ada.
**Fix** skeleton `loading.tsx` untuk tasks, tasks/[id], courses, courses/[id], calendar (pola sama: `animate-pulse`, `aria-busy`).

---

## 4. Desain hash-CSP (catatan implementasi)

- 4 halaman prerender static (build membuktikan `○ /`, `/login`, `/register`, `/forgot-password`; `/reset-password` tetap `ƒ` karena butuh session — benar).
- Tiap halaman = 2 inline `<script>`, 0 inline `<style>` (Turbopack).
- `scripts/build-csp-hashes.ts`: ekstrak → SHA-256 → tulis `lib/csp-hashes.ts`; `--verify` gagalkan build bila drift.
- Double-build diperlukan karena payload menyematkan build ID → `generateBuildId` deterministik (`next.config.ts`: `VERCEL_GIT_COMMIT_SHA` → `git rev-parse HEAD` → `"local-dev"`). `--verify` MEMBUKTIKAN kedua build identik, bukan asumsi.
- `proxy.ts`: pathname ada di map + hash non-kosong → CSP hash, tanpa nonce, tanpa `x-nonce`. Map kosong (dev/`next build` polos) → jalur nonce (fail-closed ke aman).
- **Butuh aksi dashboard:** Vercel Build Command `next build` → `next build && bun scripts/build-csp-hashes.ts && next build && bun scripts/build-csp-hashes.ts --verify` (sama dengan `bun run build`).

---

## 5. Proyeksi angka (dijumlah dari komponen terukur)

Per navigasi dingin `/tasks` (2 call: bootstrap + tasks list), pasca-semua-fase:

| Komponen | Sebelum | Sesudah |
|---|---|---|
| Vercel edge→`iad1` (tak tersentuh, R2) | ~250ms | ~250ms |
| `iad1`→API (Railway US East) | ~50ms (sfo) | ~10ms |
| Redis/op (Upstash US East) | ~180ms | ~10ms |
| DB RTT (Supabase us-east-1) | ~180ms | ~10ms |
| API calls per nav | 3 | 1–2 (+ cache 30s) |
| `/login` TTFB Jakarta | ~450ms | ~50–100ms (edge cache SIN) |

Estimasi TTFB `/tasks`: ~1.2–1.5s → ~350–450ms. Sisa dominan = hop `iad1` (R2, struktural di Hobby).

---

## 6. Keputusan yang ditolak / diterima tertulis

| ID | Keputusan | Rasional |
|---|---|---|
| R2-accepted | Hop `iad1` diterima sebagai plafon | Hobby terkunci; pindah web off-Vercel ditolak (biaya hosting + kehilangan CDN) |
| C-unsafe | `unsafe-inline` untuk halaman static DITOLAK | Melemahkan SEC-002 di halaman login (pencurian kredensial); hash setara nonce tanpa biaya keamanan |
| E-pendingEmail | `getUser` Supabase TIDAK dihapus dari `/session` | Kontrak teruji (`auth.routes.test.ts:1210`); tak ada konsumen web tapi perubahan perilaku di luar scope |
| F-eviction | Eviksi hook global, bukan per-route | 12+ call site rawan lupa; hook mencakup mutasi masa depan otomatis |
| G-split | `dynamic()` split DITAHAN | Tunggu angka per-route dari analyzer (P3 audit lama) |

---

## 7. Gates yang masih butuh manusia (dashboard)

1. **Supabase:** project baru `us-east-1` → berikan 5 nilai (pooler `DATABASE_URL`, `SUPABASE_URL`, anon, service_role, JWT secret) → `bun run db:migrate` + `db:verify` + `verify-prod.sql` §1–§5 → update ENV-API/ENV-WEB → redeploy → re-probe. Konsekuensi: user daftar ulang.
2. **Upstash:** DB Redis → region US East (atau buat baru + ganti `REDIS_URL`).
3. **Vercel:** Build Command → rantai double-build (§4). `API_ORIGIN` tetap (domain Railway tak berubah pindah region).
4. Re-probe (`sh scripts/perf-probe.sh`) + catat di tabel §2 sebagai kolom "sesudah".

*Catatan mode: semua perubahan kode di atas sudah diuji (API 553 pass excl. 9 real-DB yang gagal juga di tree bersih; web 177 pass; typecheck+lint+build hijau) tetapi BELUM di-push — deploy menunggu gates §7 + keputusan rilis pemilik.*
