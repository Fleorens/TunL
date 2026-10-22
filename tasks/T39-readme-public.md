# T39 — README public, CONTRIBUTING, LICENSE, CHANGELOG

| | |
|---|---|
| **Jalon** | M8 — Distribution |
| **Dépend de** | T37 |
| **Lire avant** | `docs/02-decisions.md` D01 (la variable pour NVIDIA), D14, D15 |
| **Livrable** | `README.md` réécrit pour le public ; `CONTRIBUTING.md`, `CHANGELOG.md`, `LICENSE` ; 1 fichier de tests |

## Pourquoi

Le `README.md` dit encore « Work in progress: this README is for development ». Avant la première publication
(T37 produit les paquets), le dépôt doit parler à quelqu'un qui découvre TunL : ce que c'est, comment l'installer,
quoi faire si la fenêtre reste blanche, comment contribuer, sous quelle licence (D15 : le fichier `LICENSE` était
prévu ici).

Les textes ont été écrits par l'orchestrateur sur le prototype : cette fiche les met en place. Le seul morceau qui
n'est pas fourni mot pour mot est le tableau « Where it stands », que les fiches précédentes ont rempli : il est
**gardé tel quel**.

## À réutiliser (ne pas réécrire)

- Le tableau « Where it stands » du `README.md` actuel (titre `## Where it stands`, en-tête `| Works today | Not yet |`
  et toutes ses lignes) : `AGENTS.md` demande aux fiches d'y ajouter leur ligne, il doit survivre.
- Les captures `docs/screenshots/home.png` et `terminal.png` (T36), l'icône `branding/app-icon.svg`.

## Contrat

### `LICENSE`

Le texte officiel de la GPL v3, sans le modifier :

```bash
curl -fsSL -o LICENSE https://www.gnu.org/licenses/gpl-3.0.txt
sha256sum LICENSE   # 3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986
```

Une autre empreinte : ne garde pas le fichier, arrête-toi et signale-le.

### `README.md` (remplace tout le fichier)

Recopie ce texte, en mettant à la place de la ligne `TABLE — …` le tableau « Where it stands » actuel :

````markdown
<p align="center"><img src="branding/app-icon.svg" width="96" height="96" alt=""></p>

<h1 align="center">TunL</h1>

<p align="center">SSH, SFTP and RDP connections for Linux — one window, keyboard first, secrets in your keyring.</p>

![TunL: the home screen, with favorites, recent connections and quick connect](docs/screenshots/home.png)

## Features

- **SSH terminal in tabs** (xterm.js): password, private key with passphrase, SSH agent, keyboard-interactive
  (two-factor). Search, links, copy and paste, zoom.
- **Host keys checked** like OpenSSH (`~/.ssh/known_hosts` is read, never changed): a first connection shows the
  fingerprint, a changed key is refused with an explanation.
- **Jump hosts**: chain up to four saved SSH connections; SSH, SFTP and RDP all go through them.
- **SFTP explorer**: browse, create, rename, delete, permissions, downloads and uploads with progress, drag and drop
  from the desktop.
- **RDP** through FreeRDP 3 in its own window, with the credentials passed on its standard input, never on its
  command line; behind a jump host too.
- **Wake-on-LAN**, before connecting or on demand, and **reachability dots** for every connection.
- **Organisation**: groups, tags, favorites, recents, instant filter, command palette (`Ctrl+Shift+P`), quick
  connect (`user@host:port`), import of `~/.ssh/config`, export and import of your connections as a JSON file.
- **Private**: passwords and passphrases live in the system keyring (Secret Service: KWallet, GNOME Keyring…). No
  account, no telemetry, no update check: TunL only connects where you ask it to.
- English and French; light, dark or system theme; reduced motion.

![An SSH session in a tab](docs/screenshots/terminal.png)

## Install

Packages for each release are on the [releases page](https://github.com/Fleorens/TunL/releases): a `.deb` (Debian 13,
Ubuntu 24.04 and later), an `.rpm` (Fedora) and an AppImage (any recent distribution). Check them against
`SHA256SUMS`, published beside them.

```bash
sudo apt install ./tunl_*_amd64.deb      # Debian, Ubuntu
sudo dnf install ./tunl-*.x86_64.rpm     # Fedora
chmod +x tunl_*_amd64.AppImage && ./tunl_*_amd64.AppImage
```

What TunL relies on, beside the package's own dependencies (WebKitGTK 4.1):
- a **Secret Service** keyring (KWallet on Plasma, GNOME Keyring elsewhere) to remember passwords;
- **FreeRDP 3** for RDP: `freerdp3-sdl` (Debian, Ubuntu), `freerdp` (Fedora, Arch). TunL tells you when it is
  missing, with the command for your distribution.

## Troubleshooting

- **A blank or white window** (some NVIDIA drivers): start TunL with `WEBKIT_DISABLE_DMABUF_RENDERER=1 tunl`.
- **Passwords are asked every time**: no Secret Service keyring is running; TunL still works, but cannot remember.
- **Where are my files?** `~/.config/io.github.fleorens.TunL/` (connections, settings, TunL's own `known_hosts`),
  `~/.local/share/io.github.fleorens.TunL/logs/` (logs, never a secret). Settings › About opens both.

## Where it stands

TABLE — le tableau « Where it stands » du README actuel, recopié tel quel (titre, en-tête et toutes ses lignes).

## Build from source

Prerequisites: Node.js ≥ 22.12, Rust (rustup, with `rustfmt` and `clippy`), WebKitGTK 4.1 and OpenSSL headers.
Details and per-distribution packages: [`docs/07-dev.md`](docs/07-dev.md) §1.

```bash
npm install
npm run tauri dev     # the real app, with the Rust backend (first build: a few minutes)
npm run dev           # the interface only, in a browser at http://localhost:1420, on demo data
npm run tauri build   # the .deb, .rpm and AppImage packages, in src-tauri/target/release/bundle/
```

`npm run dev` answers every backend call with an in-memory mock (the status bar says “Mock backend”): handy to look
at the interface, but only `npm run tauri dev` proves that the app works.

### Check everything

```bash
npm run review
```

It runs, in order: TypeScript, Biome, the project rules (`scripts/project-rules.mjs`) and the contract tests of every
delivered task, Vitest, `cargo fmt` / `clippy` / `test` (including every Tauri command driven through the real IPC
layer), three disposable SSH servers with podman and the SSH integration tests against them, then the Playwright
end-to-end scenarios. The CI runs the same on every pull request. Every script: [`docs/07-dev.md`](docs/07-dev.md).

### Layout

| Path | Content |
|---|---|
| `src/` | React interface: `features/` by domain, `components/`, `lib/` (IPC, mock, errors), `bindings/` (generated from Rust) |
| `src-tauri/` | Rust backend: `commands/` (Tauri commands), `ssh/`, `sftp/`, `rdp/`, `store/`, `model/` |
| `e2e/` | Playwright scenarios; `support/` holds the console guard and the generic UI checks |
| `docs/` | Architecture, decisions, design system, screens, data model, security, dev environment (in French) |
| `tasks/` | One sheet per task, written in lots ([`tasks/README.md`](tasks/README.md): the plan and its progress) |
| `packaging/`, `branding/` | Desktop entry, AppStream metadata, the app icon |
| `scripts/` | Project rules, contract tests, test servers, screenshots, packaging checks |

## How it is built

The code is written task by task by a local model (opencode), from contract sheets in `tasks/`: types, expected
behaviour, pitfalls and tests. Its standing rules are in [`AGENTS.md`](AGENTS.md). An orchestrator (Claude) writes
the architecture and the sheets, then reviews each lot.

## Contributing

Bug reports, ideas and pull requests are welcome: see [`CONTRIBUTING.md`](CONTRIBUTING.md). Security issues: please
report them privately (see the same file). Changes between versions: [`CHANGELOG.md`](CHANGELOG.md).

## License

TunL is free software, under the [GNU General Public License v3.0 or later](LICENSE).
````

### `CONTRIBUTING.md` (nouveau, à recopier tel quel)

````markdown
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
````

### `CHANGELOG.md` (nouveau, à recopier tel quel)

````markdown
# Changelog

Every notable change of TunL, newest first. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — first preview

### Added

- Connections: create, edit, duplicate, delete; groups, tags, favorites, recents, instant filter.
- SSH sessions in tabs: password, private key and passphrase, SSH agent, keyboard-interactive (two-factor).
- Host keys checked against TunL's own `known_hosts` and `~/.ssh/known_hosts` (read only); a changed key is refused.
- Jump hosts: a chain of up to four saved SSH connections, for SSH, SFTP and RDP.
- SFTP explorer: browse, new folder, rename, delete, permissions, downloads and uploads, drag and drop.
- RDP through FreeRDP 3, credentials on its standard input; through a jump host with a stable tunnel port, so that
  FreeRDP checks the server's certificate.
- Wake-on-LAN, and reachability dots (one TCP connection per address, nothing sent).
- Passwords and passphrases in the system keyring.
- Command palette, quick connect, keyboard shortcuts (F1), arrow keys in lists.
- Import of `~/.ssh/config`; export and import of the connections as a JSON file (without secrets).
- Settings: appearance, terminal, SSH defaults and known hosts, SFTP download folder, RDP client, reachability.
- English and French; light, dark and system themes; reduced motion.
- Packages: `.deb`, `.rpm`, AppImage, with a desktop entry and AppStream metadata.

[Unreleased]: https://github.com/Fleorens/TunL/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Fleorens/TunL/releases/tag/v0.1.0
````

## Pièges (vus au prototype)

- Le README est en anglais (public), comme le code ; `docs/` reste en français, et le README le dit.
- `src/docs.test.ts` vérifie que **chaque lien local** du README et de CONTRIBUTING mène à un fichier du dépôt :
  un fichier déplacé ou mal orthographié fait échouer la recette.
- Le README ne parle pas encore de Flatpak : T38 ajoutera sa ligne d'installation.
- `LICENSE` n'a pas d'extension : Vite le lit quand même avec `?raw`.

## Tests du contrat

### `src/docs.test.ts` (nouveau)

```ts
// T39: the public documents exist, link to each other, and agree with the app (licence, version).
import { describe, expect, test } from "vitest";
import changelog from "../CHANGELOG.md?raw";
import contributing from "../CONTRIBUTING.md?raw";
import license from "../LICENSE?raw";
import pkg from "../package.json";
import readme from "../README.md?raw";

/** Files of the repository the documents may link to, by their path from its root. */
const files = new Set(
  Object.keys(
    import.meta.glob([
      "../*.md",
      "../LICENSE",
      "../docs/**/*.md",
      "../tasks/README.md",
      "../docs/screenshots/*.png",
      "../branding/*.svg",
    ]),
  ).map((path) => path.replace(/^\.\.\//, "")),
);

/** The relative links of a Markdown text (`[text](path)` and `src="path"`), anchors and URLs aside. */
function localLinks(markdown: string): string[] {
  const links = [...markdown.matchAll(/\]\(([^)\s]+)\)|src="([^"]+)"/g)].map(
    (m) => m[1] ?? m[2] ?? "",
  );
  return links
    .filter((link) => !/^(https?:|mailto:|#)/.test(link))
    .map((link) => link.split("#")[0] ?? "");
}

describe("LICENSE", () => {
  test("is the GNU GPL v3 text, as D15 and the manifests say", () => {
    expect(license.startsWith("                    GNU GENERAL PUBLIC LICENSE\n")).toBe(true);
    expect(license).toContain("Version 3, 29 June 2007");
    expect(license).toContain("END OF TERMS AND CONDITIONS");
    expect(pkg.license).toBe("GPL-3.0-or-later");
  });
});

describe("README", () => {
  test("every local link and image points to a file of the repository", () => {
    const links = localLinks(readme);
    expect(links.length).toBeGreaterThan(5);
    for (const link of links) {
      expect(files.has(link), link).toBe(true);
    }
  });

  test("says how to install, what TunL needs, and what to do with a blank window", () => {
    for (const text of ["## Install", "## Troubleshooting", "## Build from source", "## License"]) {
      expect(readme).toContain(text);
    }
    expect(readme).toContain("WEBKIT_DISABLE_DMABUF_RENDERER=1");
    expect(readme).toContain("FreeRDP 3");
    expect(readme).toContain("SHA256SUMS");
  });

  test("keeps the progress table the task sheets fill in", () => {
    expect(readme).toContain("## Where it stands");
    expect(readme).toContain("| Works today | Not yet |");
  });
});

describe("CONTRIBUTING", () => {
  test("points to the checks, the rules and the private way to report a security issue", () => {
    for (const link of localLinks(contributing)) {
      expect(files.has(link), link).toBe(true);
    }
    expect(contributing).toContain("npm run review");
    expect(contributing).toContain("AGENTS.md");
    expect(contributing).toContain("security/advisories/new");
  });
});

describe("CHANGELOG", () => {
  test("has an Unreleased section and the app's version", () => {
    expect(changelog).toContain("## [Unreleased]");
    expect(changelog).toContain(`## [${pkg.version}]`);
    expect(changelog).toContain(
      `[${pkg.version}]: https://github.com/Fleorens/TunL/releases/tag/v${pkg.version}`,
    );
  });
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T39`.
2. `LICENSE` (curl et empreinte), `CONTRIBUTING.md`, `CHANGELOG.md`.
3. `README.md` (le texte ci-dessus, avec le tableau actuel) : `npx vitest run src/docs.test.ts`.
4. `npm run format`, `npm run review`, cases, statut, commit
   `docs: public README, contributing guide, changelog and licence (T39)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T39 --check` affiche `OK` partout.
- [x] `sha256sum LICENSE` donne `3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986`.
- [x] `git diff main -- README.md` ne retire aucune ligne du tableau « Where it stands ».
- [x] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

Relis le `README.md` comme un inconnu (sur GitHub, une fois le dépôt public, il s'affiche avec l'icône et les
captures) : le ton, les fonctions mises en avant, la section dépannage. `CONTRIBUTING.md` promet une réponse sous une
semaine aux signalements de sécurité : à changer si ce n'est pas tenable.
