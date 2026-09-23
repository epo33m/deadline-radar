# Remediation Log — ME-1: `revalidateTask()` memakai pola dinamis `/courses/[id]` sehingga membatalkan semua halaman detail course per mutasi task

- **Temuan asal:** `docs/audit/caching-data-fetching-audit.md` §3 ME-1 (🟡 Medium).
- **Status:** ✅ SELESAI (kode + verifikasi). Perubahan kode sudah berada di working tree; sesi ini hanya menuntaskan jejak dokumentasi + verifikasi build.

---

## 1. Perubahan kode

### `apps/web/app/actions/tasks.ts`
- `revalidateTask(taskId?, courseId?)` — helper kini menerima `courseId` opsional.
  - Bila `courseId` tersedia (diketahui dari form), panggil **path literal**:
    ```ts
    revalidatePath(`/courses/${courseId}`, "page");
    ```
  - Bila tidak tersedia (action hanya punya `taskId`), jatuh ke pola dinamis sebagai fallback:
    ```ts
    revalidatePath("/courses/[id]", "page");
    ```
- Call site yang punya `course_id` di form (`createTask`, `updateTask`) → baca `courseIdFromForm(formData)` lalu teruskan `revalidateTask(taskId, courseId)`, sehingga hanya halaman detail **course itu** yang dibatalkan, bukan semua instance route detail course.
- 6 call site lain yang hanya punya `taskId` (`completeTask`, `softDeleteTask`, `addReminderThreshold`, `updateReminderThreshold`, `removeReminderThreshold`, `setDefaultThresholds`) → tetap fallback pola dinamis.

---

## 2. Mengapa ini menutup ME-1

- Sebelumnya `revalidatePath("/courses/[id]", "page")` memakai pola dinamis → membatalkan **seluruh instance** route detail course untuk **setiap** mutasi task, padahal satu task hanya terkait satu course.
- Bukan bug kebenaran dan bukan vektor kebocoran (halaman dynamic `no-store`; `revalidatePath` hanya membersihkan segmen di router cache masing-masing browser). Ini murni perluasan scope revalidasi tanpa manfaat.
- Kini, saat `course_id` tersedia di action, hanya `/courses/${courseId}` (path literal) yang dibatalkan — scope invalidation menyempit sesuai course yang benar-benar berubah.

---

## 3. Trade-off

- Fallback `/courses/[id]` tetap dipertahankan untuk 6 action yang hanya punya `taskId` — menghindari fetch tambahan `GET /tasks/:id` per mutasi demi mendapatkan `courseId`, yang berarti round-trip ekstra tanpa pengaruh user-visible. (Pola ini identik dengan keputusan di CR-1/HI-1: narrow hanya saat data sudah tersedia di form.)
- Konsisten dengan helper `revalidateCourseContent(courseId?)` di `courses.ts` (HI-1): keduanya memakai path literal `/courses/${courseId}` bila course-dalam-tahad dikenal.

---

## 4. Verifikasi

### Otomatis
- `bunx nx run web:test` — 161 pass / 0 fail.
- `bunx nx run web:lint` — bersih.
- `bunx tsc --noEmit -p apps/web/tsconfig.json` — bersih (TSC_EXIT=0).
- `bunx nx run web:build` — sukses.

### Manual / observasi
- Tidak ada kerusakan user-visible (sesuai temuan: reproduksi hanya observasi pembacaan kode); net efeknya hanya scope invalidasi yang lebih sempit.

---

## 5. Changelog

### 2026-09-20 — ME-1 course detail revalidasi ke path literal

- **fix(web):** `revalidateTask()` di `apps/web/app/actions/tasks.ts` kini menerima `courseId` opsional dan memanggil `revalidatePath(`/courses/${courseId}`, "page")` (path literal) saat tersedia, dengan fallback `/courses/[id]` bila hanya `taskId` yang diketahui.
- **fix(web):** `createTask` & `updateTask` meneruskan `courseIdFromForm(formData)` ke `revalidateTask`, sehingga mutasi task hanya membatalkan halaman detail course yang terkait.

---

## 6. Ringkasan perbaikan (remediation notes)

1. **Root cause:** helper `revalidateTask` (tasks.ts) memakai pola path dinamis `/courses/[id]` — per mutasi task, semua halaman detail course ikut dibatalkan.
2. **Perbaikan:** thread `courseId` ke helper; path literal `/courses/${courseId}` saat course diketahui, fallback dinamis bila tidak.
3. **Trade-off:** 6 action non-course (hanya `taskId`) tetap fallback — tanpa fetch tambahan; konsisten dengan pola CR-1/HI-1.
4. **Verifikasi:** test 161 ✓, lint ✓, tsc ✓, build ✓.
