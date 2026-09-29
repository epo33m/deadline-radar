# Branching & CI/CD — Deadline Radar

> Sumber kebenaran untuk alur branch, CI, dan deploy. Terakhir diverifikasi
> 2026-09-29 via Vercel CLI + GitHub API.

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
         Preview +   Production
         staging     (approval)
         otomatis
```

1. Kerja di branch fitur, buka PR ke `dev`. `ci-dev` (lint, typecheck,
   test, build — tanpa database, tanpa secrets) harus hijau.
2. Merge ke `dev` → otomatis: Vercel **Preview** deployment + migrasi
   database **staging** (`deploy-staging.yml`). Verifikasi di staging.
3. Buka PR `dev` → `main`. `ci-main` (gate penuh: fresh-DB migration,
   11 file regresi SQL, drift, lint, typecheck, test, build) harus hijau.
4. Merge ke `main` → `deploy-production.yml` (perlu approval pemilik) +
   Vercel **Production** deployment. Lanjut checklist manual
   `docs/PROD_ENV_CHECKLIST.md` + `supabase/verify-prod.sql`.

## Pemisahan dev vs production

| Aspek | dev / feature | main / production |
|---|---|---|
| CI | `ci-dev.yml` (ringan) | `ci-main.yml` (gate penuh, required check) |
| Vercel | Preview deployment | Production deployment (`productionBranch: main` di kedua project `deadline-radar` dan `deadline-radar-web`) |
| DB deploy | staging otomatis tiap push `dev` | production hanya dari `main` + approval |
| Secrets | staging (`STAGING_DATABASE_URL`) | production (`PRODUCTION_DATABASE_URL`, hanya dibaca `deploy-production.yml`) |
| E2E Playwright | manual vs staging | manual pre-release |

Tidak ada workflow yang trigger dari branch dev/fitur dan membaca secret
production — itu yang membuat dev terputus total dari production.

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
