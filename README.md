<img src="public/logo-banner.png" alt="Release Tools banner" width="100%">

# App Store Release Tools

[English](README.md) | [Русский](README.ru.md)

Prepare App Store “What's New” text by copying published release notes or pasting a translation table. Compare the source with the existing draft before saving.

## Setup

Requires Node.js 22+, access to your app, an App Store Connect API key, and an existing **Prepare for Submission** draft.

1. In [App Store Connect](https://appstoreconnect.apple.com/), open your profile → **Individual API Key** and generate a key, or use an existing one. Save the **Key ID**.
2. Keep the downloaded `.p8` file outside the repository. Apple only allows one download.
3. Copy `asc-config.example.json` to `.asc-config.json` and enter the Key ID and key file path. For a team key, also provide `issuerId`.

On Windows, use `/` in paths, for example `C:/Users/User/Downloads/AuthKey_KEY_ID.p8`. Keep configuration and keys private; they are ignored by Git. No dependency installation is required.

## Run

Choose one of three launch methods from the project folder:

- **Double-click:** run `Start.command` on macOS or `Start.bat` on Windows. The web interface opens in your browser; if it does not, use the address printed in the terminal. Close the terminal to stop.
- **Web from a terminal:** run `npm run web`. Stop with `Ctrl+C`.
- **Terminal interface:** run `npm start` in an interactive terminal. Choose the app, platform, and source, review the comparison, then confirm saving. End pasted tables with a dot on its own line.

The interface defaults to English. Use **EN / RU** in the web interface or run `npm start -- --lang ru` / `npm start -- --lang en`. The choice is shared by the web and terminal interfaces and saved locally in `.release-tools-preferences.json`, which is ignored by Git. Interface language does not change the app's release-note localizations.

## Compare and save

Choose a published version or a translation table as the source. The comparison shows each locale's current draft text and proposed replacement. Only confirm after checking the app, platform, draft version, source, and languages.

- A published source is required only when copying from a version. For iOS and macOS, the tool tries to identify the current version using the US App Store. Choose a version manually if it cannot identify one; another published version can also be selected.
- Only “What's New” in existing draft localizations changes. The tool does not create a draft or localization, select a build, or submit an app for review.
- Locales without source text are skipped. Existing draft text is replaced only after confirmation. If the draft or source changes after comparison, prepare a fresh comparison.
- Writes can partially succeed. Check updated and failed locales, then compare again before retrying; do not assume all changes were saved.

The web server listens on `127.0.0.1`. It uses your local configuration to call Apple services; API credentials are not entered in the browser. Operation summaries appear in the terminal.

## Translation tables

Paste Markdown or spreadsheet data with languages in rows or columns. The web **Copy prompt** button and the terminal table flow provide a prompt containing the selected draft's languages. Edit its change description and use it with your preferred translation tool; this app does not generate translations itself.

Use the exact language names from the prompt, or locale codes. Unknown or ambiguous names must be corrected before comparison; restart the terminal flow to retry. Recognized languages absent from the draft are shown as skipped; draft languages omitted from the table stay unchanged. Review translations for accuracy and do not add unverified changes.

## AI agents and contributions

Open this project in Codex and ask it to prepare “What's New”; the project skill is discovered in a new session. Other agents can follow [the shared skill](.agents/skills/app-store-release/SKILL.md); Claude has an entry point in `.claude/skills/app-store-release/SKILL.md`.

Run `npm test` for the local test suite. See [Contributing](CONTRIBUTING.md), [Security](SECURITY.md), [Code of Conduct](CODE_OF_CONDUCT.md), and [Accessibility](ACCESSIBILITY.md). Do not include credentials, private app data, or raw logs in reports.

## License

[MIT](LICENSE).
