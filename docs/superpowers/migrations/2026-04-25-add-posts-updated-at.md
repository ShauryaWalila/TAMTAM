# 2026-04-25 — Add `updated_at` to `posts`

The `posts` table sync queue (used by Draw and the new Grid mode) sends an
`updated_at` field, but the Supabase column was missing, causing every sync to
fail with `Could not find the 'updated_at' column of 'posts' in the schema
cache`. This migration adds the column, backfills it from `created_at` so
existing rows look reasonable, and sets `now()` as the default for future
inserts that don't supply one.

## SQL

Run this in the Supabase SQL editor for project `jzxfdaalvmsjzkrrajvp`
(see `lib/supabase.ts:5`):

```sql
alter table posts add column if not exists updated_at timestamptz;
update posts set updated_at = created_at where updated_at is null;
alter table posts alter column updated_at set default now();
```

## Verification

```sql
select column_name, data_type, column_default
from information_schema.columns
where table_name = 'posts' and column_name = 'updated_at';
```

Expected: one row, `updated_at | timestamp with time zone | now()`.

```sql
select count(*) from posts where updated_at is null;
```

Expected: 0.
