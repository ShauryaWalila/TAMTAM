-- TAMTAM — Single one-shot SQL to fix all RLS/DELETE/realtime issues.
-- Safe to run repeatedly (idempotent). Run in Supabase SQL Editor.
--
-- What this does:
--   1. Creates anniversaries table if missing.
--   2. Re-enables RLS on every table the app uses.
--   3. Drops legacy/conflicting policies that restricted to authenticated-only.
--   4. Adds a permissive "TAMTAM full access" policy for every table (anon +
--      authenticated, all operations including DELETE).
--   5. Adds every table to supabase_realtime publication so partner devices
--      receive INSERT/UPDATE/DELETE events live.

do $$
declare
  t text;
  tbls text[] := array[
    'posts','moments','trips','places','finances','tasks','profiles',
    'timetable','meetings','targets','calendar_events',
    'bucket_items','wardrobe','itinerary_items','itinerary_outfits','trip_canvas',
    'wardrobe_categories','trip_wardrobe','bucket_categories',
    'user_balances','trip_balances',
    'wishlist',
    'chill_categories','chill_items',
    'haptic_signals',
    'study_decks','study_cards','study_whiteboards','focus_sessions','active_study_sessions',
    'study_exams','study_habit_log','study_brain_dump','study_syllabus','study_naps','study_routines',
    'user_diary',
    'trip_songs',
    'diet_metrics','diet_units','ingredients','recipes','recipe_ingredients',
    'diet_plans','diet_settings','diet_goals',
    'anniversaries',
    'system_config',
    'study_chats','study_chat_messages',
    'user_memories','chat_summaries',
    'anatomy_library',
    'partner_locations',
    -- Added with finance intelligence + SMS-inbox + audience routine work
    'sms_inbox','sms_sender_blocklist','user_finance_rules','monthly_snapshots','gift_jar'
  ];
begin
  -- Make sure anniversaries exists before iterating.
  create table if not exists public.anniversaries (
    id text primary key,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    name text not null,
    date text not null,
    created_by text
  );

  -- Med Buddy chats (mirror of local SQLite so chats roam across devices).
  create table if not exists public.study_chats (
    id text primary key,
    title text not null default 'New Chat',
    user_id text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null
  );

  create table if not exists public.study_chat_messages (
    id text primary key,
    chat_id text not null references public.study_chats(id) on delete cascade,
    sender text not null,
    text text not null,
    data text,
    created_at timestamp with time zone default timezone('utc'::text, now()) not null
  );
  create index if not exists idx_study_chat_messages_chat on public.study_chat_messages(chat_id, created_at);

  foreach t in array tbls loop
    -- Skip tables that don't exist (some may not have been created in this DB).
    if not exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = t
    ) then
      raise notice 'skip %: not in this DB', t;
      continue;
    end if;

    -- Enable RLS.
    execute format('alter table public.%I enable row level security', t);

    -- Drop legacy policies that may block anon / DELETE.
    execute format('drop policy if exists "Allow all for authenticated users" on public.%I', t);
    execute format('drop policy if exists "Shared Diet Access"               on public.%I', t);
    execute format('drop policy if exists "Enable access for all"            on public.%I', t);
    execute format('drop policy if exists "Public access"                    on public.%I', t);
    execute format('drop policy if exists "Shared Access"                    on public.%I', t);
    execute format('drop policy if exists "Allow public read access"         on public.%I', t);
    execute format('drop policy if exists "Allow authenticated insert"       on public.%I', t);
    execute format('drop policy if exists "Allow authenticated delete"       on public.%I', t);
    execute format('drop policy if exists "Allow authenticated read access"  on public.%I', t);
    execute format('drop policy if exists "TAMTAM full access"               on public.%I', t);

    -- Single permissive policy: anon + authenticated, all operations.
    execute format(
      'create policy "TAMTAM full access" on public.%I as permissive for all to public using (true) with check (true)',
      t
    );

    -- Enable realtime (silently skip if already added).
    begin
      execute format('alter publication supabase_realtime add table public.%I', t);
    exception when duplicate_object then
      null;
    end;
  end loop;
end $$;

-- Verify by listing every policy currently in place.
select schemaname, tablename, policyname, cmd, roles
from   pg_policies
where  schemaname = 'public'
order  by tablename, policyname;











