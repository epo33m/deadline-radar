# Remediation Log — CR-1: Status deadline tidak refresh saat tab idle

- **Temuan asal:** `docs/audit/caching-data-fetching-audit.md` §CR-1 (🔴 Critical)
- **Tanggal remediasi:** 2026-09-19
- **Status:** ✅ RESOLVED
- **Peran:** engineer (remediasi dieksekusi dari plan yang disetujui)

---

## 1. Ringkasan perbaikan

Akar masalah: seluruh perhitungan sensitif-waktu (tone overdue, label relatif deadline,
grouping Late/Upcoming, highlight "today" kalender, counts summary) dievaluasi **hanya saat
render** memakai `new Date()` / `Date.now()`. Saat tab dibiarkan idle, tidak ada apa pun yang
men-trigger re-render, sehingga tampilan membeku meski waktu sudah lewat.

Perbaikan: menambahkan **satu sumber waktu tick di client** (`useNow`) yang re-render tiap
60 detik dan langsung saat tab kembali visible, lalu menyuntikkannya ke semua titik rawan.
Untuk `/summary`, counts dihitung di API per-request → dijadwalkan `router.refresh()` 60 detik
+ visibility catch-up agar Server Components di-fetch ulang.

### Anti hydration-mismatch

Halaman RSC mengirim `nowIso` (timestamp server saat request) sebagai prop ke komponen client;
`useNow` memakai nilai itu sebagai nilai awal state. SSR dan render hydrasi pertama identik,
kemudian interval berjalan di client. Tidak ada flash/hydration warning.

### Trade-off

- Re-render ~1×/menit per tab terbuka untuk halaman tasks/courses/detail/kalender — beban
  praktis nol, sepadan untuk aplikasi yang janji utamanya akurasi deadline.
- `/summary` memicu 1 request server tambahan per menit (hanya saat tab visible). Ini disengaja
  dan selaras dengan cadence polling notifikasi (60 s).
- Interval di-skip saat tab hidden (document.hidden); nilai langsung di-catch-up saat kembali
  visible.

---

## 2. Perubahan perilaku

| Sebelum | Sesudah |
|---|---|
| Tone overdue membeku saat tab idle | Tone dihitung ulang tiap 60 s + saat tab visible |
| "Due today" / "in 1 day" / "N days overdue" membeku | Label relatif menyesuaikan waktu (semua halaman yang memakainya) |
| Grouping Late/Upcoming course membeku | `groupCourseTasks(tasks, now)` tick 60 s; counts kartu turut menyesuaikan |
| Highlight "today" kalender macet di hari buka | `liveTodayKey` dari client `now`; tombol "Today" mengikuti |
| Counts `/summary` basi sampai navigasi/reload | `router.refresh()` 60 s + saat tab visible |

---

## 3. File berubah

### Baru

| File | Isi |
|---|---|
| `apps/web/lib/use-now.ts` | Hook `useNow(intervalMs, initialIso?)` — state `now` yang tick 60 s + catch-up `visibilitychange`; seed dari `initialIso` (nilai server) untuk SSR-safe |
| `apps/web/components/summary/summary-refresh.tsx` | `SummaryRefresh` — `router.refresh()` 60 s (skip saat hidden) + catch-up visible; render `null` |
| `docs/audit/caching-data-fetching-remediation.md` | Dokumen ini |

### Modifikasi

| File | Perubahan |
|---|---|
| `apps/web/lib/tasks/global-tasks.ts` | Tambah `resolveTaskTone(task, now)` (di-extract dari `tasks-collection.tsx`) agar bisa diuji |
| `apps/web/lib/tasks/global-tasks.test.ts` | Test `resolveTaskTone`: done / late / upcoming / edge `ms === now` / invalid deadline |
| `apps/web/components/tasks/tasks-collection.tsx` | Prop `nowIso?`; `useNow`; `resolveTaskTone(task, now)`; `filterTasksByStatusView(..., now)` utk view late/upcoming (+dep memo `now`) |
| `apps/web/app/(app)/tasks/page.tsx` | Pass `nowIso` |
| `apps/web/components/tasks/task-detail.tsx` | Prop `nowIso?`; `useNow`; pass `now` ke 2× `formatRelativeDeadline` |
| `apps/web/app/(app)/tasks/[id]/page.tsx` | Pass `nowIso` |
| `apps/web/components/courses/course-detail.tsx` | Prop `nowIso?`; `useNow`; `groupCourseTasks(tasks, now)` (groups tick); thread `now` → `CourseTaskGroup` → `CourseTaskRow` → `formatRelativeDeadline` |
| `apps/web/app/(app)/courses/[id]/page.tsx` | Pass `nowIso` |
| `apps/web/components/calendar/calendar-month-view.tsx` | Prop `nowIso?`; `useNow`; `liveTodayKey = getZonedDayKey(now.toISOString(), tz) ?? todayKey`; dipakai utk `isToday`, default `selectedKey`, tombol "Today" |
| `apps/web/app/(app)/calendar/page.tsx` | `nowIso` tunggal; `todayKey` diturunkan dari instant yang sama; pass `nowIso` |
| `apps/web/app/(app)/summary/page.tsx` | Render `<SummaryRefresh />` (cabang sukses) |

### Tidak diubah (disengaja)

- `apps/web/components/tasks/task-form.tsx:46-58` — `new Date()` untuk default input
  datetime; hanya relevan saat dialog dibuka, bukan idle staleness.
- Navigasi bulan di kalender saat idle melewati batas bulan — tetap eksplisit (user memilih
  bulan); hanya highlight "today" yang hidup. Catatan desain, bukan regresi.

---

## 4. Verifikasi

### Otomatis

- `bunx nx run web:test` — seluruh test (termasuk `resolveTaskTone`) hijau.
- `bunx nx run web:lint` — eslint bersih.
- `bunx tsc --noEmit -p apps/web/tsconfig.json` — typecheck bersih.
- `bunx nx run web:build` — build RSC sukses.

### Manual (DevTools / browser)

1. `/tasks` — buat task due ~1 menit dari sekarang; buka tab itu dan jangan sentuh;
   dalam ≤60 s tone berubah `upcoming → late` dan label berubah `Due today → 1 day overdue`
   tanpa interaksi.
2. `/courses/:id` — task lewat tengah malam: grouping Late/Upcoming dan kartu counts bergeser
   sendiri dalam ≤60 s.
3. `/tasks/:id` — label "Deadline" relatif menyesuaikan saat waktu lewat tanpa reload.
4. `/calendar` — biarkan tab terbuka lewat tengah malam: highlight "today" pindah ke hari baru
   dalam ≤60 s; tombol "Today" juga memilih hari baru.
5. `/summary` — Network tab: ada request `?_rsc=` untuk `/summary` tiap ~60 s; counts
   "Today/Missed/This week" bergeser saat tengah malam tanpa navigasi. Saat tab di-hidden,
   tidak ada refresh sampai tab kembali visible.
6. Kembalikan tab ke foreground setelah idle lama → render langsung segar (visibility catch-up),
   tidak menunggu 60 s berikutnya.

---

## 5. Changelog

### 2026-09-19 — CR-1 status deadline live

- **feat(web):** tambah `useNow(intervalMs, initialIso)` — sumber waktu client yang tick 60 s
  dan catch-up saat tab kembali visible; seed dari `initialIso` server agar SSR === hydrate.
- **feat(web):** semua titik deadline sensitif-waktu kini memakai `useNow`:
  tone kartu `/tasks` (`resolveTaskTone`), grouping + label relatif `/courses/:id`,
  label relatif `/tasks/:id`, highlight "today" + tombol "Today" `/calendar`.
- **feat(web):** `/summary` re-fetch otomatis tiap 60 s (dan saat tab visible) via
  `SummaryRefresh` → counts "Today / This week / Missed" tidak basi.
- **test(web):** unit test `resolveTaskTone` (done / late / upcoming / edge now / undated).
- **docs:** catatan remediasi di `docs/audit/caching-data-fetching-remediation.md`.

### Verifikasi runtime
- Tanpa interval baru saat tab hidden (hemat; desain mengikuti pola polling notifikasi).
- Re-render per menit per tab terbuka pada halaman ber-data — dampak performa praktis nol.