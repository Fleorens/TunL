# T13 — Palette de commandes, connexion rapide et aide des raccourcis

| | |
|---|---|
| **Jalon** | M1 — Connexions |
| **Dépend de** | T15b |
| **Lire avant** | `docs/04-ecrans.md` §4, `docs/03-design.md` §8. Code existant : `grep -n "export"` sur `src/features/shell/shortcuts.ts`, `src/features/connections/filter.ts`, `src/lib/theme.ts` |
| **Livrable** | `CommandPalette` (`Ctrl+Shift+P`, `Ctrl+K`, `Ctrl+Shift+T`), `ShortcutsDialog` (`F1`), l'éditeur prérempli ; 17 tests unitaires et 5 scénarios e2e verts |

## Pourquoi

La palette est le chemin le plus court vers tout : une machine, une adresse tapée à la volée (`deploy@10.0.0.5`),
une action. Tant que les sessions n'existent pas (T19 à T21), ouvrir une connexion affiche « Coming soon » : le point
d'entrée unique `openSession` sera rempli plus tard, sans toucher à la palette.

## Contrat

### `src/features/palette/quick-connect.ts` (pur)

```ts
export interface QuickTarget { protocol: Protocol; username: string | null; host: string; port: number }
/** `[ssh://|rdp://][user@]host[:port]`; IPv6 in brackets (`[::1]:2222`), or bare without a port. */
export function parseQuickConnect(input: string): QuickTarget | null;
/** `user@host:port`, without the port when it is the protocol's default; IPv6 back in brackets when a port follows. */
export function formatQuickTarget(target: QuickTarget): string;
```

- `trim()` ; vide, ou un espace à l'intérieur → `null`.
- Schéma insensible à la casse : `ssh://` ou `rdp://`. Tout autre `xxx://` → `null`.
- Au plus un `@`, avec un utilisateur non vide avant.
- `[v6]:port` ou `[v6]` ; sinon, plus d'un `:` = IPv6 nu, sans port ; sinon `hôte:port`.
- Port entier entre 1 et 65535, sinon `null`. Hôte validé par `isValidHost` (`editor/validation.ts`).
- Protocole : le schéma s'il y en a un ; sinon `rdp` si le port vaut 3389 ; sinon `ssh`. Port par défaut 22 ou 3389.

### `src/features/palette/palette-model.ts` (pur)

```ts
export type PaletteActionId = "newConnection" | "importSshConfig" | "toggleTheme" | "shortcuts" | "settings";
/** In display order, with the shortcut shown next to each action. */
export const PALETTE_ACTIONS: readonly { id: PaletteActionId; shortcut: ShortcutId | null }[];
/** Actions whose translated label contains every search term (`normalizeForSearch`); all of them for "". */
export function filterActions(labels: Record<PaletteActionId, string>, search: string): PaletteActionId[];
/** Toggle between the two resolved themes: dark (or system that resolves to dark) → "light", otherwise "dark". */
export function nextTheme(mode: ThemeMode, systemPrefersDark: boolean): ThemeMode;
/** Rows of the F1 dialog: SHORTCUTS without tab.goTo2…tab.goTo8, and tab.goTo1 displayed as ["Alt", "1…8"]. */
export function shortcutRows(): { id: ShortcutId; display: readonly string[] }[];
```

Raccourcis de `PALETTE_ACTIONS` : `connection.new`, aucun, aucun, `help.shortcuts`, `settings.open`.

### `src/features/sessions/open-session.ts`

```ts
export type SessionKind = "terminal" | "sftp";
/** Single entry point to open a saved connection. Until T21: `notifyComingSoon()`. */
export function openSession(connection: Connection, kind?: SessionKind): void;
/** Same for an address typed on the fly. Until T21: `notifyComingSoon()`. */
export function openQuickSession(target: QuickTarget): void;
```

### `ui-store` et éditeur prérempli

- `palette: "all" | "quickConnect" | null`, `openPalette(mode)`, `closePalette()` ; `shortcutsOpen`,
  `openShortcuts()`, `closeShortcuts()`.
- `EditorTarget` en création accepte `prefill?: { host: string; port: number; username: string | null }`.
  `ConnectionEditor` part de `toFormValues(template, templates)` puis remplace `name` et `host` par `prefill.host`,
  `port` par `String(prefill.port)`, `username` par `prefill.username ?? ""`, **avant** le `reset` : le formulaire
  préremplli n'est pas « modifié ». `portTouched` passe à `true` si le port diffère de celui du modèle.

### `src/features/palette/CommandPalette.tsx`

Monté dans `AppLayout`. `CommandDialog` (titre et description `sr-only` traduits), recherche contrôlée remise à vide
à chaque ouverture.

- **Filtrage fait par nous** : `<Command shouldFilter={false}>`. Les connexions passent par `filterConnections`
  (T09), triées par nom ; les actions par `filterActions`. La valeur cmdk d'une connexion est son `id`.
- **Surbrillance** : la valeur cmdk est contrôlée (`value` / `onValueChange`), et, à chaque changement de recherche,
  remise sur le premier élément visible.
- Groupes, dans cet ordre :
  1. **Connections** (mode `all` seulement) : icône de protocole, nom, `user@host` en `text-muted-foreground`.
     `Entrée` → `openSession(connexion)` ; `Ctrl+Entrée` → `openSession(connexion, "sftp")` si SSH ;
     `Alt+Entrée` → éditeur en modification. Les deux derniers se gèrent dans un `onKeyDown` sur `Command`, en lisant
     la valeur en surbrillance.
  2. **Quick connect**, si `parseQuickConnect(recherche)` réussit : « SSH to deploy@web » (ou « RDP to … »), qui
     appelle `openQuickSession` ; puis « Save as a new connection… », qui ouvre l'éditeur en création avec `protocol`
     et `prefill`.
  3. **Actions** (mode `all` seulement) : New connection, Import ~/.ssh/config (`openImport`), Toggle theme
     (`nextTheme` puis `useSettings.update` ; en cas d'échec, `notifyError`), Keyboard shortcuts (`openShortcuts`),
     Settings (`notifyComingSoon` jusqu'à T31). Le raccourci s'affiche à droite (`CommandShortcut` + `ShortcutHint`).
- Mode `quickConnect` : placeholder « user@host[:port] », seul le groupe Quick connect existe.
- Toute action ferme d'abord la palette. Rien trouvé : « No results ».

### `src/features/palette/ShortcutsDialog.tsx`

`Dialog` « Keyboard shortcuts » : une ligne par `shortcutRows()`, libellé à gauche, touches à droite (`Kbd`).
Les libellés viennent d'une table `Record<ShortcutId, …>` de clés **littérales** (les clés i18n sont typées : une
chaîne construite avec `${id}` ne compile pas).

### Branchements

- `AppLayout` : `palette.open` → `openPalette("all")`, `palette.quickConnect` → `openPalette("quickConnect")`,
  `help.shortcuts` → `openShortcuts()`, `settings.open` → `notifyComingSoon()`.
- `TopBar` : le champ « Search or connect… » → `openPalette("all")`.

### Textes (anglais exact ; en français dans `fr.json`)

| Clé | Anglais |
|---|---|
| `palette.title` / `palette.description` | Command palette / Search a connection, type an address or run an action |
| `palette.placeholder` | Search connections and actions… |
| `palette.quickPlaceholder` | user@host[:port] |
| `palette.groups.connections` / `quickConnect` / `actions` | Connections / Quick connect / Actions |
| `palette.quickConnectTo` | {{protocol}} to {{target}} |
| `palette.saveAsConnection` | Save as a new connection… |
| `palette.noResults` | No results |
| `palette.actions.newConnection` / `importSshConfig` / `toggleTheme` / `shortcuts` / `settings` | New connection / Import ~/.ssh/config / Toggle theme / Keyboard shortcuts / Settings |
| `shortcuts.title` | Keyboard shortcuts |
| `shortcuts.labels.*` (un par `ShortcutId` affiché) | Command palette, Quick connect, New connection, Close tab, Next tab, Previous tab, Go to tab 1…8, Go to last tab, Toggle sidebar, Filter connections, Settings, Keyboard shortcuts |

`{{protocol}}` vaut « SSH » ou « RDP ».

### Pièges

- cmdk traite `Entrée` lui-même (il déclenche `onSelect`), **sauf** si le `onKeyDown` passé à `Command` a appelé
  `event.preventDefault()`. Pour `Alt+Entrée` et `Ctrl+Entrée`, l'appeler avant tout, sinon la connexion s'ouvre
  en plus de l'éditeur.
- `shouldFilter={false}` : cmdk ne filtre ni ne trie plus rien ; ce qui est rendu est ce qui s'affiche.
- L'entrée de cmdk a le rôle `combobox`, ses éléments le rôle `option` (les tests s'en servent).

## Tests du contrat

### `src/features/palette/quick-connect.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { formatQuickTarget, parseQuickConnect } from "./quick-connect";

describe("parseQuickConnect", () => {
  test("a bare host is SSH on port 22", () => {
    expect(parseQuickConnect("web")).toEqual({ protocol: "ssh", username: null, host: "web", port: 22 });
  });

  test("user, host and port", () => {
    expect(parseQuickConnect("  deploy@10.0.0.5:2222 ")).toEqual({
      protocol: "ssh",
      username: "deploy",
      host: "10.0.0.5",
      port: 2222,
    });
  });

  test("port 3389 or rdp:// means RDP", () => {
    expect(parseQuickConnect("win-02:3389")?.protocol).toBe("rdp");
    expect(parseQuickConnect("RDP://admin@win-02")).toEqual({
      protocol: "rdp",
      username: "admin",
      host: "win-02",
      port: 3389,
    });
    expect(parseQuickConnect("ssh://win-02:3389")?.protocol).toBe("ssh");
  });

  test("IPv6, with or without brackets", () => {
    expect(parseQuickConnect("[::1]:2200")).toMatchObject({ host: "::1", port: 2200 });
    expect(parseQuickConnect("root@fe80::1")).toMatchObject({ username: "root", host: "fe80::1", port: 22 });
    expect(parseQuickConnect("[fe80::1]")).toMatchObject({ host: "fe80::1", port: 22 });
  });

  test("what does not look like an address", () => {
    for (const input of ["", "   ", "two words", "http://web", "@web", "a@b@web", "web:0", "web:70000", "web:x", "bad_host!"]) {
      expect(parseQuickConnect(input), input).toBeNull();
    }
  });
});

describe("formatQuickTarget", () => {
  test("leaves out the default port and puts IPv6 back in brackets", () => {
    expect(formatQuickTarget({ protocol: "ssh", username: "deploy", host: "web", port: 22 })).toBe("deploy@web");
    expect(formatQuickTarget({ protocol: "ssh", username: null, host: "web", port: 2222 })).toBe("web:2222");
    expect(formatQuickTarget({ protocol: "rdp", username: null, host: "win", port: 3389 })).toBe("win");
    expect(formatQuickTarget({ protocol: "ssh", username: null, host: "::1", port: 2200 })).toBe("[::1]:2200");
    expect(formatQuickTarget({ protocol: "ssh", username: null, host: "::1", port: 22 })).toBe("::1");
  });
});
```

### `src/features/palette/palette-model.test.ts`

```ts
import { describe, expect, test } from "vitest";
import { filterActions, nextTheme, PALETTE_ACTIONS, type PaletteActionId, shortcutRows } from "./palette-model";

const LABELS: Record<PaletteActionId, string> = {
  newConnection: "New connection",
  importSshConfig: "Import ~/.ssh/config",
  toggleTheme: "Toggle theme",
  shortcuts: "Keyboard shortcuts",
  settings: "Settings",
};

describe("palette actions", () => {
  test("keep their display order and shortcuts", () => {
    expect(PALETTE_ACTIONS.map((action) => action.id)).toEqual([
      "newConnection",
      "importSshConfig",
      "toggleTheme",
      "shortcuts",
      "settings",
    ]);
    expect(PALETTE_ACTIONS[0].shortcut).toBe("connection.new");
    expect(PALETTE_ACTIONS[3].shortcut).toBe("help.shortcuts");
  });

  test("an empty search shows every action", () => {
    expect(filterActions(LABELS, "")).toHaveLength(5);
  });

  test("every term must match, case and accents aside", () => {
    expect(filterActions(LABELS, "THEME")).toEqual(["toggleTheme"]);
    expect(filterActions(LABELS, "new conn")).toEqual(["newConnection"]);
    expect(filterActions(LABELS, "ssh")).toEqual(["importSshConfig"]);
    expect(filterActions({ ...LABELS, settings: "Paramètres" }, "parametres")).toEqual(["settings"]);
    expect(filterActions(LABELS, "nothing here")).toEqual([]);
  });
});

describe("nextTheme", () => {
  test("switches the resolved theme", () => {
    expect(nextTheme("dark", false)).toBe("light");
    expect(nextTheme("light", true)).toBe("dark");
    expect(nextTheme("system", true)).toBe("light");
    expect(nextTheme("system", false)).toBe("dark");
  });
});

describe("shortcutRows", () => {
  test("folds Alt+1…8 into one row and keeps the last-tab shortcut", () => {
    const rows = shortcutRows();
    const ids = rows.map((row) => row.id);
    expect(ids).toContain("palette.open");
    expect(ids).toContain("tab.goTo1");
    expect(ids).toContain("tab.goTo9");
    expect(ids).not.toContain("tab.goTo2");
    expect(ids).not.toContain("tab.goTo8");
    expect(rows.find((row) => row.id === "tab.goTo1")?.display).toEqual(["Alt", "1…8"]);
  });
});
```

### `e2e/palette.spec.ts`

```ts
import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function palette(page: Page) {
  return page.getByRole("dialog");
}

test("the palette finds a connection by host, and Alt+Enter edits it", async ({ page }) => {
  await page.keyboard.press("Control+Shift+P");
  await palette(page).getByRole("combobox").fill("10.0.0.12");
  await expect(palette(page).getByRole("option", { name: /web-01/ })).toBeVisible();
  await page.keyboard.press("Alt+Enter");
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Edit web-01" })).toBeVisible();
});

test("Enter on a connection opens it (sessions come later)", async ({ page }) => {
  await page.getByRole("button", { name: /Search or connect/ }).click();
  await palette(page).getByRole("combobox").fill("db-prod");
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByText("Coming soon")).toBeVisible();
});

test("quick connect can be saved as a new connection", async ({ page }) => {
  await page.keyboard.press("Control+Shift+T");
  await palette(page).getByRole("combobox").fill("deploy@10.5.5.5:2222");
  await expect(palette(page).getByRole("option", { name: "SSH to deploy@10.5.5.5:2222" })).toBeVisible();
  await palette(page).getByRole("option", { name: "Save as a new connection…" }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("heading", { name: "New connection" })).toBeVisible();
  await expect(editor.getByLabel("Host", { exact: true })).toHaveValue("10.5.5.5");
  await expect(editor.getByLabel("Port", { exact: true })).toHaveValue("2222");
  await expect(editor.getByLabel("Username", { exact: true })).toHaveValue("deploy");
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});

test("rdp:// switches the quick connect protocol", async ({ page }) => {
  await page.keyboard.press("Control+Shift+P");
  await palette(page).getByRole("combobox").fill("rdp://win-02");
  await expect(palette(page).getByRole("option", { name: "RDP to win-02" })).toBeVisible();
});

test("F1 lists the keyboard shortcuts", async ({ page }) => {
  await page.keyboard.press("F1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(dialog.getByText("Command palette")).toBeVisible();
  await expect(dialog.getByText("Go to tab 1…8")).toBeVisible();
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T13`.
2. `quick-connect.ts`, `palette-model.ts`, `open-session.ts`, puis `npx vitest run src/features/palette`.
3. `ui-store`, le préremplissage de l'éditeur, `CommandPalette`, `ShortcutsDialog`, les branchements, les textes.
4. `npm run format`, `npm run review`, cases, statut, commit `feat: command palette, quick connect and shortcuts help (T13)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T13 --check` affiche `OK` partout.
- [ ] `openSession` et `openQuickSession` sont les **seuls** endroits du code qui décident quoi faire d'une connexion
      à ouvrir : la palette ne contient aucun `notifyComingSoon` pour ça.
- [ ] Visuel : la palette est centrée à un tiers de la hauteur, 640 px de large, effet `glass`, et la surbrillance
      suit les flèches.

## À regarder par Florian

`Ctrl+Shift+P`, taper une partie d'une IP ou d'une étiquette ; `Ctrl+Shift+T`, taper `root@192.168.1.10` puis
« Save as a new connection… » ; `F1`.
