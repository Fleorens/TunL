# T41 — Paquet RPM pour COPR (spec, sources hors ligne, construction à chaque tag)

| | |
|---|---|
| **Jalon** | M8 — Distribution |
| **Dépend de** | T37, T38 |
| **Lire avant** | `tasks/T37-paquets-ci.md` « Contrat » (les fichiers du `.rpm`), `packaging/flatpak/io.github.fleorens.TunL.yml` (les commandes `build-commands`, à transposer) |
| **Livrable** | `packaging/rpm/tunl.spec` ; `.copr/Makefile` ; `scripts/copr-srpm.sh` ; `src/copr.test.ts` (contrat) |

## Pourquoi

Flathub refuse les apps écrites en grande partie par IA, et son manifeste ne doit contenir aucun contenu généré par
IA. Pour que les utilisateurs de Fedora installent TunL et le mettent à jour avec `dnf`, on le publie sur **COPR**,
le service de dépôts communautaires de Fedora. Le projet COPR est créé par Florian. À chaque tag GitHub, COPR :

1. clone le dépôt au tag, puis lance `make -f .copr/Makefile srpm outdir=<dossier> spec=<chemin>` dans un chroot
   Fedora, **en root et avec le réseau** ;
2. reconstruit le paquet source obtenu (`.src.rpm`) dans un autre chroot, **sans réseau**.

L'étape 1 prépare donc tout ce dont l'étape 2 a besoin : le code et les dépendances (crates et paquets npm).

## À réutiliser (ne pas réécrire)

- Les commandes de construction du manifeste Flatpak (T38) : `npm ci --offline --ignore-scripts`, puis
  `npx tauri build --no-bundle -- --offline`, puis la génération du `.desktop` depuis `packaging/linux/tunl.desktop.hbs`
  par `sed`. Ici l'icône s'appelle `tunl`, pas `io.github.fleorens.TunL`.
- La metainfo de T36 (`packaging/linux/io.github.fleorens.TunL.metainfo.xml`), installée telle quelle (son
  `launchable` vaut déjà `tunl.desktop`).
- Les icônes de `src-tauri/icons/`.

## Contrat

### `packaging/rpm/tunl.spec`

- `Name: tunl`, `Version:` celle de `package.json`, `Release: 1%{?dist}`, `License: GPL-3.0-or-later`,
  `URL: https://github.com/Fleorens/TunL`, un `Summary:` en anglais (celui de la metainfo).
- `Source0: tunl-%{version}.tar.gz` (le code) et `Source1: tunl-%{version}-vendor.tar.xz` (les dépendances).
- `BuildRequires:` Rust et Cargo (Rust ≥ 1.90, voir `rust-version` de `src-tauri/Cargo.toml`), Node et npm, les
  bibliothèques de développement de Tauri (`webkit2gtk4.1-devel`, `gtk3-devel`, `libsoup3-devel`,
  `librsvg2-devel`, `openssl-devel` si une crate le demande), `desktop-file-utils`, `libappstream-glib`. Les
  noms exacts se vérifient dans un conteneur Fedora (voir « Pièges »).
- `Recommends: freerdp` : sans lui, SSH et SFTP marchent, seul RDP manque. Jamais `Requires: freerdp`.
- `%prep` : extrait les deux sources, puis place la configuration de Cargo produite par `cargo vendor` dans
  `.cargo/config.toml`, à la racine des sources.
- `%build` : les deux commandes du Flatpak, avec le cache npm du vendor (`npm ci --offline --ignore-scripts
  --cache <dossier du cache>`).
- `%install` : exactement les fichiers du `.rpm` de GitHub (T37) :
  `%{_bindir}/tunl`, `%{_datadir}/applications/tunl.desktop`,
  `%{_datadir}/metainfo/io.github.fleorens.TunL.metainfo.xml`, et les icônes
  `%{_datadir}/icons/hicolor/{32x32,64x64,128x128,256x256@2,512x512}/apps/tunl.png` (depuis `32x32.png`,
  `64x64.png`, `128x128.png`, `128x128@2x.png` et `icon.png`).
- `%check` : `desktop-file-validate` sur l'entrée de bureau, `appstream-util validate-relax --nonet` sur la metainfo.
- `%files` : `%license LICENSE`, `%doc README.md CHANGELOG.md`, puis les fichiers installés.
- `%changelog` : une entrée pour 0.1.0.

### `.copr/Makefile`

Une seule cible, `srpm`, qui lance `scripts/copr-srpm.sh $(outdir)`. Le chemin du script se calcule depuis
l'emplacement du Makefile (`$(dir $(lastword $(MAKEFILE_LIST)))`), pas depuis le dossier courant.

### `scripts/copr-srpm.sh <outdir>` (exécutable)

- `set -euo pipefail`, se place à la racine du dépôt (depuis son propre chemin), refuse de tourner sans `<outdir>`.
- En root, s'il manque `git`, `cargo`, `npm`, `rpmbuild` ou `xz`, les installe avec `dnf -y install`. Sinon,
  s'arrête avec un message qui nomme l'outil manquant.
- Lit la version dans `package.json`.
- `Source0` : `git archive` du commit courant, préfixe `tunl-<version>/`, dans `<outdir>`.
- `Source1`, construit dans un dossier temporaire (`mktemp -d`, supprimé à la sortie) :
  `cargo vendor --locked` sur `src-tauri/Cargo.toml` (sa sortie, la configuration de Cargo, va dans un fichier du
  vendor), et `npm ci --ignore-scripts --cache <cache>` sur une copie de `package.json` et `package-lock.json`.
  L'archive contient **le dossier `vendor/`, le cache npm et la configuration de Cargo**, pas `node_modules`.
- `rpmbuild -bs` de `packaging/rpm/tunl.spec`, avec `_sourcedir` et `_srcrpmdir` sur `<outdir>`.
- N'écrit rien dans le dépôt (`git status` reste propre après un appel).

## Pièges

- **Les symboles de débogage** : `src-tauri/Cargo.toml` a `strip = true` en release. Fedora fabrique d'office un
  paquet `-debuginfo` et échoue s'il est vide : il faut `%global debug_package %{nil}` en tête du spec.
- **Les noms de paquets Fedora** : Node existe en plusieurs versions (`nodejs22`, `nodejs24`…). Vérifie ce qui
  fournit `npm` et `node` avec `podman run --rm registry.fedoraproject.org/fedora:44 dnf repoquery --whatprovides …`,
  ou écris la dépendance par chemin (`BuildRequires: /usr/bin/npm`). N'invente aucun nom.
- **Le chemin de `directory`** dans la configuration de Cargo : il est relatif au dossier qui contient `.cargo/`.
  Le vendor doit donc être extrait à la racine des sources.
- **`npm ci --offline`** échoue si un seul paquet manque dans le cache : le cache doit venir d'un `npm ci` complet
  sur le même `package-lock.json`.
- **Le dossier courant de COPR** n'est pas garanti : d'où le chemin du script calculé depuis le Makefile.

## Tests du contrat

### `src/copr.test.ts` (nouveau)

```ts
// T41: the RPM spec and the Copr entry point, read as text: what the package installs, and how it is built.
import { describe, expect, test } from "vitest";
import makefile from "../.copr/Makefile?raw";
import pkg from "../package.json";
import spec from "../packaging/rpm/tunl.spec?raw";
import srpm from "../scripts/copr-srpm.sh?raw";

const field = (name: string) => spec.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1]?.trim();

describe("tunl.spec", () => {
  test("names the package tunl, at the version of package.json, under the GPL", () => {
    expect(field("Name")).toBe("tunl");
    expect(field("Version")).toBe(pkg.version);
    expect(field("Release")).toBe("1%{?dist}");
    expect(field("License")).toBe("GPL-3.0-or-later");
    expect(field("URL")).toBe("https://github.com/Fleorens/TunL");
  });

  test("builds from the code and the vendored dependencies, offline", () => {
    expect(field("Source0")).toBe("tunl-%{version}.tar.gz");
    expect(field("Source1")).toBe("tunl-%{version}-vendor.tar.xz");
    expect(spec).toContain("npm ci --offline --ignore-scripts");
    expect(spec).toContain("tauri build --no-bundle -- --offline");
  });

  test("skips the debuginfo package (the release binary is stripped)", () => {
    expect(spec).toMatch(/^%global debug_package %\{nil\}$/m);
  });

  test("installs the files of the GitHub rpm (T37)", () => {
    for (const path of [
      "%{_bindir}/tunl",
      "%{_datadir}/applications/tunl.desktop",
      "%{_datadir}/metainfo/io.github.fleorens.TunL.metainfo.xml",
      "%{_datadir}/icons/hicolor/",
    ]) {
      expect(spec, path).toContain(path);
    }
    expect(spec).toMatch(/^%license LICENSE$/m);
  });

  test("recommends FreeRDP for RDP, without requiring it", () => {
    expect(spec).toMatch(/^Recommends:\s*freerdp$/m);
    expect(spec).not.toMatch(/^Requires:\s*freerdp/m);
  });

  test("validates the desktop entry and the metainfo", () => {
    expect(spec).toMatch(/^%check$/m);
    expect(spec).toContain("desktop-file-validate");
    expect(spec).toContain("appstream-util validate-relax --nonet");
  });
});

describe("Copr entry point", () => {
  test(".copr/Makefile has an srpm target that runs the script with the outdir", () => {
    expect(makefile).toMatch(/^srpm:/m);
    expect(makefile).toContain("copr-srpm.sh");
    expect(makefile).toContain("$(outdir)");
  });

  test("the script vendors the crates and the npm cache, then builds the source rpm", () => {
    expect(srpm).toContain("set -euo pipefail");
    expect(srpm).toContain("git archive");
    expect(srpm).toContain("cargo vendor");
    expect(srpm).toContain("npm ci --ignore-scripts");
    expect(srpm).toContain("rpmbuild -bs");
  });
});
```

## Étapes

1. Les tests du contrat : `node scripts/contract-tests.mjs T41`.
2. `packaging/rpm/tunl.spec`, puis `.copr/Makefile` et `scripts/copr-srpm.sh` (exécutable). `npx vitest run
   src/copr.test.ts` passe.
3. Le paquet source, dans un conteneur Fedora, comme le fait COPR (en root, avec le réseau) :
   `podman run --rm -v "$PWD:/src:Z" -w /src registry.fedoraproject.org/fedora:44 sh -c 'dnf -y install make git && git config --global --add safe.directory /src && make -f .copr/Makefile srpm outdir=/src/copr-out'`.
   Un `tunl-<version>-1.fc44.src.rpm` apparaît dans `copr-out/`.
4. La reconstruction **sans réseau**, comme le fait COPR : les dépendances de build s'installent avec le réseau,
   puis la compilation tourne dans un conteneur `--network=none` (compter 10 à 20 minutes) :
   ```bash
   podman run --name tunl-rpm -v "$PWD/copr-out:/out:Z" registry.fedoraproject.org/fedora:44 \
     sh -c 'dnf -y install rpm-build dnf-plugins-core && dnf -y builddep /out/tunl-*.src.rpm'
   podman commit tunl-rpm localhost/tunl-rpm-build && podman rm tunl-rpm
   podman run --rm --network=none -v "$PWD/copr-out:/out:Z" localhost/tunl-rpm-build \
     rpmbuild --rebuild --define "_rpmdir /out" /out/tunl-*.src.rpm
   ```
   Un `x86_64/tunl-<version>-1.fc44.x86_64.rpm` doit apparaître dans `copr-out/`.
5. Ce `.rpm` s'installe dans un conteneur Fedora propre (`dnf -y install /out/*.x86_64.rpm`), et `rpm -ql tunl`
   liste les fichiers du contrat.
6. Supprime `copr-out/` (ne le commite pas). `npm run format`, `npm run verify`, cases, statut, commit
   `chore: RPM spec and Copr source package with vendored dependencies (T41)`.

## Critères d'acceptation

- [x] `node scripts/contract-tests.mjs T41 --check` affiche `OK`, et `npm run verify` passe.
- [x] Le paquet source se construit dans un conteneur Fedora 44 par `make -f .copr/Makefile srpm`, et `git status`
      reste propre ensuite.
- [x] Il se reconstruit sans réseau en un `.rpm` qui s'installe dans un Fedora 44 propre et contient les fichiers
      du contrat.
- [x] Aucune nouvelle exception `project-rules: allow`, aucune dépendance npm ou Cargo ajoutée.

## À regarder par Florian

Dans le projet COPR `tunl` (créé par toi) : **Packages › New package › SCM**, avec l'URL du dépôt
`https://github.com/Fleorens/TunL.git`, la méthode **make srpm**, puis le webhook GitHub (Claude te guidera).
Ensuite : `sudo dnf copr enable <ton-identifiant>/tunl && sudo dnf install tunl` sur ton poste, puis lancer TunL
depuis le menu.
