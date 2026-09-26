# T04 — Coquille de l'application

| | |
|---|---|
| **Jalon** | M0 — Fondations |
| **Dépend de** | T03 |
| **Lire avant** | `docs/04-ecrans.md` §1, §2 (premier lancement) et §8 ; `docs/03-design.md` §4, §5, §8 |
| **Livrable** | la fenêtre principale complète (TopBar, Sidebar redimensionnable, TabBar animée, StatusBar, accueil vide), alimentée par des **données de démonstration** |

## Contexte

C'est la première fois que TunL ressemble à TunL. Les données sont **fictives** (`demo-data.ts`) : les vraies
connexions arrivent en T09, les vraies sessions en T21. On construit donc des composants qui prennent leurs données
en props, pour que T09 n'ait qu'à changer la source.

Tout texte visible passe par `t()`. Les noms de machines et de groupes de démonstration ne sont pas traduits
(ce sont des données).

Nouvelles dépendances : `zustand` et `motion`.

```bash
npm install zustand@^5 motion@^13.4
```

## Fichiers à créer

```
src/lib/colors.ts
src/lib/native-context-menu.ts
src/features/connections/filter.ts          (+ filter.test.ts)
src/features/shell/shortcuts.ts             (+ shortcuts.test.ts)
src/features/shell/use-global-shortcuts.ts
src/features/shell/ui-store.ts
src/features/shell/demo-data.ts             ⚠ provisoire, supprimé en T09 / T21
src/features/shell/AppLayout.tsx
src/features/shell/TopBar.tsx
src/features/shell/TabBar.tsx
src/features/shell/StatusBar.tsx
src/features/shell/sidebar/Sidebar.tsx
src/features/shell/sidebar/ConnectionRow.tsx
src/features/shell/sidebar/ConnectionContextMenu.tsx
src/features/shell/sidebar/GroupSection.tsx
src/features/home/HomeView.tsx
```

## Étapes

### 1. Textes (à ajouter aux JSON **avant** d'écrire les composants)

Ajouter ces objets à `src/i18n/locales/en.json` :

```json
"topbar": {
  "toggleSidebar": "Toggle sidebar",
  "searchPlaceholder": "Search or connect…",
  "newConnection": "New",
  "settings": "Settings"
},
"sidebar": {
  "filterPlaceholder": "Filter connections…",
  "favorites": "Favorites",
  "recents": "Recent",
  "groups": "Groups",
  "ungrouped": "Ungrouped",
  "results": "Results",
  "noResults": "No connection matches “{{query}}”",
  "count_one": "{{count}} connection",
  "count_other": "{{count}} connections",
  "import": "Import connections",
  "viaBastion": "Via {{name}}",
  "moreActions": "More actions for {{name}}",
  "createGroup": "Create a group"
},
"connectionMenu": {
  "connect": "Connect",
  "openSftp": "Open in SFTP",
  "wake": "Wake up",
  "edit": "Edit",
  "duplicate": "Duplicate",
  "addFavorite": "Add to favorites",
  "removeFavorite": "Remove from favorites",
  "moveToGroup": "Move to group",
  "copyAddress": "Copy user@host",
  "delete": "Delete"
},
"tabs": {
  "label": "Open sessions",
  "new": "New session",
  "close": "Close {{name}}"
},
"statusbar": {
  "activeSessions_one": "{{count}} active session",
  "activeSessions_other": "{{count}} active sessions",
  "via": "via {{name}}"
},
"home": {
  "welcomeTitle": "Welcome to TunL",
  "welcomeDescription": "Add your first machine, or bring in the ones already listed in ~/.ssh/config.",
  "newConnection": "New connection",
  "importSshConfig": "Import ~/.ssh/config",
  "quickConnect": "Quick connect"
},
"shell": {
  "notYetAvailable": "Coming soon",
  "sessionPlaceholder": "The session “{{name}}” will be displayed here."
}
```

Et à `fr.json` :

```json
"topbar": {
  "toggleSidebar": "Afficher ou masquer la barre latérale",
  "searchPlaceholder": "Rechercher ou se connecter…",
  "newConnection": "Nouvelle",
  "settings": "Paramètres"
},
"sidebar": {
  "filterPlaceholder": "Filtrer les connexions…",
  "favorites": "Favoris",
  "recents": "Récents",
  "groups": "Groupes",
  "ungrouped": "Sans groupe",
  "results": "Résultats",
  "noResults": "Aucune connexion ne correspond à « {{query}} »",
  "count_one": "{{count}} connexion",
  "count_many": "{{count}} de connexions",
  "count_other": "{{count}} connexions",
  "import": "Importer des connexions",
  "viaBastion": "Via {{name}}",
  "moreActions": "Autres actions pour {{name}}",
  "createGroup": "Créer un groupe"
},
"connectionMenu": {
  "connect": "Se connecter",
  "openSftp": "Ouvrir en SFTP",
  "wake": "Réveiller",
  "edit": "Modifier",
  "duplicate": "Dupliquer",
  "addFavorite": "Ajouter aux favoris",
  "removeFavorite": "Retirer des favoris",
  "moveToGroup": "Déplacer vers le groupe",
  "copyAddress": "Copier user@hôte",
  "delete": "Supprimer"
},
"tabs": {
  "label": "Sessions ouvertes",
  "new": "Nouvelle session",
  "close": "Fermer {{name}}"
},
"statusbar": {
  "activeSessions_one": "{{count}} session active",
  "activeSessions_many": "{{count}} de sessions actives",
  "activeSessions_other": "{{count}} sessions actives",
  "via": "via {{name}}"
},
"home": {
  "welcomeTitle": "Bienvenue sur TunL",
  "welcomeDescription": "Ajoutez une première machine, ou reprenez celles déjà listées dans ~/.ssh/config.",
  "newConnection": "Nouvelle connexion",
  "importSshConfig": "Importer ~/.ssh/config",
  "quickConnect": "Connexion rapide"
},
"shell": {
  "notYetAvailable": "Bientôt disponible",
  "sessionPlaceholder": "La session « {{name}} » s'affichera ici."
}
```

### 2. `src/lib/colors.ts`

```ts
// Provisional local type: replaced by the generated `AccentColor` binding in T09.
export type AccentColor =
  | "slate" | "red" | "orange" | "amber" | "green" | "teal" | "cyan" | "blue" | "violet" | "pink";

/** The only place where Tailwind's built-in palette is allowed (docs/05-modele-donnees.md §2). */
export const ACCENT_DOT_CLASSES: Record<AccentColor, string> = {
  slate: "bg-slate-500 dark:bg-slate-400",
  red: "bg-red-500 dark:bg-red-400",
  orange: "bg-orange-500 dark:bg-orange-400",
  amber: "bg-amber-500 dark:bg-amber-400",
  green: "bg-green-500 dark:bg-green-400",
  teal: "bg-teal-500 dark:bg-teal-400",
  cyan: "bg-cyan-500 dark:bg-cyan-400",
  blue: "bg-blue-500 dark:bg-blue-400",
  violet: "bg-violet-500 dark:bg-violet-400",
  pink: "bg-pink-500 dark:bg-pink-400",
};
```

### 3. `src/lib/native-context-menu.ts`

```ts
/** Blocks WebKit's native context menu (Reload, Inspect…) everywhere except in text fields. */
export function disableNativeContextMenu(): void {
  window.addEventListener("contextmenu", (event) => {
    const target = event.target;
    const isEditable =
      target instanceof HTMLElement &&
      (target.isContentEditable || target.closest("input, textarea") !== null);
    if (!isEditable) {
      event.preventDefault();
    }
  });
}
```

Dans `src/main.tsx`, juste après l'appel existant `primeTheme("system");` (ajouté à la relecture de T03, à garder
tel quel) : `if (import.meta.env.PROD) { disableNativeContextMenu(); }`.
En dev, on garde le menu natif, qui donne accès à l'inspecteur.

### 4. `src/features/connections/filter.ts` (réutilisé tel quel en T09)

```ts
export interface Filterable {
  name: string;
  host: string;
  username: string | null;
  tags: readonly string[];
}

export function normalizeForSearch(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();
}

export function matchesQuery(item: Filterable, query: string): boolean {
  const terms = normalizeForSearch(query).split(/\s+/).filter(Boolean);
  if (terms.length === 0) {
    return true;
  }
  const haystack = normalizeForSearch([item.name, item.host, item.username ?? "", ...item.tags].join(" "));
  return terms.every((term) => haystack.includes(term));
}

export function filterConnections<T extends Filterable>(items: readonly T[], query: string): T[] {
  return items.filter((item) => matchesQuery(item, query));
}
```

`filter.test.ts` : une requête vide renvoie tout (mais un **nouveau** tableau : `not.toBe(items)`) ; `"prod"`
trouve une connexion par son étiquette ; `"DÉPLOY"` trouve l'utilisateur `deploy` ; `"web 10.0"` exige les deux
termes ; `"zzz"` → `[]`.

### 5. `src/features/shell/shortcuts.ts`

La table de `docs/03-design.md` §8. Pour les chiffres, on compare `event.code` et pas `event.key` : sur un clavier
**AZERTY**, `Alt+1` donne `key = "&"` mais `code = "Digit1"`.

```ts
export type ShortcutId =
  | "palette.open"
  | "palette.quickConnect"
  | "connection.new"
  | "tab.close"
  | "tab.next"
  | "tab.previous"
  | `tab.goTo${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | "sidebar.toggle"
  | "sidebar.filter"
  | "settings.open"
  | "help.shortcuts";

interface KeyCombo {
  /** Compared case-insensitively with KeyboardEvent.key (layout-aware). */
  key?: string;
  /** Compared exactly with KeyboardEvent.code (physical key). Used for digits. */
  code?: string;
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  /** When true, the combo is ignored while a terminal has focus (the shell owns it). */
  outsideTerminalOnly?: boolean;
}

export interface ShortcutDefinition {
  id: ShortcutId;
  combos: readonly KeyCombo[];
  /** Keys shown to the user, e.g. ["Ctrl", "⇧", "P"]. */
  display: readonly string[];
}

const goToTab = (n: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9): ShortcutDefinition => ({
  id: `tab.goTo${n}`,
  combos: [{ code: `Digit${n}`, alt: true }],
  display: ["Alt", String(n)],
});

export const SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: "palette.open",
    combos: [
      { key: "p", ctrl: true, shift: true },
      { key: "k", ctrl: true, outsideTerminalOnly: true },
    ],
    display: ["Ctrl", "⇧", "P"],
  },
  { id: "palette.quickConnect", combos: [{ key: "t", ctrl: true, shift: true }], display: ["Ctrl", "⇧", "T"] },
  { id: "connection.new", combos: [{ key: "n", ctrl: true, shift: true }], display: ["Ctrl", "⇧", "N"] },
  { id: "tab.close", combos: [{ key: "w", ctrl: true, shift: true }], display: ["Ctrl", "⇧", "W"] },
  {
    id: "tab.next",
    combos: [{ key: "PageDown", ctrl: true }, { key: "Tab", ctrl: true }],
    display: ["Ctrl", "PgDn"],
  },
  {
    id: "tab.previous",
    combos: [{ key: "PageUp", ctrl: true }, { key: "Tab", ctrl: true, shift: true }],
    display: ["Ctrl", "PgUp"],
  },
  goToTab(1), goToTab(2), goToTab(3), goToTab(4), goToTab(5), goToTab(6), goToTab(7), goToTab(8), goToTab(9),
  { id: "sidebar.toggle", combos: [{ key: "b", ctrl: true, shift: true }], display: ["Ctrl", "⇧", "B"] },
  { id: "sidebar.filter", combos: [{ key: "e", ctrl: true, shift: true }], display: ["Ctrl", "⇧", "E"] },
  { id: "settings.open", combos: [{ key: ",", ctrl: true }], display: ["Ctrl", ","] },
  { id: "help.shortcuts", combos: [{ key: "F1" }], display: ["F1"] },
];

type KeyInfo = Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

function comboMatches(combo: KeyCombo, event: KeyInfo, inTerminal: boolean): boolean {
  if (combo.outsideTerminalOnly && inTerminal) return false;
  if (event.metaKey) return false;
  if (event.ctrlKey !== Boolean(combo.ctrl)) return false;
  if (event.shiftKey !== Boolean(combo.shift)) return false;
  if (event.altKey !== Boolean(combo.alt)) return false;
  if (combo.code !== undefined) return event.code === combo.code;
  return combo.key !== undefined && event.key.toLowerCase() === combo.key.toLowerCase();
}

export function matchShortcut(event: KeyInfo, inTerminal: boolean): ShortcutId | null {
  const found = SHORTCUTS.find((shortcut) =>
    shortcut.combos.some((combo) => comboMatches(combo, event, inTerminal)),
  );
  return found?.id ?? null;
}
```

`shortcuts.test.ts`, un `it` par ligne (fabriquer l'événement avec un petit helper
`key(k, { ctrl, shift, alt, code })`, tous les modificateurs à `false` par défaut) :

| Événement | Terminal ? | Attendu |
|---|---|---|
| Ctrl+Shift+`P` | non | `palette.open` |
| Ctrl+`k` | non | `palette.open` |
| Ctrl+`k` | **oui** | `null` |
| Ctrl+Shift+`B` | oui | `sidebar.toggle` |
| Ctrl+`b` | non | `null` |
| Alt + key `&` code `Digit1` | non | `tab.goTo1` |
| Ctrl+`PageDown` | oui | `tab.next` |
| Ctrl+`Tab` | non | `tab.next` |
| Ctrl+Shift+`Tab` | non | `tab.previous` |
| `F1` | non | `help.shortcuts` |
| Ctrl+`,` | non | `settings.open` |
| Ctrl+Shift+`P` avec `metaKey` | non | `null` |

### 6. `src/features/shell/use-global-shortcuts.ts`

```ts
import { useEffect, useRef } from "react";
import { matchShortcut, type ShortcutId } from "./shortcuts";

export type ShortcutHandlers = Partial<Record<ShortcutId, () => void>>;

/** Listens in the capture phase so shortcuts win over focused widgets (xterm included). */
export function useGlobalShortcuts(handlers: ShortcutHandlers): void {
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const inTerminal =
        event.target instanceof Element && event.target.closest("[data-terminal]") !== null;
      const id = matchShortcut(event, inTerminal);
      const handler = id ? handlersRef.current[id] : undefined;
      if (!handler) return;
      event.preventDefault();
      event.stopPropagation();
      handler();
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, []);
}
```

### 7. `src/features/shell/ui-store.ts`

```ts
import { create } from "zustand";

interface UiState {
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useUi = create<UiState>()((set) => ({
  sidebarCollapsed: false,
  toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
}));
```

### 8. `src/features/shell/demo-data.ts` (provisoire)

En tête : `// DEMO DATA — temporary. Replaced by real stores in T09 (connections) and T21 (sessions).`

Types :

```ts
import type { Status } from "@/components/StatusDot";
import type { AccentColor } from "@/lib/colors";

export interface DemoGroup { id: string; name: string; color: AccentColor }
export interface DemoConnection {
  id: string;
  name: string;
  protocol: "ssh" | "rdp";
  host: string;
  port: number;
  username: string | null;
  groupId: string | null;
  tags: string[];
  favorite: boolean;
  jumpHostName: string | null;
  status: Status;
  lastConnectedAt: number | null;
}
export interface DemoTab { id: string; connectionId: string; title: string; protocol: "ssh" | "rdp"; status: Status }
```

Données : `DEMO_GROUPS` et `DEMO_CONNECTIONS`, exportés en `readonly` (`const now = Date.now()` pour les dates).

| name | proto | host:port | user | groupe | tags | ★ | bastion | status | dernière connexion |
|---|---|---|---|---|---|---|---|---|---|
| web-01 | ssh | 10.0.0.12:22 | deploy | Production (blue) | prod, web | ★ | bastion-01 | online | il y a 5 min |
| web-02 | ssh | 10.0.0.13:22 | deploy | Production | prod, web | | bastion-01 | online | — |
| db-prod | ssh | db.internal:22 | root | Production | prod, pg | | bastion-01 | connecting | il y a 1 h |
| bastion-01 | ssh | bastion.example.net:2222 | ops | Production | bastion | | — | online | il y a 1 h |
| ad-01 | rdp | 10.0.0.5:3389 | admin | Clients (violet) | windows | ★ | — | online | hier |
| nas | ssh | 192.168.1.10:22 | admin | Homelab (green) | storage | | — | offline | il y a 3 jours |
| pi-hole | ssh | 192.168.1.2:22 | pi | Homelab | dns | | — | online | — |
| media-server | ssh | 192.168.1.20:22 | media | Homelab | — | | — | unknown | — |
| win-desktop | rdp | 192.168.1.50:3389 | ops | Homelab | wol | | — | offline | — |
| router | ssh | 192.168.1.1:22 | root | *(aucun)* | network | | — | online | — |
| kiosk-01 | ssh | 172.16.0.40:22 | *(null)* | *(aucun)* | — | | — | unknown | — |

Store des onglets de démonstration (le code est donné parce que la fermeture de l'onglet actif est subtile) :

```ts
import { create } from "zustand";

interface DemoTabsState {
  tabs: readonly DemoTab[];
  activeId: string | null;
  activate: (id: string) => void;
  activateIndex: (index: number) => void;
  activateRelative: (delta: 1 | -1) => void;
  close: (id: string) => void;
}

export const INITIAL_TABS: readonly DemoTab[] = [
  { id: "t1", connectionId: "c-web-01", title: "web-01", protocol: "ssh", status: "online" },
  { id: "t2", connectionId: "c-db-prod", title: "db-prod", protocol: "ssh", status: "connecting" },
];

export const useDemoTabs = create<DemoTabsState>()((set) => ({
  tabs: INITIAL_TABS,
  activeId: "t1",
  activate: (id) => set({ activeId: id }),
  activateIndex: (index) =>
    set((state) => {
      const target = state.tabs[Math.min(index, state.tabs.length - 1)];
      return target ? { activeId: target.id } : {};
    }),
  activateRelative: (delta) =>
    set((state) => {
      if (state.tabs.length === 0) return {};
      const current = state.tabs.findIndex((tab) => tab.id === state.activeId);
      const next = (current + delta + state.tabs.length) % state.tabs.length;
      return { activeId: state.tabs[next].id };
    }),
  close: (id) =>
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === id);
      const tabs = state.tabs.filter((tab) => tab.id !== id);
      if (state.activeId !== id) return { tabs };
      const neighbour = tabs[Math.min(index, tabs.length - 1)];
      return { tabs, activeId: neighbour ? neighbour.id : null };
    }),
}));
```

(Les `id` des connexions de démonstration sont `c-<name>`, par exemple `c-web-01`.)

### 9. `AppLayout.tsx`

Structure : `flex h-dvh flex-col overflow-hidden bg-background` →
1. `<TopBar />` ;
2. un `ResizablePanelGroup orientation="horizontal" className="min-h-0 flex-1"` :
   - panneau latéral : `<ResizablePanel panelRef={panelRef} defaultSize={272} minSize={220} maxSize={400} collapsible collapsedSize={0} onResize={(size) => setSidebarCollapsed(size.inPixels === 0)}>`
     contenant `<Sidebar />` (les nombres = **pixels**, API v4 de `react-resizable-panels`) ;
   - `<ResizableHandle />` ;
   - panneau principal : colonne `flex h-full min-w-0 flex-col` avec `<TabBar />` puis la zone de contenu
     `relative min-h-0 flex-1` : `HomeView` si `activeId === null`, sinon un placeholder centré
     (`text-muted-foreground`, `t("shell.sessionPlaceholder", { name })`) ;
3. `<StatusBar />`.

Synchronisation du repli (le store est la source de vérité, le panneau suit) :

```tsx
const panelRef = usePanelRef(); // import { usePanelRef } from "react-resizable-panels"
const collapsed = useUi((state) => state.sidebarCollapsed);
const setSidebarCollapsed = useUi((state) => state.setSidebarCollapsed);

useEffect(() => {
  const panel = panelRef.current;
  if (!panel) return;
  if (collapsed && !panel.isCollapsed()) panel.collapse();
  if (!collapsed && panel.isCollapsed()) panel.expand();
}, [collapsed, panelRef]);
```

Raccourcis branchés ici avec `useGlobalShortcuts` :
- `sidebar.toggle` → `toggleSidebar` ;
- `sidebar.filter` → déplier la barre si besoin, puis `document.getElementById("sidebar-filter")?.focus()` ;
- `tab.next` / `tab.previous` → `activateRelative(1 / -1)` ;
- `tab.close` → fermer l'onglet actif ;
- `tab.goTo1`…`tab.goTo8` → `activateIndex(n - 1)` ;
- `tab.goTo9` → le dernier onglet.

Les autres raccourcis restent sans gestionnaire pour l'instant.

### 10. `TopBar.tsx` (`docs/04-ecrans.md` §1 « TopBar »)

`header` : `flex h-12 shrink-0 items-center gap-2 border-b bg-sidebar px-2 select-none`.
- Bouton `ghost` `size="icon-sm"`, icône `PanelLeft`, `aria-label={t("topbar.toggleSidebar")}`, enveloppé dans un
  `Tooltip`. Clic : `toggleSidebar`.
- `Logo` (20) + `Wordmark`.
- Au centre (`flex flex-1 justify-center`), le **faux champ** : un `button type="button"`
  `flex h-8 w-full max-w-115 items-center gap-2 rounded-md border bg-background/60 px-3 text-muted-foreground transition-colors duration-120 hover:border-border-strong hover:text-foreground`.
  Il contient `Search` (`size-4`), le texte `t("topbar.searchPlaceholder")` (`flex-1 truncate text-left`) et
  `<ShortcutHint keys={["Ctrl", "⇧", "P"]} />`.
  Clic : `toast(t("shell.notYetAvailable"))` (la palette arrive en T13).
- Bouton `size="sm"` avec `Plus` + `t("topbar.newConnection")` → même toast (l'éditeur arrive en T10).
- Bouton `ghost` `icon-sm` `Settings2`, `aria-label` + `Tooltip` → même toast.

### 11. `Sidebar.tsx`, `GroupSection.tsx`, `ConnectionRow.tsx`, `ConnectionContextMenu.tsx`

Spécification : `docs/04-ecrans.md` §1 « Sidebar » et §8. Les données arrivent en **props**
(`connections`, `groups`) : `AppLayout` passe `DEMO_CONNECTIONS` et `DEMO_GROUPS`.

- **Sidebar** : `aside` `flex h-full flex-col bg-sidebar text-sidebar-foreground select-none`.
  - En haut, `p-2` : un `Input` `id="sidebar-filter"` `h-8`, placeholder `t("sidebar.filterPlaceholder")`, avec une
    icône `Search` à gauche (composant `InputGroup` de shadcn, ou `Input` avec `pl-8` et icône en `absolute`).
    `Échap` vide le champ. État local `useState("")`.
  - Corps : `ScrollArea` `flex-1 px-2 pb-2`.
    - **Avec un filtre** : `SectionHeader title={t("sidebar.results")}` puis la liste plate
      `filterConnections(connections, query)`, triée par nom (`localeCompare`). Liste vide :
      `t("sidebar.noResults", { query })` en `text-xs text-muted-foreground px-2 py-4`.
    - **Sans filtre** :
      - Favoris (`favorite`, tri par nom) ;
      - Récents (`lastConnectedAt !== null`, tri décroissant, 5 au plus) ;
      - Groupes : un `GroupSection` par groupe, dans l'ordre de `groups` ;
      - Sans groupe.
      Une section vide n'est pas rendue.
  - Pied : `flex h-10 items-center justify-between border-t px-3 text-xs text-muted-foreground`,
    `t("sidebar.count", { count: connections.length })` et un bouton `ghost` `icon-xs` `FileInput`
    (`aria-label={t("sidebar.import")}`, `Tooltip`) → toast « bientôt ».
  - Sélection : `useState<string | null>` local, passé aux lignes.
- **GroupSection** : `Collapsible` ouvert par défaut. Déclencheur = ligne `h-7` avec `ChevronRight` (pivote de 90°
  quand ouvert, `transition-transform duration-120`), pastille `size-2 rounded-full` + `ACCENT_DOT_CLASSES[color]`,
  nom en `text-xs font-medium`, compteur à droite en `text-xs text-subtle-foreground tabular-nums`.
  Contenu : ses `ConnectionRow`, triées par nom.
- **ConnectionRow** : `button type="button"`
  `group/row relative flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors duration-120 hover:bg-sidebar-accent`
  (+ `bg-sidebar-accent` si sélectionnée, avec une barre `absolute left-0 top-1.5 bottom-1.5 w-0.5 rounded-full bg-primary`).
  Contenu : `ProtocolIcon` `size-3.5` · nom `truncate flex-1` · si `jumpHostName`, une icône `Waypoints`
  `size-3 text-subtle-foreground` avec `Tooltip` `t("sidebar.viaBastion", { name })`. ⚠ Le déclencheur est
  `<TooltipTrigger asChild><span>…icône…</span></TooltipTrigger>` : jamais de `button` dans le `button` de la ligne. Enfin, `StatusDot` avec
  `label={t(\`status.${status}\`)}`.
  - Clic : sélectionner.
  - Double-clic ou `Entrée` : `toast(t("shell.notYetAvailable"))`.
  - Clic droit : `ConnectionContextMenu`.
- **ConnectionContextMenu** : `ContextMenu` de shadcn enveloppant la ligne (`ContextMenuTrigger asChild`).
  Entrées de `04-ecrans.md` §8 dans l'ordre, séparateurs compris, icônes lucide de `03-design.md` §5 :
  - « Ouvrir en SFTP » seulement pour SSH ;
  - « Réveiller » seulement si `tags` contient `wol` (règle de démo) ;
  - « Déplacer vers le groupe » = sous-menu listant les groupes ;
  - « Supprimer » avec `variant="destructive"`.
  Toutes les entrées → `toast(t("shell.notYetAvailable"))` pour l'instant.

### 12. `TabBar.tsx`

`div role="tablist" aria-label={t("tabs.label")}`
`flex h-10 shrink-0 items-end gap-0.5 overflow-x-auto bg-sidebar px-2 select-none`, puis un bouton `ghost` `icon-xs`
`Plus` (`aria-label={t("tabs.new")}`) → toast « bientôt ».

Chaque onglet (le code de l'indicateur est donné, c'est l'animation signature n° 1) :

```tsx
<div
  role="tab"
  tabIndex={active ? 0 : -1}
  aria-selected={active}
  onClick={() => activate(tab.id)}
  onAuxClick={(event) => {
    if (event.button === 1) close(tab.id);
  }}
  onKeyDown={(event) => {
    if (event.key === "Enter" || event.key === " ") activate(tab.id);
  }}
  className={cn(
    "group/tab relative flex h-9 min-w-30 max-w-55 cursor-default items-center gap-2 rounded-t-lg px-3 text-sm transition-colors duration-120",
    active
      ? "bg-background text-foreground"
      : "text-muted-foreground hover:bg-sidebar-accent hover:text-foreground",
  )}
>
  <StatusDot status={tab.status} label={t(`status.${tab.status}`)} />
  <ProtocolIcon protocol={tab.protocol} className="size-3.5" />
  <span className="truncate">{tab.title}</span>
  <button
    type="button"
    aria-label={t("tabs.close", { name: tab.title })}
    onClick={(event) => {
      event.stopPropagation();
      close(tab.id);
    }}
    className={cn(
      "ml-auto rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity duration-120 hover:bg-muted hover:text-foreground group-hover/tab:opacity-100 focus-visible:opacity-100",
      active && "opacity-100",
    )}
  >
    <X className="size-3.5" />
  </button>
  {active && (
    <motion.span
      layoutId="tab-indicator"
      className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-brand-gradient"
      transition={{ type: "spring", stiffness: 500, damping: 38 }}
    />
  )}
</div>
```

### 13. `StatusBar.tsx`

`footer` : `flex h-7 shrink-0 items-center justify-between border-t bg-sidebar px-3 text-xs text-muted-foreground select-none`.
- Gauche : `t("statusbar.activeSessions", { count })`, avec `count` = nombre d'onglets `online`. Rien si 0.
- Droite (`flex items-center gap-2 font-mono`), si un onglet est actif : `ProtocolBadge`, `username@host:port` de la
  connexion (sans `username@` s'il est `null`), et `t("statusbar.via", { name })` s'il y a un bastion.

### 14. `src/features/home/HomeView.tsx` (premier lancement, `docs/04-ecrans.md` §2)

Centré (`flex h-full items-center justify-center p-8`), avec le composant shadcn `Empty` :
- `EmptyMedia` : un halo `rounded-2xl bg-brand-soft p-4` contenant `<Logo size={40} />` (corrigé à la relecture : `bg-brand-gradient/10` ne produit rien) ;
- `EmptyTitle` → `t("home.welcomeTitle")` ;
- `EmptyDescription` → `t("home.welcomeDescription")` ;
- `EmptyContent` : trois boutons en ligne (retour à la ligne permis) :
  - `default` avec `Plus` → `t("home.newConnection")` ;
  - `outline` avec `FileInput` → `t("home.importSshConfig")` ;
  - `ghost` avec `Command` → `t("home.quickConnect")`.
  Tous → toast « bientôt ».

Le tableau de bord complet (cartes, récents) arrive en T14.

### 15. `App.tsx`

```tsx
import { MotionConfig } from "motion/react";
import { useEffect } from "react";
import { I18nextProvider } from "react-i18next";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Gallery } from "@/dev/Gallery";
import { AppLayout } from "@/features/shell/AppLayout";
import { i18n } from "@/i18n";
import { applyTheme } from "@/lib/theme";

const showGallery = import.meta.env.DEV && window.location.hash === "#gallery";

export function App() {
  useEffect(() => applyTheme("system"), []);
  return (
    <I18nextProvider i18n={i18n}>
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={400}>
          {showGallery ? <Gallery /> : <AppLayout />}
          <Toaster position="bottom-right" />
        </TooltipProvider>
      </MotionConfig>
    </I18nextProvider>
  );
}
```

La galerie reste accessible en dev via `http://localhost:1420/#gallery` (dans un navigateur).

### 16. Tests

- `src/App.test.tsx` : le bouton du faux champ existe
  (`getByRole("button", { name: /Search or connect/ })`) ; le titre « Welcome to TunL » **n'est pas** affiché
  (un onglet est actif).
- `src/features/shell/demo-data.test.ts` : fermer l'onglet actif `t1` active `t2` ; fermer le dernier onglet restant
  donne `activeId === null` ; `activateRelative(1)` sur le dernier revient au premier. Remettre le store à zéro
  entre deux tests : `useDemoTabs.setState({ tabs: INITIAL_TABS, activeId: "t1" })` dans un `beforeEach`.
- `filter.test.ts` et `shortcuts.test.ts` (étapes 4 et 5).

### 17. Vérifier et livrer

```bash
npm run format && npm run verify
git add -A && git commit -m "feat: application shell with demo data (T04)"
```

## Critères d'acceptation

- [x] `npm run verify` passe.
- [x] Aucun texte d'interface en dur dans `src/features/` : chaque chaîne visible vient de `t()`, sauf les données de
      démonstration.
- [x] `grep -rn "invoke(" src` est vide (pas d'IPC dans cette fiche).
- [x] Dans l'app (`npm run tauri dev`) : *(relecture Claude : vérifié avec Playwright + Chromium, après corrections)*
  - [ ] la barre latérale se redimensionne entre 220 et 400 px, et `Ctrl+Shift+B` la replie et la déplie ;
  - [x] `Ctrl+Shift+E` met le focus dans le filtre, et taper « prod » réduit la liste ;
  - [ ] l'indicateur dégradé **glisse** d'un onglet à l'autre (clic, `Ctrl+PageDown`, `Alt+1`/`Alt+2` sur AZERTY) ;
  - [x] fermer les deux onglets affiche l'écran « Bienvenue sur TunL » ;
  - [x] clic droit sur une connexion → menu contextuel complet ; *(ne s'ouvrait pas à la livraison : corrigé à la relecture)*
  - [ ] la pastille de `db-prod` pulse.

## À regarder par Florian

L'app entière, en clair et en sombre. Points à juger :
- les proportions (barre latérale, hauteur des barres) ;
- la lisibilité des lignes de connexion ;
- la sensation de l'indicateur d'onglet ;
- l'écran d'accueil vide.
