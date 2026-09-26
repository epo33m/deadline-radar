# Deploy Produksi — Deadline Radar

> Status 2026-09-26: repo **belum punya** auto-deploy. Push ke `main` hanya
> memicu CI (`.github/workflows/ci.yml`). Deploy terjadi dari dashboard Railway
> (API) dan Vercel (Web) memakai branch `main`.
> Checklist env + verifikasi tetap di `docs/PROD_ENV_CHECKLIST.md`.

## 0. Prasyarat (sudah diverifikasi 2026-09-26, read-only)

| Item | Hasil |
|---|---|
| Migrasi prod | 41 applied, **0 pending** (`bun run db:migrate status`) — syarat N-4 terpenuhi |
| Tabel prod | 12 tabel public lengkap (`reminder_thresholds`, `reminder_runs`, …) |
| Data prod | `tasks` 0, `notification_deliveries` 0, `reminder_runs` 0 → belum ada scheduler yang pernah jalan |
| `.env.production` (lokal, operator) | `assertStartupConfig()` PASS (RF-11/RF-13 fail-closed) |
| Redis (Upstash `rediss://`) | `PING → PONG` |
| Resend | domain `rapm.space` **verified** |
| Web | belum dideploy → `WEB_ORIGIN` masih placeholder |

Nilai rahasia tidak pernah masuk repo. `.env.production` hanya referensi
operator; env yang benar-benar dipakai adalah secret store Railway/Vercel.

## 1. Urutan deploy (WAJIB berurutan)

1. `bun run db:migrate` (kode baru sebelum API-nya) + `db:verify` — tanpa ini
   enum `sending`/kolom `claimed_at` belum ada dan setiap run cron 500
   (RF-15, `assertReminderSchemaPrerequisites` menolak boot).
2. Deploy **API** ke Railway.
3. Isi `WEB_ORIGIN` di Railway dengan domain publik Vercel (butuh untuk CORS +
   cookie), lalu redeploy/restart API.
4. Deploy **Web** ke Vercel (Root Directory `apps/web`).
5. Isi `API_ORIGIN` di Vercel = domain Railway, lalu **redeploy** — rewrite
   `next.config.ts` di-*bake* saat build, jadi perubahan env tidak cukup tanpa
   build baru.
6. Trigger cron pertama kali secara manual (§4) dan verifikasi §6.

## 2. Railway — API

File config: `railway.json` + `Dockerfile` (root). Railway tidak bisa
mendeteksi Bun secara otomatis, jadi Dockerfile wajib; build context = repo
root agar workspace Bun ter-install dari lockfile yang benar.

Langkah dashboard:
1. **New Project → Deploy from GitHub repo** (`epo33m/deadline-radar`).
2. Service API: **Root Directory = `/`** (default; JANGAN `apps/api`, karena
   `bun.lock` + `packages/*` di root), builder **Dockerfile** (dari
   `railway.json`).
3. Isi env di **ENV-API** (tab Variables). Start command dan port sudah di-set
   di `Dockerfile` (`API_PORT=${PORT:-$API_PORT}`) — biarkan kosong.
4. Deploy. Rewrite tidak perlu; domain publik dari service → dipakai
   sebagai `API_ORIGIN` di Vercel dan `PROD_API_URL` di GitHub secret.

| Var | Catatan |
|---|---|
| `NODE_ENV` | `production` (sudah di-set sebagai `ENV` di image) |
| `REMINDER_CUTOFF_ISO` | **wajib** (RF-11). Nilai aktivasi scheduler yang disepakati; boleh maju, jangan mundur |
| `DATABASE_URL` | Pooler Supabase, `prepare:false` sudah di kode |
| `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` | service_role **tidak boleh** masuk Vercel |
| `CRON_SECRET` | acak panjang; sama dengan `CRON_SECRET` GitHub secret |
| `AUTH_BRIDGE_SECRET` | **harus identik** dengan nilai di Vercel |
| `REDIS_URL` | wajib (SEC-007) |
| `RESEND_API_KEY` / `RESEND_FROM_EMAIL` | domain terverifikasi di Resend |
| `WEB_ORIGIN` | origin publik Vercel (cookie/CORS) |
| `AUTH_AUDIT_RETENTION_DAYS` | `90` (keputusan audit ROUND 1) |
| `SENTRY_DSN` | opsional; Sentry mati bila kosong |

Healthcheck: `railway.json` → `/health` (statis `200 {ok:true}`, tanpa DB,
exempt rate limit). Endpoint ini **bukan** bukti scheduler hidup — untuk itu
ada `/health/cron` (§6).

## 3. Vercel — Web

Tidak ada `vercel.json` sengaja: Vercel mendeteksi monorepo Nx + `bun.lock`
otomatis. Setting yang perlu diisi manual:

| Setting | Nilai |
|---|---|
| Root Directory | `apps/web` |
| Install Command | `bun install` (default; Vercel mencari `bun.lock` ke parent) |
| Build Command | `next build` (default) |
| Output Directory | `.next` (default) |

Env di **ENV-WEB** (Project Settings → Environment Variables, environment
production — hanya production, jangan preview/dev):

| Var | Catatan |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | di-inline saat build |
| `API_ORIGIN` | domain Railway; dipakai rewrite `/api/*`, `/openapi`, `/health` |
| `AUTH_BRIDGE_SECRET` | **harus sama** dengan Railway |
| `SUPABASE_JWT_SECRET` | opsional (HS256 lawas) |
| `NEXT_PUBLIC_SENTRY_DSN` | opsional |

`NEXT_PUBLIC_*` di-inline saat build → mengisi ulang harus disertai redeploy.

## 4. Trigger scheduler (cron)

Default: **GitHub Actions** `.github/workflows/cron-reminders.yml`
(`0 * * * *` UTC), memanggil `GET /api/v1/cron/evaluate-reminders` dengan
`Authorization: Bearer $CRON_SECRET`. GitHub secret yang perlu dibuat:
`PROD_API_URL` (domain Railway) + `CRON_SECRET`.

Kenapa bukan `cronSchedule` di `railway.json`: Railway mengeksekusi **start
command** service pada jadwal, dan `railway.json` berlaku untuk seluruh repo
(bukan per-service) — cron di service API akan menjalankan boot API tiap jam.
Alternatif jika mau: service Railway kedua (`scheduler`) dengan start command
`curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<api>/api/v1/cron/evaluate-reminders`
dan cron `0 * * * *` di dashboard service itu saja.

Overlap aman: single-flight lock (`reminder_runs_single_active`) membuat
panggilan kedua keluar `skipped` tanpa kerja.

## 5. Rollback

- Kode API: Railway redeploy revision sebelumnya aman (enum `sending` yang
  tertinggal diabaikan sweep claim lama).
- Migrasi: rollback enum `sending` tidak mungkin selama ada row `sending`
  (lihat `docs/RUNBOOK-reminders.md` §6).

## 6. Verifikasi pasca-deploy

1. `GET https://<api>/health` → `200 {ok:true, service:"deadline-radar-api"}`.
2. `GET https://<api>/openapi` → 200 (dokumentasi API hidup).
3. `GET https://<web>/health` → 200 (rewrite ke API lewat Vercel).
4. Trigger manual: GitHub Actions → Scheduler Trigger → Run workflow. Log harus
   `[cron] evaluate-reminders finished: …` di log Railway.
5. `GET https://<api>/health/cron` → **503 sampai run pertama `ok` tercatat**
   (`reminder_runs` masih 0 row saat dokumen ini ditulis). Setelah run pertama
   harus `200 {ok:true, lastRunAt, lastStatus, evaluatedTasks}`.
6. Login end-to-end di browser prod (auth bridge butuh `AUTH_BRIDGE_SECRET` yang
   sama di kedua sisi) + satu task uji dengan threshold H-1 untuk memastikan
   email benar-benar keluar.
7. Pasang monitor eksternal (UptimeRobot/StatusCake) ke `/health/cron` setiap
   menit — alerted saat `503` (RF-14 MTTD).

## 7. Rekaman installasi production (2026-09-26)

| Item | Nilai |
|---|---|
| Railway project / service | `deadline-radar-api` / `deadline-radar-api` (`6886d8eb-b917-4820-bc2e-74ac3c0b16c2`) |
| Domain API | `https://deadline-radar-api-production.up.railway.app` |
| Vercel project | `deadline-radar-web` (`prj_BT7yRuoU4Jw7MXggiQDenlfffovJ`), root `apps/web`, GitHub connected |
| Domain Web | `https://deadline-radar-web.vercel.app` |
| GitHub secrets | `PROD_API_URL`, `CRON_SECRET` |

`API_ORIGIN` = domain API, `WEB_ORIGIN` = domain Web. `railway.json` masih
dipakai (deprecated CLI, tetap jalan sampai 2026-12-01; migrasi ke
`.railway/railway.ts` bila perlu). CLI: `railway link` (project+environment
`production`+service) sudah terpasang di repo ini, `vercel link` ada di
`apps/web/.vercel` (tidak di-commit).

