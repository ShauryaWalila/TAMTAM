# 2026-04-25 — Add `touch_payload` to `moments`

Adds an optional `jsonb` column to the existing `moments` table to store the
recorded handprint (frame-by-frame touch points + final imprint) for the
touch-partner pin-art replay feature.

## SQL

Run this in the Supabase SQL editor for project `jzxfdaalvmsjzkrrajvp`
(see `lib/supabase.ts:5`):

```sql
alter table moments add column if not exists touch_payload jsonb;
```

## Verification

After running, confirm the column exists:

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'moments'
  and column_name = 'touch_payload';
```

Expected: one row, `touch_payload | jsonb`.

## Backwards compatibility

- Column is nullable. Existing rows are unaffected.
- The receiver screen falls back to a generic "[user] sent a touch" message
  when `touch_payload` is null, so old rows continue to render correctly.
