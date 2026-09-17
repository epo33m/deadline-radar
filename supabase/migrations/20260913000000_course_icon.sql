-- Add optional Lucide icon slug to courses.
-- Display-only field storing a kebab-case Lucide slug (e.g. 'book-open'); existing rows get NULL (= None).

alter table public.courses
  add column if not exists icon text;
