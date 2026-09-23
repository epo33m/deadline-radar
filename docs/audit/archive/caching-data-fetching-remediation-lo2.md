# Remediation Log — LO-2: Badge unread hanya bisa telat sampai 60 detik (batas desain)

- **Temuan asal:** `docs/audit/caching-data-fetching-audit.md` §3 LO-2 (⚪ Low).
- **Status:** ✅ SELESAI (dokumentasi; tanpa perubahan kode — sesuai rekomendasi audit: "tidak wajib").

---

## 1. Observasi kode (bukan perubahan)

### `apps/web/components/notifications/notifications-provider.tsx`
- `POLL_INTERVAL_MS = 60_000` — interval poll badge 60 detik.
- Poll di-skip saat tab hidden (`if (!document.hidden)`), menghemat request untuk tab tak terlihat.
- Catch-up saat tab kembali visible: `shouldCatchUpOnVisible(lastFetchAt, Date.now(), POLL_INTERVAL_MS)` — refetch bila fetch terakhir lebih tua dari 60 detik.
- Bootstrap: fetch sekali per document load (layout persist antar soft-nav).

### `apps/web/app/actions/notifications.ts`
- `countUnreadInAppNotifications()` memanggil `GET /api/v1/notifications/unread-count` (no-store, selalu segar) — bukan sumber staleness.
- Optimistic delta lokal (`noteOneRead`/`noteAllRead` via `applyOneRead`/`applyAllRead`) membuat aksi read terasa instan tanpa menunggu poll berikutnya.

---

## 2. Keputusan: diterima sebagai batas desain

- Badge unread dapat tertinggal hingga 60 detik dari kenyataan DB — ini **batas polling**, bukan bug data basi (API tidak pernah di-cache).
- Untuk produk reminder, keterlambatan ≤60 detik dapat diterima; audit §7 step 5 eksplisit membolehkan "dokumentasikan batas polling 60s bila tidak diubah".
- Pengetatan (turunkan interval / event-driven update) **ditolak untuk saat ini**: menambah beban request atau kompleksitas realtime tanpa kebutuhan produk yang tercatat.

---

## 3. Trade-off

- Interval lebih pendek (mis. 30s) akan memperkecil lag maksimal dengan biaya ~2x request unread-count per tab terbuka; tidak diambil.
- Event-driven (mis. refresh setelah mutasi notifikasi) akan menutup lag untuk aksi lokal, tetapi aksi lintas-perangkat/tab tetap butuh poll; tidak diambil — optimistic delta lokal sudah menutup kasus umum.

---

## 4. Verifikasi

### Otomatis
- `bunx nx run web:test` — 161 pass / 0 fail.
- `bunx nx run web:lint` — bersih.
- `bunx tsc --noEmit -p apps/web/tsconfig.json` — bersih.
- `bunx nx run web:build` — sukses.
- (Tidak ada perubahan perilaku; gates di atas memastikan tidak ada regresi dari sesi ini.)

### Manual
- Tidak diperlukan — tidak ada perubahan kode; perilaku 60s + catch-up adalah yang sudah berjalan dan diterima.

---

## 5. Changelog

### 2026-09-20 — LO-2 batas polling badge 60s didokumentasikan

- **docs(audit):** LO-2 ditutup sebagai batas desain yang diterima — badge unread polling 60 detik + skip-saat-hidden + catch-up-saat-visible; API unread-count no-store sehingga tidak ada data basi. Tanpa perubahan kode, sesuai rekomendasi audit.
