# FINAL SECURITY VERIFICATION & SIGN-OFF — Deadline Radar

```
REPO_PATH        : /Users/voldys/project/deadline-radar (working tree, BELUM commit — tak ada hash)
AUDIT_REPORT     : SECURITY_AUDIT_2026-09-19.md (8 temuan: 0C/0H/3M/2L/3INFO)
FIX_CLAIMS       : SEC-001..008 "sudah diperbaiki" di working tree (klaim sesi ini, diuji di bawah)
TEST_ENV         : tidak tersedia (tidak ada staging; bukti runtime hanya build prod lokal)
CONFIG_ANSWERS   : sebagian — single replica; retensi 90; SQL verifikasi diserahkan;
                   dev bucket private, prod BELUM deploy; webhook N/A; Sentry menunggu DSN;
                   cleanup selesai. BELUM: dashboard Supabase, env prod, backup, security.txt
EXPOSURE_HISTORY : "tidak ada" (terverifikasi terbatas, lihat F6)
RELEASE_TARGET   : tidak dinyatakan (prod belum ada)
```

> **Disklaimer independensi (anti-pattern #8 gate ini):** verifikator sesi ini adalah
> agen yang sama dengan yang menulis perbaikan. Itu melemahkan independensi dan
> dengan sendirinya menutup kemungkinan verdict `GO` penuh — lihat Syarat C1.

---

## 1. Verdict

### `CONDITIONAL GO`

Alasan satu kalimat: tidak ada temuan CRITICAL/HIGH dan 7/8 perbaikan terbukti E2,
tetapi SEC-003 tersisa PARTIALLY-FIXED (jalur PostgREST langsung), verifikasi oleh
pihak yang sama dengan implementor, dan produksi belum ada sehingga E3-staging mustahil.

**Blocker/kondisi (semua di §11):** C1 verifikasi independen · C2 commit+tag ·
C3 env prod + migrasi + `verify-prod.sql` · C4 residu SEC-003 · C5 jawaban dashboard ·
C6 verifikasi runtime pasca-deploy.

> C4 dilacak sebagai **blocking gate eksplisit** di `docs/PROD_ENV_CHECKLIST.md` §7
> (bukan sekadar catatan). Checklist-lah yang menentukan kapan C4 boleh dicentang,
> dengan evidence yang disyaratkan di sana — bukan hijaunya test aplikasi.

---

## 2. Papan skor

```
Temuan audit awal   : 8  (C:0  H:0  M:3  L:2  INFO:3)
VERIFIED-FIXED      : 7
PARTIALLY-FIXED     : 1  (SEC-003 — jalur app tertutup, jalur PostgREST langsung terbuka)
NOT-FIXED           : 0
COSMETIC-FIX        : 0
FIX-REGRESSED       : 0
UNVERIFIED          : 0
NOT-ATTEMPTED       : 0
Temuan baru (F5)    : 0 ID baru (residu SEC-003 menempel pada ID lama, bukan ID baru)
Distribusi bukti    : E4:0  E3:1 (lokal, bukan staging)  E2:7 (dengan catatan §3)  E1:pendukung
```

---

## 3. Matriks verifikasi (semua ID)

| ID | Judul | Sev | Klaim | Status | Tier | Bypass dicoba | Ref bukti |
|---|---|---|---|---|---|---|---|
| SEC-001 | Open redirect `return_to` | M | fixed | VERIFIED-FIXED | E2 | 18 varian (lolos 4 di kode lama, 0 di baru) | §5-001, `/tmp/bypass-redirect.ts` output |
| SEC-002 | Tanpa CSP/HSTS/X-Frame web | M | fixed | VERIFIED-FIXED | E2 + E3-lokal | header tidak bisa di-strip penyerang (penalaran) | curl `next start` + `NONCE_MATCH` |
| SEC-003 | Tanpa kuota → amplifikasi email | M | fixed | PARTIALLY-FIXED | E2 (app) / E1 (residu) | PostgREST langsung (TEMBUS, lihat §4) | revert-proof + policy text §4 |
| SEC-004 | Subject email mentah | L | fixed | VERIFIED-FIXED | E2 | `\r\n`+`Bcc:` di subject & body | revert-proof email-resilience |
| SEC-005 | `redirectTo` buta | L | fixed | VERIFIED-FIXED | E2-helper + E1-wiring | regresi backend penggemaan input (ditahan validator) | redirect.test.ts + grep 5 situs |
| SEC-006 | `href` tanpa allowlist skema | INFO | fixed | VERIFIED-FIXED | E2-helper/skema + E1-komponen | `javascript:`/`data:` di skema & helper | attachment.test.ts |
| SEC-007 | Rate-limit in-memory | INFO | fixed | VERIFIED-FIXED | E2 | boot prod tanpa REDIS_URL (ditolak) | revert-proof env.test.ts |
| SEC-008 | Respons cron bocor hitungan | INFO | fixed | VERIFIED-FIXED | E2 | baca counts tanpa secret (tertutup) | revert-proof cron-auth A2 |

Catatan tier jujur: revert-proof "gagal di kode lama" untuk helper *baru* (SEC-001/005/006)
bersifat menegaskan-bukan-membuktikan (fungsi tak ada di kode lama); bobot E2 di sana
ditopang demonstrasi diferensial (SEC-001) dan test wiring (SEC-004/007/008/003).
SEC-005 wiring (5 situs) dan SEC-006 guard komponen hanya E1 — tidak ada route/component
test; dicatat sebagai celah bukti, bukan celah keamanan.

---

## 4. Detail temuan yang tidak lulus penuh

### [SEC-003] Kuota email — PARTIALLY-FIXED
Klaim perbaikan: kuota 200 task / 10 threshold / cap 50 email/user/run.
Apa yang berubah (terverifikasi E2): `POST /tasks` → 429 di 200 (revert: 3 fail,
restore: 4 pass); evaluator cap 50 + 10 pending (revert: fail, restore: pass);
`PUT` 11 item → 429. md5 file dikembalikan persis pasca-siklus.
Kenapa belum cukup: **RLS mengizinkan INSERT langsung via PostgREST tanpa batas.**
Bukti verbatim (`supabase/migrations/20260901020000_tasks.sql:83-85`):
`create policy "tasks_insert_own" ... for insert with check (user_id = auth.uid());`
— tanpa klausa hitung. Anon key publik by design (`NEXT_PUBLIC_*` di `.env.example`).
Trigger `on_task_created ... after insert ... for each row` (`:62-68`) menyuntik 4
threshold default pada **setiap** insert dari jalur mana pun. Thresholds INSERT pun
tanpa cap (`thresholds_insert_own`). Satu-satunya rem global adalah cap 50/user/run
(masih berlaku untuk baris langsung) — sehingga liabilitas total tak terbatas
(drain 50/run selamanya), bukan bounded.
Reproduksi (konseptual, tanpa staging): login → `POST https://<project>.supabase.co/rest/v1/tasks`
dengan `apikey: <anon>` + `Authorization: Bearer <jwt>` body 10.000 task
`user_id=self` → lolos RLS → trigger menambah 40.000 threshold → cron mengirim.
Blast radius: sama dengan temuan awal (biaya Resend), laju dibatasi 50/user/run.
Yang masih harus dilakukan (tanpa menulis kode di gerbang ini): cabut/batasi tulis
PostgREST langsung (revoke `INSERT` anon/authenticated pada tasks/thresholds, atau
trigger kuota di DB), atau putuskan sadar bahwa PostgREST terekspos + terima risikonya;
lalu verifikasi ulang E3 ke Supabase staging.
Pelacakan: `docs/PROD_ENV_CHECKLIST.md` §7 (C4 — OPEN / BLOCKING). SEC-003 tetap
PARTIALLY-FIXED sampai gate itu lolos dengan evidence yang disyaratkannya; test
aplikasi yang hijau bukan dasar mengubah status ini.

---

## 5. Perbaikan yang terverifikasi (ringkas, dengan bukti usaha)

- **SEC-001**: korpus 18 varian dijalankan terhadap logika lama vs validator baru.
  Lama meneruskan `//evil.com/phish`, `/\evil.com`, `///evil.com`, `/tasks\r\n…` ke
  `redirect()`; baru menolak keempatnya; perilaku identik untuk `/tasks`,
  `/courses/:id?view=all`, `/summary`. `/%2f%2fevil.com` lolos keduanya — aman
  (tetap path same-origin, tanpa otoritas). Tier E2.
- **SEC-002**: `next start` (build prod) + `curl -I /login` menampilkan
  CSP nonce/`strict-dynamic`, `frame-ancestors 'none'`, HSTS, nosniff, DENY,
  Referrer-Policy; nonce header == nonce 16 tag inline dalam satu respons
  (`NONCE_MATCH`). Tier E2+E3-lokal. Penalaran bypass: header diset server di
  kedua jalur proxy; penyerang tak bisa menghapusnya tanpa header-injection
  (tidak ditemukan).
- **SEC-004**: revert 1 baris subject → test pengiriman gagal (subject mentah
  keluar); restore → 4 pass. Tier E2.
- **SEC-005**: 5 situs grep-terkonfirmasi memakai `resolveSafeReturnTo`
  (`actions/auth.ts:49,81,133`, `auth-forms.tsx:256,373`); nilai backend saat ini
  semua lolos; fuzz jatuh ke fallback. Tier E2-helper/E1-wiring.
- **SEC-006**: helper + skema menolak `javascript:`/`data:`/`//evil` (test);
  guard `<a>` terkonfirmasi di `attachment-manager.tsx:365`. Tier E2/E1.
- **SEC-007**: revert cek `REDIS_URL` → test boot-guard gagal; restore → 6 pass. Tier E2.
- **SEC-008**: revert return → test A2 (`toEqual({ok:true})`) gagal; restore → 7 pass.
  Metrik terlihat di server log (`[cron] evaluate-reminders finished: {...}`).
  Tier E2.

---

## 6. Regresi & efek samping (F4)

- Suite hijau pasca-semua-siklus: API 344/344, web 168/168, validation 105/105,
  domain 36/36; `tsc` bersih (api, web, root); `next build` lolos.
- Dua edit test eksisting dibenarkan (bukan pelemahan): (a) overlap-test cron —
  asersi `created` dari body pindah ke store (body memang dihapus SEC-008; makna
  exactly-once tetap); (b) `env.test.ts` — setup "valid" kini menyetel `REDIS_URL`
  karena syarat boot berubah.
- Tidak ada pelonggaran kontrol: 0 file migrasi termodifikasi (hanya untracked lama +
  `verify-prod.sql` baru yang read-only); service-role tetap 3 situs di
  `attachments.ts`; tanpa flag/endpooint debug; tanpa perubahan cache; CSP
  `connect-src *.sentry.io` dibenarkan (inert tanpa DSN); Sentry nonaktif tanpa DSN;
  `TaskWithCourse` yang didaftarkan MEMPERBAIKI spec invalid (bukan melonggarkan).
- 0 regresi.

---

## 7. Temuan baru dari uji cakupan mandiri (F5)

Tidak ada ID baru. Sweep: RLS 11 tabel aktif + policy per operasi + `WITH CHECK`
(verbatim §4); deliveries tanpa policy INSERT (fabrikasi delivery langsung tertutup —
positif); semua `redirect()` memakai konstanta/nilai tervalidasi, satu-satunya param
`next` ter-allowlist; bundle `.next` bebas `SUPABASE_SERVICE_ROLE_KEY`/`service_role`
(`NEXT_PUBLIC_*` hanya URL/VERCEL_ENV); tanpa `security.txt` (catat di F7).
Satu pola sistemik yang dikonfirmasi F3/F5: **kuota hanya di lapisan aplikasi,
RLS tanpa batas hitung** — menempel pada SEC-003, bukan audit-miss baru
(audit awal sudah menyatakan RLS lapis kedua).

---

## 8. Kewajiban pasca-paparan (F6)

| Item | Status |
|---|---|
| Secret di bundle klien (build `.next` aktual) | ☑ Bersih (grep) |
| Secret hardcode di source (pola `eyJ…`/`re_…`/private-key, terbatas) | ☑ Bersih |
| Fixture e2e (`serviceRoleKey()`) hardcode | ☑ Env-based (`fixtures.ts:32-38`) |
| File `.env*` pernah ter-commit | ☑ Tidak pernah (`git log` kosong; `.gitignore` menutup) |
| Rotasi/cabut sesi/notifikasi pengguna | ☑ N/A — tidak ada paparan ditemukan |
| Batasan | histori nilai-secret level-diff tidak dipindai penuh (dinyatakan, bukan disembunyikan) |

---

## 9. Kesiapan produksi (F7)

| Item | Status |
|---|---|
| Rate limiting aktif di prod | ❓ UNVERIFIED — kode + Redis-guard ada; prod belum ada |
| Security headers terkirim di prod | ❓ UNVERIFIED — terbukti di build lokal (E3-lokal), bukan domain prod |
| Redirect allowlist Supabase | ❓ Belum dijawab |
| Bucket `attachments` prod | ❓ Prod belum deploy (dev private terkonfirmasi pemilik) |
| Migrasi + `verify-prod.sql` di prod | ❓ Menunggu project prod (C3) |
| Backup/restore | ❓ Belum dijawab |
| Alerting (email, auth, 5xx, cron) | ❓ Direkomendasikan; Sentry+log siap, alarm belum dibuat |
| Jalur lapor kerentanan (`security.txt`) | ❌ Tidak ada — sarankan tambah sebelum publik |
| CONFIG_ANSWERS | ❌ Sebagian (lihat INPUT) |
| Resend suppression/webhook | ☑ N/A by design (verifikasi kode) |

---

## 10. Batasan verifikasi ini

1. Verifikator = implementor (independensi terbatas; syarat C1).
2. Tanpa staging/prod: E3 DLC mustahil; bukti runtime hanya build lokal.
3. Working tree kotor (campuran perubahan pra-sesi + sesi ini) dan belum commit —
   tidak ada hash untuk di-sign; sign-off kedaluwarsa pada perubahan apa pun.
4. Dashboard Supabase/Resend/Sentry, DNS/TLS, infra tidak terlihat.
5. Git-history value-scan, e2e, load/perf, CVE scan tidak dilakukan.
6. Gerbang ini tidak mengubah kode (kecuali siklus revert sementara yang
   dikembalikan terverifikasi-md5).

---

## 11. Pernyataan sign-off

```
SIGN-OFF DITAHAN SEBAGAI GO PENUH — VERDICT: CONDITIONAL GO
Cakupan  : SEC-001..008 pada working tree sesi ini (md5 tercatat di §5/siklus)
Tanggal  : 2026-09-20
Syarat wajib sebelum rilis publik:
  C1. Pihak independen memverifikasi ulang temuan MEDIUM (khusus SEC-003).
  C2. Commit + tag tree yang diverifikasi; sign-off ini tidak berlaku untuk tree lain.
  C3. Isi env prod (wajib REDIS_URL — boot gagal tanpanya), jalankan migrasi,
      tempel supabase/verify-prod.sql di SQL editor dan cocokkan ekspektasi.
  C4. Tutup residu SEC-003 (§4) atau terima risikonya secara tertulis + E3 ulang.
      Dilacak di docs/PROD_ENV_CHECKLIST.md §7 — C4 hanya dicentang bila evidence
      di sana lengkap (test output + production verification evidence); test
      aplikasi hijau saja tidak cukup (release rule di checklist).
  C5. Jawab sisa dashboard: allowlist redirect, kebijakan confirm-email/OTP,
      eksposur PostgREST, backup/restore, tambah security.txt.
  C6. Pasca-deploy: buktikan header live, cron ok + log metrik, Sentry menerima
      event ter-scrub, alarm biaya Resend aktif — baru E3 terpenuhi.
Verifikasi ulang diperlukan bila: perubahan RLS/policy, endpoint email/cron baru,
perubahan model auth, sharing antar-user, perubahan cache route berautentikasi,
atau pelonggaran kuota/validasi apa pun.
```
