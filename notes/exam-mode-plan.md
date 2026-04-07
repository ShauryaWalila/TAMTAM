# Exam Mode Plan: The Ultimate MBBS Study Hub

## Overview

A comprehensive, long-term study application built within TAMTAM, specifically designed for an MBBS student. It features Spaced Repetition System (SRS) flashcards, an infinite whiteboard with a unique "Glass Layer" revise mode, and deep focus productivity tools.

## Phase 1: Database Architecture (Supabase)

- **Objective:** Design and implement the backend tables required for Flashcards (Decks, Cards, Reviews), Whiteboards, and Focus Sessions.
- **Action for User:** Execute provided SQL scripts in the Supabase SQL Editor.
- **Tables:**
  - `study_decks`: Categories/Subjects (e.g., Anatomy, Pharmacology).
  - `study_cards`: The actual flashcards (Front, Back, Image URLs).
  - `card_reviews`: SRS tracking (Next review date, ease factor, interval).
  - `whiteboards`: Saved infinite canvas states.
  - `focus_sessions`: Pomodoro and study tracking.

## Phase 2: The "Anki-Killer" Flashcard System (SRS)

- **Objective:** Build the UI and logic for creating, viewing, and reviewing flashcards based on spaced repetition.
- **Features:**
  - Deck creation and management.
  - Two-sided card UI with rich text/image support.
  - SRS Algorithm (SuperMemo-2 or similar) to calculate `next_review` dates based on Hard/Good/Easy ratings.
  - "Due Today" dashboard.

## Phase 3: The "Infinite Med-Board" (Advanced Whiteboard)

- **Objective:** Implement a robust, iPad-optimized infinite canvas.
- **Features:**
  - Integration of a powerful canvas engine (e.g., WebView with TLDraw/Excalidraw or a native Skia-based canvas).
  - Save/Load board state from Supabase.
  - **Revise Mode (The Glass Layer):** A read-only mode overlay where temporary drawings/highlights can be made and discarded upon exit, leaving the original board intact.

## Phase 4: Med-Specific Productivity & Gamification

- **Objective:** Add tools to maintain long-term focus and track progress over the 4.5 years of MBBS.
- **Features:**
  - Shared Focus / Pomodoro Timer (Synced with partner).
  - Exam Countdown Widget.
  - Consistency Heatmap (Study streak tracking).
  - "Brain Dump" quick-capture inbox.

- ### Phase 4 plan
  -Part 1: The "Unstoppable" Whiteboard (SQLite + Sync)
  -Right now, your Med-Board saves directly to the cloud (Supabase). if your internet blinks, the save fails.
  -The Solution:
  - 1. Save Local First: I will modify the Med-Board to save your drawings into the phone's built-in SQLite database
  - (study_whiteboards table) first. This takes 0.001 seconds and works even in a basement with no signal.
  - 2. Background Sync: As soon as you save locally, the app will add a "ticket" to the sync_queue.
  - 3. Silent Upload: Your existing syncEngine will see that ticket and upload your drawing to Supabase automatically
  - when the internet is ready. You won't even notice it happening.
- -Part 2: The Exam Countdown (MBBS Motivation)
  -We will add a specialized widget to the Study Hub dashboard.
  - - How: We'll create a new table called study_exams.
  - - The UI: A card that says: "Next Prof: Anatomy & Physio in 42 Days." It will have a progress bar showing how much of
  - the "Prep Time" is left.
- -Part 3: Consistency Heatmap (The Habit Builder)
  -We will build a visual grid of 365 squares on your dashboard.
  - - The Logic: Every day you finish a Focus Session or review your Flashcards, that day’s square turns green.
  - - The Goal: Seeing a "Streak" of green squares is the best way to stay motivated through the long MBBS years.
  - -Part 4: Brain Dump Inbox
  - - The UI: A floating "+" button on the Study Hub dashboard.
  - - The Flow: You have a quick thought → Tap button → Type "Remember the 12 Cranial Nerves mnemonic" → Save.
  - - The Result: It goes into an "Inbox" list where you can later turn it into a full Flashcard or a drawing.

## Phase 5: AI "Study Buddy" Integration (Future)

- **Objective:** Leverage LLMs to accelerate learning.
- **Features:**
  - Auto-generation of flashcards from lecture notes.
  - Socratic Tutor mode for interactive recall.
  - Mnemonic generation for complex medical lists.

## Execution Strategy

We will execute this plan sequentially, starting with Phase 1 (Database) and Phase 2 (Flashcards). I will provide the exact Supabase SQL scripts and then build the React Native components step-by-step.
