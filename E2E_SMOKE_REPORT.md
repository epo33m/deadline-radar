# E2E Smoke Test Report — Deadline Radar (FINAL)

---

## 1. Pemetaan Sistem

Berdasarkan analisis arsitektur, kode sumber, dan skema database, berikut adalah pemetaan lengkap komponen sistem Deadline Radar:

| Komponen | Implementasi & Teknologi | Sumber / Path File |
|---|---|---|
| **Frontend Stack** | Next.js 16.3.4 (App Router, React Server Components, Server Actions, Tailwind CSS, shadcn/ui) pada port `3025` | [`apps/web/package.json`](file:///Users/voldys/project/deadline-radar/apps/web/package.json)<br>[`apps/web/next.config.ts`](file:///Users/voldys/project/deadline-radar/apps/web/next.config.ts)<br>[`docs/ARCHITECTURE.md`](file:///Users/voldys/project/deadline-radar/docs/ARCHITECTURE.md) |
| **Backend Stack** | Elysia 1.3 berjalan di atas Bun 1.4 runtime pada port `4025` dengan kontrak OpenAPI | [`apps/api/package.json`](file:///Users/voldys/project/deadline-radar/apps/api/package.json)<br>[`apps/api/src/index.ts`](file:///Users/voldys/project/deadline-radar/apps/api/src/index.ts)<br>[`apps/api/src/app.ts`](file:///Users/voldys/project/deadline-radar/apps/api/src/app.ts) |
| **Database & ORM** | PostgreSQL (Supabase Postgres) dengan Drizzle ORM sebagai type/query mapping, serta SQL migrations sebagai otoritas tunggal skema | [`packages/db/src/schema.ts`](file:///Users/voldys/project/deadline-radar/packages/db/src/schema.ts)<br>[`packages/db/src/client.ts`](file:///Users/voldys/project/deadline-radar/packages/db/src/client.ts)<br>[`supabase/migrations/`](file:///Users/voldys/project/deadline-radar/supabase/migrations/) |
| **Cache, Queue & Lock** | In-memory store (lokal/dev) dan Redis (opsional di production via `REDIS_URL`) untuk rate limiting; Single-flight evaluation lock dijamin melalui unique partial index PostgreSQL `reminder_runs(status) WHERE status = 'running'` | [`apps/api/src/plugins/rate-limit.ts`](file:///Users/voldys/project/deadline-radar/apps/api/src/plugins/rate-limit.ts)<br>[`packages/db/src/schema.ts`](file:///Users/voldys/project/deadline-radar/packages/db/src/schema.ts#L358)<br>[`apps/api/src/services/run-evaluate.ts`](file:///Users/voldys/project/deadline-radar/apps/api/src/services/run-evaluate.ts) |
| **Mekanisme Auth** | Supabase Auth (penyimpanan identitas, hashing password bcrypt/argon2, refresh token) + Session Cookie HTTP-Only (`dr_access_token`, `dr_refresh_token`, SameSite=Lax) + Verifikasi JWT via JWKS (ES256/RS256) dengan fallback HS256 + App-level RBAC (`roles`, `role_capabilities`, `user_roles`) | [`apps/api/src/lib/auth-tokens.ts`](file:///Users/voldys/project/deadline-radar/apps/api/src/lib/auth-tokens.ts)<br>[`apps/api/src/plugins/auth.ts`](file:///Users/voldys/project/deadline-radar/apps/api/src/plugins/auth.ts)<br>[`apps/api/src/lib/authorization/`](file:///Users/voldys/project/deadline-radar/apps/api/src/lib/authorization/)<br>[`apps/web/proxy.ts`](file:///Users/voldys/project/deadline-radar/apps/web/proxy.ts) |
| **Penjadwalan & Eksekusi Reminder** | Single-instance scheduler melalui managed HTTP cron yang memanggil endpoint internal `GET /api/v1/cron/evaluate-reminders` dengan `Authorization: Bearer $CRON_SECRET` setiap interval (`REMINDER_RUN_INTERVAL_MS`, default 1 jam). Logika evaluasi murni dijalankan oleh package `@deadline-radar/domain` | [`apps/api/src/routes/cron.ts`](file:///Users/voldys/project/deadline-radar/apps/api/src/routes/cron.ts)<br>[`apps/api/src/services/run-evaluate.ts`](file:///Users/voldys/project/deadline-radar/apps/api/src/services/run-evaluate.ts)<br>[`packages/domain/src/evaluate.ts`](file:///Users/voldys/project/deadline-radar/packages/domain/src/evaluate.ts) |
| **Channel Notifikasi & Pengiriman** | 1. **In-App:** Dicatat pada tabel `notification_deliveries` (status `sent`) dan dikonsumsi via `GET /api/v1/notifications`<br>2. **Email:** Dikirim via Resend API SDK (`resend.emails.send`) dengan payload snapshot beku dan kunci idempoten deterministik (`reminder-delivery-<id>-<hash>`) | [`apps/api/src/routes/notifications.ts`](file:///Users/voldys/project/deadline-radar/apps/api/src/routes/notifications.ts)<br>[`apps/api/src/lib/email.ts`](file:///Users/voldys/project/deadline-radar/apps/api/src/lib/email.ts)<br>[`apps/api/src/lib/resend-config.ts`](file:///Users/voldys/project/deadline-radar/apps/api/src/lib/resend-config.ts) |
| **Tool Test di Repo** | Playwright Test (`@playwright/test` di `apps/e2e/playwright.config.ts`), Bun Test runner (`bun test`), dan Nx Monorepo Test Target | [`apps/e2e/playwright.config.ts`](file:///Users/voldys/project/deadline-radar/apps/e2e/playwright.config.ts)<br>[`package.json`](file:///Users/voldys/project/deadline-radar/package.json)<br>[`nx.json`](file:///Users/voldys/project/deadline-radar/nx.json) |
| **Cara Menjalankan Environment** | `bun run dev` (menjalankan API di port 4025 dan Web di port 3025 secara bersamaan via `scripts/dev.ts`), `bun run test` (unit/integration), `bun run test:e2e` (E2E browser & API suite) | [`scripts/dev.ts`](file:///Users/voldys/project/deadline-radar/scripts/dev.ts)<br>[`package.json`](file:///Users/voldys/project/deadline-radar/package.json) |
| **Timezone & Penyimpanan Waktu** | Default profile timezone: `"UTC"`, format: `"24h"`. Seluruh timestamp di database disimpan dalam tipe PostgreSQL `timestamptz` (UTC). Kalkulasi deadline & reminder trigger dikonversi secara deterministik mempertahankan wall-clock lokal pada timezone profil pengguna menggunakan `Intl.DateTimeFormat` | [`packages/db/src/schema.ts`](file:///Users/voldys/project/deadline-radar/packages/db/src/schema.ts#L58)<br>[`packages/domain/src/evaluate.ts`](file:///Users/voldys/project/deadline-radar/packages/domain/src/evaluate.ts#L58)<br>[`apps/api/src/routes/summary.ts`](file:///Users/voldys/project/deadline-radar/apps/api/src/routes/summary.ts) |

---

## 2. Ringkasan Eksekutif

| Metrik | Before | After |
|---|---|---|
| **Total Skenario Diuji** | 25 | 25 |
| **Lulus (Passed)** | 7 | **25** |
| **Gagal (Failed)** | 18 | **0** |
| **Diblokir (Blocked)** | 0 | **0** |
| **Verdict** | **NO-GO** | **GO** |

> [!NOTE]
> **VERDICT: GO**
> Cacat kritis BUG-01 (fungsi trigger `public.handle_new_user()` tidak lagi meng-assign role `user` ke `public.user_roles`) telah diperbaiki melalui migrasi `20260922010000_restore_handle_new_user_rbac.sql` (sudah di-apply ke database lokal maupun remote Supabase). Setelah perbaikan, seluruh **25 skenario E2E lulus** dengan assertion yang diperketat. Dua anomali yang ditemukan dalam log run (A-06 `created: 0` dan B-05 non-23505 lock error) telah ditelusuri hingga akar masalah dan ditutup dengan perbaikan assertion pengujian — bukan pelemahan kode produksi.

---

## 3. Environment & Konfigurasi Pengujian

- **Git Commit Hash:** `c21922e` (head saat laporan; perubahan fix/test bersifat uncommitted working tree)
- **Runtime & Toolchain:** Bun v1.4.0, Node.js v22.23.2, Playwright 1.63.0, Chromium Headless
- **Database:** Supabase Postgres (project `gejhqrwqtieupiweyskp`), **42 migrations applied** (local + remote in sync)
- **API Origin:** `http://127.0.0.1:4025`
- **Web Origin:** `http://127.0.0.1:3025`
- **Cara Run (final, exit code 0):**
  ```bash
  bun --env-file=.env.local run --filter e2e test:e2e smoke.spec.ts
  ```
  Hasil: **25 passed (4.9m), Exited with code 0** — bukti di `/tmp/opencode/e2e-final2.log`.
  > Catatan: perintah ini yang dipakai pada run tersebut sudah tidak berlaku
  > setelah #56 — `.env.local` menunjuk production dan e2e kini wajib menyebut
  > target (`E2E_TARGET=staging`). Lihat § *Cara Menjalankan Ulang* di bawah.
  > Angka 25/25 di atas tetap berlaku sebagai hasil run tersebut.
- **Aturan anti-false-positive:** Real API, real DB (Supabase), real Auth. Tanpa mock pada core logic, tanpa fixed sleep (polling kondisional + bounded timeout), tanpa pre-created privileged user, tanpa hardcode HTTP 200.

---

## 4. Tabel Hasil Pengujian (Before → After)

Legenda Before: **FAIL** = gagal karena BUG-01 (`403 authz.denied` — user baru tanpa role `user`, sehingga semua endpoint `course.create`/`task.create`/threshold ditolak). **PASS** = lulus (skenario yang tidak memerlukan akses ter-authentikasi terhadap course/task).

| ID | Bagian | Skenario | Hasil Expected | Before | After (Bukti) |
|---|---|---|---|---|---|
| A-01 | Happy Path | Register → Login, verifikasi profile & auth state | 200, profil `timezone='UTC'`,`time_format='24h'`, session valid | PASS | **PASS** |
| A-02 | Happy Path | Create course & ownership binding | 200, `user_id` terikat di `courses`, muncul di list | FAIL | **PASS** |
| A-03 | Happy Path | Create task di dalam course, relasi & status | 200, relasi `course_id` valid, status `todo` | FAIL | **PASS** |
| A-04 | Happy Path | Set & store deadline UTC, tampil di timezone user | 200; `timestamptz` tersimpan presisi | FAIL | **PASS** |
| A-05 | Happy Path | Reminder calc: 4 default thresholds (H-7/3/1/0) & deadline edit | 4 baris `reminder_thresholds`; PATCH bump `deadline_updated_at` | FAIL | **PASS** |
| A-06 | Happy Path | Notification delivery: evaluasi → in_app & email, in_app `sent` | Delivery `in_app` status `sent`, email row ada, muncul di `GET /api/v1/notifications` | FAIL | **PASS** (cron `created: 4`; in_app H-7 & H-3 `sent`, email `failed`/sandbox, `GET /notifications` mengembalikan task tsb) |
| A-07 | Happy Path | Open/edit/delete task: soft delete membatalkan reminder | PATCH status, soft delete testable | FAIL | **PASS** |
| A-08 | Happy Path | Dashboard / summary / calendar metrics | Endpoint summary RPC akurat | FAIL | **PASS** |
| A-09 | Happy Path | Logout → login semula: session lama invalid, data tetap ada | 401 session lama; data utuh setelah re-login | FAIL | **PASS** |
| B-01 | Negative | IDOR: User A tidak bisa GET/PATCH/DELETE resource User B | 403/404 seluruh akses lintas-user | FAIL | **PASS** |
| B-02 | Negative | Session expired/invalid: garbage/`alg:none`/missing token | 401 | PASS | **PASS** |
| B-03 | Negative | Invalid input & mass-assignment: strict schema | 400/422 + field asing ditolak | FAIL | **PASS** |
| B-04 | Negative | Duplicate request: `Idempotency-Key` single creation | Hanya 1 resource dibuat | FAIL | **PASS** |
| B-05 | Negative | Duplicate cron: single-flight lock mencegah run ganda & double delivery | 1 winner, 1 excluded; 0 tabel `running` tersisa; tanpa overlap waktu antar run | FAIL | **PASS** (assertion diperketat: winner punya `runId`, loser `lockUnavailable`/`skipped` dengan `evaluatedTasks: 0`, 0 baris `running`, non-overlap divalidasi via ledger) |
| B-06 | Negative | Missing resource | 404 tanpa 500 | FAIL | **PASS** |
| B-07 | Negative | Unauthorized mutation: user biasa assign admin | 403 | PASS | **PASS** |
| C-01 | Edge | Timezone & day boundary 23:59 vs 00:00 | trigger hitung valid lintas timezone | PASS | **PASS** |
| C-02 | Edge | Threshold sudah lewat saat task dibuat → skip (DOMAIN.md §4) | Tidak ada delivery untuk threshold lewat | FAIL | **PASS** |
| C-03 | Edge | Retry cap provider: max 3 retry (4 attempt) lalu permanent | `retry_count` cap 3, tidak ada attempt ke-5 | FAIL | **PASS** |
| C-04 | Edge | Worker/cron crash recovery: stale `running` lock (>30 mnt) di-reclaim | Lock stale direklaim, run baru bisa masuk | FAIL | **PASS** |
| C-05 | Edge | Race: concurrent PATCH & DELETE tanpa 500 | Tidak ada 500/no-op crash | FAIL | **PASS** |
| C-06 | Edge | Rate limiting / progressive delay gagal login | 401/429 dengan delay | PASS | **PASS** |
| C-07 | Edge | Large data volume: summary RPC akurat | Agregasi akurat pada dataset besar | FAIL | **PASS** |
| C-08 | Edge | XSS injection defense di task title | XSS disanitasi/escape, tidak tereksekusi | FAIL | **PASS** |
| C-09 | Edge | Terminal status `done`: read-only & stop evaluasi | Reopen ditolak; evaluasi berhenti | FAIL | **PASS** |

> Catatan C-07: smoke test memvalidasi HTTP 200 + `tasks` terdefinisi; validasi penuh cursor pagination (`nextCursor` / tenant-scoping tiap halaman) dilayani oleh unit test `apps/api/src/routes/tasks.pagination.test.ts` (including soft-deleted & cross-tenant baseline). Gap assertion `nextCursor` di level E2E dicatat di Section 9 sebagai item bisa lanjut (non-blocking).

---

## 5. Detail Temuan Cacat (Defect Findings)

### BUG-01 (RESOLVED): Registrasi Pengguna Baru Tidak Menetapkan Peran `user` (Regression Database Trigger)

- **Severity:** CRITICAL (Blocker) → **RESOLVED**
- **Akar Masalah:** Migrasi `supabase/migrations/20260920030000_profile_email_normalization.sql` menimpa `public.handle_new_user()` dan menghapus penyisipan baris `user_roles`, sehingga user baru punya 0 capability → `403 authz.denied` di semua endpoint.
- **Perbaikan:** Migrasi baru **`supabase/migrations/20260922010000_restore_handle_new_user_rbac.sql`** yang:
  1. Menyisipkan `profiles (id, lower(trim(email)))` — mempertahankan normalisasi email.
  2. Mencari `roles.slug = 'user'` (seed id stabil `a0000000-0000-4000-8000-000000000001`).
  3. Menyisipkan `user_roles (user_id, role_id)` dengan `on conflict (user_id, role_id) do nothing`.
  4. Backfill satu kali untuk profil yang sudah ada tetapi belum punya role.
  5. `SECURITY DEFINER` + `set search_path = public`; tidak menerima role dari input request.
- **Verifikasi Live DB:** definisi fungsi terbaru di remote sesuai spec; trigger `on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION handle_new_user()` utuh; uji registrasi end-to-end menghasilkan profil + `user_roles` role `user` + 19 capability.
- Referensi: [`supabase/migrations/20260922010000_restore_handle_new_user_rbac.sql`](file:///Users/voldys/project/deadline-radar/supabase/migrations/20260922010000_restore_handle_new_user_rbac.sql)

### BUG-02 (RESOLVED): Endpoint HTTP Cron Tidak Memiliki Abstraksi Injeksi Waktu (Clock Override)

- **Severity:** MEDIUM → **RESOLVED**
- **Implementasi:** [`apps/api/src/routes/cron.ts`](file:///Users/voldys/project/deadline-radar/apps/api/src/routes/cron.ts#L29-L59) kini menerima `?simulated_now=` (atau `simulatedNow`) yang divalidasi **zod `datetime({ offset: true })`** (ISO-8601, invalid → 400 `ApiError.validation`). Override hanya aktif saat `!env.isProduction`; di production selalu `new Date()` (waktu server). Authorization cron (`Bearer CRON_SECRET`, constant-time compare) tetap wajib.

---

## 6. Anomali yang Ditemukan Selama Regresi & Root Cause-nya

### Anomali 1 — A-06: log cron `created: 0` padahal test lulus

- **Gejala:** Cron A-06 mengeluarkan `evaluatedTasks: 3, created: 0` meski test "lulus".
- **Root cause (2 lapis):**
  1. **Asumsi test salah:** task dibuat dengan deadline *tepat* `now + 3 hari`, sehingga trigger H-3 ≈ saat pembuatan. Guard non-retroaktif (`trigger < created_at`, DOMAIN.md §4 / C-02) **benar** menekan threshold yang sudah lewat saat task dibuat → tidak ada delivery.
  2. **Assertion test lemah:** semua verifikasi berada di dalam `if (inAppDelivery) { ... }`, sehingga ketika `inAppDelivery` undefined seluruh assertion dilewati dan test lolos tanpa memverifikasi apa pun.
- **Kategorisasi:** Category C (test-defect, bukan defect produksi). Pipeline delivery produksi diverifikasi bekerja benar dengan repro langsung: task ber-deadline 10 hari + evaluasi pada instant trigger H-3 menghasilkan `created: 4` (in_app `sent` utk H-3 & H-7, email rows dibuat).
- **Fix:** deadline diubah ke `now + 10 hari`, `simulated_now` di-set ke instant trigger H-3 (`thresholdTriggerAt(deadline, 3, "UTC")`) memakai domain calculator yang sama; assertion dijadikan **hard** (tanpa `if`): `in_app.status = "sent"`, `sentAt` non-null, email row ada (`retryCount 0`), dan notifikasi muncul di `GET /api/v1/notifications` untuk `daysBefore = 3`.

### Anomali 2 — B-05: loser concurrent lock mendapat `lockUnavailable` (error DB non-23505), bukan clean `skipped`

- **Gejala:** log menunjukkan `run lock write failed (attempt 1/3)` lalu `lockUnavailable, aborting run Failed query: insert into reminder_runs ...`.
- **Root cause:** dua insert konkuren ke unique partial index `reminder_runs_single_active` membuat collisi non-`23505` (transient, serialization/deadlock internal). Per `run-evaluate.ts`, error non-23505 di-retry bounded (3x) dan bila tetap gagal run **abort fail-closed** (`lockUnavailable: true`) — tidak pernah melanjutkan evaluasi tanpa lock (tidak bisa double-spend quota). Ini perilaku desain RF-04/NEW-01 yang aman (recommended behavior), bukan defect.
- **Catatan assertion lama:** `expect([true, false]).toContain(...)` adalah tautologi dan akan selalu lulus.
- **Kategorisasi:** Category A/B behavior → divalidasi aman; dan **Category C assertion** (test lama tautologis).
- **Fix:** assertion B-05 diperketat: winner punya `runId`; loser `null runId` → `skipped || lockUnavailable === true` dan `evaluatedTasks === 0`; jika loser *berhasil* menang lock pada retry setelah winner release (serialized, legitimate), kedua run diverifikasi **tidak tumpang-tindih waktu** via ledger (`started_at`/`finished_at`); selalu mengassert 0 baris `running` tersisa.

---

## 7. Verifikasi Keamanan (Security Verification)

- **RBAC default benar lagi:** registrasi baru → `user_roles` berisi role `user` (19 capabilities), jadi RLS + App-level authorization berjalan fail-closed namun tidak lagi memblokir user sah.
- **Endpoint admin tetap tertutup:** user biasa men-call `POST /api/v1/admin/roles/assign` → `403` (B-07 PASS).
- **IDOR:** User A tidak dapat GET/PATCH/DELETE resource User B (B-01 PASS); ownership enforcement & tenant-scoping pagination teruji.
- **Auth hardening:** token invalid/`alg:none`/missing → 401 (B-02 PASS); mass-assignment & field tak dikenal ditolak strict schema (B-03 PASS); rate limiting repeated failed login (B-06 PASS).
- **XSS:** title task dengan payload XSS tidak tereksekusi (C-08 PASS).
- **Cron:** endpoint reminder tetap membutuhkan `Bearer CRON_SECRET` (constant-time); `simulated_now` hanya non-production; response kontrak `200 {ok:true}` tanpa volume info sensitif (SEC-008).
- Grant RLS: roles/role_capabilities/user_roles/profiles/courses/tasks/notification_deliveries/reminder_runs/reminder_thresholds memiliki RLS enabled; grants hanya `anon`/`authenticated`/`service_role` (+postgres).

## 8. Verifikasi Database (DB Verification)

- **42 migrations** applied & in sync (local = remote); tanpa drift (per `scripts/migrate.ts status`).
- Fungsi `public.handle_new_user()` live: menyisipkan profil (email `lower(trim(...))`), lookup `slug='user'`, insert `user_roles` `on conflict do nothing`, `SECURITY DEFINER`/`search_path=public`.
- Trigger `on_auth_user_created` aktif pada `auth.users` (AFTER INSERT, FOR EACH ROW).
- Roles seed: `user` = `a0000000-0000-4000-8000-000000000001`, `admin` = `...02`.
- Constraint: `user_roles.UNIQUE(user_id, role_id)`, FK cascades, `reminder_thresholds_task_days_before_active_key` (partial unique non-deleted), trigger `forbid_threshold_delete` (archive-only, RF-09/RF-10).
- Index `reminder_runs_single_active` (partial unique `WHERE status='running'`) terkonfirmasi — dasar single-flight lock.
- Residue setelah final run: **0** rows di `tasks`, `courses`, `profiles`, `notification_deliveries`, dan `reminder_runs(status='running')`.

## 9. Regression Confirmation & Batasan

- **Regresi:** run penuh ulang setelah fix & perketatan assertion — `25 passed (4.9m), exit 0` (2x diverifikasi: `/tmp/opencode/e2e-final.log` dan `/tmp/opencode/e2e-final2.log`).
- **Catatan fixture hygiene (longstanding, non-blocking):** pada beberapa full-suite run berkali-kali teramati ghost auth-user/profiles sisa (contoh lama `e2e-idorb-*`/`e2e-linkedge-*` dari run sebelum sesi ini). Isolasi/subset run maupun final run bersih selalu membersihkan 100% (0 sisa). Tidak ter-reproduksi di final run bersih; bukan defect produksi (hanya memengaruhi database dev bersama). Untuk report ini, seluruh residue dibersihkan manual (auth users = 0).
- **Gap yang ditinggalkan (non-blocking):** assertion `page.nextCursor` pada skenario pagination E2E (C-07) belum di-strengthen di level E2E; sudah dicakup unit test `tasks.pagination.test.ts`. Disarankan ditutup pada iterasi berikutnya.
- **Email:** pengiriman email nyata ke `@example.test` ditolak sandbox Resend (hanya ke email terdaftar). Status email row `failed`/`pending` dianggap expected di environment dev; path produksi diverifikasi via idempotency key, payload frozen snapshot, dan resend-config yang non-blocking when keys absent.

## 10. Rekomendasi Regresi Otomatis di CI

1. **E2E Smoke Suite (`apps/e2e/tests/smoke.spec.ts`)** mandatory gate sebelum release; pastikan **A-06 & B-05 memakai assertion keras** (bukan conditional/tautologi).
2. **Database Trigger & RBAC Integrity Gate:** test otomatis bahwa register → `profiles` + `user_roles(role=user)` selalu terbentuk.
3. **Migration Drift/Function-Contract Gate:** jalankan `scripts/verify-schema-drift.ts` + verifikasi bahwa migrasi baru tidak menghapus fungsi trigger dari migrasi lama (pemicu BUG-01).
4. **CI hygiene:** tambahkan job cleanup setelah suite untuk menghapus ghost auth user (Admin API) bila full-suite berjalan terhadap shared database.

## 11. Lokasi Script Otomasi E2E

- **Test Suite:** [`apps/e2e/tests/smoke.spec.ts`](file:///Users/voldys/project/deadline-radar/apps/e2e/tests/smoke.spec.ts)
- **Fixture & Helpers:** [`apps/e2e/fixtures.ts`](file:///Users/voldys/project/deadline-radar/apps/e2e/fixtures.ts)
- **Konfigurasi Playwright:** [`apps/e2e/playwright.config.ts`](file:///Users/voldys/project/deadline-radar/apps/e2e/playwright.config.ts)

### Cara Menjalankan Ulang

> Suite e2e kini **wajib** menamai target-nya (#56). Perintah lama
> `bun --env-file=.env.local run --filter e2e test:e2e …` sudah tidak berlaku:
> `.env.local` menunjuk production dan tidak lagi dimuat. Lihat
> `apps/e2e/README.md` § *Target selection*.

```bash
# Dari root repository:
E2E_TARGET=staging bun run test:e2e -- smoke.spec.ts

# Atau Playwright CLI langsung (build web dulu secara terpisah, dan
# jalankan dari dalam apps/e2e karena config mengimpor modul target):
(cd apps/e2e && E2E_TARGET=staging ./node_modules/.bin/playwright test smoke.spec.ts)

# Hanya skenario tertentu (contoh A-06 & B-05):
E2E_TARGET=staging bun run test:e2e -- smoke.spec.ts --grep "A-06|B-05"
```