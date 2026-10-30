# T54 — SFTP : sélection multiple, téléchargement et suppression en lot

| | |
|---|---|
| **Jalon** | M10 — Nouvelles fonctions (lot 8) |
| **Dépend de** | T53 |
| **Lire avant** | `docs/10-fonctions-a-venir.md` § « SFTP : sélection multiple » ; `docs/04-ecrans.md` § 6 ; `docs/06-securite.md` S11 |
| **Livrable** | `src/features/sftp/selection-model.ts` (nouveau), `sftp-model.ts` (`isDownloadable`), `EntryTable.tsx`, `SftpExplorer.tsx`, `EntryMenu.tsx`, `DeleteEntryDialog.tsx`, `use-entry-actions.ts`, `en.json` / `fr.json` ; `src/features/sftp/selection-model.test.ts`, `e2e/sftp-multi.spec.ts` |

## Pourquoi

`docs/04-ecrans.md` § 6 prévoit la sélection multiple (`Ctrl`, `Maj`) pour télécharger ou supprimer, mais le tableau
ne retient qu'une ligne (`selectedPath`). Pour supprimer dix fichiers, il faut dix menus et dix confirmations.

## À réutiliser (ne pas réécrire)

- `visibleEntries`, `joinPath` (`sftp-model.ts`) ; `useTransfers().download` (un appel par entrée).
- `useEntryActions` : `busy`, `askDelete`, `remove`, `closeDialog` (T46). Le contrat de T46
  (`use-entry-actions.test.ts`) appelle `askDelete(entry)` et `remove(entry)` sur **une** entrée : ces deux fonctions
  gardent leur signature.
- `DeleteEntryDialog` : ses textes pour une seule entrée ne changent pas (tests de T25b).

## Contrat — Modèle (`selection-model.ts`, pur)

```ts
/** Les lignes sélectionnées (chemins), l'ancre d'une plage (Maj) et la ligne du curseur clavier. */
export interface Selection {
  readonly paths: readonly string[];
  readonly anchor: string | null;
  readonly focus: string | null;
}
export const EMPTY_SELECTION: Selection; // { paths: [], anchor: null, focus: null }

/** Un clic simple : cette seule ligne ; ancre et curseur dessus. */
export function selectOne(path: string): Selection;
/** Ctrl+clic : ajoute ou retire `path` (ajouté à la fin) ; ancre et curseur dessus. */
export function toggle(selection: Selection, path: string): Selection;
/**
 * Maj+clic : la plage de l'ancre à `path`, dans l'ordre affiché `order`, remplace la sélection ; l'ancre ne bouge pas,
 * le curseur va sur `path`. Sans ancre, ou une ancre absente de `order` : `selectOne(path)`.
 */
export function extendTo(selection: Selection, order: readonly string[], path: string): Selection;
/** Ctrl+A : toutes les lignes affichées, dans l'ordre ; ancre et curseur sur la première (ou `null`). */
export function selectAll(order: readonly string[]): Selection;
/** Après un rafraîchissement ou le masquage des fichiers cachés : retire ce qui n'est plus affiché. Rend le même
 *  objet quand rien ne change. Une ancre ou un curseur disparus deviennent `null`. */
export function keepVisible(selection: Selection, order: readonly string[]): Selection;
/** Un clic sur une ligne : Ctrl (ou Méta) → `toggle`, Maj → `extendTo`, sinon `selectOne`. */
export function clickRow(
  selection: Selection,
  order: readonly string[],
  path: string,
  modifiers: { ctrl: boolean; shift: boolean },
): Selection;
```

`sftp-model.ts` gagne `isDownloadable(entry: RemoteEntry): boolean` : la règle qui est aujourd'hui dans `EntryMenu`
(fichier, entrée inconnue, lien vers un fichier). `EntryMenu` et `SftpExplorer` l'utilisent.

## Contrat — Interface

- **Tableau** : `selectedPath` / `onSelect` deviennent `selection: Selection` / `onSelectionChange(next)`. Chaque ligne
  de `selection.paths` a `aria-selected="true"`. Clic → `clickRow` (avec `event.ctrlKey || event.metaKey`,
  `event.shiftKey`). Flèches haut / bas : `selectOne` de la ligne voisine du **curseur** ; avec Maj, `extendTo` vers
  elle. `Ctrl+A` dans le tableau : `selectAll` des lignes affichées (`preventDefault`, sinon la page entière se
  sélectionne). Entrée, F2, Suppr agissent sur la ligne du curseur, sauf Suppr avec plusieurs lignes : suppression en
  lot. La ligne focalisable (`tabIndex=0`) est celle du curseur.
- **Explorateur** : la sélection survit au tri ; une navigation la vide (sauf `navigate(cible, select)`, qui
  sélectionne `select`) ; après un rechargement ou le bouton « fichiers cachés », `keepVisible`. Un clic droit sur une
  ligne **hors** sélection la sélectionne seule ; sur une ligne de la sélection, la sélection reste.
- **Menu**, avec plusieurs lignes sélectionnées : « Télécharger {{count}} éléments » (si au moins une est
  téléchargeable ; seules celles-là partent, un transfert chacune), « Nouveau dossier », « Supprimer {{count}}
  éléments… ». Ni Renommer, ni Copier le chemin, ni Droits. Avec une seule ligne : le menu d'aujourd'hui.
- **Suppression en lot** : `askDeleteMany(entries)` compte **chaque** entrée avec `sftpCount` (S11 : rien ne part sans
  le total), additionne, puis ouvre **un** dialogue : titre « Supprimer {{count}} éléments ? », texte « {{count}}
  éléments en tout seront supprimés. Cette action est irréversible. » (le total compté). `removeMany(entries)` les
  supprime l'une après l'autre, s'arrête à la première erreur (toast traduit), recharge le dossier dans tous les cas.
  `busy` couvre tout, du premier comptage à la fin (même règle que T46). `askDelete(entry)` et `remove(entry)`
  deviennent `askDeleteMany([entry])` et `removeMany([entry])` : le dialogue d'une seule entrée reste celui de T25b.
- Le type du dialogue `delete` porte `entries: RemoteEntry[]` et `count` (le total).

Textes (`sftp.menu.downloadMany`, `sftp.menu.deleteMany`, `sftp.delete.titleMany`, `sftp.delete.many`) :

| Clé | en | fr |
|---|---|---|
| `downloadMany` | Download {{count}} items | Télécharger {{count}} éléments |
| `deleteMany` | Delete {{count}} items… | Supprimer {{count}} éléments… |
| `titleMany` | Delete {{count}} items? | Supprimer {{count}} éléments ? |
| `many` | {{count}} items in all will be deleted. This cannot be undone. | {{count}} éléments en tout seront supprimés. Cette action est irréversible. |

## Pièges

- `EntryTable.tsx` fait déjà 359 lignes : toute la logique de sélection va dans `selection-model.ts`, le tableau ne
  fait que l'appeler. Au-delà de 400 lignes, `npm run rules` refuse.
- Les lignes sont virtualisées : la sélection est faite de **chemins**, jamais d'index.
- `Ctrl+A` ne doit agir que le focus dans le tableau (un champ de la barre d'outils garde son `Ctrl+A`).
- Le menu contextuel s'ouvre sur `contextmenu` : la sélection doit être à jour **avant** que le menu lise ses entrées
  (même ordre qu'aujourd'hui : `onContextMenu` de la ligne d'abord).

## Tests du contrat

### `src/features/sftp/selection-model.test.ts`

```ts
// T54: the selection of the SFTP table, as paths: click, Ctrl, Shift, Ctrl+A, and what a refresh keeps.
import { describe, expect, test } from "vitest";
import {
  clickRow,
  EMPTY_SELECTION,
  extendTo,
  keepVisible,
  selectAll,
  selectOne,
  toggle,
} from "./selection-model";

const order = ["/h/projects", "/h/backup.tar.gz", "/h/current", "/h/notes.txt"];

describe("selection", () => {
  test("a click selects one row, Ctrl adds and removes", () => {
    const one = selectOne("/h/current");
    expect(one).toEqual({ paths: ["/h/current"], anchor: "/h/current", focus: "/h/current" });
    const two = toggle(one, "/h/projects");
    expect(two.paths).toEqual(["/h/current", "/h/projects"]);
    expect(two.anchor).toBe("/h/projects");
    expect(toggle(two, "/h/current").paths).toEqual(["/h/projects"]);
    expect(one.paths).toEqual(["/h/current"]);
  });

  test("Shift selects the range from the anchor, in the order shown, in both directions", () => {
    const from = selectOne("/h/backup.tar.gz");
    const down = extendTo(from, order, "/h/notes.txt");
    expect(down).toEqual({
      paths: ["/h/backup.tar.gz", "/h/current", "/h/notes.txt"],
      anchor: "/h/backup.tar.gz",
      focus: "/h/notes.txt",
    });
    expect(extendTo(down, order, "/h/projects").paths).toEqual(["/h/projects", "/h/backup.tar.gz"]);
    expect(extendTo(EMPTY_SELECTION, order, "/h/current")).toEqual(selectOne("/h/current"));
  });

  test("Ctrl+A selects every row shown", () => {
    expect(selectAll(order).paths).toEqual(order);
    expect(selectAll([])).toEqual(EMPTY_SELECTION);
  });

  test("a refresh keeps only what is still shown, and the same object when nothing changes", () => {
    const sel = toggle(selectOne("/h/notes.txt"), "/h/current");
    expect(keepVisible(sel, order)).toBe(sel);
    const kept = keepVisible(sel, ["/h/projects", "/h/notes.txt"]);
    expect(kept).toEqual({ paths: ["/h/notes.txt"], anchor: null, focus: null });
  });

  test("a click follows its modifiers", () => {
    const sel = selectOne("/h/projects");
    expect(clickRow(sel, order, "/h/current", { ctrl: false, shift: false })).toEqual(
      selectOne("/h/current"),
    );
    expect(clickRow(sel, order, "/h/current", { ctrl: true, shift: false }).paths).toEqual([
      "/h/projects",
      "/h/current",
    ]);
    expect(clickRow(sel, order, "/h/current", { ctrl: false, shift: true }).paths).toEqual([
      "/h/projects",
      "/h/backup.tar.gz",
      "/h/current",
    ]);
  });
});
```

### `e2e/sftp-multi.spec.ts`

```ts
// T54: several rows of the SFTP table are selected with Ctrl, Shift or Ctrl+A, then downloaded or deleted at once.
// Mock: the home folder of nas shows projects (4 items with its content), backup.tar.gz, current, notes.txt.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  await expect(names(page).first()).toHaveText("projects");
});

function nas(page: Page) {
  return page.getByRole("region", { name: "nas", exact: true });
}

function names(page: Page) {
  return nas(page).getByRole("table", { name: "Files" }).locator("tbody tr td:first-child");
}

function row(page: Page, name: string) {
  return nas(page)
    .getByRole("table", { name: "Files" })
    .locator("tbody tr")
    .filter({ has: page.locator("td:first-child", { hasText: new RegExp(`^${name}$`) }) });
}

function selected(page: Page) {
  return nas(page).locator('tbody tr[aria-selected="true"]');
}

test("Ctrl+click selects two files, and the menu acts on both", async ({ page }) => {
  await row(page, "notes.txt").click();
  await row(page, "backup.tar.gz").click({ modifiers: ["Control"] });
  await expect(selected(page)).toHaveCount(2);

  await row(page, "notes.txt").click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Download 2 items" })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: /^Delete 2 items/ })).toBeVisible();
  await expect(menu.getByRole("menuitem", { name: "Rename" })).toHaveCount(0);
  await expect(menu.getByRole("menuitem", { name: /^Permissions/ })).toHaveCount(0);

  await menu.getByRole("menuitem", { name: "Download 2 items" }).click();
  const transfers = nas(page).getByRole("list", { name: "Transfers" });
  await expect(transfers.getByRole("listitem", { name: "notes.txt" })).toBeVisible();
  await expect(transfers.getByRole("listitem", { name: "backup.tar.gz" })).toBeVisible();
});

test("Shift+click selects a range, Ctrl+A selects every row shown", async ({ page }) => {
  await row(page, "backup.tar.gz").click();
  await row(page, "notes.txt").click({ modifiers: ["Shift"] });
  await expect(selected(page)).toHaveCount(3);
  await expect(row(page, "projects")).toHaveAttribute("aria-selected", "false");

  await page.keyboard.press("Control+a");
  await expect(selected(page)).toHaveCount(4);
});

test("one confirmation deletes several entries, with the total counted first", async ({ page }) => {
  await row(page, "projects").click();
  await row(page, "notes.txt").click({ modifiers: ["Control"] });
  await page.keyboard.press("Delete");

  const dialog = page.getByRole("alertdialog");
  await expect(dialog.getByRole("heading", { name: "Delete 2 items?" })).toBeVisible();
  await expect(dialog).toContainText("5 items in all will be deleted.");
  await expectSaneUi(page);
  await dialog.getByRole("button", { name: "Delete", exact: true }).click();

  await expect(dialog).toHaveCount(0);
  await expect(names(page)).toHaveText(["backup.tar.gz", "current"]);
});

test("the selection survives a sort, not a change of folder", async ({ page }) => {
  await row(page, "notes.txt").click();
  await row(page, "current").click({ modifiers: ["Control"] });
  await nas(page).getByRole("button", { name: "Size" }).click();
  await expect(selected(page)).toHaveCount(2);

  await row(page, "projects").dblclick();
  await expect(names(page).first()).toHaveText("app");
  await expect(selected(page)).toHaveCount(0);
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T54`.
2. `selection-model.ts`, `isDownloadable` : `npx vitest run src/features/sftp`.
3. `use-entry-actions.ts` (`askDeleteMany`, `removeMany`), `DeleteEntryDialog.tsx`, puis `EntryTable.tsx`,
   `SftpExplorer.tsx`, `EntryMenu.tsx`, textes : `npx playwright test e2e/sftp-multi.spec.ts e2e/sftp.spec.ts`.
4. `npm run format`, `npm run review`, cases, statut, commit
   `feat: select several SFTP entries to download or delete them at once (T54)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T54 --check` affiche `OK` partout.
- [x] `wc -l src/features/sftp/EntryTable.tsx` : 400 lignes au plus.
- [x] Aucune nouvelle exception `project-rules: allow`.
- [ ] Les lignes sélectionnées se distinguent toutes, et la ligne du curseur clavier garde son anneau de focus (à
  l'écran).

## À regarder par Florian

`npm run tauri dev`, un onglet SFTP : Ctrl+clic sur trois fichiers, clic droit, « Télécharger 3 éléments ». Maj+clic
pour une plage, Suppr : un seul dialogue, avec le total.
