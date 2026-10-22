# T31 — Onglet Paramètres : apparence, terminal, disponibilité, à propos

| | |
|---|---|
| **Jalon** | M7 — Finitions |
| **Dépend de** | T30b |
| **Lire avant** | `docs/04-ecrans.md` §10 et §1 (« TabBar »), `docs/05-modele-donnees.md` §5, `docs/03-design.md` §2 (titres) et §10 |
| **Livrable** | l'onglet Paramètres dans la barre d'onglets (roue dentée, `Ctrl+,`, palette) ; `features/settings/` : vue, rangées, 4 sections ; `features/sessions/tabs.ts` ; 4 fichiers de tests (dont `e2e/shell.spec.ts` remplacé) |

## Pourquoi

La roue dentée, `Ctrl+,` et l'action « Paramètres » de la palette affichent encore « Coming soon ». Tous les réglages
existent pourtant côté Rust (`settings.json`, T08) et sont déjà lus par l'app : thème, langue, animations, terminal,
sondes. Cette fiche ajoute l'**onglet Paramètres** de `docs/04-ecrans.md` §10, avec ses quatre premières sections.
SSH, SFTP et RDP viennent en T31b (ils demandent du backend).

Chaque réglage s'enregistre **au changement**, sans bouton « Enregistrer » ; un refus du backend s'affiche en toast.

Prototypé par l'orchestrateur : les tests de cette fiche passent, avec toute la recette e2e.

## À réutiliser (ne pas réécrire)

- `useSettings` (`features/settings/store.ts`) : `settings`, `update(next)` qui renvoie un `Result` sans toast ;
  `notifyError` (`lib/errors.ts`).
- `useApplySettings` (T03, T20) applique déjà thème, langue et animations ; `useXterm` applique déjà les réglages du
  terminal **à chaud**. Cette fiche n'a qu'à **écrire** les réglages.
- `ipc.appInfo()` (`AppInfo` : `name`, `version`, `configDir`, `logDir`…) ; `openExternal`, `revealInFolder`
  (`lib/opener.ts`) ; `Logo`.
- shadcn : `Select`, `Switch`, `Input`, `Label`, `Button`, `ScrollArea`.
- Clés i18n existantes : `theme.system|dark|light`, `language.system|en|fr`.

## Contrat

### Les onglets : `src/features/sessions/tabs.ts` (nouveau, pur)

```ts
export const SETTINGS_TAB = "settings";            // jamais un id de session (ce sont des UUID)
/** Les ids de la barre : les sessions dans l'ordre, puis Paramètres s'il est ouvert. */
export function tabIds(sessions: readonly Session[], settingsOpen: boolean): string[];
/** L'onglet à `delta` pas de `activeId`, en boucle ; sans onglet actif : le premier (+1) ou le dernier (−1). */
export function relativeTab(ids: readonly string[], activeId: string | null, delta: 1 | -1): string | null;
/** L'onglet à montrer quand `removedId` part : celui d'après, sinon celui d'avant, sinon aucun. */
export function neighbourTab(ids: readonly string[], removedId: string): string | null;
```

### Le store des sessions (`features/sessions/store.ts`)

- Nouvel état `settingsOpen: boolean` (faux au départ), et deux actions :
  - `openSettings()` : `settingsOpen: true`, `activeId: SETTINGS_TAB` (un 2ᵉ appel va au même onglet) ;
  - `closeSettings()` : `settingsOpen: false` ; si Paramètres était actif, `activeId` = `neighbourTab(…)`.
- `activateIndex` et `activateRelative` parcourent `tabIds(sessions, settingsOpen)` (Paramètres compris).
- `requestClose(SETTINGS_TAB)` appelle `closeSettings()`.
- `close(id)` choisit l'onglet suivant avec `neighbourTab(tabIds(…), id)` ; la fonction locale `neighbour` disparaît.
- `activeId === SETTINGS_TAB` n'est pas une session : la barre d'état n'affiche alors rien à droite (elle cherche la
  session active, et n'en trouve pas : rien à changer).

### La barre d'onglets (`TabBar.tsx`)

- Le rendu d'un onglet devient un `TabFrame({ id, title, active, activate, close, children })` (rôle `tab`, clic,
  clic du milieu, `Entrée`, bouton fermer `tabs.close`, indicateur `layoutId="tab-indicator"`), utilisé par
  `SessionTab` (pastille + icône de protocole) et par l'onglet Paramètres (icône `Settings2`, titre
  `settings.title`), rendu **après** les sessions quand `settingsOpen`.

### Les branchements

- `TopBar` (roue dentée), `AppLayout` (`"settings.open"`, `Ctrl+,`) et `CommandPalette` (action `settings`) :
  `useSessions.getState().openSettings()`. Plus aucun d'eux n'importe `notifyComingSoon` (il reste utilisé par la
  connexion rapide RDP, `open-session.ts`).
- `AppLayout`, zone de contenu : l'accueil seulement s'il n'y a **ni** session **ni** Paramètres ; sinon les
  `SessionView` puis, si `settingsOpen`, `<SettingsView active={activeId === SETTINGS_TAB} />`.

### `src/features/settings/` (nouveaux fichiers)

| Fichier | Contenu |
|---|---|
| `settings-options.ts` | pur : `FONT_SIZES` `[10,11,12,13,14,15,16,18,20,22,24,28,32]`, `LINE_HEIGHTS` `[1,1.1,1.2,1.25,1.3,1.4,1.5,1.75,2]`, `SCROLLBACKS` `[1000,5000,10000,25000,50000,100000]`, `PROBE_INTERVALS` `[15,30,60,120,300,900,3600]`, `FONT_FAMILY_MAX = 64` ; `withCurrent(options, current)` (ajoute une valeur posée à la main, triée, sans doublon, nouveau tableau) ; `cleanFontFamily(value)` (le nom rogné, ou `null` si vide, > 64 caractères ou avec un caractère de contrôle C0, DEL ou C1 : les refus du Rust) ; `intervalParts(seconds)` → `{ unit: "seconds" \| "minutes" \| "hours", count }` (la plus grande unité entière) |
| `save-settings.ts` | `saveSettings(change: (current) => Settings): Promise<boolean>` : rien avant le chargement ; `update(change(current))` ; refus → `notifyError` |
| `SettingRow.tsx` | `SettingRow({ id, label, description?, children })` : à gauche le `Label htmlFor={id}` (`text-sm font-medium`) et l'aide (`text-xs text-muted-foreground`), à droite le contrôle, `flex items-center justify-between gap-6 py-3` ; `SettingSelect<T extends string>({ id, label, description?, value, options: {value: T, label}[], onChange(value: T) })` (déclencheur `id`, `aria-label={label}`, `w-48` ; retrouve l'option choisie pour rendre une valeur typée, **sans cast**) ; `SettingSwitch({ id, label, description?, checked, onChange })` ; `SettingGroup({ title?, children })` : une carte `divide-y divide-border rounded-xl border bg-card px-4` |
| `sections/AppearanceSection.tsx` | thème (`theme.*`), langue (`language.*`), réduire les animations (`settings.appearance.motion.*`, avec une aide), et l'interrupteur « Confirmer avant de fermer un onglet connecté » (`ui.confirmCloseActiveSession`) |
| `sections/TerminalSection.tsx` | thème du terminal (`auto`, `tunlNight`, `tunlDay`), police (un `Input` `font-mono` enregistré sur `Entrée` ou à la perte du focus, `aria-invalid` et le message `fontFamilyInvalid` à la place de l'aide si `cleanFontFamily` refuse ; la rangée a `key={fontFamily}` pour repartir de la valeur enregistrée), taille (`withCurrent(FONT_SIZES, …)`, libellé `{{count}} px`), interligne (`toFixed(2)`), curseur (`bar`, `block`, `underline`), curseur clignotant, historique (`{{count}} lines`), copier à la sélection |
| `sections/AvailabilitySection.tsx` | l'interrupteur des sondes (avec l'aide : TCP seul, rien envoyé, jamais derrière un bastion) ; l'intervalle, **affiché seulement si les sondes sont actives**, libellés `settings.availability.every.<unit>` au pluriel |
| `sections/AboutSection.tsx` | `ipc.appInfo()` dans un `useEffect` (`catch(notifyError)`) : `Logo` 40 px, nom, « Version {{version}} » en `font-mono`, la licence, un bouton « Code source » (`openExternal("https://github.com/Fleorens/TunL")`, exporté en `REPOSITORY_URL`) ; puis deux rangées dossier (configuration, journaux) : le chemin en aide, un bouton « Afficher » (`revealInFolder(path)`) relié au libellé par `id` |
| `SettingsView.tsx` | `SettingsView({ active })` : `<section aria-label={t("settings.title")} hidden={!active}>` ; à gauche un `<nav aria-label={t("settings.sectionsLabel")}>` de 200 px (`w-50`, `border-r`) avec un bouton par section (icônes `Palette`, `SquareTerminal`, `Radar`, `Info`), `aria-current="page"` sur la section affichée ; à droite une `ScrollArea` avec un contenu centré `max-w-180`, le titre de la section en `h1` (`text-xl font-semibold tracking-tight`), puis la section. `export const SETTINGS_SECTIONS = ["appearance", "terminal", "availability", "about"] as const` |

Chaque modification construit un **nouvel** objet : `saveSettings((s) => ({ ...s, terminal: { ...s.terminal, fontSize } }))`.

### i18n (`en.json` et `fr.json`, nouvel espace `settings`)

| Clé | en | fr |
|---|---|---|
| `settings.title` | Settings | Paramètres |
| `settings.sectionsLabel` | Settings sections | Sections des paramètres |
| `settings.sections.appearance` / `terminal` / `availability` / `about` | Appearance / Terminal / Availability / About | Apparence / Terminal / Disponibilité / À propos |
| `settings.appearance.theme` / `language` | Theme / Language | Thème / Langue |
| `settings.appearance.reduceMotion` | Reduce animations | Réduire les animations |
| `settings.appearance.reduceMotionHelp` | “System” follows your desktop's accessibility setting. | « Système » suit le réglage d'accessibilité du bureau. |
| `settings.appearance.motion.system` / `on` / `off` | System / On / Off | Système / Activé / Désactivé |
| `settings.appearance.confirmClose` | Confirm before closing a connected tab | Confirmer avant de fermer un onglet connecté |
| `settings.appearance.confirmCloseHelp` | Closing a tab ends its session. | Fermer un onglet met fin à sa session. |
| `settings.terminal.theme` | Theme | Thème |
| `settings.terminal.themes.auto` / `tunlNight` / `tunlDay` | Follow the app / TunL Night / TunL Day | Suivre l'application / TunL Nuit / TunL Jour |
| `settings.terminal.fontFamily` | Font | Police |
| `settings.terminal.fontFamilyHelp` | A monospaced font installed on this computer. | Une police à chasse fixe installée sur cet ordinateur. |
| `settings.terminal.fontFamilyInvalid` | Between 1 and {{max}} characters. | Entre 1 et {{max}} caractères. |
| `settings.terminal.fontSize` | Font size | Taille de police |
| `settings.terminal.pixels_one` / `_other` | {{count}} px | {{count}} px |
| `settings.terminal.lineHeight` / `cursorStyle` | Line height / Cursor | Interligne / Curseur |
| `settings.terminal.cursors.bar` / `block` / `underline` | Bar / Block / Underline | Barre / Bloc / Soulignement |
| `settings.terminal.cursorBlink` | Blinking cursor | Curseur clignotant |
| `settings.terminal.scrollback` | Scrollback | Historique de défilement |
| `settings.terminal.lines_one` / `_other` | {{count}} line / {{count}} lines | {{count}} ligne / {{count}} lignes |
| `settings.terminal.copyOnSelect` | Copy on select | Copier à la sélection |
| `settings.availability.enabled` | Check which machines are reachable | Vérifier quelles machines répondent |
| `settings.availability.enabledHelp` | TunL opens a TCP connection to each machine's port, sends nothing and closes it. Never for a machine behind a jump host. | TunL ouvre une connexion TCP vers le port de chaque machine, n'envoie rien et la referme. Jamais pour une machine derrière un bastion. |
| `settings.availability.interval` | Check every | Intervalle |
| `settings.availability.every.seconds_one` / `_other` | {{count}} second / {{count}} seconds | {{count}} seconde / {{count}} secondes |
| `settings.availability.every.minutes_one` / `_other` | {{count}} minute / {{count}} minutes | {{count}} minute / {{count}} minutes |
| `settings.availability.every.hours_one` / `_other` | {{count}} hour / {{count}} hours | {{count}} heure / {{count}} heures |
| `settings.about.version` | Version {{version}} | Version {{version}} |
| `settings.about.licence` | Free software, GPL-3.0-or-later | Logiciel libre, GPL-3.0-or-later |
| `settings.about.repository` | Source code | Code source |
| `settings.about.configDir` / `logDir` | Configuration folder / Logs folder | Dossier de configuration / Dossier des journaux |
| `settings.about.showFolder` | Show | Afficher |

## Pièges (vus au prototype)

- **`e2e/shell.spec.ts` est remplacé** (son test des actions « bientôt disponibles » cliquait la roue dentée ; il
  passe par la connexion rapide RDP). Tant que T31 n'est pas `livrée` dans `tasks/README.md`, `npm run rules`
  affiche `DIFFERENT e2e/shell.spec.ts (contract of T21)` : c'est attendu. Passe le statut à `livrée` **avant** le
  dernier `npm run review`.
- La cloche (`terminal.bell`) n'a **pas** de rangée : aucun code ne l'écoute encore, un réglage sans effet serait un
  mensonge.
- Le nom accessible d'un onglet de session commence par sa pastille (« Online nas ») : `getByRole("tab", { name:
  /nas/ })`, pas `/^nas/`.
- Radix `Select` donne une `string` : `SettingSelect` la reconvertit en retrouvant l'option, pas avec `as`.
- Les sélecteurs zustand : `useSessions((s) => s.settingsOpen)`, une valeur brute (voir le tableau des pièges
  d'`AGENTS.md`).
- Les sous-composants (`FontFamilyRow`, `FolderRow`) sont au niveau du module, pas dans le corps d'un autre
  composant.

## Tests du contrat

### `src/features/sessions/tabs.test.ts` (nouveau)

```ts
// T31: the tab row with the Settings tab — order, keyboard walk, and the tab shown after a close.
import { describe, expect, test } from "vitest";
import { newSession } from "./session-model";
import { neighbourTab, relativeTab, SETTINGS_TAB, tabIds } from "./tabs";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const sessions = [A, B].map((id) => newSession(id, id, { type: "saved", connectionId: id }));

describe("tabIds", () => {
  test("the sessions in order, then Settings when it is open", () => {
    expect(tabIds(sessions, false)).toEqual([A, B]);
    expect(tabIds(sessions, true)).toEqual([A, B, SETTINGS_TAB]);
    expect(tabIds([], true)).toEqual([SETTINGS_TAB]);
    expect(tabIds([], false)).toEqual([]);
  });
});

describe("relativeTab", () => {
  test("walks the row both ways and wraps around", () => {
    const ids = tabIds(sessions, true);
    expect(relativeTab(ids, B, 1)).toBe(SETTINGS_TAB);
    expect(relativeTab(ids, SETTINGS_TAB, 1)).toBe(A);
    expect(relativeTab(ids, A, -1)).toBe(SETTINGS_TAB);
  });

  test("no tab: nothing; no active tab: the first or the last", () => {
    expect(relativeTab([], null, 1)).toBeNull();
    expect(relativeTab([A, B], null, 1)).toBe(A);
    expect(relativeTab([A, B], null, -1)).toBe(B);
  });
});

describe("neighbourTab", () => {
  test("the tab after the closed one, else the one before, else none", () => {
    expect(neighbourTab([A, B, SETTINGS_TAB], A)).toBe(B);
    expect(neighbourTab([A, B, SETTINGS_TAB], SETTINGS_TAB)).toBe(B);
    expect(neighbourTab([SETTINGS_TAB], SETTINGS_TAB)).toBeNull();
    expect(neighbourTab([A], "unknown")).toBeNull();
  });
});
```

### `src/features/settings/settings-options.test.ts` (nouveau)

```ts
// T31: the choices of the Settings tab, and the font name check that mirrors the backend's.
import { describe, expect, test } from "vitest";
import { cleanFontFamily, intervalParts, withCurrent } from "./settings-options";

describe("withCurrent", () => {
  test("adds a value set by hand, in order, without duplicating an offered one", () => {
    const offered = [10, 13, 16];
    expect(withCurrent(offered, 13)).toEqual([10, 13, 16]);
    expect(withCurrent(offered, 9)).toEqual([9, 10, 13, 16]);
    expect(withCurrent(offered, 17)).toEqual([10, 13, 16, 17]);
    expect(offered).toEqual([10, 13, 16]);
  });
});

describe("cleanFontFamily", () => {
  test("trims, and refuses what the backend refuses", () => {
    expect(cleanFontFamily("  JetBrains Mono ")).toBe("JetBrains Mono");
    expect(cleanFontFamily("   ")).toBeNull();
    expect(cleanFontFamily("x".repeat(64))).toBe("x".repeat(64));
    expect(cleanFontFamily("x".repeat(65))).toBeNull();
    expect(cleanFontFamily("Mono\nInjected")).toBeNull();
    expect(cleanFontFamily("Mono\u0085")).toBeNull();
  });
});

describe("intervalParts", () => {
  test("the largest whole unit", () => {
    expect(intervalParts(15)).toEqual({ unit: "seconds", count: 15 });
    expect(intervalParts(60)).toEqual({ unit: "minutes", count: 1 });
    expect(intervalParts(900)).toEqual({ unit: "minutes", count: 15 });
    expect(intervalParts(3600)).toEqual({ unit: "hours", count: 1 });
    expect(intervalParts(90)).toEqual({ unit: "seconds", count: 90 });
  });
});
```

### `e2e/settings.spec.ts` (nouveau)

```ts
// T31: the Settings tab — opened from the gear, Ctrl+, or the palette; every change applies at once.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function settings(page: Page) {
  return page.getByRole("region", { name: "Settings", exact: true });
}

async function openSection(page: Page, name: string) {
  await settings(page).getByRole("navigation").getByRole("button", { name }).click();
}

async function choose(page: Page, label: string, option: string) {
  await settings(page).getByRole("combobox", { name: label }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test("the gear opens the Settings tab, its close button brings the home back", async ({ page }) => {
  await page.getByRole("banner").getByRole("button", { name: "Settings" }).click();
  const tab = page.getByRole("tab", { name: /Settings/ });
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(settings(page).getByRole("heading", { name: "Appearance" })).toBeVisible();
  await expectSaneUi(page);

  // A second open goes to the same tab.
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("tab", { name: /Settings/ })).toHaveCount(1);

  await tab.getByRole("button", { name: "Close Settings" }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ }),
  ).toBeVisible();
});

test("Ctrl+, and the palette open it too, beside the session tabs", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().dblclick();
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas");
  await page.keyboard.press("Control+,");
  await expect(page.getByRole("tab", { selected: true })).toContainText("Settings");
  await expect(page.getByRole("region", { name: "nas", exact: true })).toBeHidden();

  // The next-tab shortcut walks the whole row, Settings included.
  await page.keyboard.press("Control+PageDown");
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas");

  await page
    .getByRole("tab", { name: /Settings/ })
    .getByRole("button", { name: "Close Settings" })
    .click();
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("option", { name: /Settings/ }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("Settings");
});

test("theme and language apply at once", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await choose(page, "Theme", "Light");
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/);
  await choose(page, "Theme", "Dark");
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);

  await choose(page, "Language", "Français");
  const french = page.getByRole("region", { name: "Paramètres", exact: true });
  await expect(french.getByRole("heading", { name: "Apparence" })).toBeVisible();
  await expectSaneUi(page);
  await french.getByRole("combobox", { name: "Langue" }).click();
  await page.getByRole("option", { name: "English", exact: true }).click();
  await expect(settings(page).getByRole("heading", { name: "Appearance" })).toBeVisible();
});

test("the terminal settings reach an open terminal", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().dblclick();
  const rows = page.getByRole("region", { name: "nas", exact: true }).locator(".xterm-rows");
  await expect(rows).toContainText("nas");
  await page.keyboard.press("Control+,");
  await openSection(page, "Terminal");
  await expectSaneUi(page);
  await choose(page, "Font size", "18 px");

  await page.getByRole("tab", { name: /nas/ }).click();
  await expect(rows).toHaveCSS("font-size", "18px");
});

test("a font name the backend would refuse is not saved", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await openSection(page, "Terminal");
  const font = settings(page).getByLabel("Font", { exact: true });
  await expect(font).toHaveValue("Geist Mono Variable");
  await font.fill("   ");
  await font.press("Enter");
  await expect(font).toHaveAttribute("aria-invalid", "true");
  await expect(settings(page)).toContainText("Between 1 and 64 characters.");
});

test("turning the probes off leaves every dot unknown and hides the interval", async ({ page }) => {
  const nas = page.getByRole("complementary").getByRole("button", { name: /^nas/ }).first();
  await expect(nas.getByRole("img", { name: "Online" })).toBeVisible();
  await page.keyboard.press("Control+,");
  await openSection(page, "Availability");
  await expect(settings(page).getByRole("combobox", { name: "Check every" })).toBeVisible();
  await expectSaneUi(page);

  await settings(page).getByRole("switch", { name: "Check which machines are reachable" }).click();
  await expect(nas.getByRole("img", { name: "Unknown" })).toBeVisible();
  await expect(settings(page).getByRole("combobox", { name: "Check every" })).toHaveCount(0);
});

test("About shows the version, the licence and TunL's folders", async ({ page }) => {
  await page.keyboard.press("Control+,");
  await openSection(page, "About");
  await expect(settings(page)).toContainText("Version 0.1.0-mock");
  await expect(settings(page)).toContainText("GPL-3.0-or-later");
  await expect(settings(page)).toContainText("~/.config/io.github.fleorens.TunL");
  await expect(settings(page).getByRole("button", { name: "Configuration folder" })).toBeVisible();
  await expect(settings(page).getByRole("button", { name: "Source code" })).toBeVisible();
  await expectSaneUi(page);
});
```

### `e2e/shell.spec.ts` (remplace la version de T21)

```ts
import { expect, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("right-clicking a connection opens its menu, with the groups submenu", async ({ page }) => {
  await page
    .getByRole("button", { name: /^web-01/ })
    .first()
    .click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Connect" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Move to group" }).hover();
  await expect(page.getByRole("menuitem", { name: "Homelab" })).toBeVisible();
});

test("only one connection row is highlighted at a time", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().click();
  await page
    .getByRole("button", { name: /^pi-hole/ })
    .first()
    .click();
  const current = page.locator('[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("pi-hole");
});

test("placeholder actions show a translated toast, never a raw key", async ({ page }) => {
  // T31: Settings is a real tab now; a quick RDP connection is still to come.
  await page.keyboard.press("Control+Shift+P");
  await page.getByRole("dialog").getByRole("combobox").fill("rdp://win-02");
  await page.getByRole("option", { name: "RDP to win-02" }).click();
  await expect(page.getByText("Coming soon")).toBeVisible();
  await expect(page.getByText("shell.notYetAvailable")).toHaveCount(0);
});

test("keyboard shortcuts drive the tabs and the sidebar filter", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().dblclick();
  await page
    .getByRole("button", { name: /^pi-hole/ })
    .first()
    .dblclick();
  await expect(page.getByRole("tab", { selected: true })).toContainText("pi-hole");
  await page.keyboard.press("Alt+Digit1");
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas");
  await page.keyboard.press("Control+PageDown");
  await expect(page.getByRole("tab", { selected: true })).toContainText("pi-hole");

  await page.keyboard.press("Control+Shift+E");
  await expect(page.locator("#sidebar-filter")).toBeFocused();
  await page.keyboard.type("pg");
  await expect(page.getByRole("button", { name: /^db-prod/ })).toHaveCount(1);
});

test("the app starts on the home screen, and closing the last tab returns to it", async ({
  page,
}) => {
  await expect(page.getByRole("tab")).toHaveCount(0);
  const quickConnect = page.getByPlaceholder("user@host[:port] — quick connect");
  await quickConnect.fill("root@unreachable.test");
  await quickConnect.press("Enter");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("outside Tauri, the status bar flags the mock backend", async ({ page }) => {
  await expect(page.getByText("Mock backend")).toBeVisible();
  await expect(page.getByText("v0.1.0-mock")).toBeVisible();
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T31`.
2. `sessions/tabs.ts`, `settings/settings-options.ts`, `settings/save-settings.ts` : `npm run typecheck`,
   `npx vitest run src/features/sessions src/features/settings`.
3. `sessions/store.ts`, `shell/TabBar.tsx`, `shell/AppLayout.tsx`, `shell/TopBar.tsx`, `palette/CommandPalette.tsx`.
4. `settings/SettingRow.tsx`, les quatre sections, `settings/SettingsView.tsx`, `en.json`, `fr.json` :
   `npx playwright test e2e/settings.spec.ts e2e/shell.spec.ts e2e/sessions.spec.ts e2e/palette.spec.ts`.
5. `npm run format`, statut `livrée`, `npm run review`, cases, ligne « Works today » du `README.md` (onglet
   Paramètres), commit `feat: Settings tab with appearance, terminal, availability and about (T31)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T31 --check` affiche `OK` partout.
- [x] `grep -rn "notifyComingSoon" src` ne trouve plus que `coming-soon.ts` et `open-session.ts`.
- [x] `grep -rn " as \(ThemeMode\|Language\|ReduceMotion\|CursorStyle\|TerminalTheme\)" src/features/settings` ne trouve rien.
- [x] Aucune nouvelle exception `project-rules: allow`.
- [x] Visuel : la liste des sections et le contenu sont alignés, les rangées respirent (pas de contrôle collé au
      bord de la carte), l'onglet Paramètres a le même aspect que les onglets de session, en clair et en sombre.

## À regarder par Florian

`npm run tauri dev` : la roue dentée ouvre l'onglet. Change le thème, la langue, la taille de police du terminal
avec une session ouverte (elle change à chaud), coupe les sondes (les pastilles passent en anneau). « À propos » :
« Afficher » ouvre le dossier de configuration dans Dolphin. Quitte et relance : les choix sont gardés.
