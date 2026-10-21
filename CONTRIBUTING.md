# Contributing to TunL

Thank you for wanting to help. TunL is a small project: a short issue first saves everyone time before a large
pull request.

## Report a bug, ask for a feature

Open an issue on [GitHub](https://github.com/Fleorens/TunL/issues) with:
- what you did, what you expected, what happened;
- your distribution, desktop (Plasma, GNOME…) and session (Wayland or X11), and the TunL version (Settings › About);
- the relevant lines of the log (Settings › About › Logs folder). TunL never writes a secret there, but read it
  before you paste it: it names your hosts and users.

## Report a security issue

**Not in a public issue.** Use [a private security advisory](https://github.com/Fleorens/TunL/security/advisories/new)
on GitHub. Say what an attacker can do, and how to reproduce it. You will get an answer within a week. What TunL
protects, and how: [`docs/06-securite.md`](docs/06-securite.md) (in French).

## Change the code

1. Set up the tools: [`docs/07-dev.md`](docs/07-dev.md) §1 (Node.js, Rust, WebKitGTK, podman for the SSH tests).
2. `npm install`, then `npm run review` once: it must be green before you change anything.
3. Make your change, with its tests. The rules the code follows are in [`AGENTS.md`](AGENTS.md) (in French), and
   `npm run rules` checks most of them. In short:
   - no hard-coded interface text: `t("domain.key")`, with the key in `src/i18n/locales/en.json` **and** `fr.json`;
   - `invoke()` only in `src/lib/ipc.ts`, and every command answered by the browser mock (`src/lib/ipc-mock.ts`);
   - shared types come from Rust through `npm run bindings` (`src/bindings/` is generated: never edit it);
   - Rust commands return `Result<T, AppError>`, without `unwrap()` outside tests;
   - no secret in a file, a log, an error message or a process argument (`docs/06-securite.md`).
4. `npm run format`, then `npm run review` again: the CI runs the same.
5. One commit per change, in English: `<type>: <summary>` with `<type>` among `feat`, `fix`, `refactor`, `docs`,
   `test`, `chore`, `perf`, `ci`.

`npm run dev` shows the interface in a browser on demo data, without compiling the Rust part; `npm run tauri dev`
runs the real app.

## Translations

The interface is in English (`src/i18n/locales/en.json`) and French (`fr.json`). A new language is a new file with
the same keys (a test checks that every file has them all), an entry in `SUPPORTED_LANGUAGES`
(`src/i18n/index.ts`), and a value of the `Language` setting (`src-tauri/src/model/settings.rs`, then
`npm run bindings`). Open an issue first: we will do the code part with you.

## License

By contributing, you agree that your contribution is distributed under the
[GNU General Public License v3.0 or later](LICENSE), like the rest of TunL.
