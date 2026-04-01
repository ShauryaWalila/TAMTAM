# TAMTAM Project Overview

TAMTAM is a private, shared space for couples to stay connected through creative tools, shared routines, and documented memories.

---

## 📱 Current Screen Directory

### 1. Dashboard (The "Us" Screen) - `app/(tabs)/index.tsx`
*   **Emotional Hub**: Displays a dynamic greeting and a Lottie-animated heart.
*   **Next Meet Countdown**: A real-time timer that switches from "Days" to a live "HH:MM:SS" countdown when less than 24 hours remain. Supports specific dates, weekly, and monthly schedules.
*   **Message of the Moment**: A prominent card displaying a custom message set by the partner.
*   **Shared Stats**: Quick-view counters for days together and total messages shared.
*   **Our Routine**: A horizontally scrollable weekly timetable allowing the couple to set time-blocked activities for every day of the week.

### 2. Shared Journal - `app/(tabs)/journal.tsx`
*   **Memory Feed**: An infinite-scrolling list of text and image posts.
*   **Lottie Reactions**: Interactive, high-quality animations (Heart, Fire, Star, etc.) that can be applied to any post via long-press.
*   **Lazy Loading**: Optimized to load 10 memories at a time to maintain performance.
*   **Syncing**: Real-time updates via Supabase and "Seen" indicators for both partners.

### 3. Shared Canvas - `app/(tabs)/draw.tsx`
*   **Precision Drawing**: Vector-based drawing engine using React Native Skia.
*   **Vector Zoom & Pan**: Allows actual zooming into the canvas (not just the image) with 100% sharpness and precise touch mapping.
*   **Advanced Color Picker**: A custom modal featuring a smooth Hue Slider and a quick-select palette.
*   **History Gallery**: A card-based gallery of previous drawings with a full-screen high-detail viewer.

### 4. Settings & Account - `app/(tabs)/settings.tsx`
*   **Central Navigation**: Shortcuts to the MOTM and Next Meet setup screens.
*   **Profile Management**: View and edit personal information.
*   **System Controls**: Notification toggles and Logout functionality.

### 5. Message of the Moment Setup - `app/(tabs)/motm.tsx`
*   **Quick Updates**: A dedicated interface to update the text that appears on the partner's home screen.
*   **History Integration**: Overwrites previous messages to keep the dashboard focused on the "Now."

### 6. Next Meet Setup - `app/(tabs)/next-meet.tsx`
*   **Flexible Scheduling**: Choose between Specific Date, Weekly (Day of week), or Monthly (Day of month).
*   **Unified Picker**: Custom-built scrollable wheels for selecting Date and Time.
*   **Smart Validation**: Ensures end-times are always after start-times.

---

## 🚀 Future Implementation: iOS Transaction Parser

Since iOS prohibits apps from reading SMS directly, we will implement **Option 1: The Apple Shortcuts Route**.

### Phase 1: Deep Link Integration
*   We need to configure `expo-linking` to handle a custom URL scheme (e.g., `tamtam://transaction`).
*   The app must be able to parse parameters from this URL (e.g., `tamtam://transaction?body=MessageText`).

### Phase 2: Regex Parsing Engine
*   Create a utility within the app that takes the raw SMS body and extracts:
    *   **Amount** (e.g., `(?i)(?:Rs|INR|USD)\.?\s?([0-9,]+(?:\.[0-9]+)?)`)
    *   **Type** (Debit vs Credit)
    *   **Merchant/Source** (e.g., `(?i)at\s([^,]+)`)
    *   **Account/Bank Name**

### Phase 3: The Shortcut Automation (User Setup)
*   User creates a "Personal Automation" in the iOS Shortcuts App.
*   **Trigger**: "When I receive a message from [Bank]" or "Contains [Debited/Credited]".
*   **Action**: "Open URL" -> `tamtam://transaction?body=[Shortcut Input]`.
*   **Result**: Every time a transaction SMS arrives, the user taps the notification, and TAMTAM instantly logs the expense/income into a shared finance tracker.

### Phase 4: Shared Finance Screen
*   A new tab or section to view these auto-logged transactions.
*   Charts for monthly spending and shared budget tracking.
