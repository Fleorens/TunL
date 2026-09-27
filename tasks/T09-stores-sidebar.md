# T09 — Stores zustand et barre latérale branchée

| | |
|---|---|
| **Jalon** | M1 — Connexions |
| **Dépend de** | T08 |
| **Lire avant** | `AGENTS.md` (« Fiches contrat », tableau des pièges), `docs/01-architecture.md` §10, `docs/04-ecrans.md` §1 (Sidebar) et §8, `docs/03-design.md` |
| **Livrable** | La barre latérale lit et modifie les vraies données (favoris, groupes, duplication, suppression, copie d'adresse) ; thème et langue suivent les réglages |

## Pourquoi

Jusqu'ici, la barre latérale affiche des données en dur (`demo-data.ts`). Elle passe maintenant par des stores
zustand qui appellent `ipc`. Dans le navigateur, c'est le mock de T08 qui répond, avec les mêmes données : les
scénarios e2e de T05b doivent donc rester verts.

## Contrat

### `src/lib/result.ts`

```ts
export type Result<T> = { ok: true; value: T } | { ok: false; error: AppError };
```

### `src/features/connections/store.ts` — `useConnections`

```ts
type LoadStatus = "idle" | "loading" | "ready" | "error";

interface ConnectionsState {
  status: LoadStatus;
  loadError: AppError | null;
  groups: readonly Group[];
  connections: readonly Connection[];
  templates: ConnectionTemplates | null;
  quarantined: readonly string[];

  load: () => Promise<void>;                       // storeLoad + connectionTemplates, en parallèle
  // Called from forms: return the error, no toast (the form shows it under the field).
  create: (input: ConnectionInput) => Promise<Result<Connection>>;
  update: (id: string, input: ConnectionInput) => Promise<Result<Connection>>;
  createGroup: (input: GroupInput) => Promise<Result<Group>>;
  updateGroup: (id: string, input: GroupInput) => Promise<Result<Group>>;
  // Called from menus: on failure, notifyError() then false / null.
  duplicate: (id: string) => Promise<Connection | null>;
  remove: (id: string) => Promise<boolean>;
  setFavorite: (id: string, favorite: boolean) => Promise<boolean>;
  moveToGroup: (id: string, groupId: string | null) => Promise<boolean>;   // connectionUpdate avec toInput()
  removeGroup: (id: string) => Promise<boolean>;                            // remplace groups ET connections
  moveGroup: (id: string, delta: -1 | 1) => Promise<boolean>;               // groupReorder
}
```

- État **remplacé**, jamais modifié : `set({ connections: connections.map(…) })`, `filter`, `[...list, item]`.
- `load()` en échec : `status: "error"`, `loadError` renseigné, **pas** de toast (la barre latérale l'affiche).
- `load()` réussi avec `quarantined` non vide : un `toast.warning` par fichier, qui reste affiché
  (`duration: Infinity`), texte `connections.quarantined`.
- `App.tsx` appelle `useConnections.getState().load()` et `useSettings.getState().load()` **une fois**, au montage.
  La barre latérale n'appelle jamais `load()` elle-même, sauf via son bouton « Retry ».

### `src/features/connections/sections.ts`

```ts
export const RECENTS_LIMIT = 5;
export interface SidebarSections {
  favorites: Connection[];
  recents: Connection[];                                   // lastConnectedAt décroissant, 5 au plus
  groups: { group: Group; connections: Connection[] }[];   // ordre du store, groupes vides INCLUS
  ungrouped: Connection[];                                 // groupId null ou inconnu
}
export function buildSidebarSections(connections: readonly Connection[], groups: readonly Group[]): SidebarSections;
export function compareNames(a: string, b: string): number;   // Intl.Collator(undefined, { numeric: true, sensitivity: "base" })
```

Tri par nom avec `compareNames` partout : sections et résultats du filtre. Ne jamais appeler `.sort()` sur un
tableau reçu : copier d'abord (`[...list].sort(…)` ou `toSorted`).

### `src/features/settings/store.ts` — `useSettings`

```ts
interface SettingsState {
  settings: Settings | null;
  load: () => Promise<void>;
  update: (next: Settings) => Promise<Result<Settings>>;
}
```

### Thème, langue, animations — `src/features/settings/use-apply-settings.ts`

Un hook `useApplySettings()`, appelé dans `App.tsx` (il remplace le `useEffect(() => applyTheme("system"), [])`
actuel). Il renvoie la valeur `reducedMotion` à passer à `<MotionConfig>`.

- **Thème.** Tant que les réglages ne sont pas chargés : `applyTheme(readStoredThemeMode())`. Ensuite :
  `applyTheme(settings.theme)` et `rememberThemeMode(settings.theme)`.
- **Langue.** `setLanguage(settings.language)`, de `src/i18n` (existe déjà).
- **Animations.** `reduceMotion` donne `"system"` → `"user"`, `"on"` → `"always"`, `"off"` → `"never"`.

Dans `src/lib/theme.ts` :

```ts
export const THEME_STORAGE_KEY = "tunl.themeMode";
export function readStoredThemeMode(): ThemeMode;          // "system" si absent, illisible, ou localStorage indisponible
export function rememberThemeMode(mode: ThemeMode): void;   // ignore silencieusement un localStorage indisponible
```

`main.tsx` : `primeTheme(readStoredThemeMode())` au lieu de `primeTheme("system")`. Ainsi, un utilisateur en
« Clair » sur un système sombre ne voit pas de flash au démarrage.

`localStorage` ne sert **qu'à** ce mode de thème (ce n'est pas un secret, S1 respectée). Les accès sont dans un
`try/catch` : WebKitGTK peut refuser le stockage. « Silencieusement » veut dire ici : sans toast, mais avec un
commentaire qui explique pourquoi l'échec est sans conséquence.

### Erreurs — `src/lib/errors.ts`

```ts
export function describeError(error: AppError): { title: string; description: string };
```

- `title` = `errors.kind.<kind>`.
- `description` = `errors.usedBy` avec les noms joints par `", "` si `detail.type === "inUse"`, sinon `message`.

`notifyError` s'appuie dessus.

### Presse-papiers — `src/lib/clipboard.ts`

`copyText(text: string): Promise<boolean>`, qui utilise `navigator.clipboard.writeText`.
- Succès : `toast.success(t("clipboard.copied"))`.
- Échec : `notifyError`.

Un seul fichier à changer le jour où l'on passera au plugin Tauri.

### Barre latérale (`src/features/shell/sidebar/`)

- `Sidebar` **ne prend plus de props** : il lit `useConnections` avec des sélecteurs. `AppLayout` rend `<Sidebar />`.
- **Chaque section est une région nommée** :
  - `<section aria-label={titre}>` pour Favoris, Récents, Sans groupe et Résultats ;
  - `<section aria-label={group.name}>` pour chaque groupe.
- **Groupes.**
  - Tous les groupes sont affichés, même vides. Un groupe vide montre un compteur `0`.
  - Section « Groups » : son en-tête porte un bouton icône `FolderPlus`, `aria-label="New group"`. Sans aucun groupe,
    le lien « Create a group » (clé existante) ouvre le même dialogue.
  - En-tête d'un groupe : à droite, un bouton `⋯` (`MoreHorizontal`), `aria-label="Group actions"`. Il ouvre un
    `DropdownMenu` : Rename · Move up · Move down · — · Delete group (destructive). Move up est désactivé sur le premier
    groupe, Move down sur le dernier.
  - Le bouton reste **dans le DOM** : `opacity-0`, puis `group-hover:opacity-100` et `focus-visible:opacity-100`.
    Jamais `hidden`.
- **`GroupDialog`** (création et renommage) : `Dialog` avec un champ « Name » (`<Label htmlFor>`) et un
  `ColorPicker`. Bouton « Create » (création) ou « Save » (renommage), plus « Cancel ». Une erreur renvoyée par le
  store s'affiche sous le champ.
- **`src/components/ColorPicker.tsx`** : aucune couleur, puis les 10 `AccentColor`, en pastilles (`ACCENT_DOT_CLASSES`).
  - Chaque pastille est un `button` avec `aria-pressed` et `aria-label` (`colors.<couleur>`, `colors.none`).
  - Props : `value: AccentColor | null`, `onChange`.
  - Il servira aussi à l'éditeur (T10).
- **`ConnectionRow`** reçoit une `Connection` et un `jumpHostName: string | null`, calculé par le parent à partir de
  `jumpHostId`. La pastille d'état affiche `unknown` pour tout le monde, en attendant les sondes (T30).
- **Menu contextuel**, dans l'ordre de `docs/04-ecrans.md` §8 :

  | Entrée | Action |
  |---|---|
  | Connect | `notifyComingSoon` (T19, T28) |
  | Open in SFTP (SSH seulement) | `notifyComingSoon` (T24) |
  | Wake up (seulement si `wol !== null`) | `notifyComingSoon` (T29) |
  | Edit | `notifyComingSoon` (T10) |
  | Duplicate | `duplicate`, puis la copie devient la ligne sélectionnée |
  | Add to / Remove from favorites | `setFavorite` |
  | Move to group ▸ | un `ContextMenuItem` par groupe, avec une icône `Check` devant le groupe actuel, puis un séparateur et « No group » (désactivé si déjà sans groupe) |
  | Copy user@host | `copyText("user@host")`, ou `"host"` s'il n'y a pas d'utilisateur |
  | Delete | dialogue de confirmation, puis `remove` |

- **Confirmations** (`AlertDialog`) :
  - suppression d'une connexion : titre « Delete {{name}}? », boutons « Cancel » et « Delete » (destructive) ;
  - suppression d'un groupe : titre « Delete the group {{name}}? », texte « Its connections will move to Ungrouped. »
- **États de chargement.**
  - `idle` / `loading` : 6 lignes `Skeleton`.
  - `error` : titre « Connections could not be loaded », le `loadError.message`, et un bouton « Retry » qui appelle
    `load()`.
- Pied : le compteur utilise `connections.length`.

### Reste de la coquille

- `demo-data.ts` : supprimer `DemoConnection`, `DemoGroup`, `DEMO_CONNECTIONS` et `DEMO_GROUPS`. Garder les onglets de
  démonstration (remplacés en T21).
  - `INITIAL_TABS[].connectionId` pointe vers `MOCK_IDS.web01` et `MOCK_IDS.dbProd`.
  - Dans Tauri, ces ids n'existent pas : la StatusBar n'affiche alors pas d'adresse. C'est normal jusqu'à T21.
- `StatusBar` : cherche la connexion de l'onglet actif dans `useConnections`. Le nom du bastion est retrouvé à partir
  de `jumpHostId`.

### Textes (anglais exact, utilisé par les tests ; en français dans `fr.json`)

| Clé | Anglais |
|---|---|
| `sidebar.newGroup` | New group |
| `sidebar.groupActions` | Group actions |
| `sidebar.noGroup` | No group |
| `sidebar.loadError` | Connections could not be loaded |
| `groupMenu.rename` / `moveUp` / `moveDown` / `delete` | Rename / Move up / Move down / Delete group |
| `groupDialog.createTitle` / `renameTitle` | New group / Rename group |
| `groupDialog.name` / `color` / `create` | Name / Color / Create |
| `confirm.deleteConnection` | Delete {{name}}? |
| `confirm.deleteGroup` | Delete the group {{name}}? |
| `confirm.deleteGroupDescription` | Its connections will move to Ungrouped. |
| `clipboard.copied` | Copied to the clipboard |
| `errors.usedBy` | Used by: {{names}} |
| `connections.quarantined` | Your connections file could not be read. A copy was kept at {{path}}. |
| `colors.none`, `colors.slate` … `colors.pink` | No color, Slate … Pink |

### Pièges

- **Menu → dialogue.** Le dialogue de confirmation (ou `GroupDialog`) est rendu **hors** du menu, avec un état
  remonté, et s'ouvre depuis `onSelect`. Symptômes à surveiller : le dialogue se referme aussitôt, ou la page ne
  réagit plus aux clics (`pointer-events: none` resté sur `<body>`). C'est le conflit de focus connu entre un menu
  Radix et un dialogue. Correctif : ouvrir le dialogue au tour suivant, avec `setTimeout(() => setOpen(true), 0)`.
- Les groupes du sous-menu restent des `ContextMenuItem` (rôle `menuitem`), **pas** des `ContextMenuRadioItem` : le
  scénario e2e de T05b les cherche par ce rôle.
- `getByRole("region", …)` ne trouve une `<section>` que si elle a un nom accessible (`aria-label`).
- Un sélecteur zustand qui construit un nouvel objet ou tableau (`useConnections((s) => s.connections.filter(…))`)
  provoque une boucle de rendu infinie en React 19. Sélectionner la donnée brute, puis dériver avec `useMemo`
  (ou avec `useShallow` de `zustand/react/shallow`).

## Tests du contrat

### `src/features/connections/sections.test.ts`

```ts
import { describe, expect, it } from "vitest";
import type { Connection } from "@/bindings/Connection";
import type { Group } from "@/bindings/Group";
import { buildSidebarSections } from "./sections";

function connection(name: string, patch: Partial<Connection> = {}): Connection {
  return {
    id: `id-${name}`,
    name,
    host: "10.0.0.1",
    port: 22,
    username: null,
    groupId: null,
    tags: [],
    favorite: false,
    color: null,
    notes: null,
    jumpHostId: null,
    wol: null,
    settings: { protocol: "ssh", auth: { method: "agent" }, keepaliveSecs: null, connectTimeoutSecs: null },
    createdAt: 0,
    updatedAt: 0,
    lastConnectedAt: null,
    ...patch,
  };
}

const groups: Group[] = [
  { id: "g-b", name: "Beta", color: null },
  { id: "g-a", name: "Alpha", color: "green" },
];

describe("buildSidebarSections", () => {
  it("sorts favorites by name and keeps the five most recent", () => {
    const items = [
      connection("zeta", { favorite: true }),
      connection("alpha", { favorite: true }),
      ...[1, 2, 3, 4, 5, 6].map((n) => connection(`r${n}`, { lastConnectedAt: n * 1000 })),
    ];
    const sections = buildSidebarSections(items, groups);
    expect(sections.favorites.map((c) => c.name)).toEqual(["alpha", "zeta"]);
    expect(sections.recents.map((c) => c.name)).toEqual(["r6", "r5", "r4", "r3", "r2"]);
  });

  it("keeps the store order of the groups, empty groups included", () => {
    const items = [connection("web", { groupId: "g-a" }), connection("db", { groupId: "g-a" })];
    const sections = buildSidebarSections(items, groups);
    expect(sections.groups.map(({ group }) => group.name)).toEqual(["Beta", "Alpha"]);
    expect(sections.groups[0].connections).toEqual([]);
    expect(sections.groups[1].connections.map((c) => c.name)).toEqual(["db", "web"]);
    expect(sections.ungrouped).toEqual([]);
  });

  it("sorts names naturally and without regard to case", () => {
    const items = [connection("web-10"), connection("web-2"), connection("Web-1")];
    const names = buildSidebarSections(items, []).ungrouped.map((c) => c.name);
    expect(names).toEqual(["Web-1", "web-2", "web-10"]);
  });

  it("treats an unknown group as no group", () => {
    const sections = buildSidebarSections([connection("orphan", { groupId: "g-gone" })], groups);
    expect(sections.ungrouped.map((c) => c.name)).toEqual(["orphan"]);
  });

  it("never mutates its inputs", () => {
    const items = Object.freeze([connection("b", { favorite: true }), connection("a", { favorite: true })]);
    expect(() => buildSidebarSections(items, Object.freeze([...groups]))).not.toThrow();
    expect(items.map((c) => c.name)).toEqual(["b", "a"]);
  });
});
```

### `src/features/connections/store.test.ts`

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { failNextCall, resetMockBackend } from "@/lib/ipc-mock";
import { useConnections } from "./store";

function byName(name: string) {
  const found = useConnections.getState().connections.find((connection) => connection.name === name);
  if (!found) throw new Error(`no connection named ${name}`);
  return found;
}

function groupNamed(name: string) {
  const found = useConnections.getState().groups.find((group) => group.name === name);
  if (!found) throw new Error(`no group named ${name}`);
  return found;
}

beforeEach(async () => {
  resetMockBackend();
  await useConnections.getState().load();
});

describe("useConnections", () => {
  it("loads the snapshot and the templates", () => {
    const state = useConnections.getState();
    expect(state.status).toBe("ready");
    expect(state.connections).toHaveLength(11);
    expect(state.groups).toHaveLength(3);
    expect(state.templates?.ssh.port).toBe(22);
  });

  it("replaces state after an action instead of mutating it", async () => {
    const before = useConnections.getState().connections;
    expect(await useConnections.getState().setFavorite(byName("nas").id, true)).toBe(true);
    expect(byName("nas").favorite).toBe(true);
    expect(before.find((connection) => connection.name === "nas")?.favorite).toBe(false);
  });

  it("moves a connection into a group, then out of any group", async () => {
    const homelab = groupNamed("Homelab");
    await useConnections.getState().moveToGroup(byName("router").id, homelab.id);
    expect(byName("router").groupId).toBe(homelab.id);
    await useConnections.getState().moveToGroup(byName("router").id, null);
    expect(byName("router").groupId).toBeNull();
  });

  it("adds a duplicate", async () => {
    const copy = await useConnections.getState().duplicate(byName("web-01").id);
    expect(copy?.name).toBe("web-01 (2)");
    expect(byName("web-01 (2)").id).toBe(copy?.id);
  });

  it("keeps the list when a delete is refused", async () => {
    expect(await useConnections.getState().remove(byName("bastion-01").id)).toBe(false);
    expect(useConnections.getState().connections).toHaveLength(11);
  });

  it("returns form errors to the caller", async () => {
    const templates = useConnections.getState().templates;
    if (!templates) throw new Error("templates missing");
    const created = await useConnections.getState().create({ ...templates.ssh, name: " ", host: "h" });
    expect(created).toMatchObject({ ok: false, error: { kind: "validation" } });
    const group = await useConnections.getState().createGroup({ name: "homelab", color: null });
    expect(group).toMatchObject({ ok: false, error: { kind: "validation" } });
  });

  it("ungroups the connections of a deleted group", async () => {
    expect(await useConnections.getState().removeGroup(groupNamed("Homelab").id)).toBe(true);
    expect(useConnections.getState().groups).toHaveLength(2);
    expect(byName("nas").groupId).toBeNull();
  });

  it("reorders groups", async () => {
    expect(await useConnections.getState().moveGroup(groupNamed("Homelab").id, -1)).toBe(true);
    const names = useConnections.getState().groups.map((group) => group.name);
    expect(names).toEqual(["Production", "Homelab", "Clients"]);
  });

  it("switches to the error state when loading fails", async () => {
    failNextCall("store_load", { kind: "store", message: "created by a newer TunL", detail: null });
    await useConnections.getState().load();
    expect(useConnections.getState().status).toBe("error");
    expect(useConnections.getState().loadError?.message).toBe("created by a newer TunL");
  });
});
```

### `src/features/shell/sidebar/Sidebar.test.tsx` (remplace entièrement le fichier de T04)

```tsx
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useConnections } from "@/features/connections/store";
import { Sidebar } from "@/features/shell/sidebar/Sidebar";
import { failNextCall, resetMockBackend } from "@/lib/ipc-mock";
import "@/i18n";

function renderSidebar() {
  return render(
    <TooltipProvider>
      <Sidebar />
    </TooltipProvider>,
  );
}

beforeEach(async () => {
  resetMockBackend();
  await useConnections.getState().load();
});

describe("Sidebar", () => {
  it("renders each section as a labelled region", () => {
    renderSidebar();
    const favorites = screen.getByRole("region", { name: "Favorites" });
    expect(within(favorites).getByRole("button", { name: /^web-01/ })).toBeInTheDocument();
    const homelab = screen.getByRole("region", { name: "Homelab" });
    const homelabRows = within(homelab).getAllByRole("button", { name: /^(nas|pi-hole|media-server|win-desktop)/ });
    expect(homelabRows).toHaveLength(4);
    const ungrouped = screen.getByRole("region", { name: "Ungrouped" });
    expect(within(ungrouped).getAllByRole("button", { name: /^(router|kiosk-01)/ })).toHaveLength(2);
  });

  it("highlights a single row across all sections", () => {
    renderSidebar();
    fireEvent.click(screen.getAllByRole("button", { name: /^nas/ })[0]);
    fireEvent.click(screen.getAllByRole("button", { name: /^pi-hole/ })[0]);
    const current = document.querySelectorAll('[aria-current="true"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent("pi-hole");
  });

  it("filters to a flat result list", () => {
    renderSidebar();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "pg" } });
    expect(screen.getByRole("heading", { name: "Results" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^db-prod/ })).toHaveLength(1);
    expect(screen.queryByRole("button", { name: /^web-01/ })).toBeNull();
  });

  it("offers the wake-up action only for connections with Wake-on-LAN", () => {
    renderSidebar();
    fireEvent.contextMenu(screen.getAllByRole("button", { name: /^win-desktop/ })[0]);
    expect(within(screen.getByRole("menu")).getByRole("menuitem", { name: "Wake up" })).toBeInTheDocument();
  });

  it("shows the load error with a retry button", async () => {
    failNextCall("store_load", { kind: "store", message: "created by a newer TunL", detail: null });
    await useConnections.getState().load();
    renderSidebar();
    expect(screen.getByText("Connections could not be loaded")).toBeInTheDocument();
    expect(screen.getByText("created by a newer TunL")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
```

### `src/lib/theme-storage.test.ts`

```ts
import { afterEach, describe, expect, it } from "vitest";
import { readStoredThemeMode, rememberThemeMode, THEME_STORAGE_KEY } from "./theme";

afterEach(() => {
  localStorage.clear();
});

describe("remembered theme mode", () => {
  it("defaults to system", () => {
    expect(readStoredThemeMode()).toBe("system");
  });

  it("returns what was remembered", () => {
    rememberThemeMode("light");
    expect(readStoredThemeMode()).toBe("light");
  });

  it("ignores garbage", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "purple");
    expect(readStoredThemeMode()).toBe("system");
  });
});
```

### `src/lib/errors.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { describeError } from "./errors";
import "@/i18n";

describe("describeError", () => {
  it("lists the connections that block a delete", () => {
    const error = {
      kind: "inUse" as const,
      message: "connection is used as a jump host",
      detail: { type: "inUse" as const, names: ["web-01", "web-02"] },
    };
    expect(describeError(error)).toEqual({ title: "Still in use", description: "Used by: web-01, web-02" });
  });

  it("falls back to the technical message", () => {
    const error = { kind: "timeout" as const, message: "tcp connect", detail: null };
    expect(describeError(error)).toEqual({ title: "Timed out", description: "tcp connect" });
  });
});
```

### `e2e/connections.spec.ts`

```ts
import { expect, type Page, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function row(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^${escapeRegExp(name)}`) }).first();
}

function region(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

async function openMenu(page: Page, name: string) {
  await row(page, name).click({ button: "right" });
  return page.getByRole("menu");
}

test("favoriting a connection adds it to the Favorites section", async ({ page }) => {
  const favorites = region(page, "Favorites");
  await expect(favorites.getByRole("button", { name: /^nas/ })).toHaveCount(0);
  const menu = await openMenu(page, "nas");
  await menu.getByText("Add to favorites", { exact: true }).click();
  await expect(favorites.getByRole("button", { name: /^nas/ })).toBeVisible();
});

test("moving a connection into a group, then out of it", async ({ page }) => {
  await openMenu(page, "router");
  await page.getByRole("menuitem", { name: "Move to group" }).hover();
  await page.getByRole("menuitem", { name: "Homelab" }).click();
  await expect(region(page, "Homelab").getByRole("button", { name: /^router/ })).toBeVisible();

  await openMenu(page, "router");
  await page.getByRole("menuitem", { name: "Move to group" }).hover();
  await page.getByRole("menuitem", { name: "No group" }).click();
  await expect(region(page, "Ungrouped").getByRole("button", { name: /^router/ })).toBeVisible();
});

test("duplicating a connection adds a numbered copy", async ({ page }) => {
  const menu = await openMenu(page, "web-02");
  await menu.getByText("Duplicate", { exact: true }).click();
  await expect(row(page, "web-02 (2)")).toBeVisible();
});

test("deleting a connection asks for confirmation", async ({ page }) => {
  const menu = await openMenu(page, "kiosk-01");
  await menu.getByText("Delete", { exact: true }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("kiosk-01");
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(row(page, "kiosk-01")).toHaveCount(0);
});

test("a bastion that is still in use cannot be deleted", async ({ page }) => {
  const menu = await openMenu(page, "bastion-01");
  await menu.getByText("Delete", { exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByText("Used by: db-prod, web-01, web-02")).toBeVisible();
  await expect(row(page, "bastion-01")).toBeVisible();
});

test("copying the address puts user@host on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const menu = await openMenu(page, "web-01");
  await menu.getByText("Copy user@host", { exact: true }).click();
  await expect(page.getByText("Copied to the clipboard")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("deploy@10.0.0.12");
});

test("groups can be created, renamed and deleted", async ({ page }) => {
  await page.getByRole("button", { name: "New group", exact: true }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Lab");
  await page.getByRole("dialog").getByRole("button", { name: "Create", exact: true }).click();
  await expect(region(page, "Lab")).toBeVisible();

  await region(page, "Lab").getByRole("button", { name: "Group actions" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("dialog").getByLabel("Name", { exact: true }).fill("Laboratory");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(region(page, "Laboratory")).toBeVisible();

  await region(page, "Homelab").getByRole("button", { name: "Group actions" }).click();
  await page.getByRole("menuitem", { name: "Delete group" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete", exact: true }).click();
  await expect(region(page, "Homelab")).toHaveCount(0);
  await expect(region(page, "Ungrouped").getByRole("button", { name: /^nas/ })).toBeVisible();
});
```

## Étapes

1. Tests d'abord (les 6 fichiers ci-dessus). Supprimer l'ancien `Sidebar.test.tsx` et le remplacer.
2. `result.ts`, `sections.ts`, les stores, `theme.ts`, `errors.ts`, `clipboard.ts`.
3. La barre latérale et ses dialogues, puis `demo-data.ts`, `StatusBar`, `AppLayout`, `App.tsx` et `main.tsx`.
4. `npm run format`, `npm run review` : les 6 scénarios de T05b et les 7 de cette fiche doivent être verts. Cases,
   statut, commit `feat: zustand stores and live sidebar (favorites, groups, duplicate, delete) (T09)`.

## Critères d'acceptation

- [x] `npm run review` passe : tests unitaires du contrat, 6 scénarios de `shell.spec.ts` et 7 de `connections.spec.ts`.
- [x] Les fichiers de tests sont identiques à la fiche (au formatage Biome près).
- [x] `grep -rn "DEMO_CONNECTIONS\|DEMO_GROUPS" src` est vide.
- [x] `grep -rn "localStorage" src --include=*.ts --include=*.tsx | grep -v test` ne montre que `src/lib/theme.ts`.
- [x] Visuel : le bouton `⋯` d'un groupe n'apparaît qu'au survol de son en-tête ou au focus clavier.
- [x] Visuel : pendant le chargement, la barre latérale montre des lignes squelettes, pas une liste vide.

## À regarder par Florian

`npm run tauri dev` démarre avec une barre latérale **vide** : le vrai store n'a encore aucune connexion. L'éditeur
arrive en T10. Pour voir les données de démonstration, ouvrir `npm run dev` dans un navigateur :
- créer un groupe, le renommer, le monter et le descendre ;
- mettre une connexion en favori ;
- dupliquer, supprimer ;
- essayer de supprimer `bastion-01` : c'est refusé, avec la liste de ce qui l'utilise.
