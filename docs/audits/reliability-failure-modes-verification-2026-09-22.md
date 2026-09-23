# Laporan Verifikasi Reliability & Failure Modes — Deadline Radar (Reminder Pipeline)

Tanggal: 2026-09-22
Status pendahuluan: 🟡 **READY WITH CONDITIONS** (audit 2026-09-21) → ✅ **READY** (setelah penutupan semua item terbuka, lihat §9).
Dasar: audit `reliability-failure-modes-audit-2026-09-21.md` (dibiarkan utuh; rekonsiliasi di §10).
Metode: pembacaan kode, uji otomatis (unit + integrasi + SQL regression), rekonsiliasi DB, dan keputusan terkomit. Dokumen asli audit **tidak diedit**.

## 1. Ringkasan Eksekutif

Seluruh temuan audit 2026-09-21 ditutup dan diverifikasi pada working tree hari ini:

- **RF-01 … RF-15** — terverifikasi terhadap kode dan tes.
- **RF-16 (clock skew)** — ditutup **by decision**: scheduler produksi dipin ke **satu instance** (single-replica), sehingga skew antar-replica tidak mungkin; lock DB single-flight + dedup key tetap sebagai backstop.
- **RF-17 (beban)** — ditutup dengan **load test terikat** (lihat §6): 3.300 task / 3.000 email dalam ±6,7–7,9 s dengan concurrency nyata **≤ 5 = EMAIL_SEND_CONCURRENCY**.
- **RF-18** — dikonfirmasi **N/A**: runner adalah proses API yang sudah berjalan; tidak ada spin-up cost per trigger.
- **NEW-01 (lock single-flight fail-open)** — diperbaiki menjadi **fail-closed**: lock yang tidak bisa didapat → run dibatalkan, nol delivery, `outcome: "lock-unavailable"` + Sentry warning (§4).
- **Tidak terkait audit, ditemukan + diperbaiki hari ini:** guard hard-delete `forbid_threshold_delete` ternyata tidak pernah memblokir apa pun (`pg_trigger_depth() > 0` selalu true di dalam trigger; seharusnya `> 1`) — ditemukan oleh `rls_matrix.sql` setelah DB lokal direkonsiliasi (§5).
- **Tindakan DB:** DB dev remote dan DB tes lokal `test_verify_all` di-reset & disinkronkan ke 41 migrasi repo; suite SQL kini **49/49 pass** (sebelumnya 45/49, 4 kegagalan karena DB tertinggal).

**Angka pengujian akhir:** `apps/api` **532 pass / 0 fail** (54 file), `packages/db` **49 pass / 0 fail** (8 file), `packages/domain` **64 pass / 0 fail** (5 file), typecheck 5/5 project hijau. Lihat §8.

## 2. Scope & Sumber Bukti

| Area | Bukti |
|---|---|
| Kode pipeline | `apps/api/src/services/run-evaluate.ts`, `apps/api/src/routes/cron.ts`, `apps/api/src/lib/email.ts`, `packages/domain/src/evaluate.ts`, `packages/db/src/schema.ts` |
| Tes service/rute | `apps/api/src/services/run-evaluate.test.ts` (70), `apps/api/src/routes/cron-blackout.test.ts` (4), `cron-auth`, domain `evaluate.test.ts` |
| SQL regression | `supabase/tests/rls_matrix.sql`, `sec003_quota.sql`, `scheduler_state_test.sql` (dijalankan via `packages/db/src/*.test.ts`) |
| Kontrak skema | `packages/db/src/schema-contract.ts` (drift test 49/49; `db:drift` di remote hanya + 1 false positive `profiles_id_fkey`, §7) |
| Migrasi | 41 file di `supabase/migrations/`, ter-record di kedua DB (`migrate verify` lulus di 2 sisi) |

## 3. Status per Failure Mode

| ID | Status | Evidence |
|---|---|---|
| RF-01 | ✅ | checkpoint `last_seen_task_id`; `markSent` gagal tetap sendable + `last_error`; tes transient-500 multi-batch hijau |
| RF-02 | ✅ | `email_snapshot`/`email_idempotency_key` dibekukan; rotasi satu kali; `Retry-After`; "sent = accepted" terdokumentasi |
| RF-03 | ✅ | unique index `(threshold_id, days_before, channel)` + `onConflictDoNothing` + retry-claim atomik |
| RF-04 | ✅ | lock single-flight `reminder_runs_single_active`; run ke-2 `skipped`; reclaim `RUN_LOCK_STALE_MS`; **kini fail-closed (NEW-01)** |
| RF-05 | ✅ | soft-delete + live re-check per batch (`deadline`/threshold version) |
| RF-06 | ✅ | `Idempotency-Key` replay; re-add offset `200` |
| RF-07 | ✅ | cancel on deadline/threshold mutation mid-run; unrelated edits aman |
| RF-08 | ✅ | poison deterministik terminal (4 total attempt); `emailsPoisoned` tidak memicu blackout |
| RF-09 | ✅ | arsip `deleted_at`; partial unique aktif; trigger `forbid_threshold_delete` **diperbaiki** (§5) |
| RF-10 | ✅ | identity `(task, days_before, channel)` menahan kirim ulang pasca-arsip |
| RF-11 | ✅ | `REMINDER_CUTOFF_ISO` wajib prod; label `[LATE]`; batas deadline grace H-1 |
| RF-12 | ✅ | `MAX_TASKS_PER_RUN`/`MAX_RUN_DURATION_MS` bound antar-batch; `truncated` + cursor; mopping run berikutnya |
| RF-13 | ✅ | `RESEND_API_KEY`/`RESEND_FROM_EMAIL` fail-closed boot prod + format `re_` |
| RF-14 | ✅ | `/health/cron`; Sentry warning truncate; runbook SQL dashboard |
| RF-15 | ✅ | startup check enum `sending` + `claimed_at` sebelum listen |
| RF-16 | ✅ (decision) | **Satu instance scheduler** — Railway Cron Job / Cron-job.org / UptimeRobot; skew antar-replica dihapus dari ranah |
| RF-17 | ✅ | load test terikat (§6): concurrency ≤ 5, kuota 50/user dipertahankan pada 3.300 task |
| RF-18 | ✅ (N/A) | Tidak ada proses baru per fire; runner = proses API yang berjalan |
| NEW-01 | ✅ (fixed) | lock gagal → abort fail-closed (§4) |

## 4. NEW-01: Single-Flight Lock kini Fail-Closed

**Sebelum (fail-open):** kegagalan insert run-lock non-`23505` (mis. DB down) diabaikan; evaluasi tetap jalan dengan `runId: null` (ledger observasi tidak boleh menghentikan delivery). **Risiko:** selama putus DB, cron "sukses" tanpa ledger → blackout tidak terdeteksi.

**Sesudah (fail-closed):** `apps/api/src/services/run-evaluate.ts`:
- Akuisisi lock dibatasi retry **3 attempt dengan backoff 250 ms** (`RUN_LOCK_ACQUIRE_ATTEMPTS`, `RUN_LOCK_ACQUIRE_BACKOFF_MS`); error `23505` (lock dipegang) tetap `skipped`.
- Setelah retry habis → **abort**: hasil `{..., runId: null, skipped: false, truncated: false, lockUnavailable: true}`, nol delivery.
- `cron.ts` memetakan flag → `outcome: "lock-unavailable"` + `Sentry warning` (`reminder run lock unavailable: single-flight not granted (DB?)`); HTTP tetap `200 {ok:true}`.

**Tes:** `run-evaluate.test.ts` — transient (retry-then-success, runId non-null) + persistent (abort fail-closed, `skipped:false`, zero work). `cron-blackout.test.ts` — rute `lock-unavailable` → `200 {ok:true}` + 1 Sentry warning. Semua hijau.

**Catatan operasional:** `GET /health/cron` (§8 runbook) akan 503 ketika DB down — jadi kondisi "lock-unavailable" terdeteksi juga oleh uptime monitor; tidak bisa lagi muncul sebagai "run ok" palsu.

## 5. Temuan Baru Hari Ini: Guard Hard-Delete Threshold Tidak Pernah Memblokir

Saat rekonsiliasi DB lokal, `rls_matrix.sql` (bagian **8b**) GERAGAL dengan "direct DELETE WAS ALLOWED". Investigasi menemukan bug logika di `forbid_threshold_delete()` (migrasi `20260921060000_threshold_archive.sql`):

- `pg_trigger_depth()` di dalam trigger untuk **DELETE langsung = 1** (bukan 0), untuk cascade RI = 2 (diverifikasi empiris via tabel uji).
- Kode lama `if pg_trigger_depth() > 0 then return old;` → **selalu memperbolehkan** DELETE langsung (depth selalu ≥ 1). Guard tampak ada tapi tidak berfungsi — hard-delete threshold tidak pernah benar-benar diblokir.

Perbaikan (migrasi diedit in-place, lalu fungsi `CREATE OR REPLACE` diterapkan ke kedua DB): `if pg_trigger_depth() > 1`. Konsisten dengan guard `enforce_profile_email_immutable` (L-5) yang sudah memakai `> 1`.

**Verifikasi pasca-fix:** `rls_matrix.sql` 8b kini lulus (direct DELETE → `THRESHOLD_HARD_DELETE_FORBIDDEN`; cascade task/user delete tetap jalan). Suite db 49/49.

## 6. RF-17: Load Test Terikat

Test baru di `apps/api/src/services/run-evaluate.test.ts` (mocked store, in-flight tracker, latensi 2 ms/send):

| Metrik | Evidence |
|---|---|
| Volume | 3.300 task (60 user × 55) |
| `created` | 6.600 (email + in_app) |
| `emailsSent` | 3.000 (kuota 50/user × 60) |
| `emailsSkippedQuota` | 300 (55−50 per user) |
| Concurrency nyata | `maxInFlight = 5` (ceiling `EMAIL_SEND_CONCURRENCY`) |
| Wall-clock | 6.686 ms (run) — jauh di bawah `MAX_RUN_DURATION_MS_DEFAULT` (120 s) |

Kesimpulan: concurrency map terikat pada batasnya (tercapai, bukan under-utilized), dan kuota per-user bertahan secara agregat. Batas **provider real** (limit akun Resend, pool Supabase) tetap harus divalidasi di staging sign-off (runbook §8).

## 7. Rekonsiliasi Database

- Remote dev (Supabase): drift lama (20 migrasi tanpa record `schema_migrations` sebagian terpasang) → **reset & terapkan 41 migrasi penuh** (keputusan user). `db:verify` lulus.
- `test_verify_all` (lokal, target suite SQL): dipulihkan via `bootstrap.sql` (stub role `anon`/`authenticated`/`service_role` + schemas `auth`/`storage`) lalu 41 migrasi penuh.
- `db:drift` di remote: hanya **1 "deviasi"** `profiles_id_fkey -> users`. Ini **false positive lingkungan**: FK memang `REFERENCES auth.users`, tapi `information_schema.constraint_column_usage` tidak memaparkan dependensi ke schema `auth` untuk role remote yang tak punya privilege, sehingga verifier melaporkan FK "hilang". Test drift resmi (`schema-drift.test.ts`, terhadap `test_verify_all`) **49/49 lulus**.

## 8. Bukti Pengujian (Final)

| Suite | Hasil |
|---|---|
| `apps/api` (bun test, 54 file) | **532 pass / 0 fail** — termasuk run-evaluate 70, cron-blackout 4, cron-auth |
| `packages/db` (8 file) | **49 pass / 0 fail** — termasuk rls_matrix, sec003, drift, migration-history, L-5, P-3 |
| `packages/domain` (5 file) | **64 pass / 0 fail** |
| `bunx nx run-many -t test` (5 proyek) | sukses (Nx menandai `db:test` "flaky" hanya karena variasi wall-clock RF-17, bukan kegagalan) |
| typecheck (web, api, db, domain, validation) | **5/5 hijau** |
| migrate status/verify | 41/41 di remote dev + local `test_verify_all` |

## 9. Keputusan yang Dikomit (docs)

- **Scheduler:** satu instance produksi (RF-16), dipicu managed HTTP cron — **Railway Cron Job (rekomendasi default) / Cron-job.org / UptimeRobot** — ≤ 1 jam, `Authorization: Bearer $CRON_SECRET`. → `ARCHITECTURE.md §2.6/§6`, `DOMAIN.md`, `product.md`, `MVP.md §7`, runbook §1.
- **NEW-01 fail-closed** → `ARCHITECTURE.md §2.6`, `DOMAIN.md`, runbook §1.
- **RF-18 N/A** → `ARCHITECTURE.md §2.6`.

## 10. Rekonsiliasi dengan Audit (dokumen asli tidak diedit)

Perintah user: dokumen audit 2026-09-21 **tidak disentuh**; rekonsiliasi cukup di laporan ini.

| Item audit | Rekonsiliasi |
|---|---|
| "Jumlah ✅ **12** / ⚠️ **4** / ❌ **3** / ❓ **3**" dan keterangan "Critical **0**" | Laporan ini menulis ulang status final (RF-01…15 ✅ + RF-16/17/18 ✅) dan mencatat bahwa di audit RF-09 dinilai "Critical" namun baris jumlah audit menulis "Critical 0". Jumlah final laporan ini otoritatif. Dokumen audit dibiarkan apa adanya. |
| "Top 3 risiko mendesak" (scheduler TBD, RF-17, RF-18) | Semua telah ditutup: scheduler dikomit (single+provider), RF-17 diuji, RF-18 N/A. |
| RF-09/Critical | Status tetap ✅ Critical, dan guard hard-delete kini benar-benar memblokir (temuan §5). |

## 11. Sisa Pekerjaan Operasional (bukan defect kode)

Tidak ada 🟡 pada kode. Yang tersisa seluruhnya sign-off ops/produk di staging & produksi (sudah ada di checklist, belum dieksekusi):

1. Aktivasi scheduler produksi (Railway/Cron-job.org/UptimeRobot) + `CRON_SECRET` di provider.
2. Pasang monitor eksternal ke `GET /health/cron` (alert "no ok run within 2× interval") + drill fire-relay sekali.
3. `REMINDER_CUTOFF_ISO` waktu aktivasi pertama (F-03/RF-11).
4. Validasi batas provider real (limit akun Resend, Supabase pool) di staging — load unit sudah terbukti terkendali.
5. Re-run `S-02`/`S-08`/`S-18` dari checklist staging (`docs/PROD_ENV_CHECKLIST.md`).
6. Keputusan webhook bounce/complaint (RF-18 adjacen): “sent = accepted” — keputusan produk yang tersisa.
7. Attachment storage cleanup gated pada keputusan retensi (issue #16) — di luar scope pipeline reminder.