# T36 — Icône, entrée de bureau, métadonnées AppStream, captures d'écran

| | |
|---|---|
| **Jalon** | M8 — Distribution |
| **Dépend de** | T34 |
| **Lire avant** | `docs/02-decisions.md` D14 et D15, `docs/03-design.md` §5.1 (le logo) |
| **Livrable** | les icônes tirées de `branding/app-icon.svg` ; `packaging/linux/` (entrée de bureau, metainfo) branché dans `tauri.conf.json` ; paquet nommé `tunl` ; `npm run screenshots` et `docs/screenshots/` ; `npm run check:packaging` ; 4 fichiers du contrat |

## Pourquoi

Installée, TunL apparaît aujourd'hui avec **l'icône par défaut de Tauri**, dans un paquet Debian nommé **`tun-l`**
(Tauri dérive le nom du paquet du `productName` « TunL » en kebab-case), avec une entrée de menu générique (catégorie
« Utility ») et aucune métadonnée pour les logithèques (GNOME Logiciels, Discover, Flathub).

Cette fiche donne à TunL son identité de bureau :
- **l'icône** : la tuile du logo (`docs/03-design.md` §5.1) en dégradé de marque, dessinée par l'orchestrateur dans
  `branding/app-icon.svg` (déjà dans le dépôt) ; `tauri icon` en tire les PNG ;
- **le paquet `tunl`** (D14) : `productName` passe à `"tunl"` ; le nom affiché reste « TunL » (titre de fenêtre,
  entrée de bureau) ;
- **l'entrée de bureau** : un modèle à nous (catégories `Network;RemoteAccess;`, mots-clés, traductions françaises,
  `StartupWMClass`) ;
- **la metainfo AppStream** `io.github.fleorens.TunL.metainfo.xml`, installée dans les trois paquets ;
- **les captures** publiques, prises par un script Playwright sur les données de démo du mock.

Prototypé par l'orchestrateur : `tauri build --bundles deb,rpm,appimage` produit `tunl_0.1.0_amd64.deb`,
`tunl-0.1.0-1.x86_64.rpm` et `tunl_0.1.0_amd64.AppImage` ; `desktop-file-validate` et `appstreamcli validate` (1.0.5)
passent (une seule remarque pédante, la majuscule de l'identifiant, imposée par D14). La fenêtre de la version
compilée a la classe X11 `tunl` / `Tunl`, et, sans identifiant d'application GTK (`enableGTKAppId` reste à `false`,
le défaut), l'`app_id` Wayland vaut aussi `tunl` : d'où `tunl.desktop` et `StartupWMClass=tunl`.

## À réutiliser (ne pas réécrire)

- `branding/app-icon.svg` (fourni) : **ne pas le modifier**.
- `npx tauri icon` (la CLI de Tauri, déjà installée).
- La config Playwright du dépôt (`playwright.config.ts`) : le script des captures l'étend.

## Contrat

### Les icônes

1. `npx tauri icon branding/app-icon.svg` (écrit dans `src-tauri/icons/`).
2. Supprimer ce qui ne sert pas sous Linux : `src-tauri/icons/android/`, `src-tauri/icons/ios/`, les
   `Square*Logo.png`, `StoreLogo.png`, `icon.icns`, `icon.ico`.
3. `tauri.conf.json` › `bundle.icon` : `icons/32x32.png`, `icons/64x64.png`, `icons/128x128.png`,
   `icons/128x128@2x.png`, `icons/icon.png`.

### `tauri.conf.json`

- `"productName": "tunl"` (le paquet, le binaire, le dossier `/usr/lib/tunl`). La fenêtre garde `"title": "TunL"`.
- `bundle.shortDescription` : `"SSH, SFTP and RDP connections, with jump hosts and Wake-on-LAN"` (le `Comment` de
  l'entrée de bureau anglaise).
- `bundle.linux` :

```json
"linux": {
  "deb": {
    "desktopTemplate": "../packaging/linux/tunl.desktop.hbs",
    "files": { "/usr/share/metainfo/io.github.fleorens.TunL.metainfo.xml": "../packaging/linux/io.github.fleorens.TunL.metainfo.xml" }
  },
  "rpm": {
    "desktopTemplate": "../packaging/linux/tunl.desktop.hbs",
    "files": { "/usr/share/metainfo/io.github.fleorens.TunL.metainfo.xml": "../packaging/linux/io.github.fleorens.TunL.metainfo.xml" }
  },
  "appimage": {
    "files": { "/usr/share/metainfo/io.github.fleorens.TunL.metainfo.xml": "../packaging/linux/io.github.fleorens.TunL.metainfo.xml" }
  }
}
```

### `packaging/linux/tunl.desktop.hbs` (nouveau, à recopier tel quel)

```
[Desktop Entry]
Type=Application
Name=TunL
GenericName=Remote connection manager
GenericName[fr]=Gestionnaire de connexions distantes
Comment={{comment}}
Comment[fr]=Connexions SSH, SFTP et RDP, avec bastions et Wake-on-LAN
Exec={{exec}}
Icon={{icon}}
Terminal=false
Categories=Network;RemoteAccess;
Keywords=ssh;sftp;rdp;terminal;remote;bastion;jump host;wake-on-lan;
Keywords[fr]=ssh;sftp;rdp;terminal;distant;bastion;rebond;wake-on-lan;
StartupNotify=true
StartupWMClass=tunl
```

Un modèle Handlebars : Tauri remplit `{{exec}}`, `{{icon}}` et `{{comment}}`. `Name` est écrit en dur (`{{name}}`
vaudrait `tunl`).

### `packaging/linux/io.github.fleorens.TunL.metainfo.xml` (nouveau, à recopier tel quel)

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!-- AppStream metadata of TunL (T36): what software centres (GNOME Software, Discover, Flathub) show. -->
<component type="desktop-application">
  <id>io.github.fleorens.TunL</id>
  <metadata_license>CC0-1.0</metadata_license>
  <project_license>GPL-3.0-or-later</project_license>

  <name>TunL</name>
  <summary>Connect to your servers over SSH, SFTP and RDP</summary>
  <summary xml:lang="fr">Se connecter à ses serveurs en SSH, SFTP et RDP</summary>

  <developer id="io.github.fleorens">
    <name>Fleorens</name>
  </developer>

  <description>
    <p>
      TunL keeps your SSH, SFTP and RDP connections in one window: terminals in tabs, a file explorer with
      transfers, and remote desktops through FreeRDP, even behind a chain of jump hosts.
    </p>
    <p xml:lang="fr">
      TunL réunit vos connexions SSH, SFTP et RDP dans une seule fenêtre : des terminaux en onglets, un explorateur
      de fichiers avec ses transferts, et des bureaux distants avec FreeRDP, même derrière une chaîne de bastions.
    </p>
    <ul>
      <li>SSH terminal in tabs, with password, key, agent and two-factor sign-in</li>
      <li xml:lang="fr">Terminal SSH en onglets, avec mot de passe, clé, agent et double authentification</li>
      <li>Host keys checked, and a changed key refused with an explanation</li>
      <li xml:lang="fr">Clés d'hôte vérifiées, et une clé changée refusée avec une explication</li>
      <li>SFTP explorer: browse, rename, delete, upload and download with progress, drag and drop</li>
      <li xml:lang="fr">Explorateur SFTP : parcourir, renommer, supprimer, envoyer et télécharger, glisser-déposer</li>
      <li>RDP through FreeRDP 3, with credentials never shown to other processes</li>
      <li xml:lang="fr">RDP avec FreeRDP 3, sans que les identifiants soient visibles des autres processus</li>
      <li>Jump hosts, Wake-on-LAN and reachability dots</li>
      <li xml:lang="fr">Bastions, Wake-on-LAN et pastilles de disponibilité</li>
      <li>Passwords in the system keyring, never in a file; import of ~/.ssh/config</li>
      <li xml:lang="fr">Mots de passe dans le trousseau du système, jamais dans un fichier ; import de ~/.ssh/config</li>
      <li>Keyboard first: command palette, quick connect, shortcuts</li>
      <li xml:lang="fr">Clavier d'abord : palette de commandes, connexion rapide, raccourcis</li>
    </ul>
  </description>

  <launchable type="desktop-id">tunl.desktop</launchable>

  <url type="homepage">https://github.com/Fleorens/TunL</url>
  <url type="bugtracker">https://github.com/Fleorens/TunL/issues</url>
  <url type="vcs-browser">https://github.com/Fleorens/TunL</url>

  <categories>
    <category>Network</category>
    <category>RemoteAccess</category>
  </categories>
  <keywords>
    <keyword>ssh</keyword>
    <keyword>sftp</keyword>
    <keyword>rdp</keyword>
    <keyword>terminal</keyword>
    <keyword>bastion</keyword>
  </keywords>

  <provides>
    <binary>tunl</binary>
  </provides>

  <requires>
    <display_length compare="ge">960</display_length>
  </requires>
  <supports>
    <control>keyboard</control>
    <control>pointing</control>
  </supports>

  <branding>
    <color type="primary" scheme_preference="light">#2196a7</color>
    <color type="primary" scheme_preference="dark">#6e41db</color>
  </branding>

  <screenshots>
    <screenshot type="default">
      <caption>Home: favorites, recent connections and quick connect</caption>
      <image>https://raw.githubusercontent.com/Fleorens/TunL/main/docs/screenshots/home.png</image>
    </screenshot>
    <screenshot>
      <caption>An SSH session in a tab</caption>
      <image>https://raw.githubusercontent.com/Fleorens/TunL/main/docs/screenshots/terminal.png</image>
    </screenshot>
    <screenshot>
      <caption>The SFTP explorer and its transfers</caption>
      <image>https://raw.githubusercontent.com/Fleorens/TunL/main/docs/screenshots/sftp.png</image>
    </screenshot>
    <screenshot>
      <caption>The connection editor</caption>
      <image>https://raw.githubusercontent.com/Fleorens/TunL/main/docs/screenshots/editor.png</image>
    </screenshot>
  </screenshots>

  <content_rating type="oars-1.1"/>

  <releases>
    <release version="0.1.0" date="2026-10-20" type="development">
      <description>
        <p>First preview: SSH, SFTP and RDP connections, jump hosts, Wake-on-LAN.</p>
      </description>
    </release>
  </releases>
</component>
```

- `launchable` = `tunl.desktop` : c'est le nom du fichier que Tauri installe. Le Flatpak (T38) le renomme.
- Le développeur est le pseudonyme public du dépôt (`Fleorens`), jamais une adresse.
- Les captures pointent vers `main` sur GitHub : elles s'affichent dès que le dépôt est public.

### « À propos » (`settings/sections/AboutSection.tsx`)

Le nom affiché devient la marque **« TunL » en dur** (avec un commentaire) : `info.name` vaut désormais `tunl`, le
nom du paquet.

### Les captures

- Le script et sa config sont fournis par la fiche (`scripts/screenshots/`) ; `package.json` :
  `"screenshots": "playwright test --config scripts/screenshots/playwright.config.ts"`.
- `npm run screenshots` écrit `docs/screenshots/home.png`, `terminal.png`, `sftp.png`, `editor.png` (1280 × 800,
  thème sombre). Les PNG sont **commités**. Le script cache le badge « Mock backend » et la version du mock.
- Pas dans `npm run review` : on le relance quand l'interface change.

### La validation

- `scripts/check-packaging.sh` (fourni) ; `package.json` : `"check:packaging": "scripts/check-packaging.sh"`. Il
  remplit le modèle comme Tauri, puis lance `desktop-file-validate` et `appstreamcli validate --no-net`, installés ou
  dans un conteneur podman jetable (Debian 13). La CI de T37 l'appellera.

## Pièges (vus au prototype)

- `productName` sert aussi à `app.package_info().name` : c'est pourquoi « À propos » écrit la marque en dur.
- `tauri icon` crée aussi les icônes Android, iOS et Windows Store : à supprimer (Linux seulement, D01).
- `src/packaging.test.ts` lit les fichiers par Vite (`?raw`, `import.meta.glob`) : pas de `node:fs`, le
  `tsconfig` de l'app n'a pas les types de Node.
- Le faux shell du mock ne connaît qu'`echo` : le script des captures écrit sa sortie directement dans le port du
  terminal (même instance de module que l'app, servie par Vite).
- `npx tauri build` compile en mode release : **6 à 7 minutes** la première fois. Inutile dans cette fiche pour le
  modèle (le prototype l'a fait) ; T37 l'automatise.

## Tests du contrat

### `src/packaging.test.ts` (nouveau)

```ts
// T36: the desktop integration files agree with each other and with the app (id, version, binary, screenshots).
// The files are read through Vite (`?raw`, `import.meta.glob`), like `lib/ipc-contract.test.ts`: no Node API here.
import { describe, expect, test } from "vitest";
import appIcon from "../branding/app-icon.svg?raw";
import pkg from "../package.json";
import metainfoXml from "../packaging/linux/io.github.fleorens.TunL.metainfo.xml?raw";
import desktopTemplate from "../packaging/linux/tunl.desktop.hbs?raw";
import tauri from "../src-tauri/tauri.conf.json";

const METAINFO = "packaging/linux/io.github.fleorens.TunL.metainfo.xml";
const DESKTOP = "packaging/linux/tunl.desktop.hbs";

/** Files of the repository, by their path from its root. */
const files = new Set(
  Object.keys(
    import.meta.glob(["../src-tauri/icons/*.png", "../docs/screenshots/*.png"], { eager: false }),
  ).map((path) => path.replace(/^\.\.\//, "")),
);

function existsSync(path: string): boolean {
  return files.has(path);
}

function metainfo(): Document {
  return new DOMParser().parseFromString(metainfoXml, "application/xml");
}

function text(doc: Document, selector: string): string | undefined {
  return doc.querySelector(selector)?.textContent?.trim();
}

describe("tauri.conf.json", () => {
  test("the package is `tunl` (D14), the window says TunL", () => {
    expect(tauri.productName).toBe("tunl");
    expect(tauri.identifier).toBe("io.github.fleorens.TunL");
    expect(tauri.app.windows[0]?.title).toBe("TunL");
    expect(tauri.version).toBe(pkg.version);
  });

  test("deb and rpm use the desktop template and install the metainfo; every icon exists", () => {
    const target = "/usr/share/metainfo/io.github.fleorens.TunL.metainfo.xml";
    for (const format of [tauri.bundle.linux.deb, tauri.bundle.linux.rpm]) {
      expect(format.desktopTemplate).toBe(`../${DESKTOP}`);
      expect(format.files).toEqual({ [target]: `../${METAINFO}` });
    }
    expect(tauri.bundle.linux.appimage.files).toEqual({ [target]: `../${METAINFO}` });
    for (const icon of tauri.bundle.icon) {
      expect(existsSync(`src-tauri/${icon}`), icon).toBe(true);
    }
  });
});

describe("the AppStream metainfo", () => {
  test("names the app, its licence, its desktop file and its binary", () => {
    const doc = metainfo();
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(text(doc, "component > id")).toBe(tauri.identifier);
    expect(text(doc, "project_license")).toBe("GPL-3.0-or-later");
    expect(text(doc, "metadata_license")).toBe("CC0-1.0");
    expect(text(doc, "launchable[type='desktop-id']")).toBe("tunl.desktop");
    expect(text(doc, "provides > binary")).toBe("tunl");
    expect(text(doc, "url[type='homepage']")).toBe("https://github.com/Fleorens/TunL");
  });

  test("its latest release is the app's version", () => {
    const release = metainfo().querySelector("releases > release");
    expect(release?.getAttribute("version")).toBe(pkg.version);
    expect(release?.getAttribute("date")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("every screenshot is a file of docs/screenshots, published from the main branch", () => {
    const images = [...metainfo().querySelectorAll("screenshot > image")].map(
      (image) => image.textContent?.trim() ?? "",
    );
    expect(images.length).toBeGreaterThanOrEqual(3);
    const prefix = "https://raw.githubusercontent.com/Fleorens/TunL/main/";
    for (const url of images) {
      expect(url.startsWith(prefix), url).toBe(true);
      expect(existsSync(url.slice(prefix.length)), url).toBe(true);
    }
  });
});

describe("the desktop entry template", () => {
  test("runs the binary with its icon, in the network menus, for the X11 window class", () => {
    const lines = desktopTemplate.split("\n");
    expect(lines[0]).toBe("[Desktop Entry]");
    for (const line of [
      "Type=Application",
      "Name=TunL",
      "Exec={{exec}}",
      "Icon={{icon}}",
      "Terminal=false",
      "Categories=Network;RemoteAccess;",
      "StartupWMClass=tunl",
    ]) {
      expect(lines).toContain(line);
    }
    expect(lines.some((line) => line.startsWith("Comment[fr]="))).toBe(true);
  });
});

test("the app icon is the brand's tile, as an SVG", () => {
  const svg = appIcon;
  expect(svg).toContain('viewBox="0 0 128 128"');
  expect(svg).toContain("<title>TunL</title>");
});
```

### `scripts/screenshots/playwright.config.ts` (nouveau)

```ts
// `npm run screenshots` (T36): the public screenshots of docs/screenshots/, taken from the browser UI on the mock's
// demo data. Not part of `npm run review`: run it again when the interface changes, then commit the images.
import { defineConfig } from "@playwright/test";
import base from "../../playwright.config";

export default defineConfig({
  ...base,
  testDir: ".",
  testMatch: "screenshots.spec.ts",
  fullyParallel: false,
  workers: 1,
});
```

### `scripts/screenshots/screenshots.spec.ts` (nouveau)

```ts
// The four screenshots of the AppStream metadata (packaging/linux/*.metainfo.xml), 1280×800, dark theme.
// The mock's own marks (the "Mock backend" badge and its version) are hidden: they are not part of the app.
import { expect, type Page, test } from "@playwright/test";

const OUT = "docs/screenshots";

test.use({ viewport: { width: 1280, height: 800 }, colorScheme: "dark", reducedMotion: "reduce" });

async function open(page: Page) {
  await page.goto("/");
  await expect(
    page.getByRole("complementary").getByRole("button", { name: /^nas/ }).first(),
  ).toBeVisible();
  await page.addStyleTag({
    content: "footer span:has(> [data-slot='badge']) { visibility: hidden }",
  });
}

async function sidebarRow(page: Page, name: string) {
  return page
    .getByRole("complementary")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first();
}

test("home", async ({ page }) => {
  await open(page);
  await expect(page.getByRole("article").first()).toBeVisible();
  await page.screenshot({ path: `${OUT}/home.png` });
});

/** What the terminal shows: a shell prompt, then a short, colored listing (written straight to the tab's port). */
const TERMINAL_TEXT = [
  "\x1b[2J\x1b[H",
  "\x1b[1;32madmin@nas\x1b[0m:\x1b[1;34m~\x1b[0m$ uptime\r\n",
  " 09:41:07 up 23 days,  4:12,  1 user,  load average: 0.08, 0.11, 0.09\r\n",
  "\x1b[1;32madmin@nas\x1b[0m:\x1b[1;34m~\x1b[0m$ ls -l /srv\r\n",
  "total 16\r\n",
  "drwxr-xr-x 6 admin admin 4096 Oct 18 21:04 \x1b[1;34mbackups\x1b[0m\r\n",
  "drwxr-xr-x 3 admin admin 4096 Oct 12 08:30 \x1b[1;34mmedia\x1b[0m\r\n",
  "-rwxr-xr-x 1 admin admin  812 Sep 30 17:55 \x1b[1;32mrotate-logs.sh\x1b[0m\r\n",
  "-rw-r--r-- 1 admin admin 2291 Oct 20 09:12 notes.md\r\n",
  "\x1b[1;32madmin@nas\x1b[0m:\x1b[1;34m~\x1b[0m$ df -h /srv\r\n",
  "Filesystem      Size  Used Avail Use% Mounted on\r\n",
  "/dev/md0        7.3T  4.1T  3.2T  57% /srv\r\n",
  "\x1b[1;32madmin@nas\x1b[0m:\x1b[1;34m~\x1b[0m$ ",
].join("");

test("terminal", async ({ page }) => {
  await open(page);
  await (await sidebarRow(page, "nas")).dblclick();
  const view = page.getByRole("region", { name: "nas", exact: true });
  await expect(view.locator(".xterm-rows")).toContainText("nas");
  await page.evaluate(async (text) => {
    // The same module instances as the app (Vite serves them by URL).
    const { useSessions } = await import("/src/features/sessions/store.ts");
    const { getSessionPort } = await import("/src/features/sessions/session-ports.ts");
    const id = useSessions.getState().sessions[0]?.id ?? "";
    getSessionPort(id)?.push(new TextEncoder().encode(text));
  }, TERMINAL_TEXT);
  await expect(view.locator(".xterm-rows")).toContainText("/dev/md0");
  await page.screenshot({ path: `${OUT}/terminal.png` });
});

test("sftp", async ({ page }) => {
  await open(page);
  await (await sidebarRow(page, "nas")).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  const view = page.getByRole("region", { name: "nas", exact: true });
  await expect(view.getByRole("table", { name: "Files" })).toBeVisible();
  await view.getByRole("button", { name: "Upload files" }).click();
  await expect(view.getByRole("list", { name: "Transfers" })).toContainText("Done");
  await expect(view.getByRole("table", { name: "Files" })).toContainText("report.pdf");
  await page.mouse.move(0, 0);
  await page.screenshot({ path: `${OUT}/sftp.png` });
});

test("editor", async ({ page }) => {
  await open(page);
  await (await sidebarRow(page, "web-01")).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/editor.png` });
});
```

### `scripts/check-packaging.sh` (nouveau)

```bash
#!/usr/bin/env bash
# Validate the desktop entry and the AppStream metainfo with the freedesktop tools (T36).
# Uses `desktop-file-validate` and `appstreamcli` when installed (CI), else a throwaway podman container.
set -euo pipefail
cd "$(dirname "$0")/.." || exit 1

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# The template as Tauri fills it for the deb and rpm packages.
sed -e 's/{{exec}}/tunl/' -e 's/{{icon}}/tunl/' -e 's/{{comment}}/SSH, SFTP and RDP connections/' \
  packaging/linux/tunl.desktop.hbs >"$work/tunl.desktop"
cp packaging/linux/io.github.fleorens.TunL.metainfo.xml "$work/"

run() {
  desktop-file-validate /work/tunl.desktop
  appstreamcli validate --no-net --explain /work/io.github.fleorens.TunL.metainfo.xml
}

if command -v desktop-file-validate >/dev/null && command -v appstreamcli >/dev/null; then
  desktop-file-validate "$work/tunl.desktop"
  appstreamcli validate --no-net --explain "$work/io.github.fleorens.TunL.metainfo.xml"
elif command -v podman >/dev/null; then
  image="localhost/tunl-check-packaging:1"
  if ! podman image exists "$image"; then
    printf 'FROM docker.io/library/debian:13\nRUN apt-get update && apt-get install -y --no-install-recommends appstream desktop-file-utils && rm -rf /var/lib/apt/lists/*\n' |
      podman build -q -t "$image" -f - . >/dev/null
  fi
  podman run --rm -v "$work:/work:ro,Z" "$image" bash -c "$(declare -f run); run"
else
  printf 'error: install desktop-file-utils and appstream, or podman\n' >&2
  exit 1
fi
printf 'packaging: desktop entry and metainfo are valid\n'
```

## Étapes

1. Les fichiers fournis : `node scripts/contract-tests.mjs T36`, puis `chmod +x scripts/check-packaging.sh`.
2. Les icônes (`npx tauri icon …`, ménage), `tauri.conf.json`, `package.json` (deux scripts).
3. `packaging/linux/tunl.desktop.hbs`, `packaging/linux/io.github.fleorens.TunL.metainfo.xml` :
   `npm run check:packaging`.
4. `AboutSection.tsx` ; `npm run screenshots` (quatre PNG dans `docs/screenshots/`) ;
   `npx vitest run src/packaging.test.ts`.
5. `npm run format`, `npm run review`, cases, statut, ligne « Works today » du `README.md` (icône et intégration au
   bureau), commit `feat: app icon, desktop entry, AppStream metainfo and screenshots (T36)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T36 --check` affiche `OK` partout.
- [x] `npm run check:packaging` affiche `packaging: desktop entry and metainfo are valid`.
- [x] `ls src-tauri/icons` ne montre que `32x32.png`, `64x64.png`, `128x128.png`, `128x128@2x.png`, `icon.png`.
- [x] `git diff main -- branding/app-icon.svg` est vide.
- [x] Aucune nouvelle exception `project-rules: allow`.
- [ ] Visuel : les quatre captures sont nettes, sans badge « Mock backend », et montrent l'interface entière.

## À regarder par Florian

- L'icône : `branding/app-icon.svg` (et `src-tauri/icons/128x128@2x.png`) te plaît-elle ?
- `npx tauri build --bundles deb`, puis `sudo apt install ./…/tunl_0.1.0_amd64.deb` : TunL est dans le menu
  « Internet » de Plasma, avec son icône ; lancée, sa fenêtre est groupée sous la bonne icône dans la barre des
  tâches (Wayland **et** X11 si tu peux) ; Discover montre sa fiche (résumé, description, captures après publication).
