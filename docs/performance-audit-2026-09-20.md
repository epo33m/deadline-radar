# Performance Audit — Deadline Radar

**Tanggal:** 2026-09-20
**Mode:** evidence-backed audit (tanpa perubahan kode)
**Cakupan:** `apps/web` (Next.js 16.3.4 / React 19.2.8), `apps/api` (Elysia/Bun), `packages/db` (Drizzle), `supabase/migrations`

> Prinsip: setiap temuan wajib **Located** (`path:line`), **Explained** (mekanisme biaya), **Sized** (terukur atau estimasi beralasan), **Fixable** (perubahan spesifik). Jika tidak memenuhi keempatnya, temuan dibuang atau masuk ke Unverified.

---

## 1. System map

- **Stack:** Next.js `16.3.4` / React `19.2.8` App Router + RSC (`apps/web` :3025) → Elysia API di Bun (`apps/api` :4025, `/api/v1/*`) → Drizzle (`postgres-js`, `prepare: false, max: 10`, `packages/db/src/client.ts:10`) → Supabase Postgres. Supabase Auth memegang identitas (verifikasi JWKS di `proxy.ts` dan API). Tanpa React Query/SWR/Zustand. Tanpa pemanggilan Supabase langsung dari web; semua via `apiJson` (`apps/web/lib/api/server.ts:105`) dengan `cache: "no-store"`.
- **Hot paths (asumsi, perlu konfirmasi):** `/summary`, `/tasks`, `/tasks/[id]`, `/calendar`, header bell unread-count (terpasang di setiap halaman `(app)` via `AppShell` → `NotificationsProvider`). Cron per jam `GET /api/v1/cron/evaluate-reminders` → `runEvaluateReminders`.
- **Data scale:** tidak diketahui — DB dev kecil. Dinilai pada skala "user dengan 1k–10k tasks + scheduler dengan 10k–100k open tasks" karena summary/cron memindai semua baris.
- **Keluhan yang dilaporkan:** tidak ada. Audit murni berbasis bukti kode; tanpa APM, tanpa `EXPLAIN ANALYZE`, tanpa angka bundle.

> Data yang masih dibutuhkan untuk mempromosikan item §6: jumlah baris prod per tabel utama, apakah `DATABASE_URL` memakai role non-`BYPASSRLS`, konfirmasi hot path, akses slow-query log.

---

## 2. Verdict

**Needs work** — belum ada satu query pun yang akan menjatuhkan situs besok, tetapi dua read yang paling sering dikunjungi (`/summary`, task detail) dan scheduler per jam semuanya menyerikan round trip DB yang independen dan memindai row set tak terbatas di Node. Perubahan dengan leverage tertinggi adalah melipat waterfall 4-transaksi di task detail (`tasks.ts:222-240`) menjadi satu transaksi `withUserRls` dengan 3 select paralel, dan membatasi path summary dengan agregasi di sisi DB.

---

## 3. ✅ Already handled

- `TasksPage` (`apps/web/app/(app)/tasks/page.tsx:30-33`) dan `TaskDetailPage` (`apps/web/app/(app)/tasks/[id]/page.tsx:62-71`) menembak fetch independen dalam `Promise.all` — benar.
- `getSession` dibungkus React `cache()` (`lib/api/session.ts:17-34`) — dedup per-request, benar.
- Cursor/keyset pagination di semua list (`limit+1`, `encodeCursor`), tanpa `OFFSET` — `tasks.ts:176`, `courses.ts:100`, `notifications.ts:73`. Benar.
- Snapshot authz 30 detik in-memory + invalidasi saat assign/revoke (`load.ts:52-100`, `cache.ts:10-48`). Benar untuk single-node; lihat caveat P2.
- Index komposit/filtered M9 sesuai urutan sort list (`20260919030000_m9…sql:7-23`). Arah benar.
- `POST read-all` adalah satu statement `UPDATE` set-based dengan ownership di dalam statement (`notifications.ts:227-249`). Benar — tanpa blowup ID-list.
- `NotificationsProvider` mendup fetch in-flight, melewatkan tab tersembunyi, catch-up saat visible, dan `NotificationList` menyinkronkan badge dari list yang komplet tanpa query tambahan (`notifications-provider.tsx:50-86`, `notification-list.tsx:77-79`). Pola benar.
- `withUserRls` memakai GUC transaction-local (`is_local=true`) (`rls-context.ts:28-43`). Benar untuk pooling.
- RLS `IN (SELECT … tasks WHERE user_id = auth.uid())` didokumentasikan sebagai semi-join terencana di atas `idx_tasks_user_id` (`ARCHITECTURE.md:98`). Disengaja, jangan diubah.

---

## 4. ⚠️ Findings (ranked)

### [P1] Task detail melakukan 4 transaksi sekuensial per load

**Where** `apps/api/src/routes/tasks.ts:222-240`; `ownership.ts:67-88`; `rls-context.ts:28-43`
**Lens** Request waterfalls · DB
**Now** `ownedTask()` (`BEGIN` + 3× `set_config` + `SELECT` + `COMMIT` sendiri) → `SELECT` course → `SELECT` thresholds → `SELECT` attachments, semua di-`await` berurutan. Tiga yang terakhir tidak saling bergantung.
**Cost** Estimasi: 4× (overhead tx + RTT + waktu query). Pada RTT intra-region ~30ms + ~5ms setup tx, ≈140ms serialisasi murni per tampilan detail, sebelum transfer. Terbayar pada setiap hit `/tasks/[id]`.
**Why now** Tidak ada dependensi data antara course/thresholds/attachments setelah task terbukti milik user.
**Fix** Pertahankan `ownedTask` dulu (gerbang 404), lalu jalankan course/thresholds/attachments dalam satu transaksi `withUserRls` dengan `Promise.all`, atau tiga select `getDb()` paralel (kepemilikan sudah dibuktikan oleh `ownedTask`).
**Effort** ~1 jam
**Risk** Rendah.
**Verify** Log/API APM: 4 span sekuensial → 2.

### [P1] Summary memindai SEMUA tasks ke Node setiap load, di-map dua kali

**Where** `apps/api/src/routes/summary.ts:34-59`, `:61-79`
**Lens** DB & indexes · Payload · Runtime
**Now** `SELECT` profile lalu `SELECT deadline,status,completedAt,courseName,courseColor … WHERE user_id=? AND deleted_at IS NULL` tak terbatas (tanpa `LIMIT`), lalu dua pass `.map()` penuh yang masing-masing memanggil `new Date(…).toISOString()`. Timezone berasal dari baris profile, tetapi kedua query tetap diserikan.
**Cost** Estimasi: pada 5k tasks × ~120B/baris ≈ 600KB DB→API per load + 10k konstruksi `Date`; pada 100k tasks ini meng-OOM handler serverless. P1 hari ini untuk akun berat, P0 pada skala proyeksi.
**Why now** Jumlah yang ditampilkan harus eksak di atas seluruh histori user, bukan ukuran halaman — jadi biayanya tumbuh bersama total data, bukan bersama limit.
**Fix** Satu pass (bangun kedua agregat dalam satu loop, parse tiap tanggal sekali), tembak profile + tasks dalam `Promise.all` dengan fallback UTC, dan — perbaikan sebenarnya — pindahkan bucketing ke Postgres `RPC`/view (`GROUP BY` + bucketing sadar-tz) sehingga API mengirim 7 int + progress, bukan N baris.
**Effort** ~2 jam (single-pass) / ~1 hari (RPC)
**Risk** Rendah/Menengah.
**Verify** `EXPLAIN (ANALYZE, BUFFERS)` pada pemindaian tasks; byte respons API sebelum/sesudah.

### [P1] Batch cron melakukan 4 query sekuensial + write/kirim serial per delivery

**Where** `apps/api/src/services/run-evaluate.ts:275-323` (fetch batch), `:416-493` (insert/claim per aksi), `:524-617` (kirim serial + sweep)
**Lens** Waterfalls · Runtime
**Now** Per batch 100 task: `tasks` → `thresholds` → `deliveries` → `profiles`, masing-masing menunggu sebelumnya (tiga terakhir independen dengan `taskIds`/`userIds` yang sudah diketahui). Lalu setiap `create`/`retry-claim`/`deliverEmail` adalah `await` individual dalam loop `for`, dan setiap kirim email adalah I/O jaringan serial.
**Cost** Estimasi: 3 RTT terbuang × (jumlah batch). 10k tasks = 100 batch ≈ 300×30ms ≈ 9 detik serialisasi murni, plus kiriman Resend serial (detik per kirim saat retry) yang meregangkan satu run menjadi puluhan menit dan berisiko tumpang tindih dengan tick per jam berikutnya.
**Why now** Durasi run tumbuh bersama seluruh tabel; run yang tumpang tindih memicu balapan kirim-ganda yang justru ingin dihindari oleh logika claim atomik.
**Fix** `Promise.all([thresholds, deliveries, profiles])` per batch; insert batch (`INSERT … ON CONFLICT DO NOTHING` dengan array values); batasi/paralelkan kiriman (mis. `p-limit(5)`) atau pindahkan kiriman ke antrean. Logika claim atomik tidak berubah.
**Effort** ~3 jam
**Risk** Menengah (konkurensi).
**Verify** Durasi cron + ledger `reminder_runs` sebelum/sesudah.

### [P2] Setiap halaman membayar waterfall session → data; middleware memverifikasi JWT per request

**Where** `apps/web/app/(app)/tasks/page.tsx:28-33`, `calendar/page.tsx:29-35`, `lib/api/session.ts:22`, `proxy.ts:98-165`, `lib/api/server.ts:130`
**Lens** Waterfalls · Middleware
**Now** `requireSession()` (`/api/v1/auth/session`) selesai sebelum `apiJson(courses/tasks)` mulai. `proxy.ts` menjalankan `jwtVerify` (JWKS remote, instance di-cache) dan kemungkinan `POST /api/v1/auth/refresh` pada *setiap* request yang cocok.
**Cost** Estimasi: +1 RTT API (~30–120ms) pada setiap load halaman RSC, plus latensi JWKS/refresh di tepi kedaluwarsa token.
**Why now** Bukan bottleneck utama, tetapi pajak konstan di semua hot path.
**Fix** Terima apa adanya demi kebenaran; kurangi rasa sakit dengan prefetch session + data paralel di mana semantik redirect memungkinkan, dan konfirmasi hit-rate cache JWKS. Jangan pindahkan auth ke pemanggilan DB di middleware.
**Effort** ~1 jam investigasi
**Risk** Rendah.
**Verify** Waterfall DevTools: hitung RTT session vs data.

### [P2] Calendar mengambil daftar task tanpa filter; pemfilteran bulan di sisi klien

**Where** `apps/web/app/(app)/calendar/page.tsx:35`, `lib/calendar/month.ts` (`groupTasksByDay`), API tanpa filter `from/to` (`tasks.ts:118-195`)
**Lens** Over-fetching · Collapsible
**Now** Calendar memanggil `GET /api/v1/tasks` (limit default 50) lalu mengelompokkan di JS. Salah di kedua ujung: >50 tasks → bulan tampil parsial; <50 tasks lintas setahun → mengirim baris tak relevan setiap navigasi bulan.
**Cost** Estimasi: 1 fetch halaman-penuh per nav bulan + tampilan salah di atas 50 tasks. Terbatas hari ini, memburuk theo skala.
**Why now** Batas 50 + tanpa filter tanggal = ketidakbenaran fungsional, bukan sekadar lambat.
**Fix** Tambahkan `?dueFrom&dueTo` ke `GET /tasks` yang didukung `idx_tasks_user_deadline_id_active`, dan query hanya rentang bulan yang terlihat.
**Effort** ~3 jam
**Risk** Rendah.
**Verify** Jumlah baris respons per nav bulan; kebenaran bulan dengan >50 tasks.

### [P2] Transaksi-per-check `withUserRls` melipatgandakan biaya write-path

**Where** `rls-context.ts:28-43`, pemanggil `tasks.ts:380,421,434,449`, `courses.ts:277,287,305`, `ownership.ts:44-88`
**Lens** DB
**Now** Setiap `ownedTask`/`ownedCourse` = `BEGIN` + 3 `set_config` + `SELECT` + `COMMIT`. PATCH task: cek-owned → cek-course opsional → `UPDATE` → re-check kondisional = 3–4 transaksi; PUT thresholds membungkus `db.transaction` sendiri *setelah* dua cek luar.
**Cost** Estimasi: ~15–20ms overhead per cek kepemilikan; 3 cek ≈ 50ms tambahan pada setiap mutasi.
**Why now** Pajak kecil tapi pasti pada semua mutasi terautentikasi.
**Fix** Alirkan satu transaksi `withUserRls` melalui seluruh handler (cek + mutasi + baca-ulang). Setup GUC tidak berubah.
**Effort** ~2 jam per keluarga route
**Risk** Menengah (menyentuh path authz; suite ownership test harus hijau).
**Verify** Span transaksi per mutasi di APM/log.

### [P2] Proyeksi list mengirim kolom tak terpakai; daftar task mengirim `description`

**Where** `tasks.ts:143-156` memilih `description,userId,updatedAt` tetapi `tasks-collection.tsx` / calendar hanya merender title/deadline/status/course
**Lens** Payload
**Now** `description` (`text` tak terbatas) × 50 baris menyeberang DB→API→RSC→klien pada setiap load list/calendar.
**Cost** Estimasi: dengan rata-rata deskripsi 500 char, ~25KB ekstra per halaman. Nyata tapi terbatas.
**Why now** Byte termurah untuk dipangkas di laporan ini.
**Fix** Pisahkan proyeksi: list/calendar select tanpa `description`; detail mempertahankannya.
**Effort** ~30 menit
**Risk** Rendah.
**Verify** Byte respons `/api/v1/tasks` sebelum/sesudah.

### [P2] Cache authz hanya memori satu-node; `cache: no-store` di mana-mana

**Where** `authorization/cache.ts:11` (`Map`, TTL 30s), `server.ts:130`, `db.ts:7-12` (singleton, `max: 10`)
**Lens** Caching & infra
**Now** Snapshot authz tidak terbagi antar instance (Redis hanya untuk rate limit). Setiap `apiFetch` keluar dari cache Next, sehingga summary/tasks/calendar di-fetch penuh setiap navigasi; `NotificationsProvider` mem-poll `unread-count` tiap 60 detik per tab terbuka.
**Cost** Estimasi: 2 query DB authz ekstra per request API per instance dingin + refetch penuh per nav. Baik untuk satu node, boros saat scale-out.
**Why now** Bukan masalah MVP satu-node; menjadi masalah saat horizontal scale.
**Fix** Terima single-node untuk MVP; sebelum scale horizontal, pindahkan snapshot authz ke Redis (`REDIS_URL` yang sama) atau terima hit DB dan buang map lokal. Tambahkan `revalidate`/`staleTime` hanya untuk bacaan yang benar-benar statis — bukan untuk list bergerbang-session.
**Effort** ~0.5 hari
**Risk** Menengah.
**Verify** Hit-rate cache authz; query authz per request di APM.

### [P3] Index: tiga celah di balik kerja M9 yang bagus

**Where** `schema.ts:308-320` (tanpa index `attachments.task_id`); `20260919030000_m9…:21-23` (index notifikasi berawalan `task_id`); filter `courseId` list tasks (`tasks.ts:166`)
**Lens** Database & indexes
- `attachments.taskId` tanpa index — lookup files `GET /tasks/:id` (`tasks.ts:237-240`) seq-scan pada skala besar. Tambahkan `CREATE INDEX … ON attachments(task_id)`.
- `idx_notification_deliveries_in_app_sent(task_id, sent_at, id)` tidak melayani path akses aktual (`WHERE tasks.user_id=? … ORDER BY sent_at DESC`). Filter `user_id` berasal dari join; pertimbangkan varian parsial `(sent_at DESC, id DESC)` atau covering — putuskan via `EXPLAIN`.
- `idx_tasks_user_deadline_id_active(user_id, deadline, id)` tidak meng-cover filter `AND course_id=?`. Jika list terfilter-course umum, tambahkan parsial `(user_id, course_id, deadline)`.
**Effort** Hitungan menit tiap index.
**Verify** `EXPLAIN (ANALYZE, BUFFERS)` pada ketiga query.

### [P3] Komponen klien sehalaman menghidrasi tree statis + re-render penuh per ketikan

**Where** `tasks-collection.tsx:1,206-268` (state + `useNow` di atas, `TaskRow` tanpa memo), `calendar-month-view.tsx:1,203-245` (reset bulan via render-then-`setState` `233-237`, `useNow` di atas), `task-detail.tsx:1` (panel klien 557 baris), `app-shell.tsx:18` (provider membungkus semua children)
**Lens** Hydration · Re-render
**Now** State filter/search/dialog-add hidup di atas seluruh grid, sehingga tiap ketikan me-render ulang semua baris; `useNow(60s)` menyortir/me-render ulang tasks + calendar tiap menit; `NotificationsProvider` membungkus seluruh app sehingga tiap `setUnread` 60-detik me-render ulang subtree consumer-nya. Tanpa split `dynamic()` untuk `Dialog`/`PortalMenu`/threshold/attachment managers.
**Cost** Estimasi: puluhan ms per ketikan pada 50 baris; tumbuh linear. Higiene hari ini.
**Why now** Biaya kecil dibanding item P1/P2; perbaiki saat Profiler menunjukkannya.
**Fix** Saat terasa: memo `TaskRow`/`CalendarDayCell`, turunkan state input search, `dynamic()` dialog add-task + threshold/attachment managers. Jangan split prematur — ukur dengan Profiler dulu.
**Effort** ~2 jam
**Risk** Rendah.
**Verify** React DevTools Profiler pada ketikan search + nav bulan.

---

## 5. 🔧 Must fix before scale (berurutan)

1. **Waterfall task-detail → 2 round trip** (P1-detail). Tidak bisa menunggu karena membebani halaman highest-intent di setiap view. Tanpa dependensi.
2. **Pemindaian summary tak terbatas → single-pass sekarang, RPC berikutnya** (P1-summary). Tidak bisa menunggu karena satu-satunya read yang tumbuh bersama *total* histori user, bukan ukuran halaman. Setelah (1).
3. **Paralelisme batch cron + insert batch** (P1-cron). Tidak bisa menunggu karena durasi run tumbuh bersama seluruh tabel dan run per jam yang tumpang tindih menyebabkan balapan kirim-ganda yang justru ingin dihindari logika claim. Setelah (2).
4. **Filter rentang-tanggal calendar + covering index** (P2-calendar). Tidak bisa menunggu setelah user melewati 50 tasks, karena calendar menjadi diam-diam salah. Setelah (3).

---

## 6. 🔍 Unverified — butuh pengukuran

- **Bundle:** bobot klien `motion`, `lucide-react`, `@base-ui/react`, `jose`, `openapi-fetch` per route. *Ukur:* `@next/bundle-analyzer`, first-load JS per `/summary` `/tasks` `/calendar` sebelum/sesudah.
- **Biaya RLS per baris:** policy `thresholds`/`deliveries` menjalankan `IN (SELECT … tasks)` per baris. *Ukur:* `EXPLAIN (ANALYZE, BUFFERS)` pada list notifikasi + unread-count pada 100k deliveries; konfirmasi semi-join, bukan filter per-baris.
- **Latensi tepi JWKS/refresh:** frekuensi fetch JWKS remote + `auth/refresh` `proxy.ts` di prod. *Ukur:* timing middleware / APM pada traffic token-kedaluwarsa.
- **N+1:** tidak ditemukan di request path (semua kerja per-baris ada di insert cron, tercakup di atas). Gugur kecuali slow-log berkata lain.
- **Full count ala `count: exact`:** tidak ada (`unread-count` satu `count(*)` di atas himpunan parsial — baik; agregat dashboard adalah isu summary di atas).

---

## 7. Measurement plan

- **Database:** `EXPLAIN (ANALYZE, BUFFERS)` sebelum/sesudah pada select task-detail, pemindaian summary, list notifikasi + unread-count, select batch cron; slow-query log Supabase; baris dipindai.
- **Network:** Waterfall DevTools pada `/tasks`, `/tasks/[id]`, `/summary`, `/calendar` — jumlah request, TTFB, span API sekuensial vs paralel.
- **Bundle:** bundle analyzer; first-load JS per route sebelum/sesudah split `dynamic()`.
- **Rendering:** React DevTools Profiler pada ketikan search tasks + nav bulan calendar; jumlah/durasi commit `TasksCollection` / `CalendarMonthView`.
- **Field:** Core Web Vitals (LCP, INP, CLS) pada empat hot route setelah perbaikan.

---

*Out of scope — noticed anyway:* tidak ada. Precedence error auth, TTL idempotency, dan penanganan retensi soft-delete tampak disengaja dan tidak diutak-atik.

*Catatan mode: tidak ada kode yang diubah dalam audit ini. Perbaikan di atas adalah usulan berurutan yang menunggu persetujuan dan empat input yang hilang (jumlah baris, role RLS, konfirmasi hot-path, akses slow-log).*
