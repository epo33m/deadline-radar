# Release Guide — Deadline Radar

> Sumber kebenaran untuk cara merilis. Menutup issue #145 (package.json vs tag drift).
> Status produksi: aplikasi live di https://dr.rapm.space — **bukan demo**.

## 1. Aturan versi

- SemVer, tag `vX.Y.Z` dengan target `main` (atau SHA spesifik di `main`).
- `package.json` root **dan** semua workspace (`apps/*/package.json`,
  `packages/*/package.json`) wajib bernilai sama dengan versi tag tanpa
  prefix `v`. Contoh: tag `v1.1.0` ↔ `"version": "1.1.0"` di 7 file.
- Guard:
  ```bash
  bun run check:version                              # konsistensi workspace (jalan di CI feature)
  bun run scripts/check-version-sync.ts --tag vX.Y.Z # wajib lolos sebelum tag di-push / rilis di-publish
  ```

## 2. Anatomi GitHub Release

Setiap rilis terdiri dari 5 komponen:

1. **Tag versi** — marker ke satu commit spesifik di `main`. Format SemVer
   (`v1.1.0`; pre-release `vX.Y.Z-beta.N`). Target: branch `main` atau SHA commit.
2. **Judul rilis** — ringkas: versi + tema utama. Contoh:
   `v1.1.0 - Pagination + Telemetry`. Jika dikosongkan, GitHub memakai nama tag.
3. **Catatan rilis (Release notes / What's changed)** — Markdown: Added /
   Fixed / Changed, PR dan issue terkait, link komparasi
   `v1.0.0...v1.1.0`. Gunakan tombol **Generate release notes** lalu rapikan
   mengikuti template §4.
4. **Aset rilis** — aplikasi ini web (deploy via Vercel + Railway), tidak ada
   biner custom. Cukup aset Source Code `.zip` / `.tar.gz` otomatis GitHub.
5. **Status & publikasi** — rilis stabil: `Set as a pre-release` **tidak**
   dicentang, `Set as the latest release` **dicentang**, lalu **Publish
   release** (draft hanya untuk persiapan privat).

## 3. Checklist rilis (manual via web GitHub)

1. Pastikan `main` hijau (ci-main) dan branch rilis sudah merge.
2. `bun run check:version` lolos; bump versi bila perlu (satu commit
   `chore(release): bump to X.Y.Z`).
3. Buat tag: `git tag vX.Y.Z && git push origin vX.Y.Z`.
4. Verifikasi: `bun run scripts/check-version-sync.ts --tag vX.Y.Z` lolos.
5. GitHub → Releases → **Draft a new release** → pilih tag → isi judul +
   notes (§4) → centang latest, bukan pre-release → **Publish release**.
6. Update badge versi di `README.md` bila belum (follow-up PR bila perlu).

Otomatisasi penuh (workflow auto-create-release saat tag `v*` di-push)
sengaja belum ditambahkan — PR ini tetap metadata-only dan kecil.

## 4. v1.1.0 — What's changed (20 commit sejak v1.0.0)

**Tag:** `v1.1.0` · **Target:** `main` · **Judul:** `v1.1.0 - Pagination + Telemetry`
**Komparasi:** `v1.0.0...v1.1.0` · **Status:** latest, bukan pre-release · **Aset:** source otomatis.

### Added

- Cursor pagination di task & notification lists — API cursor diteruskan ke web
  (I-10, #156).
- Per-attempt send telemetry + audit IP sadar `TRUST_PROXY` (I-13, #159).
- Client identity diteruskan web → API untuk rate limit per-client (#169).

### Fixed / Hardened

- Auth bridge: same-origin intent gate (#171); cookies hanya di-clear saat 401
  refresh (#172); fail-closed ke peer bila semua entri XFF tepercaya (#174);
  cap body bridge sebelum buffering (#175).
- API: freeze identitas email sebelum panggil provider (#158); urutan
  invalidasi vs populasi cache authz (#170); guard `JSON.parse` non-JSON (#154);
  error PARSE Elysia → envelope 400 tanpa Sentry (#153); cap body independen
  Content-Length (#152).
- Idempotency: atomic completion + dedupe guard (#151); validasi body sebelum
  klaim, lepas kunci saat 4xx (#150).
- Scheduler/ops: guard scheduling di stuck-pending sweep (#149); self-heal TTL
  kunci rate-limit (#148); storage-sweep exact + age-gated (#147); throttle
  auth-abuse tahan timeout Redis + fallback memori (#146); cabut EXECUTE klien
  di RPC `get_user_summary` (#176); isolasi file tes web dari patch konsol
  Next (#157).

Salin bagian ini sebagai isi Release notes saat publish v1.1.0 di web GitHub.
