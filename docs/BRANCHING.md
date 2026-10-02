# Branching & CI/CD — Deadline Radar

> Sumber kebenaran untuk alur branch, CI, dan deploy. Migrasi ke trunk-based
> 2026-10-02: branch `dev` dihapus, default branch kini `main`.

## Branch

| Branch | Peran | Default |
|---|---|---|
| `feature/*`, `fix/*`, `improvement/*` | Kerja harian: branch pendek (1–2 hari max), 1 branch = 1 issue | — |
| `main` | Trunk + produksi/live. Satu-satunya branch abadi | ✅ default branch (origin/HEAD) |

Tidak ada branch integrasi. Setiap PR menarget `main` langsung.

## Alur

```
feature/* ──PR──▶ main ──▶ production
               ▲
          ci-main (gate penuh, required check)
          staging termigrasi saat PR (verifikasi pre-merge)
          Production (approval)
```

Tidak ada Vercel Preview. Deployment non-`main` dimatikan di repo
(`apps/web/vercel.json`), jadi satu-satunya deployment Vercel adalah
production dari `main`.

1. Mulai dari fresh: `git checkout main && git pull && git checkout -b fix/<issue>-<nama>`.
   Sync tiap hari di dalam branch (`git fetch origin && git rebase origin/main`)
   agar conflict dicicil kecil, bukan meledak pas merge.
2. Buka PR ke `main`. `CI (feature)` (lint, typecheck,
   test, build — tanpa database, tanpa secrets) harus hijau.
   `packages/db` memisah suitnya: `test` (unit bebas-DB, termasuk
   meta-test pengunci split) jalan di CI feature; `test:db` (guard
   live-database) hanya jalan di ci-main setelah migrasi (#69).
3. `deploy-staging.yml` jalan otomatis tiap PR ke `main` (dan tiap push
   `main`, idempoten): migrasi database **staging** agar perubahan bisa
   diverifikasi **sebelum** merge. Tidak ada Vercel Preview — lihat
   "Project Vercel" di bawah.
4. `ci-main` (gate penuh: fresh-DB migration,
   11 file regresi SQL, drift, lint, typecheck, test, build) harus hijau.
5. Merge ke `main` → `deploy-production.yml` (perlu approval pemilik) +
   Vercel **Production** deployment. Lanjut checklist manual
   `docs/PROD_ENV_CHECKLIST.md` + `supabase/verify-prod.sql`.
6. Hapus head branch setelah merge. Tag tiap beta (`v0.1.0-beta.N`).

## Pemisahan fitur vs production

| Aspek | feature branch | main / production |
|---|---|---|
| CI | `ci-dev.yml` ("CI (feature)", ringan) | `ci-main.yml` (gate penuh, required check) |
| Vercel | tidak ada deployment (`git.deploymentEnabled` = false) | Production deployment dari `deadline-radar-web` saja |
| DB deploy | staging otomatis tiap PR ke `main` | production hanya dari `main` + approval |
| Secrets | staging (`STAGING_DATABASE_URL`) | production (`PRODUCTION_DATABASE_URL`, hanya dibaca `deploy-production.yml`) |
| E2E Playwright | manual vs staging | manual pre-release |

Tidak ada workflow yang trigger dari branch fitur dan membaca secret
production — itu yang membuat kerja harian terputus total dari production.

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
- `git.deploymentEnabled` — `main` saja yang deploy (`dev: false`
  dipertahankan eksplisit agar nama itu tidak pernah bisa deploy kalau
  dibuat ulang). Vercel tidak bisa
  mematikan komentar bot per-branch, jadi deployment non-`main` dimatikan di
  sumbernya. Kalau `main` terhapus dari sini, merge tetap hijau tetapi
  production tidak pernah ter-deploy — itu sebabnya ada `vercel.test.ts`.

  Catatan: `productionBranch` di project ini sebenarnya **tidak diset** (API
  mengembalikan kosong), meski `docs/BRANCHING.md` pernah menyebut `main`.
  Yang berlaku faktanya: deployment dari `main` ditandai `target=production`
  (terverifikasi — build sukses terakhir `2a9da2f` adalah tip `main`), jadi
  perilaku produksi tidak bergantung pada setelan itu dan tidak diubah di PR
  ini.

`deadline-radar` (root `.`) membangun monorepo dari root dan selalu gagal
`No Output Directory named "public"`; 20 deployment terakhir semuanya error.
API production ada di Railway, jadi tidak ada kebutuhan akan project itu.
`vercel project rm` tidak dijalankan: `git disconnect` sudah cukup menghentikan
build dan komentarnya, dan menghapus project tidak bisa dibatalkan.

## Setup manual yang belum bisa otomatis (GitHub Settings)

Repo ini private tanpa Pro, jadi langkah berikut dikerjakan manusia sekali
saja di Settings → Branches / Environments. Status per 2026-10-02
(pasca-migrasi trunk-based):

- [x] Environment `staging`: sudah dibuat via API.
- [x] Environment `Production` → deployment branches = `main` saja: sudah
  diset via API (custom branch policy `main`).
- [x] Default branch = `main` (dulu `dev`; `dev` dihapus 2026-10-02).
- [ ] Protection `main`: require PR, require `ci-main` hijau, 1 review,
  block force-push — butuh Pro / repo public, hanya bisa diklik manual
  (API mengembalikan 403).
- [ ] Environment `Production` → required reviewer = pemilik — butuh
  plan berbayar (API: 422 billing plan), hanya bisa diklik manual; tanpa
  ini, approval prod mengandalkan proteksi branch `main` + review PR.
