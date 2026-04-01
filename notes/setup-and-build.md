# Supabase Setup Guide for TAMTAM

To sync data between your and your girlfriend's phone, follow these steps to set up a free Supabase project.

## 1. Create a Project
- Go to [supabase.com](https://supabase.com) and create a free account.
- Create a new project named **TAMTAM**.
- Copy your **Project URL** and **Anon Key** from the project settings (API section).

## 2. Update the Code
- Open `lib/supabase.ts` in your project.
- Replace `YOUR_SUPABASE_URL` and `YOUR_SUPABASE_ANON_KEY` with your actual credentials.

## 3. Create the 'posts' Table
- Go to the **SQL Editor** in the Supabase dashboard.
- Paste and run the following SQL command to create the necessary table:

```sql
create table posts (
  id uuid default gen_random_uuid() primary key,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  type text not null, -- 'text', 'image', or 'draw'
  content text not null,
  user_id text not null
);

-- Enable Real-time for this table
alter publication supabase_realtime add table posts;
```

## 4. Setup Storage (For Images)
- Go to **Storage** in Supabase.
- Create a new bucket named **journal-assets**.
- Make the bucket **Public**.
- (Optional) Set up RLS policies to allow anyone with an anon key to upload/download.

---

# Build Guide for Punjab (Brother's Mac)

To create the Development IPA for the iPhone, your brother should follow these steps:

## 1. Prerequisites
- Install **Node.js** and **Watchman**.
- Install **Xcode** from the App Store.
- Open Xcode and go to `Settings > Platforms` to ensure **iOS SDK** is installed.

## 2. Setup Project
- Clone or copy the **TAMTAM** folder to the Mac.
- Run `npm install` in the terminal.

## 3. Build for iOS
- Run `npx expo prebuild` to generate the `ios` folder.
- Open `ios/tamtam.xcworkspace` in Xcode.
- Select **TAMTAM** in the sidebar, go to **Signing & Capabilities**, and select a **Development Team**.
- Set the **Bundle Identifier** to `com.pratishth.ourlink`.

## 4. Archive & Export
- In Xcode, select **Product > Archive**.
- Once the archive is finished, the Organizer window will open.
- Click **Distribute App**.
- Select **Development** or **Ad Hoc**.
- Follow the prompts to export the `.ipa` file.
- Send the `.ipa` file to you!
