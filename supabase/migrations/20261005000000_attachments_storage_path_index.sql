-- Issue #133: the storage sweep resolves candidate object keys with an exact
-- `storage_path = ANY(...)` lookup (chunked). Without an index every chunk
-- seq-scans attachments; the partial index skips NULL storage_path (link
-- attachments) and keeps the lookup O(log n) as the table grows.
create index if not exists idx_attachments_storage_path
  on public.attachments (storage_path)
  where storage_path is not null;
