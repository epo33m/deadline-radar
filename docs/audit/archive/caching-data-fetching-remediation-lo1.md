# Remediation Log — LO-1: Duplikasi `requireSession()` layout + page mengandalkan fetch-memoization, bukan `React.cache()`

- **Temuan asal:** `docs/audit/caching-data-fetching-audit.md` §3 LO-1 (⚪ Low).
- **Status:** ✅ SELESAI (kode + verifikasi).

---

## 1. Perubahan kode

### `apps/web/lib/api/session.ts`
- Import `cache` dari `react`; `getSession()` dibungkus `cache()` — tanpa argumen berarti tepat satu entri per request render:
  ```ts
  import { cache } from "react";
  export const getSession = cache(async () => { …body tidak berubah… });
  ```
- `requireSession()` tidak berubah; 10 call site (`(app)/layout.tsx:9` + 9 page) tidak berubah.

### Perbaikan insidental dalam sesi ini (ME-1 follow-up)
- `apps/web/app/actions/tasks.ts` memanggil `courseIdFromForm(formData)` yang tidak pernah didefinisikan → `ReferenceError`, 3 test gagal. Diganti ekstraksi inline defensif (`typeof courseId === "string" && courseId ? courseId : undefined`) di `createTask`, dan `course_id` ikut di-thread di `updateTask`. 6 action taskId-only tetap fallback `/courses/[id]` (sesuai keputusan ME-1).

---

## 2. Mengapa ini menutup LO-1

- Sebelumnya dedup session bergantung pada memoization `fetch` GET identik per render pass + header deterministik (`cookie`, `x-forwarded-host/proto`, `origin` konstan). Bila kelak `apiFetch` menyisipkan header non-deterministik (nonce/timestamp), dedup putus dan session di-fetch ganda.
- Kini dedup dijamin per-request oleh `React.cache()`, tidak lagi bergantung pada bentuk header internal `apiFetch`.

---

## 3. Trade-off

- `clearLocalAuthCookies()` hanya berjalan di jalur unauthenticated dan idempoten — di bawah cache ia tetap dieksekusi sekali per request yang unauth, sama seperti sebelumnya (±1 eksekusi via dedup). Perilaku tidak berubah.
- `redirect()` dari `requireSession()` melempar `NEXT_REDIRECT`, tidak ikut ter-cache.
- Tidak konflik dengan `cache: "no-store"` di `apiFetch` (cache membungkus fungsi, bukan fetch).

---

## 4. Verifikasi

### Otomatis
- `bunx nx run web:test` — 161 pass / 0 fail (sempat 158/3 karena `courseIdFromForm` di atas; hijau setelah perbaikan).
- `bunx nx run web:lint` — bersih.
- `bunx tsc --noEmit -p apps/web/tsconfig.json` — bersih.
- `bunx nx run web:build` — sukses (18/18 static pages).

### Manual
- Tidak ada perubahan user-visible (dedup yang tadinya implisit kini eksplisit); tidak ada checklist browser khusus.

---

## 5. Changelog

### 2026-09-20 — LO-1 `getSession()` dibungkus `React.cache()`

- **fix(web):** `getSession()` di `apps/web/lib/api/session.ts` dibungkus `cache()` dari `react` — session di-fetch tepat sekali per request render, tidak lagi bergantung pada memoization fetch + header deterministik.
- **fix(web):** perbaiki `ReferenceError: courseIdFromForm is not defined` di `createTask` (`apps/web/app/actions/tasks.ts:61`) dengan ekstraksi inline defensif; thread `course_id` juga di `updateTask`.
