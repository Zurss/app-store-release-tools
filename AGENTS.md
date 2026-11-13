# Working in this project

- Reply in the user's language.
- To fill or check App Store “What's New”, use `.agents/skills/app-store-release/SKILL.md`.
- Never directly open, read, or print `.asc-config.json` or key files, and never add them to Git. The utility may read them itself when running. Do not request credentials in chat.
- Setup, launch, and test commands are in `README.md`; the Russian version is `README.ru.md`.
- Keep English and Russian interface text and README instructions consistent. The default interface language is English; web and CLI share the local `.release-tools-preferences.json` preference.
- Do not use real credentials or Apple API calls for tests. Use the existing local fixtures and run `npm test`.
