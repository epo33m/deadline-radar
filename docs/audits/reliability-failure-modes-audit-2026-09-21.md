# Audit Reliability & Failure Modes — Deadline Radar (Reminder Pipeline)

Tanggal: 2026-09-21
Cakupan: jalur kirim email / ubah data (cron, evaluator, email via Resend, tasks/thresholds, skema + migrasi, env, rate-limit, observability). Jalur auth, attachments/storage, courses/summary, dan frontend belum diaudit mendalam.

## 1. Ringkasan Eksekutif

Pipeline reminder (`cron → runEvaluateReminders → Resend`) sudah jauh lebih matang dari rata-rata MVP: klaim atomik untuk retry dan sweep, unique constraint `(threshold_id, days_before, channel)`, idempotency key per delivery ke Resend, retry dengan backoff + `Retry-After`, pemisah error retryable/non-retryable, live re-check untuk task yang dihapus/completed mid-run, run ledger, dan proteksi `CRON_SECRET` + rate limit. Duplikasi email massal pada happy path dan overlap cron **sebagian besar tertutup di level database**, bukan hanya di aplikasi.

Namun ada celah nyata: scheduler produksi masih **TBD** (tidak ada `vercel.json`, pg_cron, atau cron config di repo), tidak ada webhook bounce (email mental tetap `sent`), dan beberapa poison path (`missing email`) tidak pernah mencapai terminal. Observability hanya alert pada blackout total; scheduler mati diam-diam. (RF-11 — burst hari pertama & catch-up tanpa label — sudah ditutup: cutoff fail-closed di prod + label `[LATE]` + batas keterlambatan. RF-12 — run tanpa batas vs timeout serverless — sudah ditutup: run di-bound per invokasi dengan `MAX_TASKS_PER_RUN`/`MAX_RUN_DURATION_MS` + flag `truncated` di ledger; sisa task ditangani run berikutnya. RF-13 — env hilang/salah — sudah ditutup: `RESEND_API_KEY`/`RESEND_FROM_EMAIL` wajib valid di prod (fail-closed boot) + format `re_` + peringatan sandbox `resend.dev`. RF-14 — observability — sudah ditutup: endpoint publik `GET /health/cron` (healthy bila run `ok` terakhir) + alert Sentry saat run ter-truncate + SQL dashboard; penempelan monitor eksternal ke `/health/cron` adalah pekerjaan ops sign-off. RF-15 — migrasi vs kode lama — sudah ditutup: startup check prod memastikan enum `sending` + kolom `claimed_at` ada sebelum `app.listen` (pesan jelas "run bun run db:migrate").)

Jumlah: ✅ **12** / ⚠️ **4** / ❌ **3** / ❓ **3**. Severity: Critical **0**, High **3**, Medium **6**, Low **1**.

**Top 3 risiko paling mendesak:**
1. **Scheduler & monitoring production (ops sign-off):** runner belum diputuskan (TBD sepanjang audit) dan monitor eksternal `GET /health/cron` belum dipasang (UptimeRobot/penjadwal email pribadi ke runbook).
2. **RF-17 (❓):** Beban Resend / Supabase pool — `max:10`, concurrency 5 belum diuji dengan angka prod (p95 batch, limit Resend akun).
3. **RF-18 (❓):** Webhook bounce/complaint — `sent = accepted`, keputusan produk perlu dieksplisitkan di `DOMAIN.md` + checklist supresi.

## 2. Inventaris Sistem

**Entry point yang mengubah state:**
- `GET /api/v1/cron/evaluate-reminders` — satu-satunya scheduler entry (`apps/api/src/routes/cron.ts:28-45`). Auth `CRON_SECRET` (`:13-26`), purge idempotency + audit events (`:32-43`), lalu `runEvaluateReminders()`.
- `POST /api/v1/tasks`, `PATCH /:id`, `POST /:id/complete`, `DELETE /:id` (soft-delete), threshold CRUD (`POST/PUT/PATCH/DELETE /:id/thresholds`) — `apps/api/src/routes/tasks.ts`.
- `POST /api/v1/notifications/:id/read`, `/read-all` — hanya `read_at` (`apps/api/src/routes/notifications.ts:146-271`).
- Tidak ada queue consumer, webhook Resend, admin trigger, atau backfill script. Call-tracing hanya menemukan `runEvaluateReminders` dipanggil dari `cronRoutes`.

**Dependency eksternal:**
- Postgres via Supabase pooler, Drizzle `postgres-js` (`packages/db/src/client.ts:9-11`: `prepare:false, max:10`, tanpa `connect_timeout/statement_timeout`).
- Resend SDK v6 (`apps/api/src/lib/email.ts:210`, `resend@6.25.0`), timeout 10s/attempt, maks 3 attempt (`:78-79`).
- Supabase Auth (JWKS), Storage (attachment), Redis opsional untuk rate limit (fallback in-memory).
- Sentry (blackout alert saja, no-op tanpa DSN).

**State machine delivery (`packages/domain/src/evaluate.ts:101`, `packages/db/src/schema.ts:27-32`):**
- `pending → sending → sent`, `pending → failed → pending → … → failed(terminal)`, `failed → pending` (retry claim). `in_app`: langsung `sent` saat insert.
- Retry lintas-siklus capped `MAX_EMAIL_DELIVERY_RETRIES=3` (`evaluate.ts:98`), total 4 attempt (1 awal + 3 retry). Kuota `MAX_EMAILS_PER_USER_PER_RUN=50` (`quotas.ts:24`).

**Background job & jadwal:**
- Tidak ada jadwal di repo (`supabase/config.toml` tanpa cron; tidak ada `vercel.json`; `docs/ARCHITECTURE.md:109-117` runner **TBD**, syarat minimal hourly). Rate limit cron 10/menit (`rate-limit.ts:41-43`).

## 3. Failure Mode Matrix

| ID | Skenario | Komponen | Status | Severity | Ringkasan Perilaku Saat Ini |
|---|---|---|---|---|---|
| RF-01 | Supabase timeout/error koneksi mid-run | run-evaluate, db client | ✅ | — | Timeout `connect_timeout`/`statement_timeout` + override env; checkpoint `reminder_runs.last_seen_task_id` untuk resume pasca-crash; `markSent`-gagal menyimpan `last_error` dan tetap sendable (bukan `failed`) |
| RF-02 | Resend 4xx/5xx/429/timeout & ambiguous-timeout | email.ts, deliverEmail | ✅ | — | Body + idempotency key di-freeze per delivery (`email_snapshot`, `email_idempotency_key`); rotasi key hanya pada error idempotency terminal; `Retry-After` ≤30s; "sent = accepted, bukan delivered" terdokumentasi (tanpa webhook) |
| RF-03 | Cron overlap / double trigger | run-evaluate claim + DB constraint | ✅ | — | Duplikat dicegah unique index + `onConflictDoNothing` + retry-claim atomik + sweep-claim + provider key |
| RF-04 | Kuota per-user double-spend saat overlap | quota claim | ✅ | — | Single-flight run lock: partial unique index `reminder_runs_single_active` (status `running`); run kedua keluar `skipped` tanpa kerja; run crash di-reclaim setelah `RUN_LOCK_STALE_MS` |
| RF-05 | User hapus/complete task mid-run | evaluator + tasks route | ✅ | — | Soft-delete + live re-check (`:544-571`) skip kirim; delivery `pending` yatim dibiarkan (tidak dikirim, tidak dibersihkan) |
| RF-06 | Network retry / double submit | idempotency + constraints | ✅ | — | Threshold POST mendukung `Idempotency-Key` (replay respons tersimpan) + offset yang sudah ada kini `200` dengan threshold existing, bukan `409`; `PUT` replace idempoten alami; `PATCH` tetap `409` pada konflik; `DELETE` kini mengarsipkan (RF-09) |
| RF-07 | Edit deadline/threshold saat evaluator jalan | evaluator snapshot | ✅ | — | Live re-check per batch juga membandingkan versi `deadline_updated_at` + `threshold.updated_at`; bila berubah, delivery dibatalkan (row dihapus, kuota tak terpakai) dan run berikut mengevaluasi ulang; edit tak terkait (title/status) tidak membatalkan |
| RF-08 | Poison `missing task/recipient` loop selamanya | evaluator markFailed | ✅ | — | Poison deterministik kini terminal saat pertama terdeteksi (`markFailed(id, MAX_EMAIL_DELIVERY_RETRIES, …)` di kedua cabang `!task || !to`) + counter `emailsPoisoned` dikecualikan dari keputusan blackout (tetap dihitung di `emails_failed` ledger) |
| RF-09 | `PUT thresholds` hapus riwayat delivery | tasks route + FK cascade | ✅ | Critical | Hapus = arsip (`deleted_at`), bukan cascade. Migrasi `20260921060000`; partial unique + quota aktif saja; `thresholds_delete_own` diganti trigger `forbid_threshold_delete`; PUT/DELETE arsip |
| RF-10 | Threshold dihapus lalu dibuat ulang → kirim ulang | unique key per thresholdId | ✅ | Low | Identitas delivery per `(task, days_before, channel)`: baris `sent`/`pending` milik threshold terarsip menahan kirim ulang; retry hanya baris threshold live. Ditutup bersama RF-09 |
| RF-11 | First-run burst / cron catch-up telat | cutoff + scheduler TBD | ✅ | High | `REMINDER_CUTOFF_ISO` **wajib di prod** (boot throw bila kosong/invalid, RF-11); trigger ≥ 1h stale → label `[LATE]` (email subject+body, in-app `isLate` diturunkan saat baca); deadline lewat > 1h → task tak dijadwalkan lagi (create & retry), H-0 tetap terkirim di run pertama pasca deadline |
| RF-12 | Batch tak terbatas vs timeout serverless | evaluator loop + host TBD | ✅ | High | Run kini di-bound per invokasi: `MAX_TASKS_PER_RUN` (default 10k) + `MAX_RUN_DURATION_MS` (default 120s, di-clamp < lock horizon); batch-atomic; ledger `truncated=true` + `status ok`; backlog dihitung + dicatat; sisa ditangani run berikut (re-scan penuh, resend di-suppress identitas `(task, offset, channel)`) |
| RF-13 | Env hilang/salah | env.ts | ✅ | — | `RESEND_API_KEY` (format `re_`) + `RESEND_FROM_EMAIL` (valid, bukan sandbox) **wajib di prod** — `assertResendConfigured()` fail-closed lewat `assertStartupConfig`; domain `resend.dev` → warn; dev/test tetap lenient |
| RF-14 | Observability & recovery | ledger + Sentry | ✅ | — | `GET /health/cron` publik read-only: healthy ⇐ run `ok` + finish dalam `2× REMINDER_RUN_INTERVAL_MS` (default 1 jam), 503 bila stale/error/running-stuck/none; Sentry warning saat run ter-truncate; SQL dashboard (failed/hari, `sending` stale, slider kuota) di runbook |
| RF-15 | Migrasi vs kode lama | sweep claim state | ✅ | — | Startup check prod (`assertReminderSchemaPrerequisites`) memverifikasi enum `sending` + kolom `claimed_at` sebelum `listen` — pesan jelas "run bun run db:migrate"; non-prod skip; CI sudah urut (migrate → deploy) |
| RF-16 | Clock skew app vs DB | claimedAt check | ❓ | — | Perlu verifikasi |
| RF-17 | Beban Resend / Supabase pool habis | pool max 10, concurrency 5 | ❓ | — | Perlu load test |
| RF-18 | Resend webhook out-of-order | webhook | ❓ | — | Tidak ada webhook di repo — N/A by design |

## 4. Detail Finding (⚠️ dan ❌)

### RF-01 — Supabase timeout / error koneksi
Status: ✅ Resolved (2026-09-21) | Severity: High
Resolusi: `createDb` menyetel `connect_timeout`/`statement_timeout` (override env); migrasi `20260921030000` menambah `reminder_runs.last_seen_task_id` sebagai checkpoint resume pasca-crash; `markSent`-gagal menulis `last_error = "confirm failed: …"` tanpa menurunkan status ke `failed` (tetap sendable, didedup provider key). Detail runbook: `docs/RUNBOOK-reminders.md` §3.
Komponen: evaluator + DB client + error handler
Bukti: `packages/db/src/client.ts:9-11` (`postgres(conn,{prepare:false,max:10})` — tanpa timeout); `apps/api/src/services/run-evaluate.ts:91-102` (run-start gagal → `runId:null`, run lanjut); `:193-200`, `:212-219` (`markFailed/markSent` catch → `console.error`, return false); `:268-273` (`markSent` gagal → `totalEmailsFailed+=1`); `:558-563` (live-check gagal → fail-open + lanjut snapshot); `:686-705` (throw batch → ledger `error` → rethrow); `apps/api/src/plugins/error-handler.ts:141-144` (non-ApiError → 500 + Sentry).

Skenario:
1. `SELECT tasks` batch N throw (pool habis / timeout) → outer catch → ledger `error` → cron 500.
2. `INSERT deliveries` sukses, `sendReminderEmail` sukses, `UPDATE sent` gagal → email sudah terkirim tapi baris tetap `pending` → sweep berikutnya kirim ulang (didup via provider key 24h, aman) tapi `emailsFailed` naik.
3. `UPDATE failed` gagal → baris tetap `pending` → diam-diam di-retry lain waktu tanpa `last_error`.

Perilaku saat ini: tidak ada partial-write protection (tiap langkah statement terpisah, tanpa transaksi lintas langkah — disengaja agar satu delivery gagal tak menggugurkan run). Error dilaporkan ke log + ledger, tidak ditelan total, kecuali konteks `markFailed` yang hilang saat write-nya sendiri gagal.

Dampak: duplikat kirim kedua aman (idempotency key), tapi operator melihat `failed` palsu; kegagalan batch awal menggugurkan seluruh sisa task (tidak ada resume keyset).

Rekomendasi: tambah `connect_timeout` + `statement_timeout` di `createDb` (atau `SET statement_timeout` per transaksi cron); bedakan error batch-fetch (abort run, ledger `error`) vs error per-delivery (lanjut) — sudah begitu, pertahankan; simpan `last_error` untuk `markSent`-gagal juga (saat ini hanya `markFailed` yang menulis konteks); pertimbangkan checkpoint `lastSeenTaskId` di ledger agar retry manual bisa resume.

Cara verifikasi setelah diperbaiki: matikan DB mid-run (proxy kill 1 batch); assert ledger `error`, tidak ada `sent` ganda, dan run berikut menyapu `pending` tanpa duplikat (cek Resend dashboard via key).

### RF-02 — Resend gagal / ambiguous timeout
Status: ✅ Resolved (2026-09-21) | Severity: High
Resolusi: migrasi `20260921040000` menambah `notification_deliveries.email_snapshot` + `email_idempotency_key`; body dan key di-freeze saat attempt pertama dan dipakai ulang pada retry (body berubah tidak lagi memicu key baru); key dirotasi hanya pada error idempotency terminal. `sent` didefinisikan sebagai "accepted/queued, bukan delivered" (tanpa webhook) di `docs/DOMAIN.md` §2.5.
Komponen: `apps/api/src/lib/email.ts`, `run-evaluate.ts:227-274`
Bukti: `email.ts:234-236` (attempts ≥1, default 3); `:242-267` (thrown/timeout → retry); `:296-298` (`isNonRetryableReminderError` → throw langsung); `:120-128` (4xx non-429 tidak di-retry; 5xx+429 di-retry); `:299-305` (`Retry-After` dihormati, cap 30s); `:136-141` (`concurrent_idempotent_requests` → caller biarkan `pending`); `:144-150` (terminal key error → warn, lalu `markFailed`); `:50-59` (key = `deliveryId + hash(body)`); `run-evaluate.ts:252-256` (concurrent → return tanpa `markFailed`); `:257-266` (terminal → warn lalu `markFailed`).

Skenario: timeout 10s terjadi setelah Resend benar-benar menerima email → SDK melempar/return error → `sendReminderEmail` melempar `ReminderEmailError(timeout)` → `deliverEmail` → `markFailed` → status `failed`. Run berikut retry dengan **key sama** (bila body sama) → Resend kembalikan respons asli tanpa kirim ulang (jendela 24h). Tidak stuck `sending` selamanya untuk path fresh (tetap `pending`/`failed`); path sweep memakai lease 15 mnt.

Perilaku saat ini: 429/5xx/timeout di-retry dalam satu delivery (3 attempt, backoff+jitter via `backoffDelayMs`); 4xx permanen dicoba sekali; tidak ada state `sending` yang yatim untuk fresh path. Celah: bila task title/deadline diedit antar attempt sehingga body berubah, key baru → Resend anggap email berbeda → **duplikat**. Bounce/complaint tak terdeteksi (tanpa webhook) → tetap `sent`.

Dampak: duplikat hanya di edge edit-tepat-saat-retry; bounce rate tak terlihat; invalid email (`4xx`) langsung `failed` lalu di-retry lintas siklus 3× (boros tapi terbatas).

Rekomendasi: dokumentasikan trade-off key-body di runbook (sudah sebagian); pertimbangkan kunci stabil per `(deliveryId, retryCount)` + validasi payload, atau freeze body snapshot di delivery row; tambah penanganan khusus `rate_limited` Resend vs HTTP 429; putuskan eksplisit "tanpa webhook = sent berarti accepted, bukan delivered" di `DOMAIN.md`.

Cara verifikasi setelah diperbaiki: stub fetch timeout-lalu-sukses dengan key sama → assert 1 email di dashboard; ubah title antar attempt → assert key berubah (duplikat terdokumentasi); kirim ke alamat bounce → assert status tetap `sent` (keterbatasan diketahui).

### RF-04 — Kuota per-user double-spend saat overlap
Status: ✅ Resolved (2026-09-21) | Severity: Medium
Resolusi: migrasi `20260921050000` menambah partial unique index `reminder_runs_single_active` pada `status = 'running'`. `runEvaluateReminders` meng-claim lock lewat insert ledger: `23505` → keluar dini `{ skipped: true, runId: null }` (cron `outcome: "skipped"`); run crash di-reclaim lewat UPDATE `status = 'error'` bila `startedAt` lebih tua dari `RUN_LOCK_STALE_MS` (30 menit). Kuota per-user kini tidak bisa di-double-spend oleh dua run paralel.
Komponen: `apps/api/src/services/run-evaluate.ts:149-159`, `:599-602`, `:636-639`
Bukti: `claimUserSendBudget` memakai `Map` in-memory per eksekusi; tidak ada baris DB / advisory lock.

Skenario: 2 run overlap (scheduler double-fire atau retry scheduler) masing-masing melihat `used=0` → masing-masing kirim 50 → user terima 100 dalam satu interval.

Perilaku saat ini: tidak ada duplikat per reminder (constraint menahan), tapi batas biaya per-run dilipatgandakan.

Dampak: terbatas (50→100), tapi melanggar janji `quotas.ts` sebagai cost blast-radius.

Rekomendasi: opsional — terima sebagai known limitation bila overlap langka (rate limit 10/mnt + claim atomik sudah menekan), atau tegakkan kuota di DB (counter per `(user_id, run_id)` dengan `UPDATE … WHERE count<50 RETURNING`, atau advisory lock per user).

Cara verifikasi setelah diperbaiki: jalankan 2 `runEvaluateReminders` paralel dengan 60 due/user → assert total terkirim ≤50 bila diperbaiki.

### RF-06 — Request diulang / double submit
Status: ✅ Resolved (2026-09-21) | Severity: Medium
Resolusi: threshold POST kini memakai `Idempotency-Key` (`beginIdempotent`/`completeIdempotent`, pola sama dengan task POST) sehingga double-submit mengembalikan respons tersimpan. Bila offset sudah ada (unique `(taskId, daysBefore)`) dan key berbeda, handler me-re-read baris existing dan mengembalikan `200 { threshold }`, bukan `409`. Frontend (`threshold-manager.tsx`, `actions/tasks.ts`) mengirim key yang di-regenerate setelah sukses. `PUT` replace tetap idempoten alami; `PATCH` tetap `409` pada konflik; `DELETE` kini mengarsipkan threshold (RF-09), bukan hard-delete.
Komponen: `apps/api/src/routes/tasks.ts:315-327,379-386`, `apps/api/src/lib/api/idempotency.ts:127-243`
Bukti: task POST mendukung `Idempotency-Key` + replay; threshold POST (`:584-646`), PUT (`:647-754`), PATCH (`:755-820`), DELETE tanpa `readIdempotencyKey`/`beginIdempotent`; unique `(taskId,daysBefore)` (`schema.ts:233`) dan `isUniqueViolation → 409` (`tasks.ts:623-630`, `:794-801`).

Skenario: double-click "tambah threshold H-3" → request kedua 409 `Threshold already exists`, bukan replay sukses. Retry browser setelah timeout tapi insert pertama sukses → user lihat error padahal data sudah ada.

Perilaku saat ini: aman dari duplikat (constraint), tidak aman dari UX membingungkan; `PUT` replace idempoten secara alami; `POST /:id/complete` idempoten (`:529-531` return existing bila `done`).

Dampak: terbatas pada threshold endpoints; cron `GET` aman diulang (klaim atomik).

Rekomendasi: tambah `Idempotency-Key` pada threshold POST (dan opsional PUT), atau di frontend disable-double-submit + treat 409 sebagai sukses idempoten bila body sama.

Cara verifikasi setelah diperbaiki: kirim 2 POST threshold identik paralel → assert 1 baris + (bila diperbaiki) respons kedua replay 200, bukan 409.

### RF-07 — Edit deadline/threshold mid-run mengirim snapshot basi
Status: ✅ Resolved (2026-09-21) | Severity: Medium
Resolusi: live re-check per batch (yang sebelumnya hanya `status`/`deletedAt`) kini juga mengambil `tasks.deadline_updated_at` + versi `reminder_thresholds` untuk task di batch. Sebelum `claimUserSendBudget`, `isDeliveryStale` membandingkan versi snapshot vs live; bila berubah, delivery dibatalkan: row dihapus (`DELETE notification_deliveries`) agar run berikutnya bisa membuat ulang dengan data baru, log `[reminders] skipped send, task edited mid-run`, kuota tidak terpakai. Edit tak terkait (title/status/course) tidak mengubah kolom versi sehingga tidak membatalkan kirim.
Komponen: `apps/api/src/services/run-evaluate.ts:379-412`, `:591-612`
Bukti: `taskById`/`profileById` dibangun dari snapshot batch (`:362-363`); pengiriman memakai `task.title`, `task.deadline.toISOString()` snapshot; live-check hanya validasi `status/deletedAt` (`:566-571`), tidak membandingkan `deadline/updatedAt`.

Skenario: batch dibaca 10:00 (deadline 1 Okt), user edit deadline ke 15 Okt 10:00:05, kirim 10:00:10 masih bawa deadline lama + guard F-01 dihitung dari snapshot.

Perilaku saat ini: email terkirim dengan data basi; tidak ada lost-update di DB (PATCH memakai `updatedAt` optimistic concurrency + `FOR UPDATE` di PUT), tapi evaluator tak ikut serta.

Dampak: user bingung (email sebut deadline salah); jarang (window detik–menit).

Rekomendasi: sebelum `deliverEmail`, bandingkan `deadlineUpdatedAt/threshold.updatedAt` live (atau `SELECT … FOR UPDATE` per delivery); bila berubah, lewati dan biarkan run berikut evaluasi ulang.

Cara verifikasi setelah diperbaiki: mulai run dengan send di-stub lambat, edit deadline mid-run → assert email dibatalkan / memakai deadline baru.

### RF-08 — Poison missing-email loop
Status: ✅ Resolved (2026-09-21) | Severity: Low
Resolusi: kedua cabang `!task || !to` kini menandai poison deterministik sebagai terminal saat pertama terdeteksi: `markFailed(id, MAX_EMAIL_DELIVERY_RETRIES, "missing task or recipient email")` → `retry_count = 3` sehingga `evaluateReminders` berhenti menawarkan retry. Counter baru `emailsPoisoned` (subset `emailsFailed`) diteruskan ke `isSystemicReminderFailure`, yang menghitung `realFailures = emailsFailed - emailsPoisoned` — run yang hanya berisi poison tidak lagi memicu alert "blackout". `emails_failed` di ledger tetap memuat poison untuk observabilitas; `cron` logs/Sentry extras menyertakan `emailsPoisoned`.
Komponen: `apps/api/src/services/run-evaluate.ts:891-903`, `:948-960`, `apps/api/src/lib/reminder-alert.ts:13-33`, `apps/api/src/routes/cron.ts:60-90`
Bukti: kedua cabang `!task || !to` memanggil `markFailed(id, undefined, "missing task or recipient email")` — tanpa `retryCount`, sehingga `retry_count` tak naik dan `evaluateReminders` (`evaluate.ts:265-279`) terus tawarkan retry tiap run.

Skenario: profil tanpa email (praktis mustahil karena `profiles.email NOT NULL`, tapi profil hilang / task yatim / race hapus) → tiap cron `emailsFailed+1`, berpotensi picu blackout alert palsu bila itu satu-satunya work.

Perilaku saat ini: tidak ada terminal untuk poison ini; log tersedia.

Dampak: kecil, noise operasional.

Rekomendasi: naikkan `retryCount` untuk poison deterministik ini juga (atau tandai `failed` terminal langsung dengan `last_error` jelas), dan kecualikan poison deterministik dari hitungan blackout.

Cara verifikasi setelah diperbaiki: buat delivery tanpa profil → jalankan 5 run → assert `retry_count = 3` dan run berikutnya tidak retry, serta run poison-only tidak memicu alert.

### RF-09 — PUT thresholds menghapus riwayat delivery
Status: ✅ Fixed (2026-09-21) | Severity: Critical
Komponen: `apps/api/src/routes/tasks.ts:704-712`, `packages/db/src/schema.ts:218-220`, `:240-245`
Bukti: `toDeleteIds → tx.delete(reminderThresholds)`; FK `threshold_id → reminder_thresholds.id onDelete cascade` dan `task_id → tasks.id onDelete cascade`.

Skenario: user ganti set threshold [7,3,1] → [7,1] → threshold H-3 dihapus → semua delivery H-3 (`sent`, `failed`, `pending`) ikut terhapus. Audit "kapan email dikirim" hilang; bila user tambah H-3 lagi, threshold id baru → email H-3 dikirim ulang (lihat RF-10).

Resolusi (2026-09-21): hapus threshold kini **arsip, bukan hard-delete**. Migrasi `20260921060000_threshold_archive.sql` menambah `reminder_thresholds.deleted_at`, mengganti unique `(task_id, days_before)` menjadi partial unique `... where deleted_at is null`, dan mengubah `enforce_threshold_quota` menghitung baris aktif saja. `PUT` mengarsipkan offset yang dibuang (`update ... set deleted_at`), `DELETE /thresholds/:id` juga arsip. Policy RLS `thresholds_delete_own` dihapus dan diganti trigger `BEFORE DELETE` `forbid_threshold_delete` (raise `THRESHOLD_HARD_DELETE_FORBIDDEN`) yang tetap mengizinkan cascade RI (task/user delete, dijaga `pg_trigger_depth() > 0`). Baris delivery `sent`/`failed`/`pending` tetap hidup karena tidak ada lagi cascade.

Cara verifikasi: `tasks.thresholds-put.test.ts` (PUT arsip + re-add offset), `run-evaluate.test.ts` (re-add offset terkirim tidak kirim ulang; pending threshold terarsip tidak dikirim), `packages/db/src/schema.test.ts` (kolom + partial unique index), `supabase/tests/rls_matrix.sql` §8/§8b (DELETE owner 0 baris; direct DELETE raise; cascade task tetap jalan).

### RF-10 — Threshold recreate memicu kirim ulang
Status: ✅ Fixed (2026-09-21, bersama RF-09) | Severity: Low
Komponen: `packages/db/src/schema.ts:272`, `packages/domain/src/evaluate.ts:212-223`
Bukti: unique `(thresholdId,daysBefore,channel)`; guard F-01 (`trigger < editCutoff → skip`) memakai `threshold.updated_at/created_at` baru.

Skenario: hapus H-3 lalu buat H-3 lagi selagi masih due → id baru, `created_at` baru. Bila trigger sudah lewat sebelum recreate, F-01 menahan; bila trigger masih di masa depan / tepat due, email dikirim lagi.

Resolusi (2026-09-21): identitas delivery kini **per (task, days_before, channel), bukan per `threshold_id`**. `evaluateReminders` mencocokkan kandidat berdasarkan `days_before + channel`; baris `pending`/`sending`/`sent` (termasuk di bawah threshold yang sudah diarsipkan) menahan pengiriman ulang, dan retry email hanya memakai baris milik threshold live. Karena threshold diarsipkan (RF-09), delivery lama tetap ada sehingga pencocokan offset menemukan riwayat `sent`. Kunci unik delivery sengaja **tidak** diubah (tetap `(threshold_id, days_before, channel)`); baris gagal milik threshold terarsip tidak dibangkitkan, melainkan dibuat baris baru untuk threshold live.

Cara verifikasi: `packages/domain/src/evaluate.test.ts` (RF-09/RF-10 describe: re-add offset terkirim → `[]`; failed arsip → create; live failed under cap → retry; at cap → suppress) dan `apps/api/src/services/run-evaluate.test.ts` (RF-09 describe).

### RF-11 — First-run burst / cron catch-up
Status: ✅ Fixed (2026-09-22) | Severity: High
Komponen: `apps/api/src/lib/reminder-cutoff.ts:20-31`, `.env.example:51-56`, `docs/ARCHITECTURE.md:109-117`, `docs/product.md:197`
Bukti: `getReminderCutoff()` return `null` bila unset/kosong (silent), warn hanya bila invalid; template env commented out; scheduler runner TBD; `evaluateReminders` tanpa cutoff mengevaluasi semua historis.

Skenario: deploy pertama dengan 500 task historis past-due → run pertama create+kirim semuanya, hanya direm kuota 50/user/run → user dengan banyak task tetap dapat 50 email sekaligus, run berikut 50 lagi.

Perilaku saat ini: by design "pre-existing behavior", tapi checklist prod (`PROD_ENV_CHECKLIST.md:37`) mewajibkan isi cutoff saat deploy — mudah terlewat karena kode tak fail-closed.

Dampak: spam hari pertama; cron yang mati 5 siklus lalu hidup → catch-up massal telat tanpa label keterlambatan.

Rekomendasi: jadikan `REMINDER_CUTOFF_ISO` wajib di produksi (gagal boot bila kosong seperti `CRON_SECRET`), atau default ke instant deploy (build time) + dokumentasikan preview count query (sudah ada di runbook §5); tambah label "late" / batas keterlambatan bila diperlukan produk.

Resolusi (2026-09-22):
- **Fail-closed env (Part 1):** `assertReminderCutoffConfigured()` (`lib/reminder-cutoff.ts`) — `NODE_ENV=production` + `REMINDER_CUTOFF_ISO` kosong/blank/invalid → boot throw `500`; dev/test tetap lenient. Dipanggil dari `assertStartupConfig()` (`env.ts:15`). `.env.example` kini template aktif (wajib prod).
- **Late labeling (Part 2):** `REMINDER_LATE_AFTER_MS = 1h`. Trigger ≥ 1h stale saat evaluasi → `late`. Email: subject `[H-N] [LATE] Reminder: …` + baris body; label di-freeze ke `email_snapshot` pada percobaan pertama sehingga retry memakai body tetap dan idempotency key stabil. In-app: tak ada body → `isLate` diturunkan saat baca (`sent_at` vs trigger timezone-aware) di `serialize.ts` (`notificationIsLate`), badge "Late" di web; list route join tasks.deadline + profiles.timezone.
- **Batas keterlambatan (Part 2):** `REMINDER_DEADLINE_GRACE_MS = 1h`. Deadline lewat > 1h → evaluator berhenti menjadwalkan task tsb (create & retry), jadi catch-up tak nge-nag task yang sudah overdue; H-0 tetap terkirim di run hourly pertama setelah deadline.

Cara verifikasi: boot prod tanpa cutoff/invalid → throw (env.test.ts + reminder-cutoff.test.ts); `packages/domain/src/evaluate.test.ts` RF-11 describe (late false/true boundary, suppression create+retry, grace boundary, H-0); `apps/api/src/services/run-evaluate.test.ts` RF-11 describe (e2e `[LATE]` subject, retry body frozen, deadline-past → 0); `apps/api/src/lib/api/notification-late.test.ts` + `email-resilience.test.ts` RF-11 describe. Suites: apps/api 487 pass, packages/domain 64 pass, bun run typecheck clean.

### RF-12 — Batch tak terbatas vs timeout
Status: ✅ Resolved (2026-09-22) | Severity: High
Resolusi: migrasi `20260922000000` menambah `reminder_runs.truncated boolean NOT NULL DEFAULT false`. `runEvaluateReminders` kini di-bound per invokasi via `MAX_TASKS_PER_RUN` (default 10.000) dan `MAX_RUN_DURATION_MS` (default 120.000ms, dibatasi < `RUN_LOCK_STALE_MS`); cron meneruskan nilai env (lenient: invalid/unset → default, tidak pernah gagal-boot). Cek di kepala loop (batch-atomic, batch pertama selalu jalan) → bila cap/deadline tercapai, run menutup ledger rapi (`status ok`, `finished_at`, `truncated=true`, `last_seen_task_id` di cursor) dan menghitung backlog `COUNT(*)` task terbuka di belakang cursor (di-log). Run berikut memindai ulang penuh; delivery `sent`/`pending` menekan resend via identitas `(task, offset, channel)` — tidak ada yang terlewat permanen, tidak ada kirim ganda.
Komponen: `apps/api/src/services/run-evaluate.ts` (loop head, `finishRunRecord`), `apps/api/src/routes/cron.ts`, `apps/api/src/env.ts`, `packages/db/src/schema.ts` + `schema-contract.ts`, migrasi `20260922000000`
Bukti: `run-evaluate.ts` (cap resolve + clamp, loop-head check, backlog count, `truncated` di result/ledger); `cron.ts:45-50` (options env dibawa, `truncated` di log/extras); `env.ts` (`lenientPositiveInt` untuk kedua knob).
Skenario (sebelum): 10k task × 3 threshold → ratusan batch → run melebihi timeout serverless → proses dibunuh tengah batch → cron 500/timeout, sebagian `sent` sebagian `pending`, re-scan penuh di retry.
Perilaku saat ini: run selesai paling lambat cap/deadline, ledger menandai `truncated` bila belum selesai, sisa diambil run berikutnya. Catatan: host-level `maxDuration` masih TBD mengikuti keputusan hosting (`ARCHITECTURE.md:109-117`, `product.md:197`) — knob env adalah pertahanan runtime yang sudah ada.
Dampak: cron tidak lagi timeout berulang pada tenant besar; biaya re-scan tetap (murah: send di-suppress), tidak ada double-send.
Rekomendasi tersisa: set `timeout`/`maxDuration` host eksplisit sesuai hosting saat diputuskan; ukur p95 durasi run di staging (log `durationMs` + `truncated` sudah tersedia di `[cron] evaluate-reminders finished`).
Cara verifikasi setelah diperbaiki: `apps/api/src/services/run-evaluate.test.ts` RF-12 describe (cap task, cap durasi, dalam-batas, cap 0 → batch pertama jalan, env var, lock-skip `truncated:false`); seed 5k task due → run selesai/truncated rapi tanpa 500, run berikut lanjutkan sisa. Suites: apps/api 494 pass.

### RF-13 — Env hilang / default diam-diam
Status: ✅ Resolved (2026-09-22) | Severity: Medium
Komponen: `apps/api/src/lib/resend-config.ts`, `apps/api/src/env.ts`
Resolusi: `assertResendConfigured()` (dipanggil `assertStartupConfig`): prod wajib `RESEND_API_KEY` berbentuk `re_` dan `RESEND_FROM_EMAIL` berupa alamat valid. Missing/invalid keduanya → boot throw. Domain sandbox `resend.dev` → `console.warn` (bukan throw, sender transisi tetap bisa boot). Dev/test tetap lenient. Default `onboarding@resend.dev` dihapus dari `.env.example` (kini template aktif).
Bukti: `resend-config.ts` (`resendConfigProblem` pure, diuji di `resend-config.test.ts`); `env.ts` `assertStartupConfig → assertResendConfigured`; `env.test.ts` RF-13 describe (5 kasus prod); `.env.example` baris `RESEND_API_KEY`/`RESEND_FROM_EMAIL`; `PROD_ENV_CHECKLIST` §2.
Verifikasi terbaru: boot prod tanpa `RESEND_FROM_EMAIL` → throw (bukan default sandbox silent); tanpa `RESEND_API_KEY` → throw (fail-closed, menggantikan "blackout + 0 sent" — fallback runtime tetap ada untuk key yang invalid pasca-boot).

### RF-14 — Observability & recovery
Status: ✅ Resolved (2026-09-22) | Severity: Medium
Komponen: `apps/api/src/routes/health-cron.ts`, `cron.ts`, `env.ts`, runbook
Resolusi: endpoint publik read-only `GET /health/cron` (`app.ts` di-mount setelah cron): query `reminder_runs` terakhir, healthy ⇐ `status='ok' && finished_at` dan `now − started_at ≤ 2 × REMINDER_RUN_INTERVAL_MS` (getter lenient, default 1 jam); belum/`error`/`running` stuck/stale → `503` + payload minimal `{ok, lastRunAt, lastStatus, evaluatedTasks}` (bukan `{ok:true}` SEC-008 — route baru tidak menyentuh kontrak cron). Pemicu alert eksternal = polling HTTP status code (UptimeRobot, dll). Sentry warning `"reminder run truncated…"` saat `result.truncated` (kecuali sudah blackout). Runbook §"Monitoring & recovery" berisi wiring monitor + SQL dashboard (failed/hari, `sending` stale, backlog kuota).
Bukti: `health-cron.test.ts` (8 kasus: fresh/boundary/stale/error/running/none/interval-custom/interval-lenient); `cron.ts` blok truncation warning (RF-14); `openapi-coverage.test.ts` mendaftar `GET /health/cron`; `env.runIntervalMs`.
Verifikasi terbaru: staging — hentikan scheduler 2× interval → `GET /health/cron` `503`; jalankan normal → `200`; `failed` parsial → tetap `200` (alert hanya blackout & truncation).

### RF-15 — Migrasi vs kode lama
Status: ✅ Resolved (2026-09-22) | Severity: Medium
Komponen: `apps/api/src/lib/schema-prereqs.ts`, `apps/api/src/index.ts`
Resolusi: `assertReminderSchemaPrerequisites()` prod-only memeriksa `pg_enum` (nilai `sending` pada `notification_status`) + `information_schema` (`notification_deliveries.claimed_at`) sebelum `app.listen` (`index.ts` — top-level await). Missing salah satu/besar → throw dengan nama objek + petunjuk operator `Run "bun run db:migrate" (atau supabase db push) BEFORE deploying this API build`. `deriveMissingReminderPrereq` pure + diuji (tipe/message/hint). Non-prod skip. Urutan CI/CD sudah benar (`ci.yml` `migrate.ts verify` + `deploy-staging.yml` job migrate terpisah) — startup check = jaring pengaman terakhir.
Bukti: `schema-prereqs.ts` + `schema-prereqs.test.ts` (9 tes); `index.ts`; pesan bukan 500 generik — langsung menyebut objek hilang.
Verifikasi terbaru: jalankan kode baru di DB lama (staging, tanpa migrasi) → boot throw terbaca "…missing… run bun run db:migrate"; setelah migrate → boot normal; kode lama di DB baru → aman (evaluator fall-through `evaluate.ts:255-261`).

## 5. Yang Sudah Ditangani dengan Baik (✅)

- **RF-03 — Overlap cron tanpa duplikat.** Bukti: `onConflictDoNothing([thresholdId,daysBefore,channel])` (`run-evaluate.ts:452-459`, `:475-481`); retry claim `WHERE status='failed' AND retryCount<3 … RETURNING` (`:517-532`); sweep claim `pending→sending` / `sending`-stale-15mnt (`:646-664`, `SENDING_CLAIM_STALE_MS=15m :38`); provider key deterministik (`email.ts:50-59`); `queuedIds` cegah antre ganda dalam satu run (`:615`). Komentar kode eksplisit "exactly one run delivers".
- **RF-05 — Hapus/complete mid-run tak kirim email basi hapus.** Bukti: soft-delete (`tasks.ts:553-570`); live re-check indexed `WHERE id IN (…) AND deletedAt IS NULL` (`run-evaluate.ts:552-557`); `isTaskLive` tolak `done`/hilang (`:566-571`); skip tanpa catat `failed`/konsumsi kuota (`:581-590`). FK cascade hanya untuk hard-delete langsung di DB (`schema.ts:219-220,242-245`).
- **Cron auth & throttling.** Bukti: `authorizeCron` constant-time, 401 generik (`cron.ts:13-26`); `assertStartupConfig` wajibkan secret di prod (`env.ts:15-33`); rate limit cron 10/mnt (`rate-limit.ts:41-43`); in-memory fallback didokumentasikan sebagai non-distributed (`:123-131`).
- **Klasifikasi retry Resend.** Bukti: `isNonRetryableReminderError` (4xx kecuali 429) (`email.ts:120-128`); `Retry-After` cap 30s (`:83,299-305`); backoff+jitter (`net.ts:68-77`); timeout 10s via `AbortSignal.timeout` (`email.ts:242,278-281`).
- **Timezone/DST & guard edit.** Bukti: `thresholdTriggerAt` calendar-day + iterasi DST (`domain/evaluate.ts:57-84`); fallback UTC untuk TZ tak dikenal (`email.ts:175-180`); `deadlineUpdatedAt/threshold.updatedAt` + F-01 skip (`evaluate.ts:212-223`; `tasks.ts:449-455,781-784`; migrasi `20260920000000`).

## 6. Belum Terverifikasi (❓)

- **RF-16 — Clock skew app vs DB.** `SENDING_CLAIM_STALE_MS` dihitung dengan `Date.now()` app (`run-evaluate.ts:658`) vs `claimed_at` yang ditulis app juga (`:648`) — konsisten app-side, tapi `sent_at/finished_at` pakai `new Date()` app sementara trigger pakai `now` param. Skew antar replika bisa sebabkan reclaim prematur / trigger tepi meleset detik. Butuh: apakah cron single-replica? Apakah DB `now()` vs app `now()` pernah dibandingkan? Artefak: config deploy + jumlah replika.
- **RF-17 — Pool habis / Resend rate-limit global.** Pool `max:10`, concurrency 5, 3 lookup paralel per batch — secara teori aman, tapi belum ada angka prod (baris tabel, p95 batch, limit Resend akun). Butuh: traffic prod + slow-query log + dashboard Resend.
- **RF-18 — Webhook bounce/complaint.** Tidak ada endpoint webhook di repo (dikonfirmasi `SECURITY_SIGNOFF:190` N/A by design; `schema.d.ts:600` `webhooks = never`). Berarti `sent` = accepted. Bukan bug, tapi keputusan produk yang harus eksplisit di `DOMAIN.md` + checklist "supresi Resend otomatis cukup".

## 7. Rencana Perbaikan Berprioritas

### Segera (sebelum rilis)
| Prioritas | ID | Perbaikan | Effort | Dependensi |
|---|---|---|---|---|
| P0 | RF-11 | ~~Wajibkan `REMINDER_CUTOFF_ISO` di prod + dry-run count query sebelum aktivasi~~ ✅ Selesai: fail-closed env + label `[LATE]` + batas keterlambatan (deadline grace 1h); dry-run count query tetap di runbook §5 | S | — |
| P0 | RF-09 | ~~Larang hapus threshold ber-delivery `sent`~~ ✅ Selesai: arsip (`deleted_at`) + guard trigger, bukan cascade-delete | M | — |
| P0 | RF-13 | ~~Wajibkan `RESEND_*` prod; hapus default sandbox~~ ✅ Selesai: fail-closed boot (`assertResendConfigured`) + format `re_` + warn sandbox | S | — |

### Jangka pendek
| Prioritas | ID | Perbaikan | Effort | Dependensi |
|---|---|---|---|---|
| P1 ✅ | RF-12 | Cap task per run + `truncated` flag; `maxDuration` host eksplisit | M | Host diputuskan (TBD) — runtime knobs selesai; `maxDuration` host menunggu hosting |
| P1 ✅ | RF-07 | Cek versi deadline/threshold sebelum kirim (batalkan bila berubah mid-run) | S | — |
| P1 | RF-14 | ~~Alert "no ok run dalam 2× interval" + dashboard failed/stuck/kuota~~ ✅ Selesai: `/health/cron` (200/503) + Sentry truncation + SQL dashboard di runbook; ops sign-off: pasang monitor eksternal ke `/health/cron` | M | Monitor eksternal (ops) |
| P1 ✅ | RF-01 | `connect_timeout/statement_timeout` + `last_error` untuk `markSent`-gagal | S | — |
| P1 ✅ | RF-04 | Dokumentasikan quota-double-spend, atau kunci kuota di DB bila overlap realistis | S/M | Info replika/scheduler |

### Backlog
| Prioritas | ID | Perbaikan | Effort | Dependensi |
|---|---|---|---|---|
| P2 ✅ | RF-06 | `Idempotency-Key` untuk threshold POST (atau treat 409-sebagai-sukses di klien) | S | — |
| P2 ✅ | RF-02 | Freeze body snapshot per delivery; nyatakan "sent=accepted" tanpa webhook | S/M | Keputusan produk |
| P2 ✅ | RF-08 | Terminal-kan poison missing-email + kecualikan dari blackout | S | — |
| P2 | RF-15 | ~~Startup check enum/kolom + migrate-sebelum-deploy di pipeline~~ ✅ Selesai: `assertReminderSchemaPrerequisites` (prod boot) + CI sudah urut | S | CI/CD ✅ |
| P2 | RF-10 | ~~Selesaikan bersama RF-09~~ ✅ Selesai: matching delivery per `(task, days_before, channel)` + threshold arsip | M | — |

## 8. Skenario Uji yang Direkomendasikan

1. **Overlap 2 run paralel** (60 due, 1 user): assert 1 baris per `(threshold,daysBefore,channel)`, 1 email per delivery di Resend (cek key), total ≤50 bila kuota diperketat.
2. **Kill mid-batch** (stub send lambat + `SIGKILL` setelah 50%): assert tidak ada `sending` fresh-stuck, run berikut menyapu `pending` tanpa duplikat.
3. **Ambiguous timeout**: Resend terima tapi respons timeout → assert `failed` lalu retry key-sama tidak kirim ulang (dashboard 1 email).
4. **Body berubah antar attempt**: edit title lalu retry → assert key baru (duplikat terdokumentasi) atau ditolak dengan pesan jelas.
5. **Delete/complete mid-run**: stub send lambat, soft-delete task mid-run → assert skip, delivery tetap `pending`, tidak ada email.
6. **Edit deadline mid-run**: assert kirim dibatalkan atau bawa deadline baru, tidak pernah basi.
7. **Double submit threshold**: 2 POST identik paralel → assert 1 baris; (bila diperbaiki) respons kedua replay bukan 409.
8. **PUT hapus threshold ber-delivery**: assert 409 / arsip, riwayat `sent` utuh.
9. **Poison missing-email**: 5 run beruntun → assert terminal di ≤3 retry, tidak alert blackout palsu.
10. **Burst guard**: seed historis past-due, run tanpa cutoff vs dengan cutoff → assert beda jumlah kirim; boot prod tanpa cutoff → assert gagal.
11. **429 Resend dengan `Retry-After`**: assert sleep ≈ header (cap 30s) + key sama antar attempt.
12. **Scheduler mati 2 interval**: assert alert "no ok run" fired; partial 1/100 gagal → assert sunyi.
13. **Migrasi terbalik**: kode baru di DB lama → assert pesan jelas; kode lama di DB baru → assert aman.

## 9. Asumsi & Pertanyaan Terbuka

1. **Scheduler produksi apa, berapa replika, interval berapa?** Repo menyebut TBD (`ARCHITECTURE.md:109-117`, `product.md:197`). Audit mengasumsikan overlap mungkin (double-fire/retry scheduler). Jawaban menentukan urgensi RF-04 (lock, ✅) / interval vs RF-12 (bound run, ✅).
2. **Host API (serverless? VM? max timeout?)** — tidak ada `vercel.json`/`maxDuration`. RF-12 severity High bertumpu pada asumsi timeout tidak cukup untuk full-scan besar; runtime knobs (`MAX_TASKS_PER_RUN`/`MAX_RUN_DURATION_MS`, ✅) menutup sisi evaluator, tersisa menyelaraskan `timeout`/`maxDuration` host dengan knob (kalau host cap < default 120s, set `MAX_RUN_DURATION_MS` lebih kecil).
3. **`DATABASE_URL` role apa di prod (BYPASSRLS atau tidak)?** RLS diasumsikan defense-in-depth; scheduler diasumsikan privileged via `pg_has_role(service_role)` (migrasi C-1). Bila role berbeda, trigger guard bisa salah menolak.
4. **Apakah `REMINDER_CUTOFF_ISO` akan diisi saat deploy?** Checklist bilang wajib, kode tidak menegakkan. Audit mengasumsikan bisa terlupa.
5. **Apakah "sent = accepted by Resend" (tanpa delivered/bounce tracking) dapat diterima produk?** Diputuskan N/A webhook, tapi belum eksplisit di domain doc.
6. **Retensi `pending` yatim (task done/deleted)**: dibiarkan selamanya by design (runbook §2). Apakah perlu purge/arsip?
7. **Batas keterlambatan catch-up**: apakah email yang telat N hari tetap dikirim? Saat ini ya (kecuali cutoff). Perlu keputusan produk + label "late"?
