# Laporan Audit — Caching & Data Fetching (Next.js + Supabase)

- **Objek audit:** Deadline Radar, stack Next.js App Router (web) → API Elysia internal → Supabase
- **Tanggal:** 2026-09-19
- **Peran:** auditor (tidak mengubah file)
- **Versi terdeteksi:** `next` 16.3.4, `react` 19.2.8; tanpa `@supabase/ssr`, `@tanstack/react-query`, `swr` di `apps/web`
- **Verdict: AMAN DENGAN CATATAN** — tidak ada kebocoran data antar-user; ada 1 temuan 🔴 (status deadline membeku saat tab idle) dan 1 🟠 (invalidasi mutasi tidak lengkap) yang harus dibereskan sebelum rilis.

---

## 0. Ringkasan Eksekutif

- **Stack:** Next 16.3.4 + React 19.2.8, penyimpanan lewat API Elysia internal (Supabase di baliknya). Tanpa `@supabase/ssr`, react-query, atau swr.
- **Jumlah temuan:** 🔴 1 · 🟠 1 · 🟡 1 · ⚪ 2
- **3 risiko terbesar:**
  1. Status deadline ("overdue / due today / sisa hari / grouping") dihitung hanya saat render; tab yang dibiarkan terbuka tidak pernah meng-update status meskipun waktu sudah lewat.
  2. Invalidasi mutasi tidak lengkap: perubahan course dan preferensi timezone/time-format tidak membatalkan halaman penyaji, sehingga Back-nav bisa memulihkan segmen basi dari client cache.
  3. Mesin cache Next praktis non-aktif (semua `no-store` + dynamic) — bagus untuk kebenaran, tetapi berarti **tidak ada item yang boleh di-cache tanpa membuktikan keamanannya dulu**, karena satu-satunya pola yang terbukti aman adalah pola yang ada sekarang.

- **Verdict: AMAN DENGAN CATATAN.** Tidak ada kebocoran data antar-user; arsitektur no-store + dynamic sudah benar secara fundamental. Yang harus dibereskan sebelum rilis: waktu-idle staleness (🔴 CR-1) dan sebagian invalidasi mutasi (🟠 HI-1 / 🟡 ME-1).

---

## 1. Inventarisasi

### Stack

`apps/web/package.json:22-24` — `next ^16.3.4`, `react ^19.2.8`, `jose`, dll. Tidak ada `@supabase/ssr`, `@tanstack/react-query`, atau `swr`. Supabase hidup di balik API server terpisah (`apps/api`, Elysia/drizzle).

Arsitektur data: halaman RSC memanggil API internal via `apiFetch` → `fetch(API_ORIGIN, { cache: "no-store" })` (`lib/api/server.ts:127-131`); browser memanggil path yang sama via rewrite `/api/*` → API (`next.config.ts:20-25`) memakai `apiBrowser` (`lib/api/client.ts`).

Perilaku Next 16.3 yang relevan (diverifikasi dari `node_modules/next/dist/docs`):
- `fetch` **default tidak di-cache**;
- `staleTimes.dynamic` default **0** (client cache tidak memakai ulang segmen dinamis untuk navigasi maju);
- request-memoization `fetch` GET tetap aktif per render pass (`fetch.md:86-97`);
- Back/forward tidak terikat staleTime (`staleTimes.md:36`).

### Tabel Route

| Route / Komponen | Tipe | Sumber data | Strategi cache saat ini | Rendering |
|---|---|---|---|---|
| `/` | RSC statis | — | Default static | static |
| `/(auth)/login\|register\|forgot\|reset` | RSC + client form | — | Default static | static |
| `/(app)/layout.tsx` | RSC | `/api/v1/auth/session` via `requireSession` | `no-store` + `cookies()/headers()` | dynamic |
| `/(app)/summary` | RSC | `/api/v1/summary` (`lib/summary/load.ts:51-54`) | `no-store` | dynamic |
| `/(app)/tasks` | RSC | `/api/v1/courses`, `/api/v1/tasks` (`tasks/page.tsx:30-33`) | `no-store` | dynamic |
| `/(app)/tasks/[id]` | RSC | `/api/v1/tasks/:id`, `/api/v1/courses` | `no-store` | dynamic (tanpa `generateStaticParams`) |
| `/(app)/calendar` | RSC | `/api/v1/tasks`; `todayKey = new Date()` per request (`calendar/page.tsx:32`) | `no-store` | dynamic |
| `/(app)/courses` | RSC | `/api/v1/courses` | `no-store` | dynamic |
| `/(app)/courses/[id]` | RSC | `/api/v1/courses/:id`, `/api/v1/tasks?courseId=` (+ `generateMetadata` re-fetch) | `no-store` | dynamic |
| `/(app)/learn`, `/(app)/settings` | RSC | session saja | `no-store` | dynamic |
| `/(app)/settings/notifications` | RSC | server action `listInAppNotifications` | `no-store` | dynamic |
| `app/api/auth/{login,register,refresh}` | Route Handler POST | API upstream | `no-store` (6 lokasi) | dynamic |
| `app/auth/confirm/route.ts` | Route Handler GET | API upstream | `no-store`, `redirect: manual` | dynamic |
| `proxy.ts` | Edge proxy | JWT verify + refresh optional | `no-store`; cache JWKS (kunci publik) | per-request |
| `apiBrowser` (`lib/api/client.ts`) | Client fetch | `/api/*` rewrite | tanpa opsi cache; API balas `no-store` | n/a |

Mutation surface — semuanya Server Action (`"use server"`) + `revalidatePath`/`redirect`; tidak ada mutation via route handler data, tidak ada React Query/SWR, tidak ada optimistic update.

---

## 2. Yang Sudah Benar (✅)

- **Semua fetches ke API memakai `cache: "no-store"`** — `lib/api/server.ts:130`, `proxy.ts:132`, route handlers auth (`login:47`, `register:44`, `refresh:26`, `confirm:40`). Data Cache Next tidak pernah aktif untuk data user; dengan Next 16 yang default-nya sudah uncached, ini dobel aman.
- **Seluruh halaman ber-data bersifat dynamic** karena `(app)/layout.tsx:9` + tiap page memanggil `requireSession()` → `headers()/cookies()` (`api/server.ts:109-110`). Tidak ada halaman time-sensitive yang ter-freeze saat build. Tidak ada `revalidate = N`, `force-static`, ISR, atau `generateStaticParams`.
- **Tidak ada shared cache untuk data per-user**: tidak ada `unstable_cache`, `"use cache"`, `cacheTag`, `force-cache`, CDN/cache-handler, atau react-query. Kandidat bocor antar-user tidak ada. Cache in-memory di sisi API hanya berisi key per-user: authz snapshot (`authorization/cache.ts:11-53`, key = `userId`, TTL 30s) dan rate-limit bucket.
- **Tidak ada singleton/clinet Supabase di web** — tidak ada client Supabase sama sekali di `apps/web`.
- **API memblokir caching di lapisan browser/CDN**: `plugins/http-policy.ts:23-27` → `Cache-Control: private, no-store, max-age=0, must-revalidate` untuk semua `/api/*`.
- **Urutan `revalidatePath` → `redirect` selalu benar** (F.24): `tasks.ts:57-61`, `tasks.ts:105-106`, `courses.ts:91-92`.
- **Notifikasi dibereskan dengan cara yang benar**: poll unread 60s + catch-up on visibility (`notifications-provider.tsx:88-121`), badge disinkronkan ke ground-truth setelah mutasi lewat `noteOneRead`/`noteAllRead`/`syncFromList` (`notification-list.tsx:20-59,77-79`) — bukan optimistik, melainkan setelah mutasi server sukses.
- **Auth ganda**: `proxy.ts` mem-verifikasi signature JWT untuk gating (`verifyToken`, `proxy.ts:65-92`) dan API mem-verifikasi ulang + menegakkan otorisasi per-resource (`summary.ts:31`). Keputusan otorisasi tidak pernah didasarkan pada cache.
- **Route handler auth tidak masuk React tree**, tidak termemoize, semuanya `no-store`.

---

## 3. Daftar Temuan

### Tabel Ringkasan

| ID | Severity | Judul | Lokasi utama |
| --- | --- | --- | --- |
| CR-1 | 🔴 Critical | Status deadline tidak pernah refresh saat waktu berlalu selama tab terbuka | `tasks-collection.tsx:176-180`, `course-tasks.ts:42-47`, `deadline-relative.ts:24-39`, `calendar/page.tsx:32`, `/summary` |
| HI-1 | 🟠 High | Invalidasi mutasi tidak lengkap untuk course & preferensi waktu | `actions/courses.ts:55,74-76,91`, `actions/auth.ts:197-227` |
| ME-1 | 🟡 Medium | `revalidateTask()` membatalkan SEMUA halaman detail course untuk setiap mutasi task | `actions/tasks.ts:31` |
| LO-1 | ⚪ Low | Duplikasi `requireSession()` layout + page mengandalkan fetch-memoization, bukan `React.cache()` | `lib/api/session.ts:15-30`, `(app)/layout.tsx:9` |
| LO-2 | ⚪ Low | Badge unread hanya bisa telat sampai 60 detik (batas desain) | `notifications-provider.tsx:21,93-101` |

---

### CR-1 — 🔴 Critical — Status deadline tidak pernah refresh saat waktu berlalu selama tab terbuka

- **Lokasi:**
  - `components/tasks/tasks-collection.tsx:176-180` — `resolveTone()` pakai `Date.now()` saat render (tone late/upcoming);
  - `components/courses/course-detail.tsx:42-76` (via `lib/courses/course-tasks.ts:42-47`) — grouping overdue/upcoming pakai `now = new Date()` default;
  - `lib/deadline-relative.ts:24-39` — `formatRelativeDeadline()` default `now = new Date()`, dipakai `task-detail.tsx:385,414`, `course-detail.tsx:175-188`;
  - `app/(app)/calendar/page.tsx:32` — `todayKey = getZonedDayKey(new Date(), timeZone)` di-snapshot server per-request;
  - `components/summary/summary-cards` / `/summary` — count "Today/Missed/This week" di-fetch sekali per page load (`lib/summary/load.ts:51-54`).
- **Kondisi saat ini:** semua perhitungan sensitif-waktu terjadi di titik render (render client maupun render pass server; halaman dynamic → per request segar, tapi hanya saat ada request). Tidak ada interval atau refetch. Satu-satunya tempat yang sudah mencontohkan tick adalah `threshold-manager.tsx:206` (`setNow(Date.now())` saat membuka dialog).
- **Kenapa bermasalah:** tenggat lewat adalah perubahan status **tanpa mutasi** — event/tag tidak akan pernah men-trigger-nya; satu-satunya jawaban benar adalah *time-based refresh* atau *client-side recompute*. Tanpa itu, aplikasi menampilkan status deadline yang salah secara visual (tone, "in 1 day", grouping, highlight "Today") selama tab idle.
- **Skenario reproduksi:**
  1. Buka `/tasks` dengan task due 23:59 → buka tab besok pagi tanpa menyentuh apa pun → dot tone tetap "upcoming" (bukan merah/late) dan label relatif tetap "Due today".
  2. Buka `/summary` lewat tengah malam → angka "Today / This week / Missed" tidak bergeser sampai navigasi/reload.
  3. Buka `/calendar` → highlight "today" tetap di kemarin pagi.
- **Perbaikan yang disarankan:** tambahkan hook tick di client sekali per page yang menampilkan relatif — pola sudah ada di `threshold-manager`:

  ```ts
  // lib/use-now.ts
  export function useNow(intervalMs = 60_000): Date {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
      const id = window.setInterval(() => setNow(new Date()), intervalMs);
      return () => window.clearInterval(id);
    }, [intervalMs]);
    return now;
  }
  ```

  Lalu `formatRelativeDeadline(iso, tz, now)` di `task-detail` & `course-detail`, `filterTasksByStatusView(tasks, view, now)` / `groupCourseTasks(tasks, now)` di collection/course detail, dan `todayKey` kalender dihitung ulang dari `now` client. Untuk `/summary` cukup tick `router.refresh()` 60-an detik atau hitung ulang count di client.
- **Trade-off:** interval + re-render per menit per tab terbuka (beban praktis nol). Kehilangan "piksel statis saat idle" — sepadan untuk aplikasi yang janji utamanya akurasi deadline.
- **Confidence:** High.

---

### HI-1 — 🟠 High — Invalidasi mutasi tidak lengkap untuk course & preferensi waktu

- **Lokasi:** `app/actions/courses.ts:55,74-76,91`; `app/actions/auth.ts:197-227`.
- **Kondisi saat ini:** `createCourse`/`updateCourse`/`softDeleteCourse` hanya me-revalidate `/courses` + `/courses/[id]`; `updateTimezone`/`updateTimeFormat` tidak me-revalidate apa pun. Padahal nama/warna/ikon course muncul di `/tasks`, `/calendar`, `/summary`, dan timezone/timeFormat dipakai semua halaman untuk format.
- **Kenapa bermasalah:** navigasi maju selalu segar (dynamic + `staleTimes.dynamic = 0` di Next 16.3), tapi segmen yang sudah dibuka bisa dipulihkan dari Client Cache saat Back/forward (per `staleTimes.md:36` Back-nav tidak terikat staleTime). Jadi: ubah warna course, tekan Back ke `/tasks` → konten basi bisa terlihat tanpa request baru.
- **Skenario reproduksi:** buka `/tasks` → `/courses/:id` → ganti warna/ikon course → Back → periksa Network apakah ada request `?_rsc=` untuk `/tasks`; jika tidak, warna lama tampil.
- **Perbaikan yang disarankan:**

  ```ts
  // actions/courses.ts
  function revalidateCourse(courseId: string) {
    revalidatePath("/courses");
    revalidatePath(`/courses/${courseId}`);
    revalidatePath("/tasks");
    revalidatePath("/calendar");
    revalidatePath("/summary");
  }

  // actions/auth.ts — setelah updateTimezone/updateTimeFormat sukses:
  revalidatePath("/", "layout"); // atau minimal revalidatePath("/summary")
  ```

- **Trade-off:** biaya hampir nol — halaman dynamic tidak menyimpan HTML/data di server, jadi ini hanya membatalkan segmen di router cache client.
- **Confidence:** Medium (perilaku Back-nav Next 16.3 menunggu verifikasi manual, lihat §5.1).

---

### ME-1 — 🟡 Medium — `revalidateTask()` membatalkan SEMUA halaman detail course untuk setiap mutasi task

- **Lokasi:** `app/actions/tasks.ts:31` (di dalam `revalidateTask`, dipanggil oleh 6+ action: `57,77,91,105,125,146,165,210`).
- **Kondisi saat ini:** `revalidatePath("/courses/[id]", "page")` memakai pola dinamis → membatalkan seluruh instance route detail course, padahal task hanya terkait satu course.
- **Kenapa bermasalah:** bukan bug kebenaran dan bukan vektor kebocoran (halaman dynamic tidak menyimpan data; revalidatePath hanya membersihkan segmen di router cache masing-masing browser). Ini sekadar memperluas scope invalidation tanpa manfaat.
- **Skenario reproduksi:** tidak ada kerusakan user-visible; hanya observasi dari pembacaan kode.
- **Perbaikan:** jika `task.courseId` tersedia di action, panggil `revalidatePath(`/courses/${task.courseId}`)` untuk path literal.
- **Trade-off:** —.
- **Confidence:** High.

---

### LO-1 — ⚪ Low — Duplikasi `requireSession()` layout + page mengandalkan fetch-memoization, bukan `React.cache()`

- **Lokasi:** `lib/api/session.ts:15-30`; dipanggil dari `(app)/layout.tsx:9` dan tiap page (mis. `tasks/page.tsx:28`).
- **Kondisi saat ini:** `GET /api/v1/auth/session` dijalankan dari layout dan page dalam satu render pass; Next 16.3 mememoize `fetch` GET identik per render (`fetch.md:86-97`), jadi upstream menerima 1 request.
- **Kenapa bermasalah:** bukan bug; catatan stabilitas — memoization hanya berlaku kalau URL+options identik. `apiFetch` menambahkan `cookie` + `x-forwarded-*` dari `headers()` (`api/server.ts:109-124`); nilai-nilai ini stabil dalam satu render pass sehingga dedup bekerja. Jika nanti `apiFetch` menyisipkan header non-deterministik (nonce/timestamp), dedup putus dan session di-fetch ganda.
- **Perbaikan:** opsional — bungkus `getSession` dengan `React.cache()`.
- **Confidence:** High.

---

### LO-2 — ⚪ Low — Badge unread hanya bisa telat sampai 60 detik

- **Lokasi:** `components/notifications/notifications-provider.tsx:21,93-101`.
- **Kondisi saat ini:** poll 60s + catch-up saat tab jadi visible; nilai badge bisa tertinggal hingga 60 detik dari kenyataan di DB.
- **Kenapa bermasalah:** bukan bug klasik "data basi" karena API tidak pernah di-cache — ini batas polling. Untuk produk reminder masih dapat diterima; dokumentasikan sebagai batas desain.
- **Perbaikan:** tidak wajib; bila mau lebih ketat, turunkan interval atau tambahkan event-driven update.
- **Confidence:** High.

---

## 4. Cache yang Sebaiknya Dihapus (💡)

Tidak ada. Di `apps/web` tidak ada lapisan cache data yang perlu dihapus; yang ada — `no-store` + halaman dynamic — sudah optimal untuk kebenaran. Cache in-memory lintas request yang ada:

- **API authz snapshot** (`apps/api/src/lib/authorization/cache.ts`): key per-`userId`, TTL 30s, memotong query per render. **AMAN & bermanfaat — pertahankan.**
- **JWKS** di `proxy.ts:32-41` (kunci publik Supabase): standar, aman.
- **Rate-limit/abuse buckets** (proses-lokal): security, bukan data user.

**Saran arah:** jangan menambah `unstable_cache`/Cache Components pada data per-user tanpa memasukkan `user.id` ke key dan tanpa bukti masalah performa.

---

## 5. Butuh Verifikasi Manual (❓)

1. **Perilaku Back-nav di Next 16.3** (menentukan severity HI-1). Cara cek: DevTools → Network → buka `/tasks` → `/courses/:id` → ubah warna course → Back. Amati: jika muncul request `?_rsc=` untuk `/tasks`, maka tidak basi dan HI-1 turun ke Low; jika tidak, HI-1 tetap High. Ulangi untuk ganti timezone di Settings.
2. **Apakah auto-refresh server action me-render ulang `(app)/layout`** sehingga session timezone baru langsung terpakai? Cek: ganti timezone → Back ke `/summary` → apakah stempel waktu ikut berubah tanpa hard reload.
3. **Kelengkapan otorisasi di API** (fondasi asumsi "tidak bocor"): `rg "requireAuthz" apps/api/src/routes/*.ts` dan pastikan setiap endpoint data memanggilnya; konfirmasi ownership check untuk `/api/v1/tasks?courseId=`.
4. **Dev-only staleness:** fitur `serverComponentsHmrCache` men-cache respon `no-store` antar HMR (`fetch.md:101-107`) → kalau ada keluhan "data basi saat develop", itu normal; hard-navigate membersihkan. Tidak muncul di produksi.
5. **Header respons halaman** di produksi (Vercel/self-host): pastikan HTML halaman `(app)` keluar dengan `Cache-Control: no-store` (default Next untuk dynamic) dan tidak ada CDN publik di depan `(app)`.

---

## 6. Strategi Caching

| Jenis data | Boleh di-cache? | Strategi yang benar | Invalidasi oleh |
| --- | --- | --- | --- |
| Tasks, courses, progres | Tidak (boleh per-user dengan key `user.id` hanya jika terbukti perlu) | `no-store` per request → API (pola sekarang) | — (tidak di-cache) |
| Status deadline / overdue / sisa hari | **Tidak pernah** di server | Hitung ulang di client saat render + tick 60s (CR-1) atau di API per-request | Waktu, bukan event/tag |
| `todayKey` kalender | — | Dari `new Date()` client di dalam komponen, bukan prop statis server | Waktu |
| Session / token / profil | **Wajib tidak di-cache** | Cookie HttpOnly + `no-store`; verifikasi JWT di proxy & API | logout/refresh/role change |
| Unread notification | Boleh memo per-user singkat | Poll client 60s (sekarang) + sync-from-list | read-mutation + poll |
| Authz capability snapshot | Boleh, key per-user, TTL pendek | `authorization/cache.ts` (TTL 30s) | `invalidateAuthzCache(userId)` |
| Landing `/`, halaman `(auth)` | Boleh Full Route Cache | static default Next | deploy |
| API HTTP responses | Wajib `no-store` | `http-policy.ts` global (sudah ada) | — |

**Aturan emas untuk repo ini:** data yang identitasnya bergantung `user.id` **tidak pernah boleh menyentuh Data Cache/CDN**; kalau suatu saat perlu cache, bentuknya hanya (a) per-user di proses, atau (b) hanya di client dengan kunci user.

---

## 7. Urutan Pengerjaan

1. **CR-1** (client time-tick di semua halaman status) — sebelum rilis berikutnya. Dampak paling tinggi, effort rendah, pola sudah ada di `threshold-manager`.
2. **HI-1** (revalidatePath untuk course + timezone) — sebelum rilis berikutnya, setelah verifikasi §5.1. Effort sangat rendah.
3. **Verifikasi §5.3** (otorisasi per route API) — pintu masuk asumsi "tidak ada kebocoran"; lakukan seiring dengan rilis.
4. **ME-1** (path literal `courses/${courseId}`) — rapi-rapi, boleh kapan saja.
5. **LO-1/LO-2** — opsional; dokumentasikan batas polling 60s bila tidak diubah.