# T37 — Paquets deb, rpm, AppImage et CI GitHub Actions (recette, audits, publication)

| | |
|---|---|
| **Jalon** | M8 — Distribution |
| **Dépend de** | T36 |
| **Lire avant** | `docs/06-securite.md` S16, `docs/07-dev.md` §2 et §6 |
| **Livrable** | `.github/workflows/ci.yml` et `release.yml` ; `scripts/check-version.mjs` ; les outils de build en `devDependencies` ; 1 fichier de tests |

## Pourquoi

T36 a rendu les paquets présentables ; il faut maintenant les **produire sans la devbox**, et garder la recette verte
à chaque changement, même proposé par quelqu'un d'autre (`docs/00-vision.md` : « l'app est publique »).
- **CI** (`ci.yml`), à chaque push sur `main` et chaque pull request : la recette entière (`npm run review`, tests SSH
  contre podman compris), les **audits** de S16 (`npm audit`, `cargo audit`) et la validation de l'entrée de bureau
  et de la metainfo (`scripts/check-packaging.sh`, T36).
- **Publication** (`release.yml`), sur un tag `vX.Y.Z` : les trois paquets et leurs sommes SHA-256, dans une
  publication GitHub **en brouillon**. La publier reste une décision humaine (la liste de T40).

Deux constats du prototype :
- `npm audit` remonte **8 vulnérabilités hautes**, toutes dans des outils de build : `shadcn` (la CLI qui génère
  `components/ui/`), et ses dépendances (`braces`, `hono`, le SDK MCP…). `shadcn`, `tailwindcss` et
  `@tailwindcss/vite` étaient rangés dans `dependencies` : ils passent dans `devDependencies`, ce qu'ils sont. Après un
  `npm audit fix` (sans `--force`), `npm audit --omit=dev` ne trouve **plus rien** ; reste `braces` côté outils, sans
  correctif publié. La CI bloque donc sur ce qui est livré, et signale le reste en avertissement.
- `cargo audit` : voir « Pièges ».

Prototypé par l'orchestrateur : `actionlint` 1.7.12 ne relève rien ; les étapes ont été jouées sur la devbox (recette,
audits, `check-packaging`, `tauri build --bundles deb,rpm,appimage`). Les workflows eux-mêmes ne tournent que sur
GitHub : leur premier passage est à regarder (« À regarder par Florian »).

## À réutiliser (ne pas réécrire)

- `npm run review` (la recette), `scripts/check-packaging.sh` (T36), `npx tauri build` (T36 : les trois paquets se
  construisent, le dossier `src-tauri/target/release/bundle/`).
- Les prérequis système de `docs/07-dev.md` §1 (ligne Debian / Ubuntu).

## Contrat

### `package.json`

- `shadcn`, `tailwindcss`, `@tailwindcss/vite` passent de `dependencies` à `devDependencies` (même version), puis
  `npm install` et `npm audit fix` (**sans** `--force`, qui installerait `shadcn@1.0.0`). Le `package-lock.json`
  change en conséquence.

### `scripts/check-version.mjs` (fourni)

Vérifie que `package.json`, `tauri.conf.json`, `Cargo.toml` (`[package]`) et la dernière `<release>` de la metainfo
donnent la même version, et, avec un argument (`v0.2.0` ou `0.2.0`), que c'est celle du tag. Code de sortie 1 sinon,
une ligne par fichier en écart.

### `.github/workflows/ci.yml` et `.github/workflows/release.yml` (fournis)

- Chaque action est **épinglée par commit**, sa version en commentaire (`actions/checkout@<sha> # v7.0.0`) : un tag
  déplacé ne peut pas changer ce qui tourne (S16). Pour monter de version : `git ls-remote https://github.com/<action>
  refs/tags/<tag>^{}`, puis remplacer le SHA **et** le commentaire.
- Permissions minimales : `contents: read` pour la CI, `contents: write` pour la publication (créer le brouillon).
- Chaque job a un `timeout-minutes`.
- La publication tourne sur `ubuntu-22.04` (la plus ancienne avec WebKitGTK 4.1 : l'AppImage marche alors sur des
  systèmes plus anciens) avec `APPIMAGE_EXTRACT_AND_RUN=1` (pas de FUSE sur les runners).

### `docs/07-dev.md` §6 (déjà écrit par l'orchestrateur)

Rien à faire : la section « CI et publication » décrit ces deux workflows.

## Pièges (vus au prototype)

- `cargo audit` lit `src-tauri/Cargo.lock` : le lancer **dans** `src-tauri` (`working-directory`).
- Un avertissement de la CI n'est pas un échec : `npm audit` complet se termine par `|| echo "::warning::…"`.
- `npm run review` démarre podman : les runners Ubuntu 24.04 l'ont, en version 4.9. Si `test-env:up` y échouait, ne
  désactive **pas** les tests : signale-le (règle d'`AGENTS.md`).
- Playwright y utilise son propre Chromium (`npx playwright install --with-deps chromium`) : `playwright.config.ts`
  ne prend celui du système que s'il existe.
- `src/release.test.ts` lit les workflows par `?raw` : un YAML se lit comme du texte, sans dépendance.

## Tests du contrat

### `src/release.test.ts` (nouveau)

```ts
// T37: the CI and release workflows, read as text (Vite `?raw`): what they run, and how they are locked down.
import { describe, expect, test } from "vitest";
import ci from "../.github/workflows/ci.yml?raw";
import release from "../.github/workflows/release.yml?raw";
import pkg from "../package.json";
import cargoToml from "../src-tauri/Cargo.toml?raw";
import tauri from "../src-tauri/tauri.conf.json";

const WORKFLOWS = { ci, release };

describe("both workflows", () => {
  test.each(Object.entries(WORKFLOWS))(
    "%s pins every action to a commit, its tag in a comment",
    (_, text) => {
      const uses = text.split("\n").filter((line) => /^\s*-?\s*uses:/.test(line));
      expect(uses.length).toBeGreaterThan(0);
      for (const line of uses) {
        expect(line, line).toMatch(/uses: [\w.-]+\/[\w.-]+@[0-9a-f]{40} # \S+$/);
      }
    },
  );

  test.each(Object.entries(WORKFLOWS))("%s gives each job a timeout", (_, text) => {
    const jobsPart = text.slice(text.indexOf("\njobs:\n"));
    const jobs = jobsPart.split("\n").filter((line) => /^ {2}[\w-]+:$/.test(line));
    const timeouts = text.split("\n").filter((line) => /^ {4}timeout-minutes: \d+$/.test(line));
    expect(timeouts.length).toBe(jobs.length);
  });
});

describe("CI", () => {
  test("runs on main and on pull requests, with read-only access", () => {
    expect(ci).toMatch(/on:\n {2}push:\n {4}branches: \[main\]\n {2}pull_request:/);
    expect(ci).toMatch(/permissions:\n {2}contents: read/);
  });

  test("runs the whole recipe, both audits and the packaging checks", () => {
    expect(ci).toContain("run: npm ci");
    expect(ci).toContain("run: npm run review");
    expect(ci).toContain("npm audit --omit=dev --audit-level=high");
    expect(ci).toContain("cargo audit");
    expect(ci).toContain("scripts/check-packaging.sh");
  });
});

describe("release", () => {
  test("only a v* tag builds, and the result is a draft", () => {
    expect(release).toMatch(/on:\n {2}push:\n {4}tags: \["v\*"\]/);
    expect(release).toContain("draft: true");
    expect(release).not.toMatch(/branches:/);
  });

  test("checks the tag against the version, builds the three packages, publishes their checksums", () => {
    expect(release).toContain('node scripts/check-version.mjs "${GITHUB_REF_NAME}"');
    expect(release).toContain("npx tauri build --bundles deb,rpm,appimage");
    expect(release).toContain("SHA256SUMS");
  });
});

describe("what ships", () => {
  test("the build tools are dev dependencies: they are not audited as part of the app", () => {
    for (const tool of ["shadcn", "tailwindcss", "@tailwindcss/vite"]) {
      expect(Object.keys(pkg.dependencies), tool).not.toContain(tool);
      expect(Object.keys(pkg.devDependencies), tool).toContain(tool);
    }
  });

  test("package.json, tauri.conf.json and Cargo.toml give the same version", () => {
    const cargo = cargoToml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];
    expect(tauri.version).toBe(pkg.version);
    expect(cargo).toBe(pkg.version);
  });
});
```

### `.github/workflows/ci.yml` (nouveau)

```yaml
# T37: every push to main and every pull request runs the whole recipe, the audits and the packaging checks.
# Actions are pinned by commit (the tag in the comment): a moved tag cannot change what runs here (S16).
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

env:
  CARGO_TERM_COLOR: always

jobs:
  review:
    name: npm run review
    runs-on: ubuntu-24.04
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - name: Tauri system libraries
        run: |
          sudo apt-get update
          sudo apt-get install -y --no-install-recommends \
            libwebkit2gtk-4.1-dev libssl-dev build-essential libxdo-dev \
            libayatana-appindicator3-dev librsvg2-dev
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
          cache: npm
      - uses: dtolnay/rust-toolchain@b725eda525362e7cf34af9a7243cac1e3f01a7ec # stable
        with:
          toolchain: stable
          components: rustfmt, clippy
      - uses: Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6 # v2.9.2
        with:
          workspaces: src-tauri
      - run: npm ci
      - name: Chromium for the end-to-end tests
        run: npx playwright install --with-deps chromium
      # Types, Biome, project rules, contract tests, Vitest, cargo fmt/clippy/test, the SSH tests against
      # podman (preinstalled on the runner), then the Playwright scenarios.
      - run: npm run review

  audit:
    name: Dependency audit
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
      # What ships in the app: no known high or critical vulnerability.
      - name: npm audit (shipped packages)
        run: npm audit --omit=dev --audit-level=high
      # The build tools too, for information: a dev-only advisory without a fix must not block every change.
      - name: npm audit (build tools, informative)
        run: npm audit --audit-level=high || echo "::warning::npm audit reports advisories in the build tools"
      - uses: taiki-e/install-action@1168f6810a3cb30a3514bf5756a3b7f0422c6df8 # v2.87.28
        with:
          tool: cargo-audit
      - name: cargo audit
        working-directory: src-tauri
        run: cargo audit

  packaging:
    name: Desktop entry and AppStream metadata
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - name: freedesktop validators
        run: |
          sudo apt-get update
          sudo apt-get install -y --no-install-recommends appstream desktop-file-utils
      - run: scripts/check-packaging.sh
```

### `.github/workflows/release.yml` (nouveau)

```yaml
# T37: a tag `vX.Y.Z` builds the deb, rpm and AppImage packages and attaches them, with their SHA-256 sums,
# to a draft GitHub release. Publishing the draft stays a human decision (T40's checklist).
name: Release

on:
  push:
    tags: ["v*"]

permissions:
  contents: write

env:
  CARGO_TERM_COLOR: always

jobs:
  packages:
    name: deb, rpm, AppImage
    # The oldest supported Ubuntu with WebKitGTK 4.1: the AppImage then runs on older systems too.
    runs-on: ubuntu-22.04
    timeout-minutes: 60
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0 # v7.0.0
      - name: Tauri system libraries
        run: |
          sudo apt-get update
          sudo apt-get install -y --no-install-recommends \
            libwebkit2gtk-4.1-dev libssl-dev build-essential libxdo-dev \
            libayatana-appindicator3-dev librsvg2-dev file
      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020 # v7.0.0
        with:
          node-version: 22
          cache: npm
      - uses: dtolnay/rust-toolchain@b725eda525362e7cf34af9a7243cac1e3f01a7ec # stable
        with:
          toolchain: stable
      - uses: Swatinem/rust-cache@6323deb102c322ba6fcbdcafc7e3dddab59af2b6 # v2.9.2
        with:
          workspaces: src-tauri
      - run: npm ci
      - name: The tag is the app's version
        run: node scripts/check-version.mjs "${GITHUB_REF_NAME}"
      - name: Build the packages
        # linuxdeploy is itself an AppImage: no FUSE on the runner, so it extracts itself instead.
        env:
          APPIMAGE_EXTRACT_AND_RUN: "1"
        run: npx tauri build --bundles deb,rpm,appimage
      - name: Collect the packages and their checksums
        run: |
          mkdir dist-packages
          cp src-tauri/target/release/bundle/deb/*.deb \
             src-tauri/target/release/bundle/rpm/*.rpm \
             src-tauri/target/release/bundle/appimage/*.AppImage dist-packages/
          cd dist-packages && sha256sum -- * > SHA256SUMS
      - uses: softprops/action-gh-release@3d0d9888cb7fd7b750713d6e236d1fcb99157228 # v3.0.2
        with:
          draft: true
          files: dist-packages/*
```

### `scripts/check-version.mjs` (nouveau)

```js
// The version of TunL is written in four places; a release tag must match all of them (T37).
//
//   node scripts/check-version.mjs            checks that the four agree
//   node scripts/check-version.mjs v0.2.0     also checks the tag (with or without its "v")

import { readFileSync } from "node:fs";

const versions = {
  "package.json": JSON.parse(readFileSync("package.json", "utf8")).version,
  "src-tauri/tauri.conf.json": JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"))
    .version,
  "src-tauri/Cargo.toml": readFileSync("src-tauri/Cargo.toml", "utf8").match(
    /^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m,
  )?.[1],
  "metainfo (latest release)": readFileSync(
    "packaging/linux/io.github.fleorens.TunL.metainfo.xml",
    "utf8",
  ).match(/<release\s+version="([^"]+)"/)?.[1],
};

const tag = process.argv[2]?.replace(/^v/, "");
const expected = tag ?? versions["package.json"];
const wrong = Object.entries(versions).filter(([, version]) => version !== expected);

if (wrong.length > 0) {
  for (const [file, version] of wrong) {
    console.error(`${file}: ${version ?? "no version found"}, expected ${expected}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `version ${expected}: package.json, tauri.conf.json, Cargo.toml and the metainfo agree`,
  );
}
```

## Étapes

1. Les fichiers fournis : `node scripts/contract-tests.mjs T37`.
2. `package.json` (trois paquets en `devDependencies`), `npm install`, `npm audit fix` ;
   `npm audit --omit=dev --audit-level=high` doit répondre `found 0 vulnerabilities`.
3. `node scripts/check-version.mjs` ; `npx vitest run src/release.test.ts`.
4. `npm run format`, `npm run review`, cases, statut, commit
   `ci: GitHub Actions for the review, the audits and the release packages (T37)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T37 --check` affiche `OK` partout.
- [x] `npm audit --omit=dev --audit-level=high` : `found 0 vulnerabilities`.
- [x] `node scripts/check-version.mjs v0.1.0` réussit, `node scripts/check-version.mjs v9.9.9` échoue.
- [x] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

Au premier push sur GitHub (`Fleorens/TunL`) : l'onglet **Actions** montre les trois jobs de la CI en vert (le plus
long, `npm run review`, compte 15 à 25 minutes à froid). Puis, pour essayer la publication sans rien publier :
`git tag v0.1.0 && git push origin v0.1.0` → une publication **brouillon** avec le `.deb`, le `.rpm`, l'`AppImage` et
`SHA256SUMS` ; supprime le brouillon et le tag ensuite si ce n'était qu'un essai.
