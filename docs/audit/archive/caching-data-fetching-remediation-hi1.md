# Remediation Log — HI-1: Invalidasi mutasi tidak lengkap untuk course & preferensi waktu

- **Temuan asal:** `docs/audit/caching-data-fetching-audit.md` §3 HI-1 (🟠 High).
- **Status:** ✅ SELESAI (kode + verifikasi). Satu-satunya baris kode yang sisa di sesi terpantau: menambah import `revalidatePath` pada `apps/web/app/actions/auth.ts` — perubahan struktural lain (helper revalidate + global purge) sudah berada di working tree dari pengerjaan sebelumnya, hanya belum sempat diverifikasi build.

---

## 1. Perubahan kode

### `apps/web/app/actions/courses.ts`
- Helper `revalidateCourseContent(courseId?)` — me-revalidate **semua segmen** yang merender context course (nama/kode/warna/ikon): `/courses`, `/courses/[id]`, plus `/tasks`, `/calendar`, `/summary`.
- `createCourse` → `revalidateCourseContent()`; `updateCourse` → `revalidateCourseContent(id)`; `softDeleteCourse` → `revalidateCourseContent(id)` lalu `redirect`.
- (Helper + pemakaiannya sudah ada di working tree files saat pengerjaan mulai; sesi ini hanya meneruskan.)

### `apps/web/app/actions/auth.ts`
- Import `revalidatePath` dari `next/cache` dari HEAD (sebelumnya hanya dipakai value `revalidatePath` tanpa import → typecheck gagal).
- `updateTimezone` / `updateTimeFormat` → **global purge** `revalidatePath("/", "layout")` — preferensi waktu dipakai hampir semua halaman (semua stempel/format + counts "Today/etc"), jadi invalidasi segmen per-rute tidak cukup; purge seluruh Client Cache.

---

## 2. Mengapa ini menutup HI-1

- Perilaku Back/forward navigation di Next 16.3 memulihkan segmen dari **Client Cache** tanpa selalu memicu request ulang (Back-nav tidak terikat staleTime).
- Sebelumnya: ganti warna/ikon course → Back ke `/tasks` bisa menampilkan warna lama; ubah timezone → Back ke halaman mana pun bisa menampilkan preferensi basi.
- Sekarang: setiap mutasi course me-revalidate semua segmen yang menampilkannya; setiap mutasi preferensi waktu mem-purge Client Cache global. Segmen basi tidak bisa tersisa di cache client.

---

## 3. Trade-off

- Revalidasi multi-segmen tiap mutasi course: revisi beberapa segmen sekaligus — biaya praktis nol karena halaman dynamic + `no-store`; hanya membatalkan Router Cache yang akan ter-refresh pada kunjungan berikutnya.
- `revalidatePath("/", "layout")` untuk timezone/timeFormat: purge menyeluruh — tepat untuk preferensi global yang dipakai setiap halaman; bukan boros karena tidak ada data statis besar yang ikut dibatalkan (semua juga no-store).

---

## 4. Verifikasi

### Otomatis
- `bunx nx run web:test` — 161 pass / 0 fail.
- `bunx nx run web:lint` — bersih.
- `bunx tsc --noEmit -p apps/web/tsconfig.json` — bersih (TSC_EXIT=0; ini yang semula gagal karena import `revalidatePath` hilang).
- `bunx nx run web:build` — sukses.

### Manual (DevTools/browser)
1. `/tasks` → `/courses/:id` → ubah warna/ikon → **Back** → cek Network untuk request `?_rsc=` ke `/tasks`; warna baru tampil (atau segmen ditarik ulang).
2. Settings → ganti timezone → **Back** ke `/summary` → stempel waktu mengikuti preferensi baru tanpa hard reload.
3. Settings → ganti time format (12h/24h) → navigasi antar halaman menampilkan format baru konsisten.

---

## 5. Changelog

### 2026-09-19 — HI-1 course & preferensi waktu live revalidation

- **fix(web):** invalidasi mutasi lengkap untuk course — `revalidateCourseContent(courseId?)`
  me-revalidate `/courses`, `/courses/[id]`, `/tasks`, `/calendar`, `/summary`; dipakai di
  `createCourse`, `updateCourse`, `softDeleteCourse`.
- **fix(web):** global purge `revalidatePath("/", "layout")` setelah `updateTimezone` &
  `updateTimeFormat` — preferensi waktu dipakai semua halaman, Back-nav tidak bisa
  memulihkan segmen basi dari Client Cache.
- **build(web):** import `revalidatePath` di `apps/web/app/actions/auth.ts` (typecheck kini bersih).
