# Logseq Google Tasks

A Google Tasks integration for Logseq with 2-way synchronization, background automation, and native UI integration.

This plugin is a fork of [logseq-google-tasks](https://github.com/weynhamz/logseq-google-tasks) created by **[weynhamz](https://github.com/weynhamz)**. I couldn't get it working out of the box, so I figured I'd give it a go myself. I've added a few features that I wanted like background sync and automatic token renewal, and resolved some of the crashes I was experiencing. 

![Google Tasks Blocks](https://discuss.logseq.com/uploads/default/original/3X/5/4/54980ce488f154d7219d4c68ae5b7a920384aed3.png)

## Key Improvements

### 1. 2-Way Sync
- **Full Marker Support:** Kind of supports all Logseq marker cycles (`TODO`, `DOING`, `NOW`, `LATER`, `WAITING`, `DONE`, `CANCELLED`).
- **Upward Sync:** Native Logseq TODOs are automatically pushed to a dedicated Google Task list (default: "Logseq Tasks").
- **Delta Sync Logic:** Optimized synchronization that respects both local and remote changes accurately.

### 2. Minimal UI
- **One-Click Sync:** Clicking the toolbar icon triggers an immediate background sync. No clunky dialog boxes or popups.
- **Progress Tracking:** High-visibility ASCII progress bars (`[██████░░░░] 60%`) via Logseq's native toast notification system.
- **Command Palette:** Registration of native commands for "Synchronize Now" and "Open Settings".

### 3. Background Automation
- **Auto-Sync Daemon:** Configurable background synchronization intervals (e.g., every 15 minutes).
- **Silent Auth Renewal:** Background token refreshing is handled quietly without intrusive warning messages or user intervention.

## Setup

### Prerequisites 

#### NixOS / Linux
This project is built using **Nix** for a reproducible environment.
1. Enter the development shell: `nix develop`
2. Install dependencies: `pnpm install`
3. Build the plugin: `pnpm build`

#### Other (probably)
1. Install pnpm
2. Install dependencies: `pnpm install`
3. Build the plugin: `pnpm build`
 
### Google OAuth Configuration (one-time only)
1. Follow the [Google Tasks Quickstart](https://developers.google.com/tasks/quickstart/nodejs) to obtain your `client_id` and `client_secret`.
2. Save your secrets at `secrets/credentials.json` and run the manual token helper: `nix develop -c node get_token.js`
3. Paste the generated `refresh_token` into the plugin settings in Logseq.

## Usage
- **Toolbar:** Click the Google Tasks icon to sync immediately.
- **Command Palette:** `Cmd + Shift + P` -> `Google Tasks: Synchronize Now`. `Cmd + Shift + P` -> `Google Tasks: Open Settings` to open the settings page.
- **Background:** Enable "Enable Automatic Background Sync" in settings for a hands-off experience. Interval is configurable in preferences.
- **Bidirectional Sync:** Changes in Logseq are pushed to Google Tasks, and changes in Google Tasks are pulled into Logseq. I liked differentiating between tasks originating from Logseq and Google Tasks, so I add a "Logseq Tasks" list in Google Tasks to store tasks originating from Logseq. Name is configurable in preferences, or you can set it to `@default` to use the default list name.
