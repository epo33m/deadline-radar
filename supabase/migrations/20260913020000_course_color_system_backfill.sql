-- Backfill all legacy course colors to the canonical system palette.
-- After this, LEGACY_COLOR_ALIASES is removed: only the 12 system light
-- values (plus darks and valid custom hex) resolve. Run BEFORE deploying
-- the code without aliases. lower() covers uppercase stored values.

update public.courses set color = '#ff383c' where lower(color) = '#ff3b30';
update public.courses set color = '#0088ff' where lower(color) in ('#0071e3', '#007aff');
update public.courses set color = '#ff8d28' where lower(color) = '#ff9500';
update public.courses set color = '#00c8b3' where lower(color) = '#00c7be';
update public.courses set color = '#00c3d0' where lower(color) = '#30b0c7';
update public.courses set color = '#00c0e8' where lower(color) = '#32ade6';
update public.courses set color = '#6155f5' where lower(color) = '#5856d6';
update public.courses set color = '#cb30e0' where lower(color) = '#af52de';
update public.courses set color = '#ac7f5e' where lower(color) = '#a2845e';
