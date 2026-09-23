# Audit Sistem Reminder — Scheduled Reminder & Notification Delivery

Tanggal: 2026-09-20 | Auditor: senior backend reliability engineer (forensik, skeptis) | Scope: subsistem *scheduled reminder & notification delivery* (cron → `evaluateReminders` → Resend).

Sikap: sistem reminder gagal secara senyap. Absennya error bukan bukti kebenaran. Setiap temuan di bawah punya referensi `path:baris`; komentar kode bukan bukti; test yang diklaim lulus benar-benar dijalankan (hasil di §6).

## 1. Ringkasan Eksekutif

Sistem reminder berada dalam kondisi **baik di atas rata-rata**: idempotency inti ditegakkan di database + klaim atomik + provider key, dan terbukti lewat test konkurensi yang dijalankan (20 + 35 pass). Total temuan: 0 Critical, 1 High, 5 Medium, 8 Low. Risiko terbesar yang belum tertangani: **perubahan deadline (dan reopen task) memicu reminder retroaktif yang menurut `DOMAIN.md` seharusnya tidak pernah terkirim** — satu-satunya pelanggaran spesifikasi yang terbukti dari kode.
Test dijalankan: `packages/domain/src/evaluate.test.ts` (20 pass), `run-evaluate.test.ts` + `email-resilience.test.ts` (35 pass) — status *verified passed*, bukan klaim.

## 2. Peta Sistem

Satu-satunya entry point produksi: `GET /api/v1/cron/evaluate-reminders` → `authorizeCron` → `runEvaluateReminders()` (`apps/api/src/routes/cron.ts:26-42`, `apps/api/src/routes/cron.ts:11-24`). Tidak ada queue consumer, webhook, admin trigger, startup hook, atau backfill script — call-tracing hanya menemukan pemanggil `runEvaluateReminders` dari `cronRoutes`. Flow per run (`docs/ARCHITECTURE.md:117-122`): load open tasks (keyset batch) + thresholds + deliveries + profiles → `evaluateReminders` murni → insert `pending`/klaim retry atomik → kirim via Resend (serial) → `markSent`/`markFailed`. Cron juga mem-purge idempotency keys dan audit events (`apps/api/src/routes/cron.ts:30-41`).

Tabel `notification_deliveries` (`packages/db/src/schema.ts:216-242`; DDL awal `supabase/migrations/20260901040000_notification_deliveries.sql:16-27`): `id` PK uuid, `task_id` FK cascade, `threshold_id` FK cascade, `days_before` integer, `channel` enum(`email`,`in_app`), `status` enum(`pending`,`sent`,`failed`) default `pending`, `retry_count` default 0 check ≥0, `sent_at`/`read_at`/`created_at` semua `timestamptz`. Unique aktual: **`(threshold_id, days_before, channel)`** (`packages/db/src/schema.ts:237`). Satu baris = **satu reminder logis**, bukan satu percobaan — retry memakai ulang baris yang sama (`packages/domain/src/evaluate.ts:136-144`, `apps/api/src/services/run-evaluate.ts:314-337`). Tidak ada kolom `scheduled_for`, `failed_at`, atau `last_error`. Urutan operasi per delivery baru: **insert `pending` → kirim HTTP → update `sent`/`failed`** (`apps/api/src/services/run-evaluate.ts:285-311` → `:340-359` → `:148-153`).

## 3. Sudah Benar / Sudah Selesai

| # | Dimensi | Perilaku yang terjamin | Mekanisme penjamin | Bukti |
|---|---------|------------------------|--------------------|-------|
| 1 | D,E | Duplikat create konkurensi tidak mungkin lolos | Unique `(threshold_id, days_before, channel)` + `onConflictDoNothing` + cek `returning` kosong → skip | `packages/db/src/schema.ts:237`, `apps/api/src/services/run-evaluate.ts:285-304` |
| 2 | D,E | Retry konkurensi hanya diklaim satu worker | Update-bersyarat atomik `status='failed' AND retryCount<3 → pending+1`, loser dapat 0 row → skip | `apps/api/src/services/run-evaluate.ts:317-337` |
| 3 | D,H | Timeout-tapi-terkirim tidak menjadi duplikat | Provider idempotency key deterministik `deliveryId + sha256(body)`, dipakai ulang di semua retry; 409 `concurrent_idempotent_requests` → biarkan `pending`, jangan fail | `apps/api/src/lib/email.ts:48-57`, `:204-210`, `apps/api/src/services/run-evaluate.ts:132-136` |
| 4 | H | Klasifikasi retry benar + bounded + jitter + Retry-After | 4xx non-429 dan terminal tidak di-retry; 5xx/429/throw/timeout retry max 3 attempt, backoff equal-jitter, timeout 10s/abort per attempt | `apps/api/src/lib/email.ts:118-126`, `:76-77`, `:219-243`, `:276-282`, `apps/api/src/lib/net.ts:69-77` |
| 5 | B,H,I | Satu delivery gagal tidak menghentikan batch/run | `markSent`/`markFailed` try/catch → bool; `deliverEmail` catch → fail+lanjut; G6/G7 verified pass | `apps/api/src/services/run-evaluate.ts:70-108`, `:131-147`; `apps/api/src/services/run-evaluate.test.ts:721-788` |
| 6 | B,E | Tidak ada transaksi yang menggantung HTTP call; isolasi tidak relevan | Tanpa transaksi eksplisit per statement; komentar eksplisit "No row lock is held across this network call" | `apps/api/src/services/run-evaluate.ts:379-380` |
| 7 | B | Query bounded + cursor stabil | Keyset `gt(lastSeenTaskId)` + `orderBy asc(id)` + `limit(batchSize=100)`; M-12 verified pass | `apps/api/src/services/run-evaluate.ts:22`, `:158-177`; `apps/api/src/services/run-evaluate.test.ts:1062-1263` |
| 8 | C,F | Threshold kalender + DST-safe, operator inklusif terdokumentasi | `thresholdTriggerAt` kurangi hari kalender di tz user + iterasi offset 3x; `now >= trigger`; boundary ±1 detik ter-test | `packages/domain/src/evaluate.ts:39-55`, `:61-96`; `packages/domain/src/evaluate.test.ts:15-34` |
| 9 | K | Threshold lampau saat *creation* tidak membanjiri user | Guard `trigger < createdAt → skip`; ter-test H-7/H-3 | `packages/domain/src/evaluate.ts:177-180`; `packages/domain/src/evaluate.test.ts:72-77` |
| 10 | D,K | Mutasi offset threshold tidak menimpa snapshot historis | Dedupe cocokkan `(threshold_id, days_before)` keduanya; unique mencakup `daysBefore`; M-4 verified pass | `packages/domain/src/evaluate.ts:182-188`; `apps/api/src/services/run-evaluate.test.ts:794-918` |
| 11 | H,K | Retry lintas-siklus capped, lalu terminal permanen | `MAX_EMAIL_DELIVERY_RETRIES=3`, `retry_count<3` di dua lapis; lifecycle 4 attempt verified | `packages/domain/src/evaluate.ts:98`, `:207-211`; `apps/api/src/services/run-evaluate.test.ts:999-1056` |
| 12 | B,L,M | Quota blast-radius per user per run | `MAX_EMAILS_PER_USER_PER_RUN=50`, kelebihan tetap `pending` + `emailsSkippedQuota`; ter-test 60→50/10 | `packages/domain/src/quotas.ts:24`, `apps/api/src/services/run-evaluate.ts:59-64`, `:348-351` |
| 13 | M | Waktu injectable/deterministik | `evaluateReminders(tasks, now)` dan `runEvaluateReminders(now = new Date(), …)` | `packages/domain/src/evaluate.ts:155-158`, `apps/api/src/services/run-evaluate.ts:38-39` |
| 14 | I | Cron terautentikasi, respons minimal, tanpa PII di log | `CRON_SECRET` + compare timing-safe; respons `{ok:true}`; log hanya counts | `apps/api/src/routes/cron.ts:11-24`, `:45-56` |
| 15 | F,A | Waktu disimpan tz-aware; tanpa aritmetika proses-tz di path reminder | Semua kolom waktu `timestamptz`; `getZonedParts` selalu dengan `timeZone` eksplisit | `packages/db/src/schema.ts:177,230-234`, `packages/domain/src/evaluate.ts:2-12` |

## 4. Temuan — Harus Diperbaiki

```
[F-01] Deadline dimajukan → threshold yang baru-menjadi-lampau langsung terkirim (melanggar DOMAIN.md §4)
Dimensi    : K (C)
Severity   : High
Bukti      : packages/domain/src/evaluate.ts:177-180 vs docs/DOMAIN.md:93
Kondisi    : Task dibuat 1 Sep, deadline 30 Sep. Tgl 10 Sep user memajukan deadline ke 12 Sep. H-7 trigger baru = 5 Sep (lampau, tapi > createdAt) → guard `trigger < createdAtMs` FALSE → run berikutnya insert + kirim email H-7 untuk kejadian 5 hari lalu.
Dampak     : Email kejutan yang seharusnya tidak ada; tiap edit deadline ke tanggal dekat memicu burst yang sama. Realistis — edit deadline adalah operasi umum.
Akar masalah: Guard non-retroactive hanya mengenal `created_at`, tidak mengenal "kapan deadline diubah". Spesifikasi menuntut guard kedua (trigger lampau saat edit) yang tidak ada di kode maupun skema (tanpa kolom versi/deadline-snapshot).
Reproduksi : baseTask createdAt 2026-09-01, deadline baru 2026-09-12, now 2026-09-10, threshold H-7 → expect [] per spec, aktual [create email, create in_app].
Perbaikan  : Opsi A (kecil): simpan `deadline` snapshot per delivery/threshold-eval dan skip trigger yang sudah lampau sebelum perubahan terakhir diketahui — butuh kolom baru. Opsi B (kontrak): saat PATCH deadline, hapus/skip threshold yang trigger-barunya lampau di route (validasi seperti custom-threshold). Trade-off: B tanpa migrasi tapi logika terbelah route vs evaluator.
Usaha      : M
```

```
[F-02] Reopen done → todo menghidupkan kembali threshold yang lewat selama done
Dimensi    : K
Severity   : Medium
Bukti      : packages/domain/src/evaluate.ts:161-162; docs/DOMAIN.md:83-84
Kondisi    : Task done selama 10 hari, lalu di-reopen. Semua threshold dengan trigger > createdAt tapi sudah lewat selama masa done langsung fire sekaligus.
Dampak     : Burst email pasca-reopen; asumsi spec ("yang sudah lewat tidak fire retroaktif") tidak ditegakkan kode.
Akar masalah: `done` hanya di-skip pada saat evaluasi; tidak ada memori kapan task di-done-kan (tanpa `completed_at` di input evaluator — kolom ada di DB tapi tidak dibaca run-evaluate.ts:159-167).
Reproduksi : Task H-1 trigger kemarin, status done kemarin, reopen hari ini → actions non-kosong, seharusnya kosong per asumsi spec.
Perbaikan  : Teruskan `completedAt`/riwayat status ke evaluator dan perlakukan trigger yang lewat selama jendela done sebagai kedaluwarsa. Trade-off: perlu keputusan produk dulu (open question DOMAIN.md) — tandai flag sementara.
Usaha      : M
```

```
[F-03] Deploy fitur / backfill historis tanpa cutoff → burst hari pertama
Dimensi    : K (J)
Severity   : Medium
Bukti      : apps/api/src/services/run-evaluate.ts:38-43,249 (tanpa cutoff/feature-flag); docs/ARCHITECTURE.md:108-114 (runner TBD, tanpa seeding)
Kondisi    : Run pertama setelah threshold/scheduler aktif mengevaluasi seluruh task lama; semua threshold due dengan trigger > createdAt langsung create+kirim, dibatasi hanya oleh quota 50/user/run.
Dampak     : Satu kali, tapi tepat pola insiden klasik; user lama menerima puluhan email tertunda sekaligus (dicicil 50/run).
Akar masalah: Tidak ada `cutoff date`, seeding baris delivery saat migrasi, atau flag "hanya task dibuat setelah X".
Reproduksi : Seed task createdAt 60 hari lalu, deadline kemarin, tanpa deliveries → 1 run → created>0 + emailsSent>0.
Perbaikan  : Tambahkan env `REMINDER_CUTOFF_ISO`; evaluator skip trigger < cutoff. Trade-off: cutoff terlalu agresif menghilangkan reminder sah — pilih tanggal deploy + komunikasikan.
Usaha      : S
```

```
[F-04] Tanpa run/execution record — "sudah diproses" tak bisa dibedakan dari "belum dilihat"
Dimensi    : J (M)
Severity   : Medium
Bukti      : apps/api/src/routes/cron.ts:26-56; apps/api/src/services/run-evaluate.ts:38-404 (tidak ada tulis watermark/cursor)
Kondisi    : Cron mati 6 jam lalu hidup lagi. Tidak ada catatan kapan terakhir jalan sampai titik mana; perilaku catch-up vs skip hanya emergent dari `now >= trigger`.
Dampak     : Outage menghasilkan burst diam-diam (atau, jika kelak ditambah skip-logic, kehilangan permanen) tanpa jejak audit; zero-deliveries vs scheduler-mati tidak dapat dibedakan.
Akar masalah: Desain stateless murni; observabilitas run tidak dimodelkan.
Reproduksi : Hentikan cron 5 siklus, hidupkan → semua threshold terlewat terkirim sekaligus; tidak ada baris/log yang menyatakan "mengejar ketertinggalan 5 siklus".
Perbaikan  : Tabel `reminder_runs(id, started_at, finished_at, counts)` ditulis di awal/akhir run. Watermark jangan dipakai untuk skip — hanya untuk observabilitas dulu (maju-terlalu-cepat = kehilangan permanen).
Usaha      : S
```

```
[F-05] Tanpa kolom last_error/failed_at — kegagalan buta untuk debugging
Dimensi    : I (A,M)
Severity   : Medium
Bukti      : packages/db/src/schema.ts:216-242 (tanpa keduanya); docs/DATA-MODEL.md:361 (open question mengakui kebutuhan); apps/api/src/services/run-evaluate.ts:70-91 (markFailed hanya status+retryCount)
Kondisi    : Provider 500 berulang → baris `failed`, pesan "boom" hanya di console log yang fana.
Dampak     : Tidak bisa menjawab "kenapa email X gagal" dari DB; retry terminal vs transien tak bisa dibedakan pasca-fakta.
Akar masalah: Skema belum memodelkan observabilitas kegagalan.
Reproduksi : Gagalkan send 4 siklus (M-5 lifecycle test) → tidak ada kolom yang menyimpan pesan/tipe error terakhir.
Perbaikan  : Tambah `last_error text` + `failed_at timestamptz`, tulis di markFailed. Trade-off: sedikit tulis ekstra per gagal; batasi panjang pesan, jangan simpan PII.
Usaha      : S
```

```
[F-06] Cron mengembalikan {ok:true} bahkan saat 100% gagal; tanpa alerting zero-deliveries
Dimensi    : I (M)
Severity   : Medium
Bukti      : apps/api/src/routes/cron.ts:42-56; apps/api/src/services/run-evaluate.ts:396-403
Kondisi    : Semua send 500 + markFailed sukses → HTTP 200 `{ok:true}`, counts hanya di stdout.
Dampak     : Kegagalan sistemik terlihat sukses oleh scheduler; tidak ada sinyal gagal-naik vs sunyi-normal.
Akar masalah: Kontrak SEC-008 minimalis tanpa kanal alert terpisah; tidak ada metrik gagal/skipped-by-reason selain quota.
Reproduksi : Mock provider selalu-500 → respons tetap 200 ok:true, emailsFailed>0 hanya di log.
Perbaikan  : Pancarkan metrik terstruktur (dievaluasi/terkirim/gagal/quota/durasi) + alert `emailsFailed` naik atau `created==0 padahal due>0`. Pisahkan dari body respons.
Usaha      : M
```

```
[F-07] Isi email merender deadline dalam UTC, bukan timezone user
Dimensi    : F
Severity   : Low
Bukti      : apps/api/src/lib/email.ts:150-158, :194-201
Kondisi    : User Asia/Makassar dengan deadline 23:59 lokal menerima "Deadline: Friday, … 3:59 PM (UTC)".
Dampak     : Kebingungan hari/jam; H-0 bisa tampak jatuh di hari yang salah bagi user. Perhitungan trigger benar (tz user), tapi tampilannya tidak.
Akar masalah: `formatDeadlineForEmail` hardcode `timeZone:"UTC"`; `timeZone` profil tidak diteruskan ke builder email (deliverEmail hanya kirim deadlineIso).
Reproduksi : Kirim untuk profil Asia/Makassar → body mengandung "(UTC)" dan jam UTC.
Perbaikan  : Teruskan `timeZone` ke `sendReminderEmail`, format di tz user + label zona eksplisit ("WITA"). Trade-off: string key idempotency berubah untuk body yang sama → kirim ulang sekali setelah deploy (aman karena key mencakup body).
Usaha      : S
```

```
[F-08] Jalur emailWork tidak mengecek ulang done/deleted sebelum kirim; sweep mengecek
Dimensi    : B (G)
Severity   : Low
Bukti      : apps/api/src/services/run-evaluate.ts:340-359 (tanpa cek) vs :366-369 (cek done)
Kondisi    : Task di-complete tepat setelah snapshot batch diambil, sebelum `deliverEmail` dieksekusi serial.
Dampak     : Email untuk task yang baru saja selesai — jendela kecil (serial, bukan paralel), frekuensi rendah.
Akar masalah: Status hanya dibaca di snapshot; tidak ada re-validasi kepemilikan/status di titik kirim.
Reproduksi : Snapshot todo → set done di test-double → lanjutkan send → email tetap terkirim.
Perbaikan  : Re-fetch status ringan per work item, atau terima sebagai at-least-once dan dokumentasikan. Trade-off: N query tambahan per run.
Usaha      : S
```

```
[F-09] sentAt = waktu mulai run untuk semua delivery, bukan waktu konfirmasi provider
Dimensi    : A (M)
Severity   : Low
Bukti      : apps/api/src/services/run-evaluate.ts:43, :97, :270-271
Kondisi    : Run panjang (ribuan task, retry 3x10s timeout) → `sent_at` bisa menit lebih awal dari pengiriman aktual.
Dampak     : Ordering/inkuisisi in-app (`orderBy sentAt` di notifications.ts:72) dan audit sedikit miring; tidak ada dampak pengiriman.
Akar masalah: Satu timestamp run dipakai ulang demi kesederhanaan.
Reproduksi : Run dengan timeout 10s → `sent_at` < waktu HTTP 200.
Perbaikan  : Set `sentAt: new Date()` di `markSent`. Satu baris.
Usaha      : S
```

```
[F-10] Sweep stuck-pending tanpa klaim atomik — mengandalkan jendela provider 24 jam
Dimensi    : E (D)
Severity   : Low
Bukti      : apps/api/src/services/run-evaluate.ts:361-389 vs klaim atomik :314-337; kunci provider apps/api/src/lib/email.ts:204-210
Kondisi    : Dua run overlap menyapu baris `pending` yang sama → dua HTTP call dengan key sama; satu 409 → pending.
Dampak     : Bukan duplikat email (dedup provider), tapi 2x biaya/upaya provider per overlap; jika definisi key berubah atau provider ganti tanpa dedup, menjadi duplikat nyata.
Akar masalah: Sweep dirancang lock-free; satu-satunya arbiter adalah Resend.
Reproduksi : Test G3 yang ada justru membuktikan 2 call/1 sukses (apps/api/src/services/run-evaluate.test.ts:676-684).
Perbaikan  : Klaim sweep dengan update-bersyarat `pending → sending` (butuh status baru + migrasi) ATAU terima + dokumentasikan ketergantungan 24h-window sebagai asumsi arsitektur. Opsi pertama mengubah lifecycle status — tidak kecil.
Usaha      : M (opsi klaim) / S (dokumentasi asumsi)
```

```
[F-11] Dokumen DATA-MODEL.md kedaluwarsa soal kunci dedupe (tanpa days_before)
Dimensi    : A
Severity   : Low
Bukti      : docs/DATA-MODEL.md:201-212 vs packages/db/src/schema.ts:237
Kondisi    : Pembaca docs meyakini unique `(threshold_id, channel)`; aktual `(threshold_id, days_before, channel)` — semantik M-4 tidak terpahami dari docs.
Dampak     : Keputusan masa depan (mis. "tambah kolom ke kunci?") dibuat dari kontrak yang salah.
Akar masalah: Migrasi days_before tidak diikuti update docs.
Reproduksi : Bandingkan kedua kutipan — berbeda literal.
Perbaikan  : Sinkronkan §notification_deliveries + diagram; tambahkan catatan M-4.
Usaha      : S
```

```
[F-12] Deadline NaN / created_at invalid diam-diam mengubah perilaku tanpa log
Dimensi    : G (I)
Severity   : Low
Bukti      : packages/domain/src/evaluate.ts:67-69, :94, :164, :173-180
Kondisi    : `deadline` invalid → trigger NaN → skip diam-diam (benar, tapi sunyi). `created_at` invalid → `createdAtMs=NaN` → `trigger < NaN` selalu false → guard non-retroactive mati total untuk task itu.
Dampak     : Task korup mendapat burst yang seharusnya di-skip; tanpa log, tak terlacak.
Akar masalah: Kolom DB `notNull timestamptz` membuat ini mustahil dari DB, tapi tipe evaluator `string` memungkinkan dari pemanggil lain.
Reproduksi : Input deadline "not-a-date" → []; input created_at "x" + trigger lampau → create (seharusnya skip).
Perbaikan  : Validasi di batas evaluator + `console.warn` dengan task_id (tanpa PII). Trade-off: log noise jika data kotor massal — rate-limit warn.
Usaha      : S
```

```
[F-13] Tanpa normalisasi email; tanpa preferensi/unsubscribe di jalur kirim
Dimensi    : L
Severity   : Low
Bukti      : apps/api/src/services/run-evaluate.ts:342, :369 (pakai profile.email apa adanya); tidak ada checkpoint preferensi sebelum/after write di run-evaluate.ts:257-389; tidak ada tabel preferensi di packages/db/src/schema.ts:37-49
Kondisi    : `User@x.com` vs `user@x.com` diperlakukan sebagai penerima berbeda oleh logika kuota per-userId (aman karena kunci userId, bukan alamat); tidak ada jalur ganda owner/watcher (single-owner per DOMAIN.md §6) sehingga risiko dobel-kirim via dua jalur tidak ada.
Dampak     : Hari ini nihil; temuan ketahanan — penambahan kolaborasi/alias email kelak mengaktifkan risiko ini.
Akar masalah: Belum dimodelkan karena belum dibutuhkan MVP.
Reproduksi : N/A hari ini — dicatat agar tidak diasumsikan ada.
Perbaikan  : Normalisasi lowercase+trim saat tulis profiles.email; cek preferensi SEBELUM insert delivery saat fitur itu ada (agar tidak meninggalkan baris pending hantu).
Usaha      : S
```

## 5. Risiko Tidak Terverifikasi

1. **Jadwal, jumlah instance, dan timezone cron produksi.** `docs/ARCHITECTURE.md:108-114` menyatakan runner "TBD" (opsi pg_cron vs eksternal); `docs/DOMAIN.md:92` menuntut minimal tiap jam. Tanpa akses scheduler/infra, klaim "overlap realistis" (dimensi E/J) bertumpu pada rate-limit 10/menit dan test overlap, bukan observasi produksi. Butuh: konfigurasi cron produksi + jumlah replika API.
2. **Isolation level aktual Postgres.** Kode tidak menyetelnya; analisis mengasumsikan default READ COMMITTED dengan write atomik single-statement. Butuh: `SHOW default_transaction_isolation` di DB target + konfirmasi tidak ada wrapper transaksi di middleware.
3. **Validasi custom-threshold "tidak boleh lampau" di API.** `docs/DOMAIN.md:91` menspesifikasikan; graph menunjuk `assertThresholdNotInPast` di `apps/api/src/routes/tasks.ts:73-83` tapi file belum dibaca baris-per-baris dalam audit ini. Butuh: baca file tersebut + test rutenya.
4. **Perilaku wall-time nonexistent (spring-forward) di `fromZonedTime`.** Iterasi 3x (`packages/domain/src/evaluate.ts:39-55`) benar untuk offset biasa; untuk jam yang tidak ada (mis. 02:30 di hari lompat DST) hasilnya adalah tebakan iterasi, tanpa test. Butuh: test properti DST untuk zona yang observing-DST (mis. America/New_York).
5. **Jendela dedup Resend 24 jam.** Komentar kode (`apps/api/src/services/run-evaluate.ts:66-69`, `:379-380`) mengandalkan perilaku provider; tak terverifikasi dari kode. Butuh: kutipan docs Resend + test kontrak berkala.
6. **Retensi/purge `notification_deliveries` dan task soft-deleted.** `docs/DOMAIN.md:121` membuka retensi; tidak ditemukan purge deliveries. Penghapusan historis akan membuka potensi kirim-ulang (dedupe hilang bersama baris). Butuh: keputusan retensi + akses job purge bila ada.
7. **Normalisasi email saat signup dan perubahan email.** Trigger `on_auth_user_email_changed` (`docs/DATA-MODEL.md:278-299`) memmirror mentah; apakah ada lowercase di Auth? Butuh: baca trigger aktual di migrasi + perilaku Supabase Auth.
8. **Alerting/monitoring eksternal.** Tidak ada di repo selain `console.log` counts; mungkin ada di infra (Vercel/Datadog) di luar repo. Butuh: akses dashboard scheduler + log produksi.

## 6. Matriks Coverage Test

Hasil eksekusi aktual (bun v1.4.0): `packages/domain/src/evaluate.test.ts` → 20 pass / 0 fail; `apps/api/src/services/run-evaluate.test.ts` + `apps/api/src/lib/email-resilience.test.ts` → 35 pass / 0 fail. Semua "tercover" di bawah berarti *dijalankan dan lulus*, bukan sekadar ada.

| Dimensi | Status | Bukti test | Gap paling bernilai |
|---|---|---|---|
| A model data | sebagian | `run-evaluate.test.ts:230-306` (semantik unique di-emulasi faithfully) | Test drift DB-vs-Drizzle sudah ada (`db:drift` di ARCHITECTURE.md:95) — pertahankan; tambah kontrak `days_before` di migrasi |
| B struktur/cakupan | tercover | M-12 batching/cursor `run-evaluate.test.ts:1062-1263`; quota `:1265-1305` | Test task done tepat-setelah-snapshot (F-08) |
| C threshold | tercover | boundary ±1s `evaluate.test.ts:15-34` | Test burst multi-threshold setelah outage 5 hari (J) |
| D idempotency | tercover | G1/G2/G3/G5 `:588-715` | Test sweep-double-send menghitung HTTP calls (F-10) — sebagian sudah (2 calls) |
| E concurrency | tercover | G1–G3 + barrier deterministik `:90-116` | Test 3+ worker + klaim retry (baru 2 worker) |
| F timezone | sebagian | trigger tz Makassar `evaluate.test.ts:10-35` | **Test DST spring-forward / zona non-UTC±X** — belum ada sama sekali |
| G boundary | tercover | exact/±1s/past-deadline `:15-34` | Test `createdAt == trigger` (batas `<` vs `<=`) |
| H retry | tercover | M-5 lifecycle 4-attempt `:999-1056`; resilience `:80-241` | Test timeout-tapi-terkirim (butuh fake provider stateful) |
| I failure | sebagian | G6/G7 containment `:721-788` | Test markFailed-gagal + missing-profile tanpa last_error (F-05) |
| J replay/missed | sebagian | replay ganda tercover (G1–G5) | **Test missed-runs burst + manual-trigger ganda slot sama** — belum ada |
| K non-retroactive | sebagian | creation-time tercover `:72-77`; mutasi offset M-4 tercover | **Test deadline-edit (F-01), reopen (F-02), deploy-cutoff (F-03)** — tiga-tiganya belum ada |
| L duplikat luar-inti | tidak tercover | — | N/A hari ini (single-owner); tulis saat kolaborasi masuk scope |
| M observability | sebagian | counts di log `cron.ts:45-55` | Test kontrak "respons tetap ok saat gagal total" + audit run-record |

## 7. Urutan Tindakan

**Sebelum rilis berikutnya (dampak ÷ usaha tertinggi):**

1. F-01 guard deadline-edit retroaktif (High, M) — satu-satunya pelanggaran spec terbukti.
2. F-05 kolom `last_error` + `failed_at` (Medium, S) — murah, membuka semua debugging berikutnya.
3. F-03 `REMINDER_CUTOFF_ISO` (Medium, S) — mencegah insiden deploy klasik.
4. F-07 render deadline di tz user (Low, S) — kecil, user-facing.
5. F-11 sinkronkan DATA-MODEL.md kunci dedupe (Low, S) — cegah keputusan salah berikutnya.
6. F-09 `sentAt` waktu konfirmasi (Low, S) + F-12 warn NaN (Low, S) — sekalian dalam satu pass kecil.

**Menyusul (butuh keputusan produk/infra atau usaha lebih besar):**

7. F-04 tabel `reminder_runs` + metrik/alerting (F-06) — butuh akses infra; gabungkan satu paket observabilitas.
8. F-02 semantik reopen (Medium, M) — tunggu konfirmasi open question DOMAIN.md §7.
9. F-10 klaim sweep vs dokumentasi asumsi 24h (Low) — pilih eksplisit, jangan implisit.
10. F-08 recheck done pre-send + F-13 normalisasi email — hardening saat kolaborasi masuk roadmap.
11. Tutup gap test: DST, burst-missed-runs, deadline-edit, reopen, cutoff (tabel §6) — tulis bersamaan dengan perbaikan masing-masing.
