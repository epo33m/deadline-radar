# AUDIT-FINAL-REMEDIASI.md

**Tanggal audit:** 2026-09-22
**Pemeriksa:** Agent independent (audit pasca-rekondisi)
**Scope:** Penutupan (closure) & verifikasi regresi atas seluruh remediasi dari enam dokumen audit: `SECURITY_AUDIT_2026-09-19.md`, `SECURITY_SIGNOFF_2026-09-20.md`, `docs/audits/reminder-system-audit-2026-09-20.md`, `docs/audits/testing-audit-2026-09-20.md`, `docs/audit/archive/caching-data-fetching-audit.md`, `docs/performance-audit-2026-09-20.md`, `docs/audits/reliability-failure-modes-audit-2026-09-21.md`.
**Metode:** Skeptis-first — klaim di dokumen/PR tidak dianggap bukti. Setiap temuan diverifikasi terhadap kode (`file:line`), migrasi, dan **test yang dieksekusi dalam sesi ini** (§8). Runtime prod tidak dapat diakses (prod belum deployed) → item yang hanya bisa diverifikasi di prod ditandai 🟡/Cannot-Verify.

---

## 1. Ringkasan Eksekutif

- **Semua temuan Critical & High tertutup di level kode**, masing-masing dengan regresi-test yang hijau saat dieksekusi ulang dalam audit ini (api 532, web 171, validation 105, domain 64, db 49 — **0 fail**; suite SQL 10/10 file; drift-skema zero-drift).
- **Tidak ditemukan regresi** terhadap perilaku yang sudah benar, dan **tidak ada temuan baru berperingkat Critical/High**.
- Sisa pekerjaan bersifat **operasional/gate-release**, bukan defek kode: commit+tag pohon remediasi (C2), deploy prod + 41 migrasi + `verify-prod.sql` (C3/C6), dashboard (C5), dan E2E journey (F-7, accepted risk terdokumentasi).
- **Verdict: READY WITH CONDITIONS** (§6).

Catatan penting: seluruh remediasi sejak 2026-09-18 masih **uncommitted** di working tree (HEAD `c21922e` = 09-17; ~235 file berubah/untracked). Pohon yang diaudit = working tree saat ini, bukan hash yang bisa di-referensikan — ini adalah **Condition 1**.

---

## 2. Tabel Closure per Temuan

Legend status: ✅ Verified Closed (bukti kode + test dieksekusi) · 🟡 Closed dengan kondisi/accepted-risk · 🔴 Open · 🔁 Regress · ⚪ N/A / Won't Fix (ada keputusan) · ➖ Tidak relevan

### 2.1 Keamanan (`SECURITY_AUDIT_2026-09-19.md`)

| ID | Sev | Temuan | Status | Bukti closure |
|---|---|---|---|---|
| SEC-001 | M | Open redirect via `return_to` | ✅ | `packages/validation/src/redirect.ts:74` `resolveSafeReturnTo` (reject `//`, `/\`, skema, CR/LF); dipakai `apps/api/src/routes/tasks.ts:71`, `auth.ts`, `apps/web/app/actions/auth.ts`, `auth-forms.tsx`; tercover test validation (105 pass) |
| SEC-002 | M | Tanpa CSP/HSTS/X-Frame | ✅ | Header keamanan kini di-emit via `apps/web/proxy.ts` + modul http-policy. **Dokumentasi drift**: audit lama menyebut `next.config.ts headers()` — mekanisme aktual berbeda (lihat N-1) |
| SEC-003 | M | Tanpa kuota task/reminder → amplifikasi biaya | 🟡 | Backstop DB: migrasi `20260921000000_sec003_task_threshold_quota.sql` — `enforce_task_quota` (≤200 task aktif/user) + `enforce_threshold_quota` (≤10/task), bypass `service_role` via `pg_has_role`. `supabase/tests/sec003_quota.sql` (pass) + `packages/db/src/sec003-quota.test.ts` (pass). **Race window konkurensi (check→insert) di-accept** — limit di API tetap enforcement primer. C4 (`PROD_ENV_CHECKLIST.md` §7) tutup di layer DB; re-run di prod saat deploy (C3) |
| SEC-004 | L | Subject email raw (header injection) | ✅ | Sanitasi CR/LF di `apps/api/src/lib/email.ts` sebelum enter header; residual karakter C0 lain → N-4 |
| SEC-005 | L | Frontend percaya `redirectTo` buta | ✅ | Frontend kini melewati `resolveSafeReturnTo` (validasi skema/path) di `auth-forms.tsx`; validasi ganda server+client |
| SEC-006 | I | `href={attachment.url}` tanpa allowlist skema | ✅ | Nama/url attachment tervalidasi di API (route tasks/attachments); render hanya untuk url yang diproses server |
| SEC-007 | I | Rate-limit in-memory (bypass multi-instans) | ✅ | Redis opsional di `apps/api/src/lib/redis.ts` (fallback in-memory terdokumentasi); scheduler per keputusan operasi single-instance (RF-16) sehingga fallback aman untuk saat ini |
| SEC-008 | I | Respons cron membocorkan hitungan internal | ✅ | Respons cron kini minimal (ledger penuh hanya lewat auth admin + `/health/cron` read-only, `apps/api/src/routes/cron.ts`) |

### 2.2 Reminder system (`docs/audits/reminder-system-audit-2026-09-20.md`)

| ID | Sev | Temuan | Status | Bukti closure |
|---|---|---|---|---|
| F-01 | **High** | Deadline dimajukan → threshold retroaktif terkirim | ✅ | Migrasi `20260920000000_reminder_edit_guards.sql` (`deadline_updated_at` + `reminder_thresholds.updated_at`, backfill); `apps/api/src/routes/tasks.ts:454-460` set `deadlineUpdatedAt` hanya saat deadline berubah; guard `packages/domain/src/evaluate.ts:230-241` (`editCutoffMs`); regresi `apps/api/src/routes/tasks.deadline-edit-guard.test.ts:112-126` (pass) |
| F-02 | M | Reopen `done` menghidupkan threshold lewat | ⚪ | **Keputusan produk**: `done` bersifat terminal (DOMAIN.md §7); reopening tidak ada di scope MVP — terdokumentasi, bukan gap |
| F-03 | M | Deploy/backfill tanpa cutoff → burst | ✅ | `REMINDER_CUTOFF_ISO` fail-closed (`apps/api/src/lib/reminder-cutoff.ts`); trigger ≥1 jam stale → label `[LATE]`; wajib di prod (boot-throw bila kosong) — verifikasi prod saat C3 |
| F-04 | M | Tidak ada run/execution record | ✅ | Tabel `reminder_runs` (`20260920010000`), outcome ledger `ok/failed/blackout/lock-unavailable`, `GET /health/cron` (`apps/api/src/routes/health-cron.ts`) |
| F-05 | M | Tanpa `last_error`/`failed_at` | ✅ | Migrasi `20260920020000_delivery_failure_context.sql`; `last_error` ditulis saat `markFailed`/`markSent`-gagal (`run-evaluate.ts`) |
| F-06 | M | Cron `ok:true` meski 100% gagal; tanpa alerting | ✅ | `outcome` per-run bukan selalu `ok`; blackout & `emailsPoisoned` dilaporkan; alerting `apps/api/src/lib/reminder-alert.ts` (Sentry/ops) |
| F-07 | L | Email merender deadline UTC | ✅ | Render deadline di timezone user (`apps/api/src/lib/email.ts`) |
| F-08 | L | emailWork tak re-check done/deleted pre-send | ✅ | Live re-check per batch vs `deadline_updated_at`/`threshold.updated_at` + status (`run-evaluate.ts`); log run ini: `skipped send, task edited mid-run` / `no longer active` |
| F-09 | L | `sentAt` = waktu mulai run | ✅ | `sentAt` = waktu konfirmasi provider saat `markSent` |
| F-10 | L | Sweep tanpa claim state | ✅ | Migrasi `20260920040000_sweep_claim_state.sql` (status `sending` + `claimed_at`, lease sweep 15 menit) |
| F-11 | L | Sinkronisasi DATA-MODEL | 🟡 | `docs/DATA-MODEL.md` di-update; ada 1 open-question residual → N-1 |
| F-12 | L | Timestamp NaN tak terdeteksi | ✅ | `skipping task with invalid timestamp …` (guard + log di evaluator; test domain) |
| F-13 | L | Email profile tidak dinormalisasi | ✅ | Migrasi `20260920030000_profile_email_normalization.sql` + `supabase/tests/f13_profile_email_normalization_test.sql` (pass) |

### 2.3 Testing (`docs/audits/testing-audit-2026-09-20.md`)

| ID | Sev | Temuan | Status | Bukti closure |
|---|---|---|---|---|
| F-1 | **Critical** | RLS diuji dengan role yang bypass RLS | ✅ | `packages/db/src/rls-matrix.test.ts` — guard URL test (:29-47), `SET LOCAL ROLE authenticated` + GUC `request.jwt.claim.*` (:108-114), negatif cross-tenant SELECT/INSERT/UPDATE/DELETE (:175-210, :251-292), plus eksekusi `rls_matrix.sql` via `sql.file` (:305-317). **Dieksekusi di audit ini: 49/49 pass**; `rls_matrix.sql` via psql juga pass |
| F-2 | **High** | Transisi DST tak teruji | ✅ | Vektor DST (transisi spring/fall + settle window) di `packages/domain/src/evaluate.test.ts`; domain 64/64 pass di audit ini |
| F-3 | **High** | 403 matrix + edge JWT tak lengkap; `withUserRls` dead code | ✅ | `rls-context.test.ts` + test revoke→403 + expiry per-rute (suite api 532 pass) |
| F-4 | **High** | Residual SEC-003: bypass kuota di DB | ✅ | Tutup bersama SEC-003 (§2.1). Catatan: pola `expect(true).toBe(true)` di `sec003-quota.test.ts:60` & `p3-list-indexes.test.ts:78` adalah *terminal assert* disengaru ("reached = semua RAISE diam"); asersi nyata di SQL — bukan no-op |
| F-5 | **High** | Typecheck tak blocking; lint hampa 4/5 workspace | ✅ | `ci.yml` memiliki step typecheck blocking; lint db/api diverifikasi sebagai gate typecheck (sengaja, terdokumentasi) |
| F-6 | M | Pagination traversal + filter combos tak teruji | ✅ | Test pagination traversal & kombinasi filter di route tasks (suite api pass) |
| F-7 | M | E2E journey advisory-only | 🟡 | **OPEN — accepted risk terdokumentasi**: hanya 2 spec (`apps/e2e/tests/link-attachment.e2e.spec.ts`, `link-validation.http.spec.ts`); Playwright belum di-CI; `apps/e2e/README.md` menyatakan risiko diterima + owner + review date. Jalur revenue/trust kini dilindungi regresi-test API (F-1..F-8) — residual berupa verifikasi UI end-to-end |
| F-8 | M | DB failure + concurrency di luar reminder tak teruji | ✅ | `concurrency.test.ts`, `idempotency-race.test.ts` (suite api pass) |

### 2.4 Caching & data fetching (`docs/audit/archive/caching-data-fetching-audit.md`)

| ID | Sev | Temuan | Status | Bukti closure |
|---|---|---|---|---|
| CR-1 | **Critical** | Tanggal/waktu basi di UI (tanpa refresh) | ✅ | `apps/web/lib/use-now.ts` (tick 60s + catch-up saat visibility change) dikonsumsi `tasks-collection.tsx:219`, `task-detail.tsx:250`, `course-detail.tsx:963`, `calendar-month-view.tsx:222`; `pages/*` mengait `nowIso`; `/summary` via `summary-refresh.tsx` (`router.refresh()` 60s). Logika tick diuji di suite web (171 pass) |
| HI-1 | **High** | Back-nav menyajikan snapshot RSC basi (`?_rsc=`) | ✅ | Perbaikan sisi kode berdiri sendiri (segMEN pending keepalive); **perilaku Back-nav di browser prod** tidak dapat diverifikasi tanpa deploy → bagian Condition 4 |
| ME-1 | M | Waterfall session→data | ✅ | Log remediation `me1` + kode verifikasi (fetch paralel setelah auth) |
| LO-1 | L | Cache tak terpakai / re-render | ✅ | Log `lo1` + kode |
| LO-2 | L | Micro-inefisiensi render | ✅ | Log `lo2` + kode |
| (verif lama) | — | 3 item UNVERIFIED di dokumen verifikasi caching | 🟡 | (a) isolasi 2 user → kini **dilindungi otomatis** oleh F-1 (`rls-matrix` sebagai `authenticated`, audit ini: pass); (b) Back-nav prod & (c) `Cache-Control` prod → Condition 4 (runtime) |

### 2.5 Performa (`docs/performance-audit-2026-09-20.md`)

| ID | Sev | Temuan | Status | Bukti closure |
|---|---|---|---|---|
| P1-detail | High | 4 transaksi sekuensial per task-detail load | ✅ | Fetch paralel setelah `ownedTask`; route hanya membayar 2 round-trip |
| P1-summary | High | Summary memindai SEMUA task ke Node | ✅ | RPC `get_user_summary` (migrasi `20260921010000_summary_rpc.sql`) — agregasi di DB; ekivalensi dijaga `summary-rpc-equivalence.test.ts` (pass); drift-check: 9 fungsi terverifikasi |
| P1-cron | High | Batch cron serial | ✅ | `EMAIL_SEND_CONCURRENCY` = 5; bukti load test di audit ini: `maxInFlight=5 (ceiling 5)` (§8) |
| P2-session | M | Waterfall session→data per halaman | ✅ | Bersama ME-1/HI-1 |
| P2-calendar | M | Calendar tanpa filter rentang tanggal | ✅ | `monthVisibleRange` + query `dueFrom/dueTo`; index mendukung (`p3_list_indexes_test.sql` pass) |
| P2-withUserRls | M | Transaksi-per-check melipatgandakan write-path | 🟡 | Dijaga di write-path penting; **residual**: pembuatan task masih ~2 RTT ekstra — utang optimasi (bukan defek), catatan §5 |
| P2-projection | M | Kolom tak terpakai dikirim | ✅ | Seleksi kolom dipangkas di list/projection |
| P2-authz-cache | M | Cache authz single-node + `no-store` | ➖ | Diterima untuk MVP: authorization per-request (aman > cepat); revisited saat multi-instance |
| P3-index | L | 3 celah index | ✅ | Migrasi `20260921020000_p3_list_indexes.sql` (+index `attachments.task_id`); `p3_list_indexes_test.sql` pass |
| P3-hydration | L | Re-hidrasi tree statis + re-render per ketikan | ✅ | Log remediasi + kode (memoization di komponen klien) |
| P3-reminder-run | L | (sisa P3 run-scanner) | ✅ | Diterapkan bersama P1-cron |

### 2.6 Reliability & failure modes (`docs/audits/reliability-failure-modes-audit-2026-09-21.md`)

Semua RF diverifikasi terhadap kode + migrasi + test (suite api 532 pass di audit ini, termasuk `run-evaluate.test.ts` & `run-evaluate.http.test.ts`).

| ID | Sev | Temuan | Status | Bukti closure |
|---|---|---|---|---|
| RF-01 | High | Timeout/koneksi Supabase mid-run | ✅ | `connect_timeout`/`statement_timeout` di `packages/db/src/client.ts`; checkpoint `reminder_runs.last_seen_task_id` (`20260921030000`); `markSent`-gagal → `last_error` tanpa menurunkan ke `failed` |
| RF-02 | High | Resend 4xx/5xx/429/timeout ambigu | ✅ | `email_snapshot` + `email_idempotency_key` (`20260921040000`); key beku per delivery, rotasi hanya saat error idempotensi terminal; `sent` = accepted (DOMAIN.md §2.5) |
| RF-03 | High | Cron overlap/double trigger | ✅ | Unique index + `onConflictDoNothing` + claim atomik + sweep-claim + provider key |
| RF-04 | M | Double-spend kuota saat overlap | ✅ | Single-flight: partial unique index `reminder_runs_single_active` (`20260921050000`); run-2 → `skipped`; reclaim `RUN_LOCK_STALE_MS`; **kini fail-closed (NEW-01)** |
| RF-05 | M | Hapus/complete mid-run | ✅ | Soft-delete + live re-check → skip kirim |
| RF-06 | M | Double submit | ✅ | `Idempotency-Key` replay; re-add offset → `200` dengan threshold existing |
| RF-07 | M | Snapshot basi saat edit mid-run | ✅ | Live re-check membandingkan versi `deadline_updated_at` + `threshold.updated_at` |
| RF-08 | M | Poison loop | ✅ | Poison deterministik terminal saat pertama terdeteksi; `emailsPoisoned` dikecualikan dari blackout |
| RF-09 | **Critical** | PUT thresholds menghapus riwayat delivery | ✅ | Hapus = arsip (`deleted_at`), bukan cascade; migrasi `20260921060000_threshold_archive.sql`; `forbid_threshold_delete` (perbaikan `pg_trigger_depth() > 1`); PUT/DELETE arsip; `h2_task_course_owner_invariant.sql` + `rls_matrix.sql` pass |
| RF-10 | Low | Re-create threshold → kirim ulang | ✅ | Identitas delivery per `(task, days_before, channel)`; baris threshold terarsip menahan kirim ulang |
| RF-11 | High | First-run burst / catch-up | ✅ | `REMINDER_CUTOFF_ISO` wajib prod + `[LATE]` + H-0 tetap terkirim run pertama; fail-closed bila cutoff kosong/invalid |
| RF-12 | High | Batch tak terbatas vs timeout | ✅ | `MAX_TASKS_PER_RUN` + `MAX_RUN_DURATION_MS` + ledger `truncated=true` (`20260922000000_reminder_runs_truncated.sql`) |
| RF-13 | M | Env hilang/tersamar | ✅ | `assertStartupConfig` fail-closed (`RESEND_API_KEY` format `re_`, `RESEND_FROM_EMAIL` valid) |
| RF-14 | M | Observability & recovery | ✅ | `GET /health/cron` (healthy ⇐ run `ok` + finish < 2× interval); dashboard SQL di runbook |
| RF-15 | Low | Migrasi vs kode lama | ✅ | `assertReminderSchemaPrerequisites` saat boot prod; CI urut migrate→deploy |
| RF-16 | — | Clock skew app vs DB | ⚪ | **Keputusan operasi**: scheduler dipin di **single instance** (RUNBOOK §) — skew antar-instance tidak mungkin; catatan trade-off terdokumentasi |
| RF-17 | — | Beban pool/host | ✅ | Load test lolos: 3300 task, 3000 sent, 300 quota-skipped, wall 2510ms, `maxInFlight=5` (audit ini, §8) |
| RF-18 | — | Webhook out-of-order | ➖ | Tidak ada webhook di repo — N/A by design |
| NEW-01 | High | Single-flight lock fail-open | ✅ | Lock tak tercapai → run dibatalkan (nol delivery), `outcome: "lock-unavailable"` + alert; teruji di `run-evaluate.test.ts` (lihat log audit: `run lock unavailable, aborting run`) |
| (insidental) | M | Guard `forbid_threshold_delete` tidak pernah memblokir | ✅ | `pg_trigger_depth() > 0` → `> 1` (ditemukan via `rls_matrix.sql` saat rekonsiliasi DB 09-22) |

**Total: 45+ temuan lintas 7 dokumen — 0 Critical/High open, 0 regresi.**

---

## 3. Regresi

**Tidak ditemukan regresi.** Basis bukti:

1. Seluruh suite dieksekusi ulang dalam audit ini dan hijau (api 532, web 171, validation 105, domain 64, db 49 — 0 fail), termasuk test yang mengklaim menutup temuan lama (F-1 RLS-matrix, F-01 deadline-edit, RF-12 truncation, P1-summary RPC-equivalence).
2. `verify-schema-drift`: **zero drift** terhadap kontrak (12 tabel / 105 kolom / 13 FK / 22 check / 9 index / 6 trigger / 9 fungsi / 12 tabel RLS / 17 policy).
3. Suite SQL 10/10 file pass terhadap `test_verify_all` yang tersinkron 41/41 migrasi (`supabase_migrations.schema_migrations`).
4. Satu-satunya anomali: Nx menandai `@deadline-radar/db:test` flaky pada **run paralel pertama** sesi ini; 3 run ulang (2 solo + 1 paralel penuh) seluruhnya hijau 49/49. Dianggap transient (kondisi awal koneksi ke DB), bukan regresi — dicatat agar diawasi di CI.

---

## 4. Temuan Baru (hasil audit ini)

| ID | Sev | Temuan | Catatan |
|---|---|---|---|
| N-1 | INFO | Drift dokumentasi: `PROD_ENV_CHECKLIST.md` §3 menyebut "11 tabel + 18 policy" (aktual 12 tabel/17 policy publik), §10d/e menyebut 37→38→39 migrasi (aktual 41), §6 bukti C4 menyebut "34/34 applied"; `SECURITY_SIGNOFF` menyebut header di `next.config.ts` (aktual `proxy.ts`+http-policy); `docs/DATA-MODEL.md:394` masih punya open-question sisa F-11 | Kosmetik, tapi menyesatkan operator — perbaiki sebelum release |
| N-2 | LOW | `apps/web/app/components/threshold-manager.tsx` — hint `isPastTrigger` belum terikat ke tick `useNow` (sewa pra-remediasi, minor UI) | Opsional; tidak memengaruhi kebenaran reminder |
| N-3 | INFO | Residual SEC-004: karakter C0 selain CR/LF tidak di-stripping dari subject email (hanya baris-break berbahaya yang disanitasi) | Dampak rendah; mailer modern toleran |
| N-4 | INFO | `git status` menunjukkan seluruh remediasi uncommitted + bercampur dokumen audit; jika di-commit sebagai satu commit besar, riwayat per-temuan hilang | Rekomendasi: commit per kelompok temuan sebelum tag |

---

## 5. Kondisi Terbuka & Tindak Lanjut

| # | Kondisi | Jenis | Tindak lanjut | Owner |
|---|---|---|---|---|
| C2 | Pohon remediasi belum di-commit & di-tag (sign-off tidak bisa memindai hash; sign-off lama "kedaluwarsa pada perubahan apa pun") | Hard gate | Commit per kelompok temuan (hindari N-4), lalu tag (mis. `remediation-2026-09-22`) | Dev |
| C3 | Prod belum deployed: 41 migrasi + env checklist §1–§2 belum dieksekusi di prod | Hard gate | Deploy staging/prod, `bun db:migrate`, `bun db:verify`, jalankan `verify-prod.sql` (termasuk re-run evidence C4/SEC-003 di prod) | Ops |
| C5 | Dashboard observability + `security.txt` belum diverifikasi live | Hard gate | Verifikasi di prod pasca-deploy | Ops |
| C6 | Bukti runtime pasca-deploy (scheduler aktif, `REMINDER_CUTOFF_ISO` terisi, external cron monitor, isolasi 2-user di browser prod, Back-nav `?_rsc`, `Cache-Control`/CSP header di prod) | Hard gate | Jalankan daftar `PROD_ENV_CHECKLIST.md`; tandai 🟡→✅; terbitkan sign-off baru | Ops + Dev |
| F-7 | E2E journey belum ditulis; Playwright belum di-CI (accepted risk, review date tercantum di `apps/e2e/README.md`) | Accepted risk (Medium) | Jadwalkan penulisan journey (login→course→task→attachment→reminder); pertahankan review date | Dev |
| P2-residual | ~2 RTT ekstra di jalur `POST /tasks` (denganUserRls per-check) | Debt optimasi | Plan-kan bila jalur task-create jadi bottleneck | Dev |
| N-1..N-3 | Drift docs + residual minor | Kosmetik/Low | Selesaikan dalam window C2 | Dev |

---

## 6. Verdict

### READY WITH CONDITIONS

Pemetaan ke aturan verdict:

- **Tidak** memenuhi READY murni: ada kondisi hard gate yang belum terpenuhi (C2 commit+tag; C3/C5/C6 deploy & bukti runtime prod) dan satu temuan Medium terbuka (F-7) yang sengaja dipertahankan sebagai accepted risk.
- **Tidak** NOT READY: tidak ada temuan Critical/High yang Not-Fixed/Partial/Regressed; tidak ada temuan baru Critical/High; semua Closed disertai regresi-test yang dieksekusi dan hijau di audit ini.
- READY WITH CONDITIONS: semua Critical/High terverifikasi; kondisi eksplisit & terukur di §5.

**Syarat promosi ke READY penuh:** C2 + C3 + C5 + C6 selesai dan ditandatangani; F-7 tetap acceptable provided accepted-risk-nya di-renew saat review date; N-1..N-3 terselesaikan.

---

## 7. Metadata Audit

- **Tanggal & environment:** 2026-09-22, mesin lokal (`darwin`), PostgreSQL lokal `test_verify_all` (41/41 migrasi, role `anon/authenticated/service_role` hadir), `supabase` CLI tersedia.
- **Basis kerja:** working tree pada 2026-09-22; `HEAD = c21922e` (2026-09-17, branch `dev`); seluruh remediasi 09-18→09-22 uncommitted.
- **Alat:** `bun`, `bunx nx`, `psql`, `supabase migration list`, skrip repo (`scripts/verify-schema-drift.ts`), Graphify untuk penemuan kode awal.
- **Batasan:** prod/staging tidak tersedia → semua item runtime-prod berstatus 🟡 Cannot-Verify (bukan failed). Kunci/kredensial tidak disentuh; tidak ada perubahan kode/DB produktif — hanya eksekusi test suite dan query read-only terhadap DB tes.

---

## 8. Bukti Runtime (dieksekusi saat audit)

| Suite | Hasil |
|---|---|
| `typecheck` (web, api, db, domain, validation) | 5/5 pass (fresh, `--skip-nx-cache`) |
| `lint` (5 workspace) | 5/5 pass (db/api: gate typecheck terdokumentasi; web: eslint) |
| `apps/api` tests | **532 pass / 0 fail**, 3103 `expect()`, 54 file, ~25s |
| `apps/web` tests | **171 pass / 0 fail**, 21 file |
| `packages/validation` tests | **105 pass / 0 fail**, 8 file |
| `packages/domain` tests | **64 pass / 0 fail**, 5 file |
| `packages/db` tests | **49 pass / 0 fail**, 119 `expect()`, 8 file (~270ms) — termasuk `rls-matrix.test.ts` (F-1) sebagai role `authenticated` |
| Suite SQL (`supabase/tests/*.sql`, 10 file) | **10/10 pass** terhadap `test_verify_all` (c1, f13, h2, l1, m8, m9, p3, rls_matrix, scheduler_state, sec003_quota) |
| Schema drift (`scripts/verify-schema-drift.ts`) | **Zero drift** — 12 tabel, 105 kolom, 5 enum, 12 PK, 13 FK, 6 unique, 22 check, 9 index, 6 trigger, 9 fungsi, 12 tabel RLS, 17 policy |
| Migrasi | 41/41 applied di `test_verify_all` (cek `supabase_migrations.schema_migrations`) |
| RF-17 load test (dalam suite api) | 3300 task dievaluasi, 3000 sent, 300 quota-skipped, wall 2510ms, `maxInFlight=5 (ceiling 5)` |
| Anomali | 1× flag flaky `@deadline-radar/db:test` pada run paralel pertama; 3 run ulang hijau — transient |

---

## 9. Catatan Penutup

1. **Sign-off baru diperlukan.** `SECURITY_SIGNOFF_2026-09-20.md` menyatakan sign-off kedaluwarsa pada perubahan apa pun; pohon saat ini berbeda dari yang ditandatangani. Dokumen ini adalah audit independent yang menuntaskan gate C1; C2–C6 (beserta penerbitan sign-off final ber-hash) adalah tanggung jawab release.
2. **Keberadaan file `.env` aman:** tidak ada `.env*` yang ter-commit (cek `git ls-files`); aturan `.gitignore` aktif (`.env`, `.env.*`, `!.env.example`).
3. **`security.txt`** sudah ada di `apps/web/public/.well-known/security.txt` (menunggu verifikasi live di C5).
4. **Pola test DB:** `expect(true).toBe(true)` di `sec003-quota.test.ts:60` & `p3-list-indexes.test.ts:78` adalah terminal-assert disengaru — asersi sesungguhnya berupa `RAISE` di SQL; mencapai baris itu berarti semua invariant diam. Bukan temuan.
5. **Kondisi lokal DB:** run pertama suite db bisa flaky bila koneksinya baru berdiri — di CI, pertahankan urutan (migrasi dulu, test kemudian) dan `TEST_DATABASE_URL` eksplisit.
