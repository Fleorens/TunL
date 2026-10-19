# T25 — Onglet SFTP : explorateur (fil d'Ariane, tableau virtualisé, tri, fichiers cachés)

| | |
|---|---|
| **Jalon** | M4 — SFTP |
| **Dépend de** | T24 |
| **Lire avant** | `docs/04-ecrans.md` §6 (onglet SFTP), `docs/03-design.md` (tokens, densité des listes), `docs/01-architecture.md` §6 |
| **Livrable** | onglets de type `sftp` (store, ouverture, vue, icône, barre d'état) ; `src/features/sftp/` (modèle pur, barre d'outils, tableau virtualisé, explorateur) ; « Ouvrir en SFTP » branché ; 3 fichiers de tests (dont 1 remplace celui de T21) |

## Pourquoi

« Ouvrir en SFTP » (menu contextuel, carte d'accueil, palette) affiche « bientôt disponible ». Cette fiche ouvre un
vrai onglet SFTP : les mêmes étapes de connexion qu'un terminal (carte d'étapes, erreur, fin, reconnexion de T21),
puis un **explorateur** de fichiers : barre d'outils, fil d'Ariane cliquable ou chemin saisi, tableau trié,
dossiers d'abord, fichiers cachés masqués par défaut, clavier.

Les **actions** (nouveau dossier, renommer, supprimer, copier le chemin, droits) viennent avec T25b, les
**transferts** avec T26 : ici, un double-clic sur un fichier ne fait rien.

Prototypé par l'orchestrateur sur le mock de T24 : les tests de cette fiche passent.

## À réutiliser (ne pas réécrire)

- T24 : `ipc.sftpOpen`, `ipc.sftpRealpath`, `ipc.sftpList` ; `RemoteEntry`, `EntryKind` (`src/bindings/`).
- T21 : `useSessions` (store), `SessionView` (cartes de connexion, d'erreur, bandeau de fin), `session-model.ts`,
  `openSession(connection, kind?)` (déjà appelée avec `"sftp"` par la carte d'accueil et la palette).
- Composants shadcn existants : `breadcrumb`, `button` (tailles `icon-sm`), `input`, `toggle`, `empty`, `spinner`.
  `ProtocolIcon` et `ProtocolBadge` connaissent déjà `"sftp"`.
- `notifyError` (`lib/errors.ts`), `i18n.language` pour les formats de nombre et de date.

## Dépendance

`npm install @tanstack/react-virtual@^3.14` (prévue par `docs/01-architecture.md` §2, « Listes longues »). Aucune
autre.

## Contrat — Sessions

- `session-model.ts` : `export type SessionKind = "ssh" | "sftp";`, champ `kind: SessionKind` dans `Session`
  (juste après `id`), et `newSession(id, title, target, kind: SessionKind = "ssh")`.
- `store.ts` : `open(target, name, kind = "ssh")` ; `registerSessionPort` **seulement** pour `ssh` ; dans `start`,
  `kind === "sftp"` → `ipc.sftpOpen(runId, target, onEvent)`, sinon `ipc.sshOpen(…)` comme avant (même `catch`) ;
  à `connected`, `sendSessionSize` seulement pour `ssh`.
- `open-session.ts` : une connexion SSH s'ouvre en `"sftp"` quand `kind === "sftp"`, sinon en `"ssh"` ; le RDP
  reste « bientôt disponible » (T28). Mettre à jour le commentaire d'en-tête.
- `SessionView.tsx` : un onglet `ssh` garde son terminal (et `return null` sans port) ; un onglet `sftp` rend
  `<SftpExplorer key={session.runId} sessionId={session.runId} />` **quand il est connecté**, sous les mêmes
  cartes (connexion, erreur) et le même bandeau de fin. `key={runId}` : une reconnexion repart du dossier personnel.
- `TabBar.tsx` : `<ProtocolIcon protocol={session.kind} …/>`. `StatusBar.tsx` : `<ProtocolBadge protocol={active.kind} />`.
- `ConnectionContextMenu.tsx` : « Ouvrir en SFTP » appelle `openSession(connection, "sftp")` (retirer l'import de
  `notifyComingSoon` s'il ne sert plus).

## Contrat — `src/features/sftp/`

### `sftp-model.ts` (pur)

```ts
export type SortKey = "name" | "size" | "modified" | "permissions";
export interface SortOrder { key: SortKey; ascending: boolean }
export const DEFAULT_SORT: SortOrder;                       // name, ascendant
export function visibleEntries(entries, order, showHidden): RemoteEntry[];
export function nextSort(current: SortOrder, key: SortKey): SortOrder;
export function pathSegments(path: string): { name: string; path: string }[];
export function parentPath(path: string): string;
export function formatSize(bytes: number, locale: string): string;
export function formatMode(kind: EntryKind, permissions: number | null): string;
```

| Fonction | Règle |
|---|---|
| `visibleEntries` | nouveau tableau (`toSorted`) ; cachés exclus sans `showHidden` ; **dossiers d'abord, dans les deux sens** ; puis la clé ; égalité → le nom. Les noms se comparent avec `Intl.Collator(undefined, { numeric: true, sensitivity: "base" })` (`file2` avant `file10`, casse ignorée) |
| `nextSort` | même colonne → sens inversé ; autre colonne → ascendant |
| `pathSegments` | `/` d'abord, puis chaque dossier avec son chemin complet |
| `parentPath` | `/` final ignoré ; le parent de `/` est `/` |
| `formatSize` | puissances de 1024, unités `B KB MB GB TB`, une décimale sous 10 (pas pour les octets), `Intl.NumberFormat(locale)` |
| `formatMode` | `drwxr-xr-x` ; premier caractère `d` `l` `-` `?` ; setuid / setgid `s` (ou `S` sans exécution), sticky `t` (ou `T`) ; `null` → `?---------` |

### `SftpToolbar.tsx`

Une ligne `h-11`, bordure basse : bouton « Dossier parent » (`ArrowUp`), « Actualiser » (`RefreshCw`), le chemin,
« Saisir un chemin » (`Pencil`), et un `Toggle` « Afficher les fichiers cachés » (`Eye` / `EyeOff`).

- Le chemin : un `Breadcrumb` en `font-mono text-xs`, un élément par segment, le dernier en `BreadcrumbPage`, les
  autres en `BreadcrumbLink asChild` sur un `<button>`. Pas de séparateur entre `/` et le premier dossier. Les
  séparateurs sont des **frères** des `BreadcrumbItem` (un `<li>` dans un `<li>` est invalide).
- « Saisir un chemin » remplace le fil d'Ariane par un `Input` (`aria-label` « Chemin », `autoFocus`) : `Entrée`
  y va (via le `realpath` du serveur), `Échap` ou la perte du focus abandonne.

### `EntryTable.tsx`

Un `<table>` sémantique dans un conteneur qui défile (`overflow-auto`), virtualisé par `useVirtualizer`
(`ROW_HEIGHT = 32`, `overscan: 12`) :
- `table` : `aria-label` « Fichiers », `aria-rowcount`, classes `grid w-full` ; `thead` collant (`sticky top-0`) ;
  `tbody` en `relative grid` de la hauteur totale ; chaque `tr` en `absolute`, décalé par `translateY`. Colonnes :
  `grid-cols-[minmax(0,1fr)_6rem_10rem_7.5rem]`.
- En-têtes : un `<th aria-sort>` par colonne (« Nom », « Taille », « Modifié », « Droits »), contenant un `<button>`
  qui trie, et une flèche sur la colonne active.
- Ligne : icône (`Folder` en `text-primary`, `File`, `Link2`, `FileQuestion`), nom tronqué (grisé s'il est caché),
  taille (`—` pour un dossier), date (`Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" })`),
  droits en `font-mono`. `aria-selected` ; sélectionnée → `bg-accent`.
- Clic : sélectionner. Double-clic : ouvrir. Clavier (sur le `table`) : `↑` `↓` `Début` `Fin` déplacent la sélection
  (et `scrollToIndex`), `Entrée` ouvre, `Retour arrière` remonte. Tabindex mobile : la ligne sélectionnée (ou la
  première) a `tabIndex={0}`, les autres `-1`, et la ligne sélectionnée reprend le focus quand il était déjà dans
  le tableau.
- `header(…)` et `row(…)` sont des **fonctions appelées** (`{row(…)}`), pas des composants déclarés dans le corps.

### `SftpExplorer.tsx`

`SftpExplorer({ sessionId })` : état local (chemin, entrées, chargement, cachés, tri, sélection).
- `navigate(target)` : `sftpRealpath` puis `sftpList`, puis chemin, entrées, sélection vidée. Une erreur →
  `notifyError`, **on reste** où on était. Seule la **dernière** navigation lancée s'applique (un compteur dans un
  `useRef`).
- Au montage : `navigate(".")` (le dossier personnel).
- Ouvrir : un dossier ou un lien → `navigate(entry.path)` (le serveur suit le lien) ; un fichier → rien (T26).
- Un `Spinner` tant que rien n'est chargé ; un `Empty` « Ce dossier est vide » quand il n'y a rien à montrer.

### i18n (`en.json` et `fr.json`)

Bloc `sftp` : `files`, `up`, `refresh`, `editPath`, `path`, `showHidden`, `empty`, et `columns.{name, size,
modified, permissions}`. En anglais, exactement : « Files », « Parent folder », « Refresh », « Type a path »,
« Path », « Show hidden files », « This folder is empty », « Name », « Size », « Modified », « Permissions » (les
scénarios e2e les cherchent).

## Pièges (vus au prototype)

- Biome refuse un tableau fait de `div` avec des rôles ARIA (`useSemanticElements`), et un `role="grid"` sur un
  `<table>` (`noNoninteractiveElementToInteractiveRole`) : `<table>` / `<tr>` / `<th>` / `<td>` simples, avec
  `aria-selected` et `tabIndex` sur les `<tr>`.
- Un `tr` absolu dans un `tbody` : il faut `display: grid` sur `table`, `thead` et `tbody` (les classes ci-dessus),
  sinon le navigateur ignore la hauteur et les décalages.
- `visibleEntries` ne trie jamais le tableau reçu : `toSorted`, pas `sort`.
- Le test du modèle de session de T21 compare l'objet **entier** : avec le champ `kind`, ce fichier est remplacé
  (`kind: "ssh"` attendu).
- La sidebar est un `complementary` ; le fil d'Ariane, un `navigation` dans la région de l'onglet.

## Tests du contrat

### `src/features/sftp/sftp-model.test.ts` (nouveau)

```ts
// T25: the explorer's order, path pieces, sizes and modes.
import { describe, expect, test } from "vitest";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import {
  DEFAULT_SORT,
  formatMode,
  formatSize,
  nextSort,
  parentPath,
  pathSegments,
  visibleEntries,
} from "./sftp-model";

function entry(name: string, kind: RemoteEntry["kind"], size = 0, modifiedAt = 0): RemoteEntry {
  return {
    name,
    path: `/srv/${name}`,
    kind,
    size,
    modifiedAt,
    permissions: 0o644,
    hidden: name.startsWith("."),
  };
}

const entries = [
  entry("b.txt", "file", 300, 3),
  entry("file10", "file", 10, 1),
  entry("Zeta", "dir", 4096, 2),
  entry(".env", "file", 5, 9),
  entry("alpha", "dir", 4096, 5),
  entry("file2", "file", 20, 8),
  entry("current", "symlink", 8, 4),
];

const names = (list: RemoteEntry[]) => list.map((e) => e.name);

describe("visibleEntries", () => {
  test("directories first, then names in natural order, hidden ones out", () => {
    expect(names(visibleEntries(entries, DEFAULT_SORT, false))).toEqual([
      "alpha",
      "Zeta",
      "b.txt",
      "current",
      "file2",
      "file10",
    ]);
  });

  test("hidden entries come back with showHidden", () => {
    expect(names(visibleEntries(entries, DEFAULT_SORT, true))).toContain(".env");
  });

  test("a descending sort keeps directories first", () => {
    const bySizeDown = visibleEntries(entries, { key: "size", ascending: false }, false);
    expect(names(bySizeDown)).toEqual(["alpha", "Zeta", "b.txt", "file2", "file10", "current"]);
    const byDate = visibleEntries(entries, { key: "modified", ascending: true }, false);
    expect(names(byDate)).toEqual(["Zeta", "alpha", "file10", "b.txt", "current", "file2"]);
  });

  test("does not touch its input", () => {
    const before = names(entries);
    visibleEntries(entries, { key: "size", ascending: false }, true);
    expect(names(entries)).toEqual(before);
  });
});

describe("nextSort", () => {
  test("the same column flips, another starts ascending", () => {
    expect(nextSort(DEFAULT_SORT, "name")).toEqual({ key: "name", ascending: false });
    expect(nextSort({ key: "name", ascending: false }, "size")).toEqual({
      key: "size",
      ascending: true,
    });
  });
});

describe("paths", () => {
  test("segments of a path", () => {
    expect(pathSegments("/var/www/html")).toEqual([
      { name: "/", path: "/" },
      { name: "var", path: "/var" },
      { name: "www", path: "/var/www" },
      { name: "html", path: "/var/www/html" },
    ]);
    expect(pathSegments("/")).toEqual([{ name: "/", path: "/" }]);
  });

  test("the parent of a path", () => {
    expect(parentPath("/var/www/html")).toBe("/var/www");
    expect(parentPath("/var/www/")).toBe("/var");
    expect(parentPath("/var")).toBe("/");
    expect(parentPath("/")).toBe("/");
  });
});

describe("formatSize", () => {
  test("bytes, then powers of 1024 with one decimal under 10", () => {
    expect(formatSize(0, "en")).toBe("0 B");
    expect(formatSize(1023, "en")).toBe("1,023 B");
    expect(formatSize(4321, "en")).toBe("4.2 KB");
    expect(formatSize(734_003_200, "en")).toBe("700 MB");
    expect(formatSize(4321, "fr")).toBe("4,2 KB");
  });
});

describe("formatMode", () => {
  test("the usual modes", () => {
    expect(formatMode("dir", 0o755)).toBe("drwxr-xr-x");
    expect(formatMode("file", 0o644)).toBe("-rw-r--r--");
    expect(formatMode("symlink", 0o777)).toBe("lrwxrwxrwx");
    expect(formatMode("file", 0o600)).toBe("-rw-------");
  });

  test("setuid, setgid, sticky, with and without execute", () => {
    expect(formatMode("file", 0o4755)).toBe("-rwsr-xr-x");
    expect(formatMode("file", 0o2644)).toBe("-rw-r-Sr--");
    expect(formatMode("dir", 0o1777)).toBe("drwxrwxrwt");
    expect(formatMode("dir", 0o1776)).toBe("drwxrwxrwT");
  });

  test("an unknown mode", () => {
    expect(formatMode("other", null)).toBe("?---------");
  });
});
```

### `src/features/sessions/session-model.test.ts` (remplace la version de T21 : `kind`)

```ts
import { describe, expect, test } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import {
  applySessionEvent,
  newSession,
  quickTitle,
  restartSession,
  type Session,
  tabStatus,
  uniqueTitle,
} from "./session-model";

const saved = { type: "saved", connectionId: "c-1" } as const;

function applyAll(session: Session, events: SessionEvent[]): Session {
  return events.reduce(applySessionEvent, session);
}

describe("session model", () => {
  test("a new session is connecting, with nothing done yet", () => {
    expect(newSession("s-1", "web-01", saved)).toEqual({
      id: "s-1",
      kind: "ssh",
      runId: "s-1",
      title: "web-01",
      target: saved,
      connectionId: "c-1",
      status: "connecting",
      steps: [],
      error: null,
      exitStatus: null,
      size: null,
    });
    const quick = { type: "quick", host: "10.5.5.5", port: 22, username: null } as const;
    expect(newSession("s-2", "10.5.5.5", quick).connectionId).toBeNull();
    // T25: an SFTP tab is the same session, of another kind.
    expect(newSession("s-3", "web-01", saved, "sftp").kind).toBe("sftp");
  });

  test("a step updates its line in place; a new kind of step is appended", () => {
    const session = applyAll(newSession("s-1", "web-01", saved), [
      { type: "step", step: "target", label: "10.0.0.12:22", state: "started" },
      { type: "step", step: "target", label: "10.0.0.12:22", state: "done" },
      { type: "step", step: "hostKey", label: "10.0.0.12", state: "started" },
    ]);
    expect(session.steps).toEqual([
      { step: "target", label: "10.0.0.12:22", state: "done" },
      { step: "hostKey", label: "10.0.0.12", state: "started" },
    ]);
    expect(session.status).toBe("connecting");
  });

  test("connected, closed and error set the status", () => {
    const start = newSession("s-1", "web-01", saved);
    const connected = applySessionEvent(start, { type: "connected" });
    expect(connected.status).toBe("connected");

    const closed = applySessionEvent(connected, {
      type: "closed",
      reason: "remoteClosed",
      exitStatus: 0,
    });
    expect(closed).toMatchObject({ status: "closed", exitStatus: 0 });

    const error = { kind: "network", message: "connection refused", detail: null } as const;
    const failed = applySessionEvent(start, { type: "error", error });
    expect(failed).toMatchObject({ status: "error", error });
  });

  test("events never mutate the session they are given", () => {
    const start = Object.freeze(newSession("s-1", "web-01", saved));
    const next = applySessionEvent(start, {
      type: "step",
      step: "auth",
      label: "deploy",
      state: "started",
    });
    expect(next).not.toBe(start);
    expect(start.steps).toEqual([]);
    expect(applySessionEvent(start, { type: "log", line: "ignored" })).toEqual(start);
  });

  test("restarting clears the previous attempt but keeps the tab and its size", () => {
    const failed = applyAll(newSession("s-1", "web-01", saved), [
      { type: "step", step: "target", label: "10.0.0.12:22", state: "failed" },
      { type: "error", error: { kind: "network", message: "refused", detail: null } },
    ]);
    // A new attempt is a new backend session: a late event of the old one can be told apart.
    const again = restartSession({ ...failed, size: { cols: 80, rows: 24 } }, "run-2");
    expect(again).toMatchObject({
      id: "s-1",
      runId: "run-2",
      title: "web-01",
      status: "connecting",
      steps: [],
      error: null,
      exitStatus: null,
      size: { cols: 80, rows: 24 },
    });
  });

  test("a second tab of the same connection is numbered", () => {
    expect(uniqueTitle("web-01", [])).toBe("web-01");
    expect(uniqueTitle("web-01", ["web-01"])).toBe("web-01 (2)");
    expect(uniqueTitle("web-01", ["web-01", "web-01 (2)"])).toBe("web-01 (3)");
    expect(uniqueTitle("web-01", ["web-01 (2)"])).toBe("web-01");
  });

  test("a quick target is titled like an ssh command line", () => {
    expect(quickTitle({ host: "10.5.5.5", port: 22, username: "deploy" })).toBe("deploy@10.5.5.5");
    expect(quickTitle({ host: "10.5.5.5", port: 2222, username: null })).toBe("10.5.5.5:2222");
  });

  test("the tab dot follows the status", () => {
    expect(tabStatus("connecting")).toBe("connecting");
    expect(tabStatus("connected")).toBe("online");
    expect(tabStatus("closed")).toBe("offline");
    expect(tabStatus("error")).toBe("error");
  });
});
```

### `e2e/sftp.spec.ts` (nouveau)

```ts
// T25: an SFTP tab and its explorer, over the mock file system of T24 (nas: user admin, home /home/admin).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function openSftp(page: Page, name: string) {
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
}

function view(page: Page, title: string) {
  return page.getByRole("region", { name: title, exact: true });
}

function files(page: Page, title: string) {
  return view(page, title).getByRole("table", { name: "Files" });
}

function names(page: Page, title: string) {
  return files(page, title).locator("tbody tr td:first-child");
}

test("an SFTP tab opens in the home directory, folders first", async ({ page }) => {
  await openSftp(page, "nas");
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas");
  await expect(names(page, "nas")).toHaveText(["projects", "backup.tar.gz", "current", "notes.txt"]);
  await expect(view(page, "nas").getByRole("navigation")).toContainText("home");
  await expect(view(page, "nas").getByRole("navigation")).toContainText("admin");
  await expect(page.getByRole("contentinfo")).toContainText("sftp");
  await expectSaneUi(page);
});

test("hidden files, sorting, and the size column", async ({ page }) => {
  await openSftp(page, "nas");
  const nas = view(page, "nas");
  await expect(names(page, "nas")).not.toContainText([".bashrc"]);
  await nas.getByRole("button", { name: "Show hidden files" }).click();
  await expect(names(page, "nas").first()).toHaveText("projects");
  await expect(names(page, "nas").nth(1)).toHaveText(".bashrc");

  await nas.getByRole("button", { name: "Size" }).click();
  await nas.getByRole("button", { name: "Size" }).click();
  await expect(nas.getByRole("columnheader", { name: "Size" })).toHaveAttribute(
    "aria-sort",
    "descending",
  );
  await expect(names(page, "nas").nth(1)).toHaveText("backup.tar.gz");
  await expect(files(page, "nas").getByRole("row", { name: /backup\.tar\.gz/ })).toContainText(
    "700 MB",
  );
});

test("double-click enters a folder; the breadcrumb and Up go back", async ({ page }) => {
  await openSftp(page, "nas");
  const nas = view(page, "nas");
  await files(page, "nas").getByRole("row", { name: /projects/ }).dblclick();
  await expect(names(page, "nas")).toHaveText(["app", "README.md"]);
  await expect(nas.getByRole("navigation")).toContainText("projects");

  await nas.getByRole("navigation").getByRole("button", { name: "home" }).click();
  await expect(names(page, "nas")).toHaveText(["admin"]);

  await nas.getByRole("button", { name: "Parent folder" }).click();
  await expect(names(page, "nas")).toContainText(["etc", "home", "var"]);
});

test("the keyboard moves, opens, and goes up", async ({ page }) => {
  await openSftp(page, "nas");
  await expect(names(page, "nas").first()).toHaveText("projects");
  await files(page, "nas").getByRole("row", { name: /projects/ }).click();
  await page.keyboard.press("Enter");
  await expect(names(page, "nas")).toHaveText(["app", "README.md"]);
  await files(page, "nas").getByRole("row", { name: /app/ }).click();
  await page.keyboard.press("ArrowDown");
  await expect(files(page, "nas").getByRole("row", { name: /README/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await page.keyboard.press("Backspace");
  await expect(names(page, "nas").first()).toHaveText("projects");
});

test("a typed path is resolved; a wrong one says so and stays put", async ({ page }) => {
  await openSftp(page, "nas");
  const nas = view(page, "nas");
  await nas.getByRole("button", { name: "Type a path" }).click();
  await nas.getByRole("textbox", { name: "Path" }).fill("/var/www/html/../html");
  await page.keyboard.press("Enter");
  await expect(names(page, "nas")).toHaveText(["assets", "index.html"]);

  await nas.getByRole("button", { name: "Type a path" }).click();
  await nas.getByRole("textbox", { name: "Path" }).fill("/nowhere");
  await page.keyboard.press("Enter");
  await expect(page.getByText(/not found/i)).toBeVisible();
  await expect(names(page, "nas")).toHaveText(["assets", "index.html"]);
});

test("an SFTP tab through a bastion shows its steps, then the files", async ({ page }) => {
  await openSftp(page, "web-01");
  await expect(view(page, "web-01").getByRole("status")).toContainText("Through bastion-01");
  await expect(names(page, "web-01")).toContainText(["projects"]);
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T25`.
2. `npm install @tanstack/react-virtual@^3.14`.
3. Sessions : `session-model.ts`, `store.ts`, `open-session.ts` : `npx vitest run src/features/sessions`.
4. `sftp/sftp-model.ts` : `npx vitest run src/features/sftp`.
5. `SftpToolbar.tsx`, `EntryTable.tsx`, `SftpExplorer.tsx`, `en.json`, `fr.json`, puis `SessionView.tsx`,
   `TabBar.tsx`, `StatusBar.tsx`, `ConnectionContextMenu.tsx` : `npm run typecheck`, `npm run check`,
   `npx playwright test e2e/sftp.spec.ts e2e/sessions.spec.ts`.
6. `npm run format`, `npm run review`, cases, statut, ligne « Works today » du `README.md` (et retirer « SFTP » de la
   colonne « Not yet »), commit `feat: SFTP tab with a virtualized file explorer (T25)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T25 --check` affiche `OK` partout.
- [ ] `grep -rn 'role="table"\|role="row"\|role="cell"' src/features/sftp` ne trouve rien.
- [ ] `grep -rn "\.sort(" src/features/sftp` ne trouve rien.
- [ ] Aucune nouvelle exception `project-rules: allow`.
- [ ] Visuel : en clair et en sombre, les colonnes Taille, Modifié et Droits sont alignées à droite, la ligne
      sélectionnée se distingue sans être criarde, et un nom très long est tronqué sans pousser les colonnes.

## À regarder par Florian

`npm run tauri dev` : clic droit sur une connexion SSH → « Ouvrir en SFTP ». L'onglet montre les étapes, puis ton
dossier personnel. Entre dans un dossier, remonte par le fil d'Ariane, essaie le clavier (`↑` `↓` `Entrée`
`Retour arrière`), l'œil pour les fichiers cachés, et un tri par taille.
