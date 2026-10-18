# T20 — Composant terminal xterm.js 6 (thèmes, ajustement, recherche, liens, copier / coller, zoom)

| | |
|---|---|
| **Jalon** | M2 — SSH |
| **Dépend de** | T19 |
| **Lire avant** | `docs/03-design.md` §8 et §9, `docs/04-ecrans.md` §5, `docs/06-securite.md` §2 (S10, S13, S14) |
| **Livrable** | `src/features/terminal/` (`TerminalView`, `TerminalSearch`, `port`, `themes`, `terminal-keys`), `lib/opener.ts`, `lib/clipboard.ts` étendu, section « Terminal » de la galerie, deux plugins Tauri ; 13 tests Vitest, 7 scénarios e2e |

## Pourquoi

Le terminal est l'écran où l'utilisateur passera le plus de temps. Cette fiche le construit **seul**, sans session :
un composant `TerminalView` qui parle à un « port » (des octets qui arrivent, des frappes qui partent, une taille).
T21 branchera ce port sur `ipc.sshOpen` ; ici, la galerie de développement (`/#gallery`) le branche sur un écho
local, ce qui permet de tout tester dans le navigateur.

## À réutiliser (ne pas réécrire)

- `useSettings` (`features/settings/store`) : `settings.terminal` (`theme`, `fontFamily`, `fontSize`, `lineHeight`,
  `cursorStyle`, `cursorBlink`, `scrollback`, `copyOnSelect`) ; `useResolvedTheme()` (`lib/theme.ts`) → `"dark"` ou
  `"light"` ; `isMockBackend` (`lib/ipc.ts`) ; `notifyError` (`lib/errors.ts`).
- `SHORTCUTS`, `ShortcutsDialog` (T13) ; `Input`, `Button`, `Toggle` ou `Button` + `aria-pressed`, `Tooltip` de
  `components/ui`.
- Les raccourcis de l'app sont déjà protégés : `use-global-shortcuts.ts` écoute en **phase de capture** et reconnaît
  un terminal par l'attribut `data-terminal`. Le terminal n'a à gérer que ses propres touches.

## Contrat

### Dépendances (versions exactes vérifiées le 2026-09-28)

```bash
npm install @xterm/xterm@6.0.0 @xterm/addon-fit@0.11.0 @xterm/addon-webgl@0.19.0 @xterm/addon-search@0.16.0 \
  @xterm/addon-web-links@0.12.0 @tauri-apps/plugin-opener@2.6.0 @tauri-apps/plugin-clipboard-manager@2.4.0
```

`src-tauri/Cargo.toml` : `tauri-plugin-opener = "2.6"` et `tauri-plugin-clipboard-manager = "2.4"` ; dans `lib.rs`,
`.plugin(tauri_plugin_opener::init())` et `.plugin(tauri_plugin_clipboard_manager::init())`.
`src-tauri/capabilities/default.json` (S14, la portée la plus étroite ; **validé par `tauri-build`**) :

```json
"permissions": [
  "core:default",
  { "identifier": "opener:allow-open-url", "allow": [{ "url": "http://*" }, { "url": "https://*" }] },
  "clipboard-manager:allow-read-text",
  "clipboard-manager:allow-write-text"
]
```

Pas d'addon `clipboard` d'xterm (OSC 52, S10), pas d'`addon-unicode11`, pas d'`addon-image`.

### `src/features/terminal/port.ts` (pur)

```ts
export interface TerminalPort {
  /** Receives the output; what arrived before is replayed first. One listener at a time. Returns the unsubscribe. */
  subscribe(listener: (bytes: Uint8Array) => void): () => void;
  write(data: string): void;
  resize(cols: number, rows: number): void;          // forwarded only when the size changes
}
export interface PortSender { write(data: string): void; resize(cols: number, rows: number): void }
export const PORT_BUFFER_LIMIT = 1024 * 1024;
export function createTerminalPort(sender: PortSender, limit = PORT_BUFFER_LIMIT):
  { port: TerminalPort; push(bytes: Uint8Array): void };
```

Sans auditeur, `push` garde les morceaux (les plus anciens sont jetés dès que le total dépasse `limit`). `subscribe`
les rejoue dans l'ordre, vide la réserve, puis transmet en direct. Un nouvel abonnement remplace le précédent ; après
un désabonnement, la sortie est de nouveau gardée.

### `src/features/terminal/themes.ts`

```ts
import type { ITheme } from "@xterm/xterm";
export const TUNL_NIGHT: ITheme;   // docs/03-design.md §9, colonne tunl-night, les 16 couleurs ANSI comprises
export const TUNL_DAY: ITheme;     // colonne tunl-day
export function resolveTerminalTheme(setting: TerminalTheme, appIsDark: boolean): ITheme;  // "auto" suit l'app
```

Les couleurs de recherche (`matchBackground`, `activeMatchBackground`, etc. de l'addon) vivent aussi dans ce
fichier : ce sont des données de thème, pas des couleurs écrites dans un composant.

### `src/features/terminal/terminal-keys.ts` (pur)

```ts
export type TerminalKeyAction = "copy" | "paste" | "search" | "zoomIn" | "zoomOut" | "zoomReset";
export type ZoomAction = "in" | "out" | "reset";
export const FONT_SIZE_MIN = 8; export const FONT_SIZE_MAX = 32;
export function terminalKeyAction(event: KeyInfo): TerminalKeyAction | null;
export function zoomFontSize(current: number, action: ZoomAction, base: number): number;  // ±1, borné ; reset → base
export function isOpenableUrl(uri: string): boolean;   // http: ou https: seulement, URL analysable (S10)
```

`KeyInfo` : exporter le type existant de `features/shell/shortcuts.ts` (`export type KeyInfo = …`).
Correspondances (sans `Alt` ni `Meta`) : `Ctrl+Shift+C` / `V` / `F` (touche insensible à la casse) → `copy`, `paste`,
`search` ; `Ctrl` + `=` ou `+` (avec ou sans `Shift`), ou `code === "NumpadAdd"` → `zoomIn` ; `Ctrl` + `-`, ou
`NumpadSubtract` → `zoomOut` ; `Ctrl` + `code` `Digit0` ou `Numpad0` (l'AZERTY donne `key === "à"`) → `zoomReset`.
Tout le reste → `null`, et en particulier `Ctrl+C` / `Ctrl+V` sans `Shift`, qui appartiennent au shell (D12).

### `src/lib/opener.ts` et `src/lib/clipboard.ts`

- `openExternal(url: string): Promise<void>` : refuse (sans rien faire) ce que `isOpenableUrl` refuse ; Tauri →
  `openUrl(url)` de `@tauri-apps/plugin-opener` ; navigateur → `window.open(url, "_blank", "noopener,noreferrer")`.
  C'est le seul fichier qui importe ce plugin.
- `clipboard.ts` garde `copyText` (avec son toast) et ajoute `readClipboardText(): Promise<string>` et
  `writeClipboardText(text: string): Promise<void>` (**sans** toast : on copie souvent dans un terminal) : Tauri →
  `readText` / `writeText` de `@tauri-apps/plugin-clipboard-manager` ; navigateur → `navigator.clipboard`. Seul
  fichier qui importe ce plugin.

### `src/features/terminal/TerminalView.tsx`

`export function TerminalView({ port, active }: { port: TerminalPort; active: boolean })`

- Un conteneur `data-terminal`, `h-full w-full`, avec en style **en ligne** `background` = fond du thème et
  `padding: "8px 12px"` ; à l'intérieur, l'élément où xterm s'ouvre. `import "@xterm/xterm/css/xterm.css";`.
- `new Terminal({ fontFamily: '"<fontFamily>", monospace', fontSize, lineHeight, cursorStyle, cursorBlink,
  scrollback, theme, allowProposedApi: true })` — `allowProposedApi` est **exigé** par les décorations de l'addon de
  recherche. Addons : `FitAddon`, `SearchAddon`, `WebLinksAddon((event, uri) => event.ctrlKey && isOpenableUrl(uri) &&
  void openExternal(uri))` (lien seulement au `Ctrl+clic`, S10), et `WebglAddon` **sauf** avec le mock
  (`isMockBackend`) : les e2e lisent le texte dans le DOM (`.xterm-rows`), que le rendu WebGL ne produit pas.
  WebGL dans un `try/catch`, et `onContextLoss` → `dispose()` : on retombe sur le rendu DOM.
- Branchements : `term.onData(port.write)` ; `port.subscribe((bytes) => term.write(bytes))` ;
  `term.onResize(({ cols, rows }) => port.resize(cols, rows))`.
- Ajustement : un `ResizeObserver` sur le conteneur → au prochain `requestAnimationFrame`, si le conteneur a une
  largeur non nulle, `fit.fit()` puis `port.resize(term.cols, term.rows)` (le port ignore une taille inchangée).
  Même chose quand `active` passe à vrai, **et focus du terminal**. Et une fois `document.fonts.ready` résolu :
  xterm mesure la cellule à l'ouverture, avant que la police ne soit chargée.
- Réglages appliqués **à chaud** (`term.options.… = …`, puis `fit`) : thème (`resolveTerminalTheme(setting,
  useResolvedTheme() === "dark")`), police, taille, interligne, curseur, défilement. `copyOnSelect` →
  `term.onSelectionChange` → `writeClipboardText(term.getSelection())` si la sélection n'est pas vide.
- Touches : `term.attachCustomKeyEventHandler((event) => …)` : seulement sur `keydown` ; si `terminalKeyAction`
  renvoie une action, `event.preventDefault()`, l'exécuter, renvoyer `false` (xterm l'ignore) ; sinon `true`.
  - `copy` : `writeClipboardText(term.getSelection())` si non vide ; `paste` : `readClipboardText()` puis
    `term.paste(text)` (le mode « bracketed paste » est géré par xterm) ; erreurs → `notifyError`.
  - `search` : ouvre `TerminalSearch` ; zoom : `zoomFontSize(courante, action, settings.fontSize)`, propre à ce
    terminal (le réglage global ne change pas), puis `fit`.
- Démontage : `dispose()` du terminal (il libère les addons), désabonnement du port, `disconnect()` de
  l'observateur.

### `src/features/terminal/TerminalSearch.tsx`

Petit panneau flottant en haut à droite du terminal (`glass`, `rounded-lg`, `shadow-elevated`) :
`Input type="search"` (`aria-label` « Search the terminal », donc le rôle `searchbox`), le compteur, deux boutons
icônes (précédent / suivant, `aria-label` + `Tooltip`), deux bascules (`aria-pressed`) « Match case » et
« Regular expression ».
- Chaque frappe : `search.findNext(texte, { caseSensitive, regex, incremental: true, decorations })` ; `Entrée` →
  suivant, `Maj+Entrée` → précédent ; texte vide → `clearDecorations()` et pas de compteur.
- Compteur : `search.onDidChangeResults(({ resultIndex, resultCount }))` (il ne se déclenche qu'avec
  `decorations`) : `0` → « No results », sinon « `resultIndex + 1` of `resultCount` ».
- `Échap` → ferme le panneau, `clearDecorations()`, focus du terminal.

### Raccourcis affichés par F1

`shortcuts.ts` : `export const TERMINAL_SHORTCUTS: readonly { id: TerminalKeyAction; display: readonly string[] }[]`
(copier `Ctrl ⇧ C`, coller `Ctrl ⇧ V`, rechercher `Ctrl ⇧ F`, zoom `Ctrl =`, `Ctrl -`, `Ctrl 0`), **affichage
seulement** (la détection reste `terminalKeyAction`). `ShortcutsDialog` ajoute une section titrée « Terminal »
(un `<h3>`) sous la liste actuelle.

### Galerie : `src/dev/gallery/TerminalSection.tsx` (développement seulement)

`<section aria-label="Terminal">`, un titre, une boîte de 320 px de haut avec `<TerminalView port={…} active />`.
Le port de démonstration (`createTerminalPort` sur un émetteur local, dans le même dossier) écrit d'abord
`TunL terminal demo\r\n$ `, fait l'écho des caractères imprimables, efface avec `\u007f` (`\b \b`), affiche `^C\r\n$ `
pour `\u0003` (et vide la ligne), et sur `\r` écrit `\r\n` puis `you typed: <ligne>\r\n$ `. Ajoutée à `Gallery.tsx`.

### Textes (anglais exact ; en français dans `fr.json`)

| Clé | Anglais |
|---|---|
| `terminal.search.label` | Search the terminal |
| `terminal.search.count` | {{current}} of {{total}} |
| `terminal.search.none` | No results |
| `terminal.search.next` / `previous` | Next match / Previous match |
| `terminal.search.caseSensitive` / `regex` | Match case / Regular expression |
| `shortcuts.terminal.title` | Terminal |
| `shortcuts.terminal.copy` / `paste` / `search` | Copy / Paste / Search the terminal |
| `shortcuts.terminal.zoomIn` / `zoomOut` / `zoomReset` | Zoom in / Zoom out / Reset zoom |

## Pièges

- xterm 6 : les paquets sont `@xterm/*` (jamais `xterm`, `xterm-addon-*`) ; `term.write` accepte un `Uint8Array`.
- `fit()` sur un conteneur caché (`display: none`, onglet inactif en T21) donne une taille nulle : toujours tester la
  largeur avant.
- Sans `allowProposedApi: true`, la recherche avec décorations lève une exception ; sans `decorations`,
  `onDidChangeResults` ne se déclenche jamais.
- Un raccourci de l'app tapé dans le terminal (`Ctrl+Shift+P`…) n'arrive jamais jusqu'à xterm : ne pas le gérer ici.
- `TerminalView.tsx` dépassera vite 250 lignes : sortir la création d'xterm dans un hook (`use-xterm.ts`).

## Tests du contrat

### `src/features/terminal/port.test.ts`

```ts
import { describe, expect, test, vi } from "vitest";
import { createTerminalPort } from "./port";

const bytes = (text: string) => new TextEncoder().encode(text);
const text = (chunks: Uint8Array[]) => chunks.map((c) => new TextDecoder().decode(c)).join("");

function sender() {
  return {
    write: vi.fn<(data: string) => void>(),
    resize: vi.fn<(cols: number, rows: number) => void>(),
  };
}

describe("createTerminalPort", () => {
  test("output that arrives before the terminal is replayed in order, then goes live", () => {
    const { port, push } = createTerminalPort(sender());
    push(bytes("Welcome\r\n"));
    push(bytes("$ "));
    const seen: Uint8Array[] = [];
    port.subscribe((chunk) => seen.push(chunk));
    expect(text(seen)).toBe("Welcome\r\n$ ");
    push(bytes("ls"));
    expect(text(seen)).toBe("Welcome\r\n$ ls");
  });

  test("while nobody listens, the oldest output is dropped beyond the limit", () => {
    const { port, push } = createTerminalPort(sender(), 10);
    push(bytes("aaaa"));
    push(bytes("bbbb"));
    push(bytes("cccc"));
    const seen: Uint8Array[] = [];
    port.subscribe((chunk) => seen.push(chunk));
    expect(text(seen)).toBe("bbbbcccc");
  });

  test("after unsubscribing, output is kept for the next listener", () => {
    const { port, push } = createTerminalPort(sender());
    const first: Uint8Array[] = [];
    const unsubscribe = port.subscribe((chunk) => first.push(chunk));
    push(bytes("one"));
    unsubscribe();
    push(bytes("two"));
    const second: Uint8Array[] = [];
    port.subscribe((chunk) => second.push(chunk));
    expect(text(first)).toBe("one");
    expect(text(second)).toBe("two");
  });

  test("a new listener replaces the previous one", () => {
    const { port, push } = createTerminalPort(sender());
    const first: Uint8Array[] = [];
    const second: Uint8Array[] = [];
    port.subscribe((chunk) => first.push(chunk));
    port.subscribe((chunk) => second.push(chunk));
    push(bytes("x"));
    expect(first).toHaveLength(0);
    expect(text(second)).toBe("x");
  });

  test("input goes straight to the sender; a size is sent only when it changes", () => {
    const s = sender();
    const { port } = createTerminalPort(s);
    port.write("ls\r");
    port.resize(80, 24);
    port.resize(80, 24);
    port.resize(120, 40);
    expect(s.write).toHaveBeenCalledWith("ls\r");
    expect(s.resize.mock.calls).toEqual([
      [80, 24],
      [120, 40],
    ]);
  });
});
```

### `src/features/terminal/themes.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { resolveTerminalTheme, TUNL_DAY, TUNL_NIGHT } from "./themes";

const ANSI = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;

describe("terminal themes (docs/03-design.md §9)", () => {
  test("auto follows the app theme; an explicit choice wins", () => {
    expect(resolveTerminalTheme("auto", true)).toBe(TUNL_NIGHT);
    expect(resolveTerminalTheme("auto", false)).toBe(TUNL_DAY);
    expect(resolveTerminalTheme("tunlDay", true)).toBe(TUNL_DAY);
    expect(resolveTerminalTheme("tunlNight", false)).toBe(TUNL_NIGHT);
  });

  test("the palettes carry the documented values", () => {
    expect(TUNL_NIGHT).toMatchObject({
      background: "#0a0d12",
      foreground: "#e6e8ee",
      cursor: "#17cced",
      cursorAccent: "#0a0d12",
      selectionBackground: "#17cced40",
      red: "#ff6b70",
      brightWhite: "#f2f3f6",
    });
    expect(TUNL_DAY).toMatchObject({
      background: "#fbfbfd",
      foreground: "#1b202b",
      cursor: "#0070b0",
      selectionBackground: "#0070b02e",
      green: "#0b7a4f",
      brightWhite: "#9ca3af",
    });
  });

  test("both palettes define the sixteen ANSI colors", () => {
    for (const theme of [TUNL_NIGHT, TUNL_DAY]) {
      for (const color of ANSI) expect(theme[color], color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});
```

### `src/features/terminal/terminal-keys.test.ts`

```ts
import { describe, expect, test } from "vitest";
import type { KeyInfo } from "@/features/shell/shortcuts";
import { isOpenableUrl, terminalKeyAction, zoomFontSize } from "./terminal-keys";

function key(
  k: string,
  mods: { ctrl?: boolean; shift?: boolean; alt?: boolean; code?: string } = {},
): KeyInfo {
  return {
    key: k,
    code: mods.code ?? "",
    ctrlKey: mods.ctrl ?? false,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    metaKey: false,
  };
}

describe("terminalKeyAction", () => {
  test("copy, paste and search use Ctrl+Shift, so Ctrl+C stays the shell's", () => {
    expect(terminalKeyAction(key("C", { ctrl: true, shift: true }))).toBe("copy");
    expect(terminalKeyAction(key("V", { ctrl: true, shift: true }))).toBe("paste");
    expect(terminalKeyAction(key("F", { ctrl: true, shift: true }))).toBe("search");
    expect(terminalKeyAction(key("c", { ctrl: true }))).toBeNull();
    expect(terminalKeyAction(key("v", { ctrl: true }))).toBeNull();
    expect(terminalKeyAction(key("f", { ctrl: true }))).toBeNull();
  });

  test("zoom works on QWERTY and AZERTY alike", () => {
    expect(terminalKeyAction(key("=", { ctrl: true }))).toBe("zoomIn");
    expect(terminalKeyAction(key("+", { ctrl: true, shift: true }))).toBe("zoomIn");
    expect(terminalKeyAction(key("+", { ctrl: true, code: "NumpadAdd" }))).toBe("zoomIn");
    expect(terminalKeyAction(key("-", { ctrl: true }))).toBe("zoomOut");
    expect(terminalKeyAction(key("-", { ctrl: true, code: "NumpadSubtract" }))).toBe("zoomOut");
    expect(terminalKeyAction(key("0", { ctrl: true, code: "Digit0" }))).toBe("zoomReset");
    // AZERTY: the 0 key gives "à" without Shift.
    expect(terminalKeyAction(key("à", { ctrl: true, code: "Digit0" }))).toBe("zoomReset");
    expect(terminalKeyAction(key("0", { ctrl: true, code: "Numpad0" }))).toBe("zoomReset");
  });

  test("anything else, Alt combos included, is left to xterm", () => {
    expect(terminalKeyAction(key("a"))).toBeNull();
    expect(terminalKeyAction(key("=", { ctrl: true, alt: true }))).toBeNull();
    expect(terminalKeyAction(key("C", { ctrl: true, shift: true, alt: true }))).toBeNull();
  });
});

describe("zoomFontSize", () => {
  test("one pixel per step, between 8 and 32, reset to the setting", () => {
    expect(zoomFontSize(13, "in", 13)).toBe(14);
    expect(zoomFontSize(13, "out", 13)).toBe(12);
    expect(zoomFontSize(32, "in", 13)).toBe(32);
    expect(zoomFontSize(8, "out", 13)).toBe(8);
    expect(zoomFontSize(20, "reset", 13)).toBe(13);
  });
});

describe("isOpenableUrl", () => {
  test("only http and https links open (S10)", () => {
    expect(isOpenableUrl("https://tunl.dev/docs")).toBe(true);
    expect(isOpenableUrl("http://10.0.0.5:8080/")).toBe(true);
    expect(isOpenableUrl("file:///etc/passwd")).toBe(false);
    expect(isOpenableUrl("javascript:alert(1)")).toBe(false);
    expect(isOpenableUrl("ftp://host/file")).toBe(false);
    expect(isOpenableUrl("not a url")).toBe(false);
  });
});
```

### `e2e/terminal.spec.ts`

```ts
// T20: the terminal component, driven in the design gallery by a local echo port (no session needed).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/#gallery");
});

function terminal(page: Page) {
  return page.getByRole("region", { name: "Terminal", exact: true }).locator("[data-terminal]");
}

function screen(page: Page) {
  return terminal(page).locator(".xterm-rows");
}

async function typeLine(page: Page, line: string) {
  await terminal(page).click();
  await page.keyboard.type(line);
  await page.keyboard.press("Enter");
}

test("typing reaches the port and its output is drawn", async ({ page }) => {
  await expect(screen(page)).toContainText("TunL terminal demo");
  await typeLine(page, "hello");
  await expect(screen(page)).toContainText("you typed: hello");
});

test("the terminal follows the app theme, padding included", async ({ page }) => {
  await expect(terminal(page)).toHaveCSS("background-color", "rgb(10, 13, 18)");
  await expect(terminal(page)).toHaveCSS("padding", "8px 12px");
  await page.emulateMedia({ colorScheme: "light" });
  await expect(terminal(page)).toHaveCSS("background-color", "rgb(251, 251, 253)");
});

test("Ctrl+= and Ctrl+- zoom, Ctrl+0 goes back to the setting", async ({ page }) => {
  await terminal(page).click();
  const fontSize = () => screen(page).evaluate((element) => getComputedStyle(element).fontSize);
  await expect.poll(fontSize).toBe("13px");
  await page.keyboard.press("Control+Equal");
  await expect.poll(fontSize).toBe("14px");
  await page.keyboard.press("Control+Minus");
  await page.keyboard.press("Control+Minus");
  await expect.poll(fontSize).toBe("12px");
  await page.keyboard.press("Control+Digit0");
  await expect.poll(fontSize).toBe("13px");
});

test("Ctrl+Shift+F searches the scrollback; Escape gives the focus back", async ({ page }) => {
  await typeLine(page, "hello");
  await expect(screen(page)).toContainText("you typed: hello");
  await page.keyboard.press("Control+Shift+F");
  const search = page.getByRole("searchbox", { name: "Search the terminal" });
  await expect(search).toBeFocused();
  await search.fill("hello");
  await expect(page.getByText(/^[12] of 2$/)).toBeVisible();
  await expectSaneUi(page);

  await search.fill("absent-word");
  await expect(page.getByText("No results")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(terminal(page).locator("textarea")).toBeFocused();
});

test("Ctrl+Shift+C copies the selection and Ctrl+Shift+V pastes it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await expect(screen(page)).toContainText("TunL terminal demo");
  // A double click selects the word under the pointer: "TunL", the first word of the first row.
  // `force`: xterm's DOM renderer makes `.xterm-rows` `pointer-events: none`, so the click lands on
  // `.xterm-screen` at that point, which is what xterm listens to (validated by Florian, 2026-10-11).
  await screen(page)
    .locator("div")
    .first()
    .dblclick({ position: { x: 6, y: 6 }, force: true });
  await page.keyboard.press("Control+Shift+C");
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe("TunL");

  await page.keyboard.press("Control+Shift+V");
  await page.keyboard.press("Enter");
  await expect(screen(page)).toContainText("you typed: TunL");
});

test("Ctrl+C and Ctrl+V without Shift stay with the shell", async ({ page }) => {
  await terminal(page).click();
  await page.keyboard.type("abc");
  // Ctrl+C sends ETX (0x03) to the port, which the demo shows as ^C.
  await page.keyboard.press("Control+KeyC");
  await expect(screen(page)).toContainText("abc^C");
});

test("F1 lists the terminal's own shortcuts too", async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("F1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Terminal" })).toBeVisible();
  await expect(dialog.getByText("Search the terminal")).toBeVisible();
  await expect(dialog.getByText("Paste", { exact: true })).toBeVisible();
  await expectSaneUi(page);
});
```


## Étapes

1. Les tests : `node scripts/contract-tests.mjs T20`.
2. Les dépendances (npm, Cargo, `lib.rs`, capabilities), puis `npm run typecheck`.
3. `port.ts`, `themes.ts`, `terminal-keys.ts`, `opener.ts`, `clipboard.ts`, puis `npx vitest run src/features/terminal`.
4. `TerminalView` (et son hook), `TerminalSearch`, la section de la galerie, les raccourcis de F1, les textes en / fr.
5. `npm run format`, `npm run review`, cases, statut, commit `feat: xterm.js terminal component with search, zoom and clipboard (T20)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T20 --check` affiche `OK` partout.
- [x] `grep -rn "plugin-opener\|plugin-clipboard-manager" src` ne trouve que `lib/opener.ts` et `lib/clipboard.ts`.
- [x] Visuel : dans `/#gallery`, le terminal a la police Geist Mono, le curseur barre cyan clignotant, la marge
      intérieure du fond du terminal, et le panneau de recherche ne cache pas la première ligne de texte.

## À regarder par Florian

`npm run dev`, puis `http://localhost:1420/#gallery`, section « Terminal » : taper, zoomer, `Ctrl+Shift+F`. Dans
`npm run tauri dev`, le vrai terminal n'apparaît qu'avec T21.
