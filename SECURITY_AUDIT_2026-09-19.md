# SECURITY THREAT-MODEL & AUDIT — Deadline Radar

```
REPO_PATH      : /Users/voldys/project/deadline-radar
SCOPE          : seluruh repo
MODE           : AUDIT (read-only — tidak ada file kode diubah; satu-satunya file baru adalah laporan ini)
ENV_CONTEXT    : belum deploy (asumsi; butuh konfirmasi manusia §8)
ROUND          : 1
KNOWN_ISSUES   : -
Tanggal        : 2026-09-19
```

Koreksi asumsi stack: repo ini **bukan** Next.js+Supabase-postgREST seperti asumsi default.
Arsitektur nyata: **`apps/api` (Bun + Elysia, Drizzle via `DATABASE_URL`) + `apps/web`
(Next.js, tanpa Supabase client — semua via API) + `packages/db|validation|domain` +
`supabase/migrations` (RLS sebagai defense-in-depth)**. Seluruh penilaian di bawah
mengacu pada arsitektur nyata ini, bukan asumsi.

---

## 1. Ringkasan eksekutif

**Verdict: SHIP WITH FIXES** — fondasi auth/authz kuat, tapi ada 1 open redirect
user-controlled dan tidak ada kuota yang membatasi amplifikasi biaya email.
**0 CRITICAL · 0 HIGH · 2 MEDIUM · 2 LOW · 4 INFO · 11 NEEDS-VERIFY.**
Blocker rilis hanya 2 item MEDIUM (§7); sisanya hardening terjadwal.

---

## 2. Threat model ringkas

**Aset:** akun user (email+password), daftar deadline & isinya, alamat email, jadwal
reminder, kuota/biaya Resend, kredensial (`SERVICE_ROLE`, `CRON_SECRET`, `AUTH_BRIDGE_SECRET`).
**Aktor:** anonim, user terdaftar, user lain (tenant tetangga), cron caller palsu,
email provider dikompromikan, operator/maintainer, supply chain (npm).
**Trust boundary:** browser → (Server Actions / Route Handlers `apps/web`, cookie
httpOnly) → rewrite `/api/*` → API Elysia (verifikasi JWT via JWKS, `requireAuthz`
default-deny, Drizzle `DATABASE_URL` role postgres yang **melewati RLS**) → Postgres /
Supabase Auth / Storage / Resend. Cron adalah caller mesin via header
`Authorization: Bearer CRON_SECRET`. RLS Postgres hanya mengikat jalur Supabase
client langsung (anon/user/service), bukan jalur Drizzle — sehingga **otorisasi
aplikasi adalah garis pertahanan utama, RLS adalah lapis kedua**.

7 skenario serangan teratas (urut kemungkinan):
1. User A membaca/mengubah deadline User B (IDOR) — **tertutup**: semua query
   difilter `eq(tasks.userId, ctx.subject.id)` / helper `ownedTask` (§D8 PASS).
2. Anonim memicu `/api/v1/cron/evaluate-reminders` dan mengirim email massal —
   **tertutup**: Bearer + constant-time + fail-closed (§D5 PASS).
3. Service role key bocor ke bundle klien — **tertutup**: tidak ada Supabase client
   di `apps/web`; service client hanya di API dengan cek kepemilikan (§D4 PASS).
4. Cookie dipercaya tanpa verifikasi — **tertutup**: `jwtVerify` JWKS
   (`apps/api/src/lib/auth-tokens.ts:101`), bukan `getSession()` (§D1 PASS).
5. Data bocor lewat cache/CDN — **tertutup di API** (`Cache-Control: private,
   no-store` + `no-store` di semua fetch server); web tanpa CSP tapi tanpa cache
   data per-user yang berbahaya (§D17 PASS dengan 1 catatan INFO).
6. Ownership dioper lewat body (mass assignment) — **tertutup**: zod `.strict()` +
   `FORBIDDEN_MUTATION_KEYS` di semua route tulis (§D9 PASS).
7. Enumerasi akun & spam email via signup/reset — **tertutup**: response generik
   (§D1 PASS); sisa risiko hanya rate-limit tanpa Redis (§SEC-007 INFO).

---

## 3. Peta permukaan serangan

| Entry point | Tipe | Auth diperlukan | Aksi | Data disentuh | Kontrol yang ada |
|---|---|---|---|---|---|
| `GET /health` (`apps/api/src/app.ts:61`) | Route API | tidak ada (exempt rate-limit) | health check | `{ok,service}` | tidak ada data sensitif |
| `POST /api/v1/auth/register` (`apps/api/src/routes/auth.ts:113`) | Route API | tidak ada (20/mnt) | `anon.signUp` + `profiles.update(timezone)` + set cookie | email/password/timezone | zod strict, throttle, generic response |
| `POST /api/v1/auth/login` (`apps/api/src/routes/auth.ts:240`) | Route API | IP+account throttle | `signInWithPassword` | email/password | exp-backoff, `Retry-After`, generic error |
| `POST /api/v1/auth/refresh\|logout\|logout-all` (`auth.ts:366,438,478`) | Route API | refresh-cookie / opsional / sesi | rotate/cabut sesi | cookie `dr_access_token/refresh` | httpOnly, `signOut local/global` |
| `POST /api/v1/auth/forgot-password` (`auth.ts:520`) | Route API | tidak ada | `resetPasswordForEmail` ke `WEB_ORIGIN/auth/confirm?next=/reset-password` | email | selalu generik (`auth.ts:555`) |
| `POST /api/v1/auth/reset-password` (`auth.ts:572`) | Route API | recovery-JWT (`amr=recovery`) | `updateUser(password)` + `signOut global` | password baru | `verifyAccessTokenClaims` + `isRecoverySession` (`auth.ts:595`) |
| `POST /api/v1/auth/change-password|change-email` (`auth.ts:656,763`) | Route API | `requireAuthz(profile.*)` + verifikasi current password | update user | password/email | re-auth wajib |
| `GET /api/v1/auth/confirm` (`auth.ts:855`) | Route API | `code`/`token_hash` (secret sekali pakai) | exchange/verify OTP + set cookie / 302 | code, `next` | `resolveConfirmNextPath` allowlist |
| `GET /api/v1/auth/session`, `PATCH timezone|time-format` (`auth.ts:981,1053,1088`) | Route API | `requireAuthz(profile.*)` | baca/patch profil sendiri | profil | `eq(profiles.id, user.id)` |
| `GET|POST|PATCH /api/v1/tasks/*` (`apps/api/src/routes/tasks.ts`) | Route API | `requireAuthz(task.* / threshold.manage)` | CRUD task + threshold | tasks/thresholds | `ownedTask` + `eq(userId)` + forbidden-keys |
| `GET|POST|PATCH /api/v1/courses/*` (`courses.ts`) | Route API | `requireAuthz(course.*)` | CRUD course (tanpa DELETE fisik) | courses | ownership + soft-delete |
| `POST /api/v1/attachments/file|link`, `GET signed-url`, `DELETE` (`attachments.ts`) | Route API | `requireAuthz(attachment.*)` | upload/link/hapus/signed URL | Storage `attachments` + tabel | prefix `attachments/{uid}/` + `ownedAttachment*` + service client terotorisasi |
| `GET /api/v1/notifications`, `POST :id/read`, `POST read-all` (`notifications.ts`) | Route API | `requireAuthz(notification.*)` | baca/tandai notif | deliveries via tasks | double-scoped update (lookup + mutasi) |
| `GET /api/v1/summary` (`summary.ts`) | Route API | `requireAuthz(task.view)` | agregat bucket + progress | tasks user sendiri | `eq(tasks.userId)` |
| `POST|GET /api/v1/admin/roles/*|audit` (`admin.ts`) | Route API | `requireAuthz(role.assign/revoke, audit.view)` | assign/revoke role, audit | user_roles, audit events | admin-only + idempotency |
| `GET /api/v1/cron/evaluate-reminders` (`cron.ts:26`) | Cron mesin | `Bearer CRON_SECRET` (10/mnt) | purge + `runEvaluateReminders()` | tasks/profiles/deliveries, Resend | constant-time, fail-closed |
| `proxy` middleware (`apps/web/proxy.ts:166`, matcher `:189-192`) | Middleware | JWT verify (JWKS) + silent refresh | gate publik/privat | cookie sesi | `hasSession` + allowlist publik |
| Server Actions (`apps/web/app/actions/*.ts`) | Server Action | cookie sesi via `apiJson` | CRUD via API | FormData | identitas dari sesi, bukan input |
| Route Handlers web (`apps/web/app/api/auth/*/route.ts`, `app/auth/confirm/route.ts`) | Route Handler | bridge secret + cookie | bridge ke API | cookie sesi | `stripAuthTokens`, `resolveConfirmNextPath` |
| Halaman `(app)/*` + `(auth)/*` | RSC | `requireSession()` | render data sendiri | props per-user | redirect `/login` bila anon |

---

## 4. Tabel temuan (urut severity)

| ID | Judul | Domain | Severity | Confidence | Status | Lokasi |
|---|---|---|---|---|---|---|
| SEC-001 | Open redirect via `return_to` (`startsWith("/")` lolos `//evil`) | D13 | MEDIUM | Confirmed | OPEN | `apps/web/app/actions/tasks.ts:66` |
| SEC-002 | Tanpa CSP/HSTS/`X-Frame` di web | D16 | MEDIUM | Confirmed | OPEN | `apps/web/next.config.ts:5` (tanpa `headers()`), `apps/web/proxy.ts` |
| SEC-003 | Tanpa kuota task/reminder → amplifikasi biaya email via cron | D18/D6 | MEDIUM | Confirmed | OPEN | `packages/domain/src/evaluate.ts`, `apps/api/src/services/run-evaluate.ts` (tidak ada limit) |
| SEC-004 | Subject email memakai `taskTitle` mentah (risiko header injection) | D6 | LOW | Likely | OPEN | `apps/api/src/lib/email.ts:175` |
| SEC-005 | Frontend percaya `redirectTo` backend secara buta | D13 | LOW | Confirmed | OPEN | `apps/web/app/actions/auth.ts:45,76,127`, `components/auth/auth-forms.tsx:254,369` |
| SEC-006 | `href={attachment.url}` tanpa allowlist skema di frontend | D10 | INFO | Confirmed | OPEN | `components/tasks/attachment-manager.tsx:360-368` |
| SEC-007 | Rate-limit fallback in-memory tanpa Redis (bypass multi-instans) | D16 | INFO | Confirmed | OPEN | `apps/api/src/lib/redis.ts:19-20`, `apps/api/src/plugins/rate-limit.ts:105` |
| SEC-008 | Respons cron membocorkan hitungan internal | D5/D14 | INFO | Confirmed | OPEN | `apps/api/src/routes/cron.ts:42-43` |

---

## 5. Detail temuan

### [SEC-001] Open redirect via `return_to` — `//evil` lolos `startsWith("/")`
```
Severity   : MEDIUM | Confidence: Confirmed | Domain: D13 Open redirect
Lokasi     : apps/web/app/actions/tasks.ts:66
Bukti      :
  if (typeof returnTo === "string" && returnTo.startsWith("/")) {
    redirect(returnTo);
  }
Kenapa bermasalah : `startsWith("/")` menerima `//evil.com/phish` (protocol-relative
  URL). `redirect("//evil.com/...")` membuat browser navigasi ke origin penyerang
  dengan konteks pasca-aksi terpercaya ("task tersimpan, lanjutkan di sini").
  Backend tidak terlibat — nilai berasal murni dari `FormData` yang dikontrol penyerang.
Skenario serangan : korban login → penyerang membujuk korban submit form / klik link
  yang membawa `return_to=//evil.com/login-clone` → korban mendarat di situs phishing.
Blast radius      : kredensial (phishing lanjutan); bukan kebocoran data langsung.
Perbaikan         : gunakan validator yang sama dengan confirm flow:
  `resolveConfirmNextPath`-style — tolak `//`, `/\`, skema, dan hanya izinkan path
  internal yang diawali `/` tunggal; fallback ke `result.redirectTo ?? /tasks/:id`.
Verifikasi        : POST dengan `return_to=//evil.com` harus mendarat di fallback
  internal, bukan `Location: //evil.com`.
Regression test   : unit test `return_to` ∈ {`/tasks`,`//evil.com`,`/\%5cevil`,
  `https://evil`,`javascript:alert(1)`} → hanya path internal yang dihormati.
```

### [SEC-002] Tanpa CSP / HSTS / X-Frame di aplikasi web
```
Severity   : MEDIUM | Confidence: Confirmed | Domain: D16 Hardening
Lokasi     : apps/web/next.config.ts:5 (hanya redirects()+rewrites(), tanpa headers())
Bukti      : grep Content-Security-Policy|Strict-Transport di apps/web/ → nihil.
  API sudah benar (apps/api/src/plugins/http-policy.ts:8-14: nosniff, Referrer-Policy,
  DENY, HSTS prod-only) — yang hilang adalah sisi web tempat XSS akan dieksekusi.
Kenapa bermasalah : tanpa CSP, satu celah XSS (mis. via link attachment, §SEC-006)
  langsung menjadi eksekusi skrip penuh; tanpa frame-ancestors ada risiko clickjacking
  pada halaman berautentikasi.
Skenario serangan : penyerang menyimpan URL `javascript:`/konten licik (jika validasi
  API lolos di masa depan) → dieksekusi tanpa lapisan CSP kedua.
Blast radius      : sesi/aksi korban bila XSS terjadi (dampak tidak langsung).
Perbaikan         : tambah `headers()` di next.config.ts: CSP ketat (tanpa
  unsafe-inline/eval bila memungkinkan), HSTS, X-Frame-Options/DENY atau
  frame-ancestors 'none', Referrer-Policy. Uji tidak merusak Next inline runtime.
Verifikasi        : `curl -I` halaman web memuat CSP+HSTS+frame-ancestors.
Regression test   : test header mengassert kehadiran CSP/HSTS pada response halaman.
```

### [SEC-003] Tanpa kuota task/reminder → amplifikasi biaya email via cron
```
Severity   : MEDIUM | Confidence: Confirmed | Domain: D18 Business logic / D6 Email abuse
Lokasi     : packages/domain/src/evaluate.ts (tanpa quota), apps/api/src/services/run-evaluate.ts:21 (batch 100, tanpa cap per-user)
Bukti      : grep quota|QUOTA di repo hanya komentar localStorage
  (apps/web/lib/timezone.ts:103). Tidak ada limit jumlah task/threshold per user di
  validasi, route, maupun DB constraint.
Kenapa bermasalah : tiap task + threshold yang due menghasilkan delivery email
  (`run-evaluate.ts:274 pending` → `sendReminderEmail`). User (atau bot akun gratis)
  dapat membuat ribuan task → cron mengirim ribuan email Resend → tagihan/kuota habis.
  Ini satu-satunya jalur "kirim email massal" yang bisa dipicu user biasa.
Skenario serangan : user daftar → script membuat 10.000 task dengan deadline esok +
  threshold default → cron berikutnya mengantre/mengirim 10.000 email.
Blast radius      : biaya Resend, reputasi domain pengirim, kehabisan kuota untuk user lain.
Perbaikan         : (S/M) cap per-user (mis. N task aktif + M reminder/hari) ditegakkan
  di server (route create + DB constraint), plus cap pengiriman per-user per run cron
  dan alerting biaya. Jangan hanya di UI.
Verifikasi        : buat task ke-N+1 → 429/400; cron run dengan backlog besar tetap
  bounded per user.
Regression test   : test kuota: create melebihi batas ditolak; cron menghormati cap.
```

### [SEC-004] Subject email memakai `taskTitle` mentah
```
Severity   : LOW | Confidence: Likely | Domain: D6 Email abuse
Lokasi     : apps/api/src/lib/email.ts:175
Bukti      : subject: `[${label}] Reminder: ${payload.taskTitle}`
Kenapa bermasalah : judul task adalah input user; jika mengandung CR/LF dan SDK
  provider tidak membersihkannya, ada risiko header injection (baris header tambahan)
  atau email rusak/gagal kirim. Belum terbukti dieksploitasi karena Resend SDK
  umumnya menolak newline — karenanya LOW, bukan MEDIUM.
Skenario serangan : user menyimpan task berjudul `A\r\nBcc: victim@x` → jika diteruskan
  mentah ke header Subject, struktur pesan bisa dimanipulasi.
Blast radius      : integritas email keluar; potensi spam/abuse.
Perbaikan         : sanitasi satu baris: buang `[\r\n]+` → spasi, batasi panjang
  (mis. 120 char) sebelum masuk subject; pertahankan judul penuh hanya di body text.
Verifikasi        : kirim reminder untuk judul ber-newline → subject satu baris aman.
Regression test   : unit test subject sanitizer (CR/LF/panjang).
```

### [SEC-005] Frontend percaya `redirectTo` backend secara buta
```
Severity   : LOW | Confidence: Confirmed | Domain: D13 Open redirect
Lokasi     : apps/web/app/actions/auth.ts:44-45,76,127; components/auth/auth-forms.tsx:254,369
Bukti      : if (result.redirectTo) { redirect(result.redirectTo); }  // tanpa validasi
  router.replace(result.redirectTo ?? "/summary")
Kenapa bermasalah : hari ini TIDAK eksploitabel — semua `redirectTo` backend adalah
  konstanta internal ("/summary" auth.ts:329, "/login" :461,503,635, allowlist
  confirm :862 via resolveConfirmNextPath, `/tasks/${row.id}` tasks.ts:312 server-generated).
  Risikonya regresi masa depan: satu endpoint yang menggemakan input menjadi open redirect.
Skenario serangan : tidak ada jalur eksploitasi saat ini (butuh backend ikut berubah).
Blast radius      : future-phishing bila regresi.
Perbaikan         : (S) helper `resolveSafeRedirectTo(v, fallback)` di web (tolak //,
  skema, absolute) dan pakai di semua titik di atas; pertahankan allowlist backend.
Verifikasi        : semua redirectTo backend saat ini lolos validator; fuzzing input jahat tertolak.
Regression test   : test helper redirect aman.
```

### [SEC-006] `href={attachment.url}` tanpa allowlist skema (INFO)
```
Severity : INFO | Confidence: Confirmed | Domain: D10 XSS
Lokasi   : apps/web/components/tasks/attachment-manager.tsx:360-368
Bukti    : <a href={attachment.url} target="_blank" rel="noopener noreferrer">Open</a>
Kenapa   : hari ini aman karena API hanya menerima URL http(s) absolut
  (packages/validation/src/attachment.ts:22-28 linkAttachmentRequestSchema) dan render
  teks React ter-escape; tidak ada dangerouslySetInnerHTML di web (grep nihil).
  Tetap INFO defense-in-depth: satu pelonggaran validasi API langsung menjadi XSS skema.
Perbaikan : (S) allowlist `http(s):` di frontend sebelum render href + saring di API tetap.
```

### [SEC-007] Rate-limit in-memory bila `REDIS_URL` unset (INFO)
```
Severity : INFO | Confidence: Confirmed | Domain: D16 Rate limiting
Lokasi   : apps/api/src/lib/redis.ts:19-20 (null → memory), plugins/rate-limit.ts:105
Kenapa   : dev/single-instans aman; di prod multi-replika tanpa Redis, penyerang dapat
  menyebar request antar replika dan melipatgandakan budget (auth 20/mnt, cron 10/mnt).
Perbaikan : wajibkan REDIS_URL di prod (fail-closed seperti CRON_SECRET) atau
  dokumentasikan single-replica; tambahkan ke §8.
```

### [SEC-008] Respons cron membocorkan hitungan internal (INFO)
```
Severity : INFO | Confidence: Confirmed | Domain: D5/D14
Lokasi   : apps/api/src/routes/cron.ts:42 — return { ok:true, ...result }
  (evaluatedTasks/created/retried/emailsSent/emailsFailed)
Kenapa   : hanya bisa dibaca pemegang CRON_SECRET, jadi bukan kebocoran ke publik;
  tetapi prinsip least-info: cron tidak butuh mengembalikan volume internal.
Perbaikan : kembalikan `{ok:true}` saja atau di balik flag debug; simpan metrik di log server.
```

---

## 6. ✅ Sudah aman / sudah diselesaikan

| Area | Bukti singkat |
|---|---|
| Verifikasi JWT, bukan cookie mentah | `auth-tokens.ts:101 jwtVerify(JWKS, issuer, aud authenticated, ES256/RS256/EdDSA)` + fallback HS256 `:111`; proxy web identik (`proxy.ts:70,83`). Tidak ada `getSession()` di backend. |
| Default-deny capability | `decide.ts:25-34` missing_identity/unknown/missing_capability/policy_failed; `guard.ts:37` 401 vs 403; setiap route memanggil `requireAuthz(...)`. |
| Anti-enumerasi akun | forgot selalu generik (`auth.ts:555`); confirm gagal generik; notifikasi `404` seragam "not found" (`notifications.ts` + komentar anti-enumerasi). |
| Reset harus recovery-session + cabut sesi | `auth.ts:595-606` tolak non-recovery; `:619 signOut global`; change-password rotate refresh `:728`. |
| Cron fail-closed + constant-time | `cron.ts:12-21` tolak bila secret unset (kecuali test), `timingSafeEqualString(Bearer secret)`, 401 generik. |
| Email hanya ke pemilik, bukan input | penerima = `profiles.email` via join `tasks.userId` (`run-evaluate.ts:325,348`); email text-only tanpa HTML (`email.ts:173-185`); idempotency deterministik `:56,207`. |
| Service-role terotorisasi manual | 3 pemakaian, semua setelah cek milik: upload `ownedTask` dulu (`attachments.ts:169-178`), delete + signed-url via `ownedAttachment*` + prefix `attachments/{uid}/` (`:296-370`, `:359`). Bucket privat (`..._attachments.sql:68-70` `public=false`), `upsert:false` (`storage.ts:54`). |
| IDOR tertutup | list/detail/mutasi selalu `eq(userId, ctx)` atau helper milik: tasks (`tasks.ts:150-170`), courses, notif double-scope (`notifications.ts:158-200`), summary (`summary.ts:51-56`). |
| Mass assignment tertutup | semua zod `.strict()` (`packages/validation/src/*.ts`); `FORBIDDEN_MUTATION_KEYS` + `assertNoForbiddenMutationKeys` di tiap route tulis (`tasks.ts:270,346,494,543,642`); satu-satunya `allow:["user_id"]` hanya di admin (`admin.ts:37,117`) di balik `role.assign/revoke`. |
| Confirm redirect allowlist | `resolveConfirmNextPath` hanya `/reset-password,/summary` (`validation/src/redirect.ts:24-55`); dipakai API (`auth.ts:862`) + web defense-in-depth (`auth/confirm/route.ts:27-30,61-64`). |
| Header keamanan API + anti-cache auth | `http-policy.ts:8-25` nosniff/Referrer/DENY/HSTS-prod/`private,no-store`; semua fetch server `cache:"no-store"` (`proxy.ts:132`, `lib/api/server.ts:130`). |
| Error tidak bocor | `error-handler.ts:25` tanpa stack/SQL; `23503` → pesan generik; secret cron tidak di-log; audit menolak secret (`schema.ts:51` komentar). |
| Upload aman | allowlist MIME + cek magic bytes + cap 10 MiB (`body-limit.ts:7-19,133-154`); sanitasi nama file anti-traversal (`validation/src/attachment.ts:82-110`); signed URL 10 mnt (`attachments.ts:370-374`). |
| Secret tidak ke klien | web tanpa Supabase client (grep nihil); hanya `NEXT_PUBLIC_SUPABASE_URL` fallback (`proxy.ts:19`); `stripAuthTokens` sebelum JSON ke browser (`cookies.ts:71-79`); cookie httpOnly+SameSite=Lax+Secure-prod (`cookies.ts:17-25`, `auth-tokens.ts:180-182`). |
| RLS fail-closed lapis kedua | 11 tabel `ENABLE RLS`; SELECT/INSERT/UPDATE semua `USING/WITH CHECK auth.uid()`; tanpa DELETE fisik (soft-delete); 0 policy = tolak (audit/rbac/idempotency); `SECURITY DEFINER` pin `search_path` + guard email-sync. |
| CSRF praktis tertutup | tidak ada mutasi via GET (satu-satunya GET pemilik-efek, `confirm`, butuh code/OTP rahasia); API cookie dilindungi `SameSite=Lax`; Server Actions ikut proteksi bawaan. |
| Rate-limit & anti-abuse login | tier per-path (`rate-limit.ts:36-44`: auth 20, cron 10, default 180); backoff login IP+akun (`auth-abuse.ts:24-115`); `Retry-After`; proxy-trust fail-safe (`proxy-trust.ts:41,145`). |

---

## 7. ⚠️ Harus diperbaiki — backlog terurut

**Blocker sebelum rilis:**
1. SEC-001 open redirect `return_to` (effort S) — tergantung: tidak ada; perbaiki dulu karena user-controlled.
2. SEC-003 kuota + cap email per-user (effort M) — tergantung: metrik cron; tanpa ini tagihan tidak bounded.

**Sebelum publik:**
3. SEC-002 CSP/HSTS/frame-ancestors web (effort S-M) — tergantung: uji Next runtime.
4. SEC-004 sanitasi subject email (effort S).
5. SEC-005 validator redirectTo frontend (effort S) — gabungkan dengan SEC-001 dalam satu helper.

**Hardening terjadwal:**
6. SEC-007 Redis wajib di prod multi-replika (effort S, config).
7. SEC-006 allowlist skema href frontend (effort S).
8. SEC-008 rampingkan respons cron (effort S).
9. Jawab semua NEEDS-VERIFY §8 sebelum klaim "prod aman".

---

## 8. ❓ Perlu verifikasi manusia

1. Apakah migrasi `supabase/migrations/*` sudah diterapkan di database prod (RLS/policies/trigger aktif di sana, bukan hanya di file)?
2. Apakah endpoint PostgREST/Supabase langsung terekspos ke internet, atau hanya API Elysia? Sebutkan URL publik Supabase project.
3. Apakah Redirect URL allowlist di Supabase Auth hanya berisi domain produksi? Sebutkan isinya.
4. Apakah "Confirm email" wajib sebelum login dan bagaimana kebijakan password, masa berlaku OTP/magic-link, dan rate-limit OTP di dashboard Supabase?
5. Apakah bucket `attachments` di prod benar `public=false` dan policy storage-nya sama dengan `20260901030000_attachments.sql:77-111`?
6. Apakah `REDIS_URL`, `TRUST_PROXY`/`TRUSTED_PROXIES`, dan `RESEND_API_KEY`/`CRON_SECRET`/`AUTH_BRIDGE_SECRET` sudah terisi di env prod (panjang/acak, tidak sama dengan contoh)?
7. Berapa `AUTH_AUDIT_RETENTION_DAYS` yang diputuskan produk/hukum (saat ini unset = append-only, `auth.ts`/`cron.ts`)?
8. Apakah ada webhook email provider (bounce/complaint) dan apakah signature-nya diverifikasi? (Tidak ada di repo.)
9. Apakah Sentry/observability aktif dan apakah `sendDefaultPii` mati + ada `beforeSend` scrub email/token? Retensi log dan siapa yang bisa membaca?
10. Apakah API berjalan multi-replika (menentukan wajib-tidaknya Redis, §SEC-007)?
11. Apakah ada backup/SQL dump, `.env*`, atau source-map yang terekspos di hosting prod?

---

## 9. Cakupan audit

Dibaca: `apps/api/src/{app,env,index}.ts`, `plugins/*`, `lib/{supabase,db,auth-bridge,auth-tokens,auth-abuse,email,storage,redis,proxy-trust,auth-audit*}`,
`lib/authorization/*`, `routes/*` (auth, tasks, courses, attachments, notifications,
summary, admin, cron), `services/run-evaluate.ts`, `apps/web/{proxy,next.config}.ts`,
`app/{actions,api,auth}/*`, `lib/{api,auth}/*`, halaman `(app)/(auth)`, komponen yang
merender input user, `packages/{db,validation,domain}/*`, `supabase/migrations/*`,
`.env.example`, `supabase/config.toml`.
Tidak dibaca: `node_modules`, `dist`, `graphify-out`, histori git (secret lama tidak
diperiksa), konfigurasi dashboard Supabase/Resend/Vercel, infra DNS/TLS prod.
Blind spot: perilaku runtime (JWKS availability, raced quota, biaya aktual Resend),
dan semua item §8. Metode: baca kode sampai sink, bukan dari nama; tiap klaim OPEN
punya `path:baris` + kutipan; kandidat yang tertutup lapisan lain diklasifikasi PASS.

---

## 10. Out of scope observations

- Tidak ada dependensi dengan CVE yang diverifikasi dalam audit ini (butuh `bun audit`/Dependabot).
- E2E fixtures memakai service-role test-only (`apps/e2e/fixtures.ts:32`) — pastikan tidak terbawa ke prod.
- `GET /openapi` dan `/health` publik by-design; pastikan tidak memuat skema internal sensitif.
