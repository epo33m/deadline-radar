-- Backfill course red: #ff3b30 -> #ff383c (Opsi B, tanpa legacy alias).
-- Apply in Supabase SQL Editor AFTER code deploy window planning:
-- urutan aman = apply SQL dulu, baru deploy code (lihat plan).
-- lower() sekalian cover data uppercase (#FF3B30).

update public.courses
set color = '#ff383c'
where lower(color) = '#ff3b30';
