# Laporan Verifikasi — Audit Caching & Data Fetching (Deadline Radar)

- **Tanggal:** 2026-09-20
- **Peran:** verification auditor / gatekeeper (adversarial). Tidak ada kode diperbaiki dalam fase ini.
- **Cakupan:** 5 temuan audit `docs/audit/caching-data-fetching-audit.md` (CR-1, HI-1, ME-1, LO-1, LO-2) + regression sweep + sapu bersih ulang.
- **Koreksi:** tidak ada ME-2/ME-3 di audit — klaim sebelumnya tentangnya ditarik.

---

## 0. Keputusan Sign-off

⛔ **REJECTED** — bukan karena ada Critical/High terbuka atau regresi (tidak ada), melainkan karena **uji blocking isolasi antar-user belum benar-benar dijalankan** (tidak ada browser, tidak ada environment dua-user, tidak ada deploy produksi yang bisa diuji). Gate non-negosiabel audit ini menolak sign-off dalam kondisi tersebut.

- CLOSED: 4 (CR-1, HI-1, ME-1, LO-1) · WON'T FIX (accepted): 1 (LO-2) · PARTIAL / NOT FIXED / REGRESSED: 0 · UNVERIFIED: 3 (isolasi 2-user, Back-nav §5.1, header Cache-Control produksi).
- Confidence **High** untuk semua verdict statis (seluruh jalur tersentuh dibaca, 492 test hijau, tabel build sesuai ekspektasi); **tidak ada confidence** untuk isolasi runtime — itulah penolakan ini.

---

## Langkah Pertama — diff vs temuan (ringkasan)

- Base bersih tidak tersedia: working tree vs HEAD = 88 file, +12345/−1024, mencakup feature work besar (account security, UI, summary revamp, migrasi, dsb.) di luar remediiasi. Audit ditulis terhadap state committed lama; verifikasi dilakukan terhadap **kondisi kode saat ini**, bukan range diff bersih. Keterbatasan ini dicatat; confidence statis tidak diturunkan karena setiap jalur temuan dibaca langsung.
- Disentuh diff: CR-1 (8 file konsumsi tick + `lib/use-now.ts` baru + `summary-refresh.tsx` baru), HI-1 (`actions/courses.ts`, `actions/auth.ts`), ME-1 (`actions/tasks.ts`), LO-1 (`lib/api/session.ts`). LO-2 tanpa perubahan kode (disengaja).
- Tidak terkait temuan mana pun (sumber risiko regresi, semua di-sweep §3): `proxy.ts`, `lib/api/server.ts`, auth route handlers, `actions/attachments.ts`, `actions/notifications.ts`, `lib/api/idempotency.ts` (baru), `lib/tasks/global-tasks.ts`, `lib/auth/cookies.ts`, API routes (ownership/thresholds/notifications/cron/admin), migrasi Supabase.

---

## 1. Matriks Rekonsiliasi

| ID | Severity asal | Klaim developer | Status verifikasi | Bukti | Catatan |
| --- | --- | --- | --- | --- | --- |
| CR-1 | 🔴 Critical | Time-tick client di semua halaman status | **CLOSED** | `lib/use-now.ts:1-50` (hook `useNow(60s, initialIso)`, seed anti-hydration-mismatch + catch-up on visible); konsumsi di 8 file: `tasks-collection.tsx:213`, `task-detail.tsx:226`, `course-detail.tsx:963`, `calendar-month-view.tsx:212` (semua `useNow(60_000, nowIso)`), `tasks/page.tsx:80`, `tasks/[id]/page.tsx:161`, `courses/[id]/page.tsx:102`, `calendar/page.tsx:32-33,75` (semua oper `nowIso` server); `/summary` via `summary-refresh.tsx:1-37` (`router.refresh()` 60s + on-visible) sesuai saran audit §5 | Rantai server→client lengkap di semua halaman status; tidak ada halaman time-sensitive yang terlewat (`learn` statis, terverifikasi bukan time-sensitive) |
| HI-1 | 🟠 High | Invalidasi mutasi course + preferensi waktu | **CLOSED** | `actions/courses.ts:14-21` helper `revalidateCourseContent` (`/courses`, `/courses/${id}`, `/tasks`, `/calendar`, `/summary`) dipakai `createCourse:71`, `updateCourse:90`, `softDeleteCourse:106`; `actions/auth.ts:3` import `revalidatePath`, `updateTimezone:211` + `updateTimeFormat:228` → `revalidatePath("/", "layout")` | Purge global hanya untuk 2 preferensi site-wide — tepat, bukan tumpul (lihat §4) |
| ME-1 | 🟡 Medium | Path literal course di `revalidateTask` | **CLOSED** | `actions/tasks.ts:27-37` helper `(taskId?, courseId?)` → literal ``/courses/${courseId}`` bila dikenal, fallback `/courses/[id]` bila tidak; `createTask:61-64` + `updateTask:85-88` thread `course_id` form (inline defensif); 6 action taskId-only (103,117,137,158,177,222) fallback — sesuai rekomendasi audit "jika tersedia" | Sisa 6 fallback dinamis adalah residual yang diterima, bukan gap (didokumentasikan di remediation-me1) |
| LO-1 | ⚪ Low | `getSession()` dibungkus `React.cache()` | **CLOSED** | `lib/api/session.ts:1` import `cache`, `:17` `export const getSession = cache(async …)`; body tak berubah; 10 call site tak berubah | Cache request-scoped: tanpa-argumen = 1 entri per request; `clearLocalAuthCookies` hanya jalur unauth + idempoten; `redirect()` melempar, tak ter-cache; basis dynamic (`headers()` di `apiFetch`) lestari |
| LO-2 | ⚪ Low | Batas polling 60s didokumentasikan | **WON'T FIX (accepted)** | `notifications-provider.tsx:21` `POLL_INTERVAL_MS = 60_000`, skip-saat-hidden (94-99), catch-up via `shouldCatchUpOnVisible` (22-30 `unread-state.ts`, dipakai 104-112); `countUnreadInAppNotifications` (`actions/notifications.ts:76`) no-store; delta optimistik `noteOneRead/noteAllRead` pasca-mutasi sukses | Risiko (badge telat ≤60s) diterima eksplisit oleh audit §7 step 5; penerima: audit itu sendiri |

---

## 2. Temuan yang Masih Terbuka

Tidak ada temuan Critical/High/Medium/Low yang terbuka dari sisi kode. Yang terbuka hanyalah verifikasi manual (lihat §5).

---

## 3. Regresi Akibat Perbaikan

**Nol regresi ditemukan.** Daftar "Sudah Benar" (§2 audit) diverifikasi ulang satu per satu terhadap kode saat ini:

- `cache: "no-store"` utuh: `lib/api/server.ts:130`, `proxy.ts:132`, `app/api/auth/refresh/route.ts:26`, `app/auth/confirm/route.ts:40`.
- Basis dynamic utuh: `requireSession()` di layout + 10 page (LO-1 tidak mengubah jalur `headers()`).
- Tanpa shared cache data per-user: tidak ada `force-dynamic/static`, `revalidate =`, `generateStaticParams`, `unstable_cache`, `"use cache"`, `cacheTag`, `revalidateTag`, `force-cache` di `apps/web` (grep kosong).
- `http-policy.ts:18,24-25` (`private, no-store` untuk `/api/*`) utuh; `authorization/cache.ts` tak berubah (key `userId`, TTL 30s, guard key kosong, invalidasi di `role-admin.ts:88,148`).
- Urutan revalidate→redirect benar di lini baru: `tasks.ts:62→67,69`, `:118`, `courses.ts:106→107`.
- Proxy JWT gating + API re-verifikasi utuh (diff `proxy.ts` hanya cookie-clearing + audience; `server.ts` hanya cookie-forwarding).
- Notifikasi: `markRead:97`/`markAllRead:112` revalidate `/settings/notifications`; badge lintas-halaman via delta server-confirmed + poll. `changeEmail` tanpa revalidate adalah benar (email tak berubah sampai dikonfirmasi — tidak ada data basi yang ditampilkan).
- Satu-satunya cacat yang lahir dari era remediiasi (`ReferenceError: courseIdFromForm`, 3 test gagal) sudah diperbaiki sebelum audit ini; 161/161 hijau.

---

## 4. Perbaikan Palsu / Tumpul

Diperiksa 9 pola; **tidak ada fix theater**. Catatan yang dicatat (bukan blocker):

- `revalidatePath("/", "layout")` hanya di 2 tempat (`auth.ts:211,228`, preferensi site-wide) — presisi sudah maksimal untuk kasus ini; bukan utang teknis.
- `router.refresh()`: `auth-forms.tsx:255,370` setelah `router.replace` (idiom benar); `summary-refresh.tsx:22` interval + on-visible sesuai saran audit §5. Satu nit polish: refresh on-visible tanpa cek staleness (provider notifikasi punya ceknya) — redundan ringan, bukan kebenaran.
- Tidak ada `@ts-ignore`/`eslint-disable` di area yang diubah (grep kosong).
- Kesegaran bukan kebetulan: basis dynamic eksplisit via `requireSession()`, bukan efek samping komponen lain.
- Beban idle per tab: poll unread 60s + refresh summary 60s (skip-saat-hidden; tick CR-1 murni client). Karakteristik beban yang diterima, bukan rate-limit risk pada skala produk ini.

---

## 5. Hasil Verifikasi Runtime

**Dijalankan:** `web:test` 161/161 ✓ · `api,domain,validation,db` 331/331 ✓ · `web:lint` ✓ · `tsc --noEmit` ✓ · `web:build` ✓ (t necessaryble rute: semua halaman ber-data `ƒ Dynamic`; statis hanya `/`, `/_not-found`, `/login`, `/register`, `/forgot-password` — tanpa data user). Baseline build "sebelum" tidak tersedia (keterbatasan).

**TIDAK dijalankan** (tidak ada browser / env dua-user / deploy produksi + DB seed):
1. Isolasi A/B bergantian + hard refresh — ⛔ blocking, belum dijalankan.
2. Logout A → login B di browser sama — ⛔ blocking, belum dijalankan.
3. Header `Cache-Control` HTML `(app)` di produksi — belum dijalankan (tidak ada `.env`, tidak ada API berjalan; `next start` tanpa stack memberi respons error, bukan perilaku produksi).
4. Mutation → tampil tanpa hard refresh; via link internal; via Back; lintas tab — belum dijalankan di browser (rantai kode terverifikasi statis §1).
5. Overdue / lintas tengah malam / lintas timezone — belum dijalankan (rantai tick terverifikasi statis; simulasi jam belum dilakukan).
6. Supabase mati sementara; cold-start pasca-deploy — belum dijalankan.
7. §5.1 Back-nav `?_rsc=` (menentukan apakah severity HI-1 bisa turun ke Low) — belum dijalankan; perbaikan HI-1 berdiri apa pun hasilnya.
8. §5.2 timezone → layout re-render tanpa hard reload — belum dijalankan (ditutup secara kode oleh purge layout `auth.ts:211`, tapi konfirmasi visual belum ada).

Langkah uji persis untuk tiap skenario di atas ada di brief auditor Tahap 4; tidak disalin ulang ke sini selain penanda di atas.

---

## 6. Sisa Risiko yang Diterima

- LO-2: badge telat ≤60s (kondisi: selalu; mitigasi: optimistic delta + catch-up; penerima: audit §7.5).
- ME-1 residual: 6 action taskId-only tetap purge `/courses/[id]` dinamis (kondisi: complete/softDelete/thresholds; mitigasi: dinamis + no-store = purge murah tanpa data basi; penerima: remediation-me1 + keputusan user).
- Diff 88-file tak-terkomit: risiko regresi di luar area audit hanya ditutup untuk jalur caching/fetching; area lain (migrasi, email, dsb.) di luar cakupan audit ini.
- File scratch `apps/web/.render-temp.tsx` (eksperimen `useState`, 396 byte, tak terpakai) — higiene, hapus saat senggang.

---

## 7. Guardrail agar Tidak Terulang

- Test isolasi dua-user (blocking rilis): skenario §5 di atas dijadikan `apps/e2e/` (direktori sudah ada, masih kosong) sebelum rilis.
- Test kesegaran pasca-mutation per Server Action: pola `idempotency.test.ts`/`thresholds.test.ts` sudah ada — perluas ke courses/auth revalidate (mock `next/cache` + asersi path literal vs fallback).
- Konvensi: setiap `revalidatePath("/x/[id]")` dinamis wajib berkomentar kenapa bukan literal (seperti komentar di `attachments.ts:18-19` — jadikan standar).
- Checklist PR: (a) mutasi baru → revalidate cocok? (b) fetch baru → `no-store`? (c) header baru di `apiFetch` → deterministik per render? (LO-1 gratuity).
- ADR: batas polling 60s (LO-2) + keputusan purge global timezone (HI-1) sudah terdokumentasi di remediation docs — tautkan dari `docs/adr/` bila ada.

---

## 8. Sisa Pekerjaan (prioritas)

**Blocking rilis:**
1. Jalankan uji isolasi §5 item 1–3 (dua user, logout/login silang, header produksi). Tanpa ini sign-off tetap REJECTED.

**Menyusul (tidak blocking):**
2. §5.1 Back-nav `?_rsc=` — menentukan apakah HI-1 bisa turun severity ke Low.
3. §5.2 konfirmasi visual timezone → layout.
4. Hapus `apps/web/.render-temp.tsx`; pertimbangkan staleness-check di `summary-refresh` on-visible.
5. Commit working tree 88-file (di luar kewenangan audit ini — belum ada commit yang dibuat).
