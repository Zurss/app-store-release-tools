---
name: app-store-release
description: Fill or compare App Store Connect draft release notes using this project's CLI, from a published version or a translation table.
---

# App Store release notes

Run the existing CLI from the repository root with `npm start` in an interactive terminal (TTY). It requires Node.js 22+, a configured `.asc-config.json`, a local key, and access to the app. Reply in the user's language. The interface defaults to English; use `npm start -- --lang ru` or `npm start -- --lang en` when appropriate. This choice is saved locally and shared with the web interface.

Never directly open, read, or print `.asc-config.json` or key files, or ask the user to paste them into chat. The utility may read these files itself when running. Paraphrase configuration read errors instead of quoting them: they may contain file fragments.

1. Find the requested app in the utility's current list. If its name is ambiguous, clarify using the bundle ID. Choose the requested platform. Do not reuse menu numbers from an earlier run.
2. Choose the user's source: a published version or a translation table. For the current published version, use the entry identified as current by the utility. If it cannot identify one, ask the user for the source version rather than guessing. Honor an explicitly selected older version.
3. For a table, use the provided translations or prepare them from the user's change description and the draft languages shown in the CLI prompt. Paste the table, ending with a dot on its own line. Preserve meaning and add no unverified changes.
4. Review the app, platform, source, draft version, locales, and comparison. If the plan exceeds the user's request or is unclear, cancel saving and clarify. For a comparison-only request, cancel saving.
5. If the user requested filling or saving and the plan matches that request, confirm saving in the CLI. Report actual updates, skips, and errors. On partial failure, name the failed locales and do not claim that everything was saved. Compare again before retrying.

The utility changes only “What's New” in existing draft localizations. It does not create a draft or localizations, select a build, or submit an app for review. If the draft is missing or setup is unavailable, report the blocker; do not bypass it with another API request.
