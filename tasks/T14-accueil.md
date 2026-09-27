# T14 — Accueil : salutation, connexion rapide, favoris, récents, premier lancement

| | |
|---|---|
| **Jalon** | M1 — Connexions |
| **Dépend de** | T13 |
| **Lire avant** | `docs/04-ecrans.md` §2, `docs/03-design.md` §4 (point 4 des animations signature) et §10. Code existant : `grep -n "export"` sur `src/features/palette/quick-connect.ts`, `src/features/sessions/open-session.ts`, `src/features/connections/sections.ts` |
| **Livrable** | `HomeView` refaite, `ConnectionCard`, `home-model.ts` ; 12 tests unitaires, 1 test de composant et 4 scénarios e2e verts ; `e2e/shell.spec.ts` mis à jour |

## Pourquoi

L'accueil s'affiche dès qu'aucun onglet n'est ouvert. C'est la première chose qu'on voit en lançant TunL : il doit
donner envie et mener en un geste aux machines du quotidien. Au tout premier lancement, sans connexion, il guide.

## À réutiliser (ne pas réécrire)

- `parseQuickConnect`, `openSession`, `openQuickSession` (T13) ; `compareNames` (`connections/sections.ts`).
- `ProtocolBadge`, `ProtocolIcon`, `StatusDot`, `SectionHeader`, `ShortcutHint` (`components/`) ; `Empty`,
  `Skeleton`, `Tooltip`, `Input` (`components/ui`).
- `useUi` : `openEditor`, `openImport`, `openPalette` ; `SHORTCUTS` pour les touches des indications du bas.

## Contrat

### `src/features/home/home-model.ts` (pur)

```ts
export type Greeting = "morning" | "afternoon" | "evening" | "night";
/** Local hour → 5–11 morning, 12–17 afternoon, 18–22 evening, otherwise night. */
export function greetingFor(hour: number): Greeting;
/** Favorites, sorted with compareNames. */
export function favoriteConnections(connections: readonly Connection[]): Connection[];
/** Connected at least once, most recent first, at most `limit` (default 8). */
export function recentConnections(connections: readonly Connection[], limit?: number): Connection[];
/** Intl.RelativeTimeFormat(locale, { numeric: "auto" }); see the steps below. A time in the future counts as now. */
export function formatRelativeTime(thenMs: number, nowMs: number, locale: string): string;
/** `user@host`, or `host`, plus `:port` when it is not the protocol's default (22, 3389). */
export function connectionAddress(connection: Connection): string;
```

Paliers de `formatRelativeTime` (`d` = écart en secondes, arrondi à l'inférieur) : `d < 60` → `format(0, "second")`
(« now ») ; minutes sous 1 h ; heures sous 24 h ; jours sous 7 jours ; semaines sous 30 jours ; mois (30 jours) sous
365 jours ; années ensuite. Toujours un nombre négatif (passé).

### `src/features/home/ConnectionCard.tsx`

`<article aria-label={nom}>` en `rounded-xl border bg-card p-4`, animation de survol : `-translate-y-px`,
`border-border-strong`, `shadow-elevated`, 120 ms.
- En haut : `ProtocolBadge`, et à droite `StatusDot` en `"unknown"` (les sondes arrivent en T30).
- Le nom (`font-medium`), puis `connectionAddress` en `font-mono text-xs text-muted-foreground`, tronqué.
- Si bastion : « ⤷ <nom du bastion> ». Les étiquettes, trois au plus, en `#tag`.
- Le nom est un `<button>` qui couvre toute la carte (`after:absolute after:inset-0`) : clic → `openSession(connexion)`.
  Pas de bouton dans un bouton.
- Actions, visibles au survol et au focus clavier (`group-hover` / `group-focus-within`), au-dessus du bouton étiré :
  « Connect to <nom> » (`openSession`), « Open SFTP on <nom> » pour SSH seulement (`openSession(c, "sftp")`),
  « Edit <nom> » (éditeur en modification). Ce sont des `aria-label` ; à l'écran, des icônes avec `Tooltip`.

### `src/features/home/HomeView.tsx`

- `status` du store à `"idle"` ou `"loading"` : deux lignes `Skeleton`.
- **Aucune connexion** : l'`Empty` actuel (« Welcome to TunL »), avec ses trois boutons branchés :
  « New connection » → éditeur, « Import ~/.ssh/config » → `openImport()`, « Quick connect » → `openPalette("quickConnect")`.
- **Sinon**, une colonne `max-w-5xl`, centrée, défilante :
  - `<h1>` : la salutation (`home.greeting.<Greeting>`, table de clés littérales), puis le nombre de connexions
    (`home.count`, pluriel) ;
  - un grand champ de connexion rapide (`h-12`, `rounded-xl`, icône de recherche, indication `⏎`), placeholder
    « user@host[:port] — quick connect ». `Entrée` : `parseQuickConnect` → `openQuickSession(cible)` et le champ se
    vide ; sinon, sous le champ, « Enter an address like deploy@10.0.0.5:22 », qui disparaît dès qu'on retape ;
  - **Favorites** (`SectionHeader`) : grille `grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3` de
    `ConnectionCard`. Section absente s'il n'y a pas de favori ;
  - **Recent** : `<section aria-label="Recent">`, une ligne par `recentConnections` : icône de protocole, nom,
    adresse, `formatRelativeTime` (langue courante d'i18next), clic → `openSession`. Absente si vide ;
  - en bas, trois indications : `ShortcutHint` + libellé pour la palette, la nouvelle connexion, les raccourcis.
- L'heure et « maintenant » se lisent une fois au rendu (`new Date()`) : pas de minuterie dans cette fiche.

### Textes (anglais exact ; en français dans `fr.json`)

| Clé | Anglais |
|---|---|
| `home.greeting.morning` / `afternoon` / `evening` / `night` | Good morning / Good afternoon / Good evening / Good night |
| `home.count_one` / `home.count_other` | {{count}} connection / {{count}} connections |
| `home.quickPlaceholder` | user@host[:port] — quick connect |
| `home.quickInvalid` | Enter an address like deploy@10.0.0.5:22 |
| `home.favorites` / `home.recent` | Favorites / Recent |
| `home.hints.palette` / `newConnection` / `shortcuts` | Command palette / New connection / Keyboard shortcuts |
| `home.card.connect` / `sftp` / `edit` | Connect to {{name}} / Open SFTP on {{name}} / Edit {{name}} |

### `e2e/shell.spec.ts`

Le test « closing every tab shows the welcome screen » de T05b ne tient plus : avec des connexions, l'accueil est le
tableau de bord. La version ci-dessous le remplace ; les autres tests sont inchangés.

## Tests du contrat

### `src/features/home/home-model.test.ts`

```ts
import { describe, expect, test } from "vitest";
import type { Connection } from "@/bindings/Connection";
import { MOCK_CONNECTIONS } from "@/lib/mock/data";
import {
  connectionAddress,
  favoriteConnections,
  formatRelativeTime,
  greetingFor,
  recentConnections,
} from "./home-model";

const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function connection(name: string, patch: Partial<Connection> = {}): Connection {
  return { ...MOCK_CONNECTIONS[0], id: crypto.randomUUID(), name, ...patch };
}

describe("greetingFor", () => {
  test("follows the hour of the day", () => {
    expect([5, 11, 12, 17, 18, 22, 23, 0, 4].map(greetingFor)).toEqual([
      "morning",
      "morning",
      "afternoon",
      "afternoon",
      "evening",
      "evening",
      "night",
      "night",
      "night",
    ]);
  });
});

describe("favorites and recents", () => {
  test("favorites are sorted by name", () => {
    const list = [
      connection("web-10", { favorite: true }),
      connection("db", { favorite: false }),
      connection("web-2", { favorite: true }),
    ];
    expect(favoriteConnections(list).map((c) => c.name)).toEqual(["web-2", "web-10"]);
  });

  test("recents: connected at least once, most recent first, limited", () => {
    const list = [
      connection("old", { lastConnectedAt: NOW - 3 * DAY }),
      connection("never", { lastConnectedAt: null }),
      connection("fresh", { lastConnectedAt: NOW - MINUTE }),
      connection("mid", { lastConnectedAt: NOW - HOUR }),
    ];
    expect(recentConnections(list).map((c) => c.name)).toEqual(["fresh", "mid", "old"]);
    expect(recentConnections(list, 2).map((c) => c.name)).toEqual(["fresh", "mid"]);
  });

  test("at most eight recents by default", () => {
    const list = Array.from({ length: 12 }, (_, i) => connection(`c${i}`, { lastConnectedAt: NOW - i * MINUTE }));
    expect(recentConnections(list)).toHaveLength(8);
  });
});

describe("formatRelativeTime", () => {
  test("recent past in English", () => {
    expect(formatRelativeTime(NOW - 30 * SECOND, NOW, "en")).toBe("now");
    expect(formatRelativeTime(NOW - MINUTE, NOW, "en")).toBe("1 minute ago");
    expect(formatRelativeTime(NOW - 5 * MINUTE, NOW, "en")).toBe("5 minutes ago");
    expect(formatRelativeTime(NOW - 3 * HOUR, NOW, "en")).toBe("3 hours ago");
  });

  test("days, weeks, months, years", () => {
    expect(formatRelativeTime(NOW - 26 * HOUR, NOW, "en")).toBe("yesterday");
    expect(formatRelativeTime(NOW - 3 * DAY, NOW, "en")).toBe("3 days ago");
    expect(formatRelativeTime(NOW - 10 * DAY, NOW, "en")).toBe("last week");
    expect(formatRelativeTime(NOW - 40 * DAY, NOW, "en")).toBe("last month");
    expect(formatRelativeTime(NOW - 400 * DAY, NOW, "en")).toBe("last year");
  });

  test("French, and a future time counts as now", () => {
    expect(formatRelativeTime(NOW - 5 * MINUTE, NOW, "fr")).toBe("il y a 5 minutes");
    expect(formatRelativeTime(NOW - 26 * HOUR, NOW, "fr")).toBe("hier");
    expect(formatRelativeTime(NOW + HOUR, NOW, "en")).toBe("now");
  });
});

describe("connectionAddress", () => {
  test("leaves out what is implicit", () => {
    const ssh = MOCK_CONNECTIONS.find((c) => c.settings.protocol === "ssh") as Connection;
    const rdp = MOCK_CONNECTIONS.find((c) => c.settings.protocol === "rdp") as Connection;
    expect(connectionAddress({ ...ssh, username: "deploy", host: "10.0.0.12", port: 22 })).toBe("deploy@10.0.0.12");
    expect(connectionAddress({ ...ssh, username: null, host: "nas", port: 2222 })).toBe("nas:2222");
    expect(connectionAddress({ ...rdp, username: "admin", host: "win", port: 3389 })).toBe("admin@win");
    expect(connectionAddress({ ...rdp, username: null, host: "win", port: 22 })).toBe("win:22");
  });
});
```

### `src/features/home/HomeView.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useConnections } from "@/features/connections/store";
import { resetMockBackend } from "@/lib/ipc-mock";
import { HomeView } from "./HomeView";
import "@/i18n";

beforeEach(async () => {
  resetMockBackend();
  await useConnections.getState().load();
});

test("with no connection at all, the first-launch screen guides the user", () => {
  useConnections.setState({ connections: [] });
  render(
    <TooltipProvider>
      <HomeView />
    </TooltipProvider>,
  );
  expect(screen.getByText("Welcome to TunL")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Import ~/.ssh/config" })).toBeInTheDocument();
  expect(screen.queryByPlaceholderText("user@host[:port] — quick connect")).toBeNull();
});
```

### `e2e/home.spec.ts`

```ts
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

async function closeAllTabs(page: Page) {
  await page.goto("/");
  await page.keyboard.press("Control+Shift+W");
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("tab")).toHaveCount(0);
}

test("the home screen greets and lists favorites and recents", async ({ page }) => {
  await closeAllTabs(page);
  await expect(page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening|night)/ })).toBeVisible();
  await expect(page.getByRole("article", { name: "web-01" })).toBeVisible();
  await expect(page.getByRole("article", { name: "ad-01" })).toBeVisible();
  const recent = page.getByRole("region", { name: "Recent", exact: true });
  await expect(recent.getByText("web-01")).toBeVisible();
  await expect(recent.getByText("5 minutes ago")).toBeVisible();
  await expectSaneUi(page);
});

test("a card's edit action opens the editor", async ({ page }) => {
  await closeAllTabs(page);
  const card = page.getByRole("article", { name: "web-01" });
  await card.hover();
  await card.getByRole("button", { name: "Edit web-01" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Edit web-01" })).toBeVisible();
});

test("the quick connect field checks the address", async ({ page }) => {
  await closeAllTabs(page);
  const field = page.getByPlaceholder("user@host[:port] — quick connect");
  await field.fill("not an address!");
  await field.press("Enter");
  await expect(page.getByText("Enter an address like deploy@10.0.0.5:22")).toBeVisible();
  await field.fill("deploy@10.0.0.5");
  await expect(page.getByText("Enter an address like deploy@10.0.0.5:22")).toHaveCount(0);
  await field.press("Enter");
  await expect(page.getByText("Coming soon")).toBeVisible();
  await expect(field).toHaveValue("");
});

test("clicking a card opens the connection (sessions come later)", async ({ page }) => {
  await closeAllTabs(page);
  await page.getByRole("article", { name: "ad-01" }).getByRole("button", { name: "ad-01", exact: true }).click();
  await expect(page.getByText("Coming soon")).toBeVisible();
});
```

### `e2e/shell.spec.ts`

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
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Coming soon")).toBeVisible();
  await expect(page.getByText("shell.notYetAvailable")).toHaveCount(0);
});

test("keyboard shortcuts drive the sidebar filter and the tabs", async ({ page }) => {
  await page.keyboard.press("Control+Shift+E");
  await expect(page.locator("#sidebar-filter")).toBeFocused();
  await page.keyboard.type("pg");
  await expect(page.getByRole("button", { name: /^db-prod/ })).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Alt+Digit2");
  await expect(page.getByRole("tab", { selected: true })).toContainText("db-prod");
  await page.keyboard.press("Control+PageDown");
  await expect(page.getByRole("tab", { selected: true })).toContainText("web-01");
});

test("closing every tab shows the home screen", async ({ page }) => {
  await page.keyboard.press("Control+Shift+W");
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  await expect(page.getByPlaceholder("user@host[:port] — quick connect")).toBeVisible();
});

test("outside Tauri, the status bar flags the mock backend", async ({ page }) => {
  await expect(page.getByText("Mock backend")).toBeVisible();
  await expect(page.getByText("v0.1.0-mock")).toBeVisible();
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T14` (il réécrit aussi `e2e/shell.spec.ts`).
2. `home-model.ts`, puis `npx vitest run src/features/home`.
3. `ConnectionCard`, `HomeView`, les textes en / fr.
4. `npm run format`, `npm run review`, cases, statut, commit `feat: home screen with favorites, recents and quick connect (T14)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T14 --check` affiche `OK` partout.
- [ ] `HomeView.tsx` et `ConnectionCard.tsx` font chacun moins de 250 lignes.
- [ ] Visuel : cartes alignées sur la grille, légère élévation au survol, actions qui apparaissent sans décaler le
      contenu ; le champ de connexion rapide est l'élément le plus visible de l'écran.
- [ ] Visuel : clair et sombre lisibles, aucune couleur codée en dur.

## À regarder par Florian

Fermer tous les onglets (`Ctrl+Shift+W`) pour voir l'accueil ; survoler une carte ; taper une adresse dans le grand
champ. Dans `npm run tauri dev` avec un store vide, l'écran de bienvenue doit s'afficher à la place.
