# TAMTAM Master Database Schema (Life Hub)

Run these commands in your Supabase SQL Editor to prepare for all future features.

```sql
-- 1. POSTS (Journal, Pics, Stickers)
create table posts (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  type text not null, -- 'text', 'image', 'sticker', 'draw'
  content text not null,
  user_id text not null
);

-- 2. MOMENTS (Message of the Moment)
create table moments (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  message text not null,
  user_id text not null
);

-- 3. TRIPS (Travel Planning & Memories)
create table trips (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  title text not null,
  start_date date,
  end_date date,
  status text default 'planned', -- 'planned', 'ongoing', 'completed'
  cover_image text
);

-- 4. PLACES (Map Integration for Trips & Dreams)
create table places (
  id uuid default gen_random_uuid() primary key,
  trip_id uuid references trips(id),
  name text not null,
  latitude float8 not null,
  longitude float8 not null,
  category text, -- 'dream', 'visited', 'restaurant', etc.
  notes text,
  image_url text
);

-- 5. FINANCES (Shared History & Trip Expenses)
create table finances (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  trip_id uuid references trips(id), -- optional, can be null for general expenses
  amount decimal(12,2) not null,
  category text not null,
  description text,
  payer_id text not null -- who paid
);

-- 6. TASKS (Shared Life Goals & To-Dos)
create table tasks (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  title text not null,
  description text,
  is_completed boolean default false,
  due_date timestamp with time zone,
  category text -- 'life', 'work', 'dream'
);

-- 7. TIMETABLE (Weekly Routine)
create table timetable (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  day text not null, -- 'Mon', 'Tue', etc.
  time text not null, -- '09:00 AM'
  activity text not null,
  user_id text not null
);

-- 8. PROFILES (User Avatars & Metadata)
create table profiles (
  id uuid default gen_random_uuid() primary key,
  username text unique not null,
  avatar_url text,
  updated_at timestamp with time zone default now(),
  push_token text
);

-- 9. MEETINGS (Next Meet Settings)
create table meetings (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default now(),
  type text not null, -- 'date', 'recurring'
  date date, -- for type='date'
  recurring_type text, -- 'weekend', 'biweekly', 'monthly', etc.
  occasion_name text,
  user_id text not null
);

-- ENABLE REALTIME FOR ALL
alter publication supabase_realtime add table posts, moments, trips, places, finances, tasks, timetable, profiles, meetings;
```
