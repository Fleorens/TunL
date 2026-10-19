# TunL

A modern SSH, SFTP and RDP connection manager for Linux, built with Tauri 2, React 19 and Rust.
**Work in progress**: this README is for development. The public README comes with the first release.

## Where it stands

| Works today | Not yet |
|---|---|
| Connections: create, edit, duplicate, delete, favorites, groups, filter | SFTP and RDP sessions (the menus say "Coming soon") |
| Home screen: greeting, quick-connect field, favorites grid, recents list, first-launch welcome (T14) | |
| Editor: SSH / RDP, authentication method, jump host chain, Wake-on-LAN, RDP display options | |
| `~/.ssh/config` import: preview, select hosts, choose a group, apply (T15, T15b) | |
| Command palette (Ctrl+Shift+P / Ctrl+K): search connections, quick connect, toggle theme, keyboard shortcuts (F1) | |
| Secrets: passwords and SSH key passphrases in the system keyring, saved/replaced/forgotten in the connection editor (T12) | |
| Storage: `~/.config/io.github.fleorens.TunL/connections.json` (mode 0600, `.bak` copy) | |
| SSH sessions in tabs: terminal, connecting steps, error card with Retry, end banner with Reconnect, through a chain of jump hosts (T21, T22) | |
| Connection prompts: host key, password/passphrase (keyring), 2FA, changed host key (T21b) | |
| Availability dots: TCP probes, sidebar and home, latency in the status bar (T30) | |

The progress of each task is in [`tasks/README.md`](tasks/README.md).

## Try it

Prerequisites: Node.js ≥ 22.12, Rust (rustup, with `rustfmt` and `clippy`), WebKitGTK 4.1 and OpenSSL headers.
Details and per-distribution packages: [`docs/07-dev.md`](docs/07-dev.md) §1.

```bash
npm install
npm run tauri dev   # the real app, with the Rust backend (first build: a few minutes)
npm run dev         # the interface only, in a browser at http://localhost:1420, on demo data
```

`npm run dev` answers every backend call with an in-memory mock (the status bar says “Mock backend”): handy to look
at the interface, but only `npm run tauri dev` proves that the app works.

To start from an empty store again: quit TunL, then remove `~/.config/io.github.fleorens.TunL/connections.json`.

## Check everything

```bash
npm run review
```

It runs, in order: TypeScript, Biome, the project rules (`scripts/project-rules.mjs`) and the contract tests of every
delivered task, Vitest, `cargo fmt` / `clippy` / `test` (including every Tauri command driven through the real IPC
layer), then the Playwright end-to-end scenarios in the system Chromium. From task T17b on, it also starts three
disposable SSH servers with podman (`npm run test-env:up`) and runs the SSH integration tests against them
(`npm run test:ssh`). Every script: [`docs/07-dev.md`](docs/07-dev.md) §2.

## Layout

| Path | Content |
|---|---|
| `src/` | React interface: `features/` by domain, `components/`, `lib/` (IPC, mock, errors), `bindings/` (generated from Rust) |
| `src-tauri/` | Rust backend: `commands/` (Tauri commands), `model/`, `store/` |
| `e2e/` | Playwright scenarios; `support/` holds the console guard and the generic UI checks |
| `docs/` | Architecture, decisions, design system, screens, data model, security, dev environment (in French) |
| `tasks/` | One sheet per task, written in lots |
| `scripts/` | `contract-tests.mjs`, `project-rules.mjs` |

## How it is built

The code is written task by task by a local model (opencode), from contract sheets in `tasks/`: types, expected
behaviour, pitfalls and tests. Its standing rules are in [`AGENTS.md`](AGENTS.md). An orchestrator (Claude) writes
the architecture and the sheets, then reviews each lot.

## License

GPL-3.0-or-later.
