# Branching & CI/CD — Deadline Radar

> Sumber kebenaran untuk alur branch, CI, dan deploy. Terakhir diverifikasi
> 2026-09-30 via Vercel CLI + GitHub API.

## Branch

| Branch | Peran | Default |
|---|---|---|
| `feature/*`, `fix/*`, `improvement/*` | Kerja harian: perbaikan & improvement | — |
| `dev` | Integrasi. Semua PR fitur mengarah ke sini | ✅ default branch (origin/HEAD) |
| `main` | Produksi/live. Hanya menerima PR dari `dev` + commit ops | — |

**`dev` tidak punya hubungan deploy ke production.** Pemisahnya bersifat
teknis, bukan sekadar konvensi (lihat bawah).

## Alur

```
feature/* ──PR──▶ dev ──PR──▶ main ──▶ production
              ▲           ▲
         CI ringan   CI penuh (gate)
         staging DB  Production
         otomatis    (approval)
```

Tidak ada Vercel Preview. Deployment non-`main` dimatikan di repo
(`apps/web/vercel.json`), jadi satu-satunya deployment Vercel adalah
production dari `main`.

1. Kerja di branch fitur, buka PR ke `dev`. `ci-dev` (lint, typecheck,
   test, build — tanpa database, tanpa secrets) harus hijau.
   `packages/db` memisah suitnya: `test` (unit bebas-DB, termasuk
   meta-test pengunci split) jalan di ci-dev; `test:db` (guard
   live-database) hanya jalan di ci-main setelah migrasi (#69).
2. Merge ke `dev` → otomatis: migrasi database **staging**
   (`deploy-staging.yml`) saja. Verifikasi di staging. Tidak ada Vercel
   Preview — lihat "Project Vercel" di bawah.
3. Buka PR `dev` → `main`. `ci-main` (gate penuh: fresh-DB migration,
   11 file regresi SQL, drift, lint, typecheck, test, build) harus hijau.
4. Merge ke `main` → `deploy-production.yml` (perlu approval pemilik) +
   Vercel **Production** deployment. Lanjut checklist manual
   `docs/PROD_ENV_CHECKLIST.md` + `supabase/verify-prod.sql`.

## Pemisahan dev vs production

| Aspek | dev / feature | main / production |
|---|---|---|
| CI | `ci-dev.yml` (ringan) | `ci-main.yml` (gate penuh, required check) |
| Vercel | tidak ada deployment (`git.deploymentEnabled` = false) | Production deployment dari `deadline-radar-web` saja (`productionBranch: main`) |
| DB deploy | staging otomatis tiap push `dev` | production hanya dari `main` + approval |
| Secrets | staging (`STAGING_DATABASE_URL`) | production (`PRODUCTION_DATABASE_URL`, hanya dibaca `deploy-production.yml`) |
| E2E Playwright | manual vs staging | manual pre-release |

Tidak ada workflow yang trigger dari branch dev/fitur dan membaca secret
production — itu yang membuat dev terputus total dari production.

## Project Vercel

Hanya satu project Vercel yang dipakai:

| Project | Root Directory | Dipakai untuk |
|---|---|---|
| `deadline-radar-web` | `apps/web` | web Next.js — satu-satunya project yang deploy |
| `deadline-radar` | `.` (root repo) | **tidak dipakai lagi**, sudah di-`git disconnect` |

`apps/web/vercel.json` milik project `deadline-radar-web`, karena Vercel membaca
`vercel.json` dari Root Directory project. Dua hal di sana:

- `buildCommand: "next build"` — override Build Command di Project Settings.
  Nilai di dashboard menunjuk `apps/web/scripts/verify-routes.ts` dan
  `apps/web/scripts/build-csp-hashes.ts`, yang tidak pernah ada di repo, jadi
  semua deployment gagal. Build command di sini sama persis dengan script
  `build` di `apps/web/package.json`; `apps/web/vercel.test.ts` mengunci
  keduanya agar tidak melenceng.
- `git.deploymentEnabled` — `main` saja yang deploy. Vercel tidak bisa
  mematikan komentar bot per-branch, jadi deployment non-`main` dimatikan di
  sumbernya. Kalau `main` terhapus dari sini, merge tetap hijau tetapi
  production tidak pernah ter-deploy — itu sebabnya ada `vercel.test.ts`.

`deadline-radar` (root `.`) membangun monorepo dari root dan selalu gagal
`No Output Directory named "public"`; 20 deployment terakhir semuanya error.
API production ada di Railway, jadi tidak ada kebutuhan akan project itu.
`vercel project rm` tidak dijalankan: `git disconnect` sudah cukup menghentikan
build dan komentarnya, dan menghapus project tidak bisa dibatalkan.

## Setup manual yang belum bisa otomatis (GitHub Settings)

Repo ini private tanpa Pro, jadi langkah berikut dikerjakan manusia sekali
saja di Settings → Branches / Environments. Status per 2026-09-29:

- [x] Environment `staging`: sudah dibuat via API.
- [x] Environment `Production` → deployment branches = `main` saja: sudah
  diset via API (custom branch policy `main`).
- [ ] Protection `main`: require PR, require `ci-main` hijau, 1 review,
  block force-push — butuh Pro / repo public, hanya bisa diklik manual
  (API mengembalikan 403).
- [ ] Protection `dev`: require PR + `ci-dev` hijau — sama, manual.
- [ ] Environment `Production` → required reviewer = pemilik — butuh
  plan berbayar (API: 422 billing plan), hanya bisa diklik manual; tanpa
  ini, approval prod mengandalkan proteksi branch `main` + review PR.
