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

## Phase 5: AI "Study Buddy" Integration (Future)
- **Objective:** Leverage LLMs to accelerate learning.
- **Features:**
  - Auto-generation of flashcards from lecture notes.
  - Socratic Tutor mode for interactive recall.
  - Mnemonic generation for complex medical lists.

## Execution Strategy
We will execute this plan sequentially, starting with Phase 1 (Database) and Phase 2 (Flashcards). I will provide the exact Supabase SQL scripts and then build the React Native components step-by-step.
