# Production Environment Checklist — Deadline Radar

> Diisi manusia (pemilik) SEBELUM deploy pertama. Nilai tidak pernah masuk repo.
> Status awal: sebagian besar BELUM (prod belum deploy).
> Keputusan tercatat: single replica · `AUTH_AUDIT_RETENTION_DAYS=90` ·
> Redis wajib (SEC-007, boot gagal tanpanya).

Legenda lokasi:
- **ENV-API** — environment variables service API (hosting API)
- **ENV-WEB** — environment variables service Web/Next.js (hosting Web)
- **DASH-SB** — Supabase dashboard (project production)
- **DASH-RE** — Resend dashboard
- **DASH-SE** — Sentry dashboard (setelah proyek dibuat)

## 1. Rahasia wajib boot (API gagal start tanpanya)

| Var | Lokasi isi | Status | Catatan |
|---|---|---|---|
| `DATABASE_URL` | ENV-API | ☐ | Pooler Supabase project prod (`pgbouncer`, `prepare:false` tetap di kode) |
| `SUPABASE_URL` | ENV-API | ☐ | URL project prod |
| `SUPABASE_ANON_KEY` | ENV-API | ☐ | anon key project prod |
| `SUPABASE_SERVICE_ROLE_KEY` | ENV-API | ☐ | service_role project prod; JANGAN ke Web |
| `CRON_SECRET` | ENV-API + scheduler cron | ☐ | Acak panjang; scheduler memanggil `GET /api/v1/cron/evaluate-reminders` dengan `Authorization: Bearer …` |
| `AUTH_BRIDGE_SECRET` | ENV-API **dan** ENV-WEB (sama) | ☐ | Acak panjang; tidak pernah literal `"1"` |
| `REDIS_URL` | ENV-API | ☐ | Wajib prod (SEC-007); single replica tetap wajib isi |

## 2. Fungsional (degradasi bila kosong)

| Var | Lokasi isi | Status | Catatan |
|---|---|---|---|
| `RESEND_API_KEY` | ENV-API | ☐ | **WAJIB prod (RF-13 fail-closed): API refusal boot kalau kosong / bukan format `re_`.** Tanpa ini semua delivery gagal di send-time (blackout) |
| `RESEND_FROM_EMAIL` | ENV-API | ☐ | **WAJIB prod (RF-13): valid (bukan default sandbox).** Kosong/invalid = refusal boot; pakai domain terverifikasi di DASH-RE (domain `resend.dev` = warn, hanya preview) |
| `SENTRY_DSN` | ENV-API **dan** ENV-WEB | ☐ | DSN project Sentry (bukan rahasia, tapi tetap via env); lihat §5 |
| `WEB_ORIGIN` | ENV-API + ENV-WEB | ☐ | Origin publik web prod (cookie/CORS/redirect) |
| `API_ORIGIN` / `API_PORT` | ENV-WEB / ENV-API | ☐ | Alamat API yang di-rewrite Web |
| `AUTH_AUDIT_RETENTION_DAYS` | ENV-API | ☐ | Sudah diputuskan **90**; template aktif 90 |
| `REMINDER_CUTOFF_ISO` | ENV-API | ☐ | F-03 + sign-off N-2: WAJIB isi dengan instant aktivasi scheduler saat deploy (format ISO) + komunikasikan ke user. **WAJIB di production (RF-11 fail-closed): API refusal boot kalau kosong/format salah.** Kosong = run pertama PASTI burst (terbatas kuota 50/run/user — puluhan email per user, bukan nol) |
| `MAX_TASKS_PER_RUN` | ENV-API | ☐ | RF-12 opsional: cap task per run. Kosong = **10000**; invalid = diabaikan (warning) + default, tidak gagal boot. Set lebih kecil bila host timeout < budget default |
| `MAX_RUN_DURATION_MS` | ENV-API | ☐ | RF-12 opsional: deadline wall-clock per run (ms). Kosong = **120000**; invalid = diabaikan (warning) + default. Selalu < 30 mnt (di-clamp) agar tak menggembok single-flight lock; selaraskan dengan `timeout`/`maxDuration` host saat hosting diputuskan |
| `REMINDER_RUN_INTERVAL_MS` | ENV-API | ☐ | RF-14 opsional: interval antar run scheduler (ms). Kosong = **3600000** (1 jam). Dipakai `/health/cron`: scheduler dinyatakan unhealthy bila > 2× interval sejak run `ok` terakhir |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ENV-WEB | ☐ | Fallback verifikasi JWT di proxy |
| `SUPABASE_JWT_SECRET` | ENV-API + ENV-WEB | ☐ | Opsional; hanya untuk project Supabase HS256 lawas (ES256 baru via JWKS otomatis) |
| `TRUST_PROXY` / `TRUSTED_PROXIES` | ENV-API | ☐ | Isi HANYA bila di belakang reverse proxy dikenal; salah isi = spoof IP rate-limit |

## 3. Dashboard Supabase (DASH-SB, project prod)

| Item | Status | Cara verifikasi |
|---|---|---|
| Migrasi `supabase/migrations/*` diterapkan (`bun run db:migrate`, lalu `db:verify`) | ☐ | `supabase/verify-prod.sql` bagian 5: nol pending. Sign-off N-4 (blocking): migrate WAJIB jalan SEBELUM deploy kode — tanpa nilai enum `sending` + kolom `claimed_at`, klaim sweep F-10 melempar dan setiap run 500 berulang |
| `db:drift` bersih kecuali deviasi yang dikenal | ☐ | Ekspektasi: HANYA `profiles_id_fkey → users` (pra-ada). Selain itu = migrasi belum diterapkan |
| Body fungsi trigger F-13 ternormalisasi di prod | ☐ | Drift check tidak hash body fungsi — verifikasi manual: `pg_get_functiondef` untuk `handle_new_user` + `handle_user_email_change` harus memuat `lower(trim` |
| RLS aktif 12 tabel + 17 policy sesuai kontrak | ☐ | `supabase/verify-prod.sql` bagian 1–2 |
| Bucket `attachments` private (`public=false`) + 4 policy storage | ☐ | `supabase/verify-prod.sql` bagian 3 |
| Auth → Redirect allowlist HANYA domain prod | ☐ | Cek manual; isi: … |
| Auth → wajib konfirmasi email, kebijakan password & expiry OTP | ☐ | Cek manual; isi: … |
| Auth → hooks/webhook kustom tidak ada yang tak dikenal | ☐ | Cek manual |

## 4. Dashboard Resend (DASH-RE)

| Item | Status | Catatan |
|---|---|---|
| Domain pengirim terverifikasi (SPF/DKIM/DMARC) | ☐ | Tanpa ini masuk spam / ditolak |
| Tidak perlu webhook bounce/complaint di sisi kita | ☐ | Diputuskan N/A: daftar supresi otomatis Resend sudah menangani; tidak ada endpoint webhook di repo (hasil audit item 6) |
| Alerting biaya/kuota bulanan aktif | ☐ | Wajib pasca-SEC-003 (kuota kode ada, tagihan tetap perlu alarm) |

## 5. Dashboard Sentry (DASH-SE)

| Item | Status | Catatan |
|---|---|---|
| Project `deadline-radar-web` + `deadline-radar-api` dibuat | ☐ | Ambil DSN → isi `SENTRY_DSN` (ENV-API + ENV-WEB) |
| `sendDefaultPii: false` + scrub `beforeSend` aktif (sudah di kode) | ☑ | Diverifikasi test scrub |
| Alert error-rate + cron gagal aktif | ☐ | F-06 wired: Sentry `reminder delivery blackout` saat semua send gagal (counts-only, no PII); log `[cron] evaluate-reminders finished` selalu membawa outcome+durationMs; HTTP tetap `200 {ok:true}`. Sign-off: buat rule-nya + drill staging sampai alert benar-benar menyala sekali (alert yang belum pernah menyala belum terbukti bekerja) |

## 6. Repo hygiene pra-rilis

| Item | Status |
|---|---|
| `.env.local` / `.env*` tidak ter-commit (`git status` bersih dari secret) | ☐ |
| Tidak ada file `.env*` di `apps/web/` (Next auto-load-nya di dev/build/start, jadi isinya masuk `process.env` web tanpa diminta — #71) | ☑ (2026-09-30: `apps/web/.env.local` yang berisi `VERCEL_OIDC_TOKEN` dihapus; `apps/e2e/app-env.ts` menolak jalan kalau muncul lagi) |
| Rilis dari PR/diff bersih berisi HANYA fix audit | ☐ | Sign-off: pohon kerja saat ini bercampur feature work paralel (UI, account security) — rilis dari diff yang hanya memuat perbaikan terverifikasi, bukan seluruh working tree |
| Tidak ada SQL dump / backup di repo atau hosting statis | ☐ |
| Source-map prod tidak terekspos sembarang (atau nonaktifkan bila perlu) | ☐ |
| `openapi.json` + `schema.d.ts` di-regenerate pasca-SEC-008 | ☑ (sesi ini: `TaskWithCourse` tanpa `description` terkonfirmasi di keduanya) |
| `/.well-known/security.txt` ter-deploy (file ada di `apps/web/public/`) | ☐ | Hosting harus menyertakan direktori `public/` (default di Vercel; Docker wajib `COPY apps/web/public/`). Contact masih placeholder — ganti sebelum rilis |

## 7. Production security gates (blocking — dari SECURITY_SIGNOFF_2026-09-20.md)

```
[x] C1 — Independent verification
[ ] C2 — Commit + tag
[ ] C3 — Production env + migrations + verify-prod.sql
[x] C4 — SEC-003 direct PostgREST quota bypass     ← CLOSED 2026-09-20 (owner epo33m, review 2026-12-20; prod re-run at C3 deploy)
[ ] C5 — Dashboard + security.txt
[ ] C6 — Post-deploy runtime evidence
```

### C4 — SEC-003: Direct PostgREST/Supabase INSERT quota bypass — CLOSED (code control verified 2026-09-20)

- **Risiko:** application-level quota sudah enforced (200 task / 10 threshold /
  cap 50 email per user per run), tetapi direct PostgREST insert melalui public
  anon key masih dapat membuat task tanpa enforcement quota per-user yang sama.
  RLS `WITH CHECK (user_id = auth.uid())` tidak membatasi jumlah baris, dan
  trigger `on_task_created` menyuntik 4 threshold default pada setiap insert
  dari jalur mana pun.
- **Status subjektif dilarang:** SEC-003 tidak boleh ditandai PASS/VERIFIED-FIXED
  hanya karena test aplikasi hijau. Status tetap PARTIALLY-FIXED sampai gate ini lolos.
- **Required before release:** verifikasi bahwa quota task tidak dapat dibypass
  melalui direct Supabase/PostgREST write path.
- **Verification must cover:**
  1. application API write path (sudah: `tasks.quota.test.ts`, 4 test)
  2. direct PostgREST write path menggunakan anon/authenticated client yang sesuai
  3. RLS `WITH CHECK (user_id = auth.uid())` (eksistensi + ketiadaan batas hitung)
  4. quota enforcement / global threshold behavior (cap 50/user/run tetap menahan laju)
  5. regression test yang membuktikan bypass gagal (insert langsung ke-N+1 ditolak
     atau compensating control setara, mis. revoke INSERT / trigger kuota DB)
- **Evidence required:** test output + production verification evidence
  (output `supabase/verify-prod.sql` §2/§5 + bukti uji tulis langsung sebagai user).
- **Release rule:** C4 dicentang hanya bila residual direct-write path sudah
  **ditutup** (bukti di atas) atau **compensating control setara** didokumentasikan
  dan diverifikasi. Sampai saat itu rilis publik dilarang.
- **Closure 2026-09-20 (owner: epo33m, review: 2026-12-20):** compensating control
  setara ditutup dan diverifikasi — trigger `task_quota_before_insert` (200 active
  tasks/user) + `threshold_quota_before_insert` (10/task) di
  `supabase/migrations/20260921000000_sec003_task_threshold_quota.sql`
  (`service_role` bypass intentional & scoped); direct `notification_deliveries`
  fabrication tetap ditolak RLS (42501), jadi jalur amplifikasi email tertutup.
  Bukti: fresh-DB `supabase migration up` (34/34 applied) + `migrate.ts status/verify`
  + 9/9 SQL scripts PASS (`rls_matrix.sql` 13/13 sections, `sec003_quota.sql` 9/9:
  201st task `TASK_QUOTA_EXCEEDED`, 11th threshold `THRESHOLD_QUOTA_EXCEEDED`,
  cross-tenant/anon 42501, service_role bypass scoped, deliveries 42501) + bun
  wrappers `sec003-quota.test.ts` / `rls-matrix.test.ts` PASS (negative control:
  dropping the trigger makes `sec003_quota.sql` FAIL) + full `bun run test`
  green (5 projects) + `typecheck`/`lint`/`build` green. Item (2) direct-PostgREST
  write path dibuktikan via `authenticated`/`anon` role probes (bukan anon key
  sungguhan, karena tidak ada project Supabase di loop ini); bukti tulis-langsung
  sebagai user prod + `verify-prod.sql` §2/§5 wajib diulang saat C3 deploy.

## 8. Verifikasi tertunda pra-rilis (dari sign-off audit reminder 2026-09-20)

Skenario wajib yang belum tereksekusi — eksekusi atau terima tertulis sebelum rilis.
Rujukan: `docs/audits/reminder-system-audit-2026-09-20.md` §4 tabel skenario.

| Skenario | Status | Yang dibutuhkan |
|---|---|---|
| S-02 cron paralel multi-proses (≥2 instance, ≥10 iterasi) | ☐ | Staging 2 replika / 2 proses serentak melawan DB yang sama; harap: tepat 1 email per reminder per iterasi |
| S-04 timeout-tapi-terkirim | ☐ | Fake provider stateful (mencatat terkirim lalu melempar timeout); harap: tanpa email kedua, key stabil antar percobaan |
| S-08 cron mati 5 siklus lalu hidup | ☐ | Matikan scheduler 5 interval di staging, hidupkan; harap: catch-up terkendali (cutoff aktif), bukan burst |
| S-10 dua user ekstrem (UTC+14 / UTC-11) | ☐ | Fixture dua profil; harap: reminder di jam lokal masing-masing yang benar |
| S-11 hari transisi DST (maju + mundur) | ☐ | Fixture zona ber-DST melewati transisi; harap: tak bergeser/hilang/ganda |
| S-15 dry-run deploy pertama di data historis | ☐ | Snapshot/tiruan data prod berukuran wajar, evaluator dry-run; laporkan angka email sebelum ada yang terkirim |
| S-18 beban puncak | ☐ | Volume kandidat setara puncak; harap: selesai jauh di bawah interval cron, query ber-index, memori stabil |

## 9. Accepted risks (final verification 2026-09-20)

Risiko berikut diterima tertulis dengan pemilik dan tanggal review. Selain
daftar ini, tidak ada risiko yang diterima — sisanya harus ditutup.

| ID | Risiko | Pemilik | Rasional | Review | Kontrol kompensasi |
|---|---|---|---|---|---|
| F-7 | 3 journey E2E tidak dikunci di CI (advisory) | epo33m | CI `verify` hanya sedia vanilla PostgreSQL; E2E butuh Chromium + build prod + project Supabase live | 2026-12-20 | `E2E_TARGET=staging bun run test:e2e` manual pra-rilis (`apps/e2e/README.md`); suite menolak jalan tanpa target bernama dan menolak host production (#56); drill sampai hijau sekali |
| Quota-race | Dua txn bersamaan di 199/200 bisa lolos dua-duanya | epo33m | Diterima di komentar migrasi; API tetap enforcement utama, trigger adalah backstop | 2026-12-20 | Alarm biaya/kuota Resend (§4); hitung aktif = `deleted_at IS NULL` |
| S-02…S-18 | Skenario staging §8 belum tereksekusi | epo33m | Tidak ada staging; S-11 tercakup sebagian oleh vektor DST unit (6 test `America/New_York`) | 2026-12-20 | Eksekusi atau terima tertulis sebelum rilis publik (C6) |
| P2-cache | Snapshot authz tetap Map in-memory TTL 30 dtk, single replika | epo33m | MVP satu replika (keputusan di atas); refetch penuh per nav dapat diterima pada skala ini | 2026-12-20 | §11: pindah ke Redis (`REDIS_URL`) atau buang map lokal SEBELUM scale horizontal |
| P3-notif-idx | Index `sent_at`-led untuk list notifikasi SENGAJA tidak dibuat | epo33m | EXPLAIN gate 2026-09-21 (scratch PG 100k tasks/157k deliveries): planner tetap nested-loop via M9 (~1.1ms, 1456 buffers), kandidat tak terpakai — index tak terpakai hanya membebani write | 2026-12-20 | Re-cek via EXPLAIN bila volume delivery/user naik 10–100x |
| S-no-staging | Tidak ada environment staging; drill S-02/S-08/S-18 hanya lokal | epo33m | S-02 substitusi lokal (2 proses vs DB sama, ≥10 iterasi); S-08/S-15/S-18 diterima tertulis dengan mitigasi urutan prod (cutoff + kuota + dry-run) | 2026-12-20 | C6: bukti runtime pasca-deploy menggantikan drill staging; sediakan staging sebelum rilis publik berikutnya bila memungkinkan |

## 10. Verifikasi pasca-deploy — P1 waterfall fixes (2026-09-21)

Perubahan: 3 select task-detail diparalelkan (`apps/api/src/routes/tasks.ts`,
gate `ownedTask` tidak berubah); agregasi summary pindah ke Postgres RPC
(`public.get_user_summary`, migrasi `supabase/migrations/20260921010000_summary_rpc.sql`);
batch cron paralel + kirim terbatas (`apps/api/src/services/run-evaluate.ts`,
`EMAIL_SEND_CONCURRENCY=5`; predikat klaim atomik tidak berubah).

| Item | Status | Cara verifikasi |
|---|---|---|
| Migrasi `20260921010000_summary_rpc.sql` diterapkan di staging/prod (`bun run db:migrate`, lalu `db:verify`) — fungsi BARU, tanpa backfill | ☐ | `select public.get_user_summary('<user-id>', 'UTC', now())` mengembalikan `{summary:{7 int}, progress:{…}}`; `supabase/verify-prod.sql` bagian 5: nol pending |
| APM spans `GET /tasks/:id`: 4 sekuensial → 2 (gate `ownedTask`, lalu 1 fan-out paralel) | ☐ | Trace APM per tampilan detail |
| Byte respons `GET /summary` + `EXPLAIN (ANALYZE, BUFFERS)` pemindaian tasks | ☐ | Bandingkan sebelum/sesudah pada akun berat; harap: index-only scan `idx_tasks_user_deadline_id_active`, payload 7 int + progress, bukan N baris |
| Durasi cron + ledger `reminder_runs` sebelum/sesudah; tanpa tumpang tindih dengan tick berikutnya | ☐ | Log `[cron] evaluate-reminders finished` (outcome+durationMs) + baris `reminder_runs`; kirim-ganda tetap 0 (klaim atomik tak tersentuh) |
| Rilis dari diff bersih berisi HANYA fix terverifikasi | ☐ | Lihat §6: pohon kerja bercampur feature work paralel (UI, account security) — jangan rilis seluruh working tree; tidak ada commit yang dibuat di sesi ini |

### 10b. Verifikasi pasca-deploy — P2 fixes (2026-09-21)

Perubahan: proyeksi list tanpa `description` (`serializeTaskList`; kontrak
`TaskWithCourse` di OpenAPI + `openapi.json`/`schema.d.ts` di-regenerate);
`GET /tasks?dueFrom&dueTo` + calendar month-scoped (cursor diikuti sampai habis,
cap 10 halaman); session RTT di-overlap dengan fetch data di 6 halaman
(tasks, courses, summary, calendar, task-detail, course-detail);
satu transaksi `withUserRls` per handler mutasi (tasks PATCH/complete/thresholds,
courses PATCH, attachments link). pengecualian intentional: POST create
(idempotency protocol), DELETE single-statement, dan path dengan network call
di tengah (attachments file/delete, signed-url dibiarkan).

| Item | Status | Cara verifikasi |
|---|---|---|
| Byte respons `GET /tasks` sebelum/sesudah (tanpa `description` × N baris) | ☐ | Bandingkan payload list pada akun berat |
| Jumlah baris respons per nav bulan; kebenaran bulan dengan >50 tasks | ☐ | Navigasi calendar pada bulan padat; tak ada bulan parsial |
| Waterfall DevTools: RTT session vs data overlap | ☐ | Trace load halaman tasks/calendar |
| Span transaksi per mutasi di APM/log (1 tx per handler) | ☐ | Trace PATCH/PUT/complete; suite ownership hijau sebagai gate pra-deploy |

### 10c. Verifikasi pasca-deploy — P3 indexes + React hygiene (2026-09-21)

Perubahan: migrasi `supabase/migrations/20260921020000_p3_list_indexes.sql`
(`idx_attachments_task_id`, `idx_tasks_user_course_deadline_active`; keduanya
di `schema.ts` + `schema-contract.ts` + `supabase/tests/p3_list_indexes_test.sql`
+ wrapper `packages/db/src/p3-list-indexes.test.ts`); memo `TaskRow` /
`CalendarDayCell` / `CalendarTaskChip` + `useDeferredValue` pada search.
SENGAJA TIDAK dibuat (EXPLAIN gate, data di komentar migrasi): index
`sent_at`-led untuk notifikasi — planner tetap memilih nested-loop via M9
index bahkan saat kandidat ada (1.1ms, 1456 buffers @100k tasks/157k deliveries);
index tak terpakai hanya membebani write.

| Item | Status | Cara verifikasi |
|---|---|---|
| Migrasi P3 diterapkan (`bun run db:migrate`, `db:verify`, `db:drift` bersih — dua index baru ekspektasi, bukan deviasi) | ☐ | `supabase/verify-prod.sql` bagian 5: nol pending |
| `EXPLAIN (ANALYZE, BUFFERS)` ketiga query pada data prod-shape: attachments-by-task → Index Scan; course-filtered list → `idx_tasks_user_course_deadline_active`; notif list → nested-loop M9 (re-cek bila volume delivery/user naik 10–100x) | ☐ | Output EXPLAIN tersimpan sebagai bukti |
| Profiler React: ketikan search + nav bulan sebelum/sesudah (render counts/commit ms) | ☐ | React DevTools Profiler; `dynamic()` splits tetap ditahan sampai data Profiler menuntutnya |

### 10d. Verifikasi pasca-deploy — RF-01 checkpoint + RF-02 email identity (2026-09-21)

Perubahan (migrasi + kode; rujukan `docs/audits/reliability-failure-modes-audit-2026-09-21.md`):

- **RF-01 — checkpoint run + konteks kegagalan konfirmasi + timeout DB:**
  `supabase/migrations/20260921030000_reminder_runs_checkpoint.sql`
  (`reminder_runs.last_seen_task_id uuid`, nullable, tanpa index). `run-evaluate.ts`
  menulis `last_seen_task_id` setelah tiap batch selesai (crash-safe: batch yang
  gagal tidak menggeser checkpoint) dan menulis `last_error`/`failed_at` saat
  confirm-write gagal tanpa menurunkan status ke `failed`. `packages/db/src/client.ts`
  menambah timeout koneksi (`connect`/`statement`/`idle`/`max_lifetime`) dengan
  override env.
- **RF-02 — identitas email deterministik (frozen body + rotasi key):**
  `supabase/migrations/20260921040000_reminder_deliveries_email_snapshots.sql`
  (`notification_deliveries.email_snapshot jsonb` + `email_idempotency_key text`,
  nullable, tanpa index). `apps/api/src/lib/email.ts`: `buildReminderEmailBody`
  diekspor; `buildReminderIdempotencyKey` menerima `nonce` (rotasi);
  `isRateLimitedReminderError` — `Retry-After` kini dihormati untuk
  `rate_limited`/`rate_limit_exceeded` walau tanpa `statusCode`.
  `apps/api/src/services/run-evaluate.ts`: `deliverEmail` membangun payload dari
  `email_snapshot` bila ada (else live), memakai `email_idempotency_key` bila ada,
  mem-persist snapshot+key pada `markSent`/`markFailed` (termasuk fallback
  confirm-failure RF-01), dan merotasi key + persist saat terminal idempotency
  error agar retry berikutnya bisa terkirim.
- **Schema:** `packages/db/src/schema.ts` (+`EmailDeliverySnapshot`),
  `schema-contract.ts`, `schema.test.ts`, `schema-drift.test.ts` (jumlah migrasi
  37→38, versi terakhir `20260921040000`).
- **Docs:** `docs/DOMAIN.md` §2.5 (`sent` = accepted, not delivered; frozen
  body/key) + `docs/RUNBOOK-reminders.md` §3 (cara telusur duplikat via
  `email_idempotency_key`).

| Item | Status | Cara verifikasi |
|---|---|---|
| Migrasi `20260921030000_reminder_runs_checkpoint.sql` + `20260921040000_reminder_deliveries_email_snapshots.sql` diterapkan (`bun run db:migrate`, lalu `db:verify`) — kolom BARU nullable, tanpa backfill | ☐ | `supabase/verify-prod.sql` bagian 5: nol pending; `db:drift` bersih kecuali `profiles_id_fkey → users` |
| RF-01 checkpoint terisi: run multi-batch menulis `reminder_runs.last_seen_task_id` = task terakhir yang selesai diproses | ☐ | Jalankan cron pada data >1 batch; `select id, last_seen_task_id, evaluated_tasks, status from reminder_runs order by started_at desc limit 5` |
| RF-01 crash mid-run tidak menggeser checkpoint (batch gagal → resume dari batch terakhir yang sukses) | ☐ | Simulasi kegagalan batch (staging); baris `status='error'` mempertahankan `last_seen_task_id` batch sebelumnya |
| RF-01 confirm-write gagal: baris TIDAK jadi `failed`, tetap sendable + `last_error = 'confirm failed: …'` | ☐ | Paksa kegagalan write konfirmasi (staging); cek `status`, `last_error`, `failed_at` pada `notification_deliveries` |
| RF-01 timeout DB aktif (connect/statement/idle/max_lifetime) sesuai env prod | ☐ | Cek `SHOW statement_timeout` pada koneksi app; log/observability tidak lagi menggantung pada provider DB lambat |
| RF-02 frozen body: setelah send gagal, baris punya `email_snapshot`; edit judul task lalu run berikutnya retry memakai body + key yang sama (tanpa email ganda) | ☐ | `select email_snapshot, email_idempotency_key from notification_deliveries where id='<delivery-id>'`; bandingkan `Idempotency-Key` di Resend dashboard antar percobaan |
| RF-02 rotasi key: terminal idempotency rejection (`invalid_idempotent_request`/`invalid_idempotency_key`) → `email_idempotency_key` berotasi + `last_error` tercatat; retry berikutnya terkirim di key baru | ☐ | Drill provider yang menolak key sekali; cek key berubah dan `emails_sent` naik pada run berikutnya |
| RF-02 rate-limit: `Retry-After` dihormati untuk `rate_limited`/`rate_limit_exceeded` tanpa `statusCode` (tidak jatuh ke backoff generik) | ☐ | Drill 429 storm di staging; jeda retry mengikuti `Retry-After` (cap 30 dtk) |
| Docs diperbarui: `DOMAIN.md` §2.5 (`sent` = accepted, not delivered + frozen body/key) dan `RUNBOOK-reminders.md` §3 (telusur duplikat via `email_idempotency_key`) | ☐ | Review isi dokumen; keputusan sejalan dengan §4 "tanpa webhook bounce/complaint" |
| Rilis dari diff bersih berisi HANYA fix terverifikasi (RF-01 + RF-02), bukan seluruh working tree | ☐ | Lihat §6: pohon kerja bercampur feature work paralel |

### 10e. Verifikasi pasca-deploy — RF-04 single-flight + RF-06 idempotency + RF-07 edit mid-run + RF-08 poison terminal (2026-09-21)

Perubahan (migrasi + kode; rujukan `docs/audits/reliability-failure-modes-audit-2026-09-21.md`):

- **RF-04 — single-flight run lock:**
  `supabase/migrations/20260921050000_reminder_run_single_flight.sql`
  (partial unique index `reminder_runs_single_active` pada `status = 'running'`).
  `run-evaluate.ts` meng-claim lock lewat insert ledger: `23505` → keluar dini
  `{ skipped: true, runId: null }`; run crash di-reclaim bila `startedAt` lebih tua
  dari `RUN_LOCK_STALE_MS` (30 menit). `cron.ts` melaporkan `outcome: "skipped"`.
- **RF-06 — threshold POST idempotent:**
  `tasks.ts` POST `/:id/thresholds` memakai `Idempotency-Key`
  (`beginIdempotent`/`completeIdempotent`); offset yang sudah ada + key berbeda
  → re-read existing → `200 { threshold }` (bukan `409`). Frontend
  (`threshold-manager.tsx`, `actions/tasks.ts`) mengirim key dan me-regenerate
  setelah sukses.
- **RF-07 — batalkan kirim saat deadline/threshold diedit mid-run:**
  live re-check per batch juga mengambil `tasks.deadline_updated_at` + versi
  `reminder_thresholds`; bila berubah, delivery dihapus (`DELETE`) sebelum
  `claimUserSendBudget` (kuota tak terpakai) dan run berikutnya mengevaluasi ulang.
- **RF-08 — poison `missing task/recipient` terminal:**
  kedua cabang `!task || !to` di `run-evaluate.ts` memanggil
  `markFailed(id, MAX_EMAIL_DELIVERY_RETRIES, …)` sehingga `retry_count = 3`
  (evaluator berhenti menawarkan retry). Counter `emailsPoisoned` diteruskan ke
  `isSystemicReminderFailure` dan dikecualikan dari keputusan blackout; tetap
  dihitung di `emails_failed` ledger dan disertakan di log/Sentry extras.
- **Schema:** `schema.ts` (+single-flight `uniqueIndex`), `schema-contract.ts`,
  `schema.test.ts`, `schema-drift.test.ts` (jumlah migrasi 38→39, versi terakhir
  `20260921050000`).

| Item | Status | Cara verifikasi |
|---|---|---|
| Migrasi `20260921050000_reminder_run_single_flight.sql` diterapkan (`bun run db:migrate`, lalu `db:verify`) | ☐ | `supabase/verify-prod.sql`: nol pending; index `reminder_runs_single_active` ada (partial, unique) |
| RF-04 lock bekerja: dua cron trigger bersamaan → satu run penuh, satu `outcome: "skipped"` tanpa kerja | ☐ | Trigger `/api/v1/cron/evaluate-reminders` dua kali paralel; log `[reminders] skipped, another run is active`; `reminder_runs` tidak punya dua baris `running` |
| RF-04 reclaim: baris `running` yang macet >30 menit di-`error` oleh run berikutnya lalu lock diambil | ☐ | Sisipkan baris `running` dengan `started_at` mundur di staging; jalankan cron; assert baris lama `status='error'` + run baru sukses |
| RF-06 replay: POST threshold dengan `Idempotency-Key` sama dua kali → satu baris + respons kedua identik (200) | ☐ | `curl` POST identik dengan header sama; cek `idempotency_keys` + jumlah baris `reminder_thresholds` |
| RF-06 natural-key: POST offset yang sudah ada dengan key berbeda → `200 { threshold }` (bukan `409`) | ☐ | `curl` ulang offset existing tanpa/tanpa key baru; assert 200 dan id threshold existing |
| RF-07 cancel: edit deadline/threshold di antara snapshot batch dan kirim → tidak ada email terkirim, baris delivery dihapus, kuota tidak terpakai | ☐ | Staging dengan send di-stub lambat; edit deadline mid-run; log `[reminders] skipped send, task edited mid-run`; run berikutnya mengirim dengan deadline baru |
| RF-07 negatif: edit tak terkait (title/status) TIDAK membatalkan kirim | ☐ | Edit title mid-run; assert email tetap terkirim (body memakai snapshot beku RF-02) |
| RF-08 terminal: delivery tanpa profil/email → `retry_count = 3` pada run pertama, run berikutnya tidak retry | ☐ | Staging: hapus/blank email profil (atau task yatim) untuk satu delivery; jalankan cron 5×; assert `retry_count = 3` dan tidak ada retry setelahnya |
| RF-08 no false blackout: run yang hanya berisi poison TIDAK mengirim alert Sentry "blackout" | ☐ | Skenario di atas dengan poison sebagai satu-satunya work; assert tidak ada pesan Sentry dan log `emailsPoisoned >= 1` |
| Rilis dari diff bersih berisi HANYA fix terverifikasi (RF-04 + RF-06 + RF-07 + RF-08), bukan seluruh working tree | ☐ | Lihat §6: pohon kerja bercampur feature work paralel |

### 10f. Verifikasi pasca-deploy — RF-09 archive threshold + RF-10 offset identity (2026-09-21)

Migrasi wajib: `supabase/migrations/20260921060000_threshold_archive.sql` (kolom `reminder_thresholds.deleted_at`, partial unique `reminder_thresholds_task_days_before_active_key`, `enforce_threshold_quota` filter aktif, drop policy `thresholds_delete_own`, trigger `threshold_forbid_delete`).

- **RF-09 — hapus threshold = arsip:**
  - `PUT /tasks/:id/thresholds` membuang offset → baris `reminder_thresholds` tetap ada dengan `deleted_at` terisi; delivery `sent/failed/pending` lama **tidak** ikut terhapus.
  - `DELETE /tasks/:id/thresholds/:thresholdId` mengembalikan `200` dan mengarsipkan (bukan hard delete).
  - Hard delete langsung (PostgREST/SQL) ditolak `THRESHOLD_HARD_DELETE_FORBIDDEN`; hapus task/user tetap boleh (cascade RI).
- **RF-10 — identitas delivery per offset:**
  - Offset yang pernah `sent` lalu dihapus dan ditambah ulang tidak mengirim email kedua.
  - Delivery `pending` milik threshold terarsip tidak pernah dikirim (di-sweep sebagai stale).

| Item | Status | Cara verifikasi |
|---|---|---|
| Migrasi `20260921060000` terpasang: `deleted_at` ada, partial unique aktif, policy lama hilang, trigger guard ada | ☐ | `bun run db:verify`; `select indexname from pg_indexes where tablename='reminder_thresholds'`; `select tgname from pg_trigger where tgrelid='reminder_thresholds'::regclass` |
| PUT membuang offset → baris threshold terarsip, delivery lama utuh | ☐ | Staging: kirim H-1 (sent) → PUT tanpa H-1 → assert `deleted_at` terisi + baris `notification_deliveries` H-1 masih ada |
| DELETE threshold mengembalikan 200 dan mengarsipkan | ☐ | `curl -X DELETE .../thresholds/<id>`; assert 200 dan `deleted_at not null` |
| Hard delete langsung ditolak | ☐ | `delete from reminder_thresholds where id='<id>'` di SQL editor → error `THRESHOLD_HARD_DELETE_FORBIDDEN` |
| Cascade task tetap jalan (guard tidak memblok RI) | ☐ | Hapus task di staging → baris threshold ikut terhapus tanpa error guard |
| Re-add offset terkirim tidak kirim ulang | ☐ | Staging: kirim H-1 → hapus → tambah H-1 lagi → jalankan cron; assert tidak ada email kedua (`notification_deliveries` H-1 tetap satu baris `sent`) |
| Quota menghitung threshold aktif saja | ☐ | Arsipkan satu threshold saat kuota penuh → tambah offset baru berhasil; assert `enforce_threshold_quota` menghitung `deleted_at is null` |
| Rilis dari diff bersih berisi HANYA fix terverifikasi (RF-09 + RF-10), bukan seluruh working tree | ☐ | Lihat §6: pohon kerja bercampur feature work paralel |

## 11. Pra-scale-out — cache authz single-node (P2-5, 2026-09-21)

Keputusan: snapshot authz tetap `Map` in-memory TTL 30 dtk (`apps/api/src/lib/authorization/cache.ts`)
untuk MVP satu replika (sesuai keputusan single replica di atas). Bukan masalah hari ini;
menjadi masalah saat horizontal scale (snapshot tidak terbagi antar instance, refetch penuh per nav).

| Item | Status | Cara verifikasi |
|---|---|---|
| SEBELUM scale horizontal: pindahkan snapshot authz ke Redis (`REDIS_URL` yang sama) atau terima hit DB dan buang map lokal | ☐ | Hit-rate cache authz; query authz per request di APM |
| `revalidate`/`staleTime` Next hanya untuk bacaan yang benar-benar statis — bukan untuk list bergerbang-session | ☐ | Review saat menambah cache bacaan |
