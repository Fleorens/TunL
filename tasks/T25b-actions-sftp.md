# T25b — Explorateur SFTP : nouveau dossier, renommer, supprimer, droits, copier le chemin

| | |
|---|---|
| **Jalon** | M4 — SFTP |
| **Dépend de** | T25 |
| **Lire avant** | `docs/04-ecrans.md` §6 (menu contextuel), `docs/06-securite.md` **S11** (suppression récursive) |
| **Livrable** | menu contextuel de l'explorateur, renommage en place, dialogues « Nouveau dossier », suppression (avec le nombre d'éléments) et « Droits… » ; `F2` et `Suppr` ; 2 fichiers de tests |

## Pourquoi

T25 permet de parcourir un serveur ; T25b permet d'y agir, avec les commandes de T24. Une suppression récursive
annonce combien d'éléments partiront (S11), et un nom invalide est refusé avant d'aller au serveur.

Prototypé par l'orchestrateur sur le mock de T24 : les tests de cette fiche passent.

## À réutiliser (ne pas réécrire)

- T24 : `ipc.sftpMkdir`, `sftpRename`, `sftpCount`, `sftpRemove`, `sftpChmod`.
- T25 : `SftpExplorer` (`navigate(path)`), `EntryTable` (`row`, tabindex mobile), `SftpToolbar`, `sftp-model.ts`.
- `copyText` (`lib/clipboard.ts`, toast « Copied to the clipboard » compris), `notifyError`, `toast` + `i18n.t`.
- Composants shadcn : `context-menu` (`ContextMenuItem` a `variant="destructive"`, `ContextMenuShortcut`),
  `dialog`, `alert-dialog` (`AlertDialogAction variant="destructive"`), `checkbox`, `input`, `label`.
- Modèle à suivre pour une confirmation : `features/sessions/CloseSessionDialog.tsx`.

## Contrat

### `sftp-model.ts` (ajouts, purs)

- `isValidName(name)` : ni vide, ni `.`, ni `..`, ni `/`, ni `\0` (la même règle que `valid_name` côté Rust).
- `joinPath(dir, name)` : sans doubler le `/` de la racine.

### `permissions.ts` (nouveau, pur)

```ts
export type Who = "owner" | "group" | "other";
export type What = "read" | "write" | "execute";
export const WHO: readonly Who[];      // owner, group, other
export const WHAT: readonly What[];    // read, write, execute
export function hasBit(mode: number, who: Who, what: What): boolean;
export function toggleBit(mode: number, who: Who, what: What): number;   // setuid / setgid / sticky gardés
export function parseOctal(text: string): number | null;   // 1 à 4 chiffres de 0 à 7, espaces autour permis
export function toOctal(mode: number): string;              // "644", "007", "4755"
```

### `use-entry-actions.ts` (nouveau)

`useEntryActions(sessionId, dir, reload)` (`reload(select?)` relit le dossier courant et sélectionne `select`)
rend : `dialog` (`{ type: "newFolder" } | { type: "delete", entry, count } | { type: "permissions", entry } |
null`), `renaming` (chemin ou `null`), et les actions :

| Action | Comportement |
|---|---|
| `newFolder()` | ouvre le dialogue |
| `createFolder(name)` | ferme le dialogue, `sftpMkdir(joinPath(dir, name))`, recharge en sélectionnant le nouveau dossier |
| `rename(entry)` | `renaming = entry.path` |
| `renamed(entry, name \| null)` | `renaming = null` ; `null` ou nom inchangé → rien ; nom invalide → `toast.error(i18n.t("sftp.invalidName"))` ; sinon `sftpRename(entry.path, joinPath(dir, name))`, recharge en sélectionnant le nouveau chemin |
| `copyPath(entry)` | `copyText(entry.path)` |
| `permissions(entry)` | ouvre le dialogue des droits |
| `chmod(entry, mode)` | ferme, `sftpChmod`, recharge en gardant la sélection |
| `askDelete(entry)` | `sftpCount(entry.path)`, **puis** ouvre la confirmation avec ce nombre |
| `remove(entry)` | ferme, `sftpRemove`, recharge |

Chaque appel `ipc` est dans un `try/catch` → `notifyError`.

### Composants (nouveaux, dans `src/features/sftp/`)

- `EntryMenu.tsx` : le `ContextMenuContent` (`w-52`). Sur une entrée : « Renommer » (raccourci affiché `F2`),
  « Copier le chemin », « Droits… », séparateur, « Nouveau dossier », séparateur, « Supprimer… » (destructif,
  raccourci `Del`). Sur la zone vide : « Nouveau dossier » **seulement**. `onCloseAutoFocus` →
  `event.preventDefault()`.
- `NewFolderDialog.tsx` : titre « New folder », champ « Folder name » (`autoFocus`), message `sftp.invalidName` dès
  qu'un nom saisi est invalide, « Create » désactivé tant qu'il l'est, `Entrée` crée.
- `DeleteEntryDialog.tsx` : `AlertDialog`, titre « Delete “<nom>”? » ; un dossier : `sftp.delete.folder` (avec
  `count`, pluriel i18next `_one` / `_other`) ; un fichier : « This cannot be undone. » ; boutons « Cancel » et
  « Delete » (destructif).
- `PermissionsDialog.tsx` : titre « Permissions of “<nom>” » ; une grille 3 × 3 de `Checkbox` (lignes Owner, Group,
  Others ; colonnes Read, Write, Execute ; `aria-label` « Group: Write »…) ; un champ « Octal » ; les deux restent
  d'accord (une case coche → l'octal suit ; un octal valide → les cases suivent) ; octal invalide → message
  `sftp.permissions.invalid` et « Apply » désactivé.

### Modifications

- `EntryTable.tsx` : nouvelles props `renaming`, `onRename(entry)`, `onRenameDone(entry, name | null)`,
  `onDelete(entry)`. Clavier : `F2` renomme, `Suppr` (`Delete`) supprime la ligne sélectionnée. Clic droit sur une
  ligne → la sélectionne. Pendant un renommage, la cellule du nom est un `RenameField` (composant **au niveau du
  module**) : `Input` `autoFocus`, nom sélectionné sans l'extension, `Entrée` garde, `Échap` ou la perte du focus
  abandonne, et **toutes** ses touches s'arrêtent à lui (`event.stopPropagation()`), sinon `Entrée` ouvrirait
  l'entrée et `Retour arrière` remonterait d'un dossier.
  La ligne sélectionnée prend le focus quand il est dans le tableau **ou nulle part** (`document.body`, après un
  renommage ou un dialogue), et jamais pendant un renommage.
- `SftpToolbar.tsx` : bouton « New folder » (`FolderPlus`) avant l'œil ; prop `onNewFolder`.
- `SftpExplorer.tsx` : `navigate(target, select?)` ; le tableau dans
  `<ContextMenu modal={false}><ContextMenuTrigger asChild onContextMenu={…}>` (un clic droit hors d'une ligne vide la
  sélection) avec `<EntryMenu entry={entrée sélectionnée} …/>` ; le dialogue ouvert rendu par une **fonction**
  `dialogFor(actions)`.
- i18n (`en.json` et `fr.json`), dans `sftp` : `invalidName`, `newFolder.{title, name, create}`,
  `delete.{title, folder_one, folder_other, file, confirm}`, `permissions.{title, owner, group, other, read, write,
  execute, box, octal, invalid, apply}`, `menu.{rename, copyPath, permissions, newFolder, delete}`. Les textes
  anglais exacts sont ceux des scénarios e2e (« Folder name », « Permissions… », « Group: Write »,
  « 4 items in all »…).

## Pièges (vus au prototype)

- **Le focus du renommage** : un menu Radix modal garde le focus prisonnier pendant son animation de fermeture,
  puis le rend à son déclencheur ; le champ de renommage le perd aussitôt. D'où `modal={false}` sur ce
  `ContextMenu` et `onCloseAutoFocus` → `preventDefault()` sur son contenu.
- Biome refuse un `onContextMenu` sur un `<div>` (`noStaticElementInteractions`) : on le pose sur
  `ContextMenuTrigger`, qui le combine avec le sien.
- La zone vide sous les lignes appartient au conteneur, pas au `<table>` : le tableau ne fait que la hauteur de ses
  lignes.
- Le nombre d'éléments vient du serveur (`sftp_count`) **avant** d'ouvrir la confirmation : jamais un « supprimer »
  sans le chiffre (S11).
- Un sous-composant déclaré dans le corps d'un autre est refusé par Biome et remonte à chaque rendu (un champ perd
  son focus) : `RenameField` au niveau du module, `dialogFor` appelée comme une fonction.

## Tests du contrat

### `src/features/sftp/permissions.test.ts` (nouveau)

```ts
// T25b: the permissions dialog's boxes and octal field.
import { describe, expect, test } from "vitest";
import { hasBit, parseOctal, toggleBit, toOctal } from "./permissions";

describe("permissions", () => {
  test("the boxes of 0o754", () => {
    expect(hasBit(0o754, "owner", "execute")).toBe(true);
    expect(hasBit(0o754, "group", "write")).toBe(false);
    expect(hasBit(0o754, "group", "execute")).toBe(true);
    expect(hasBit(0o754, "other", "read")).toBe(true);
    expect(hasBit(0o754, "other", "execute")).toBe(false);
  });

  test("a box flips one bit and keeps the special ones", () => {
    expect(toggleBit(0o644, "group", "write")).toBe(0o664);
    expect(toggleBit(0o664, "group", "write")).toBe(0o644);
    expect(toggleBit(0o4755, "other", "execute")).toBe(0o4754);
  });

  test("octal in and out", () => {
    expect(parseOctal("755")).toBe(0o755);
    expect(parseOctal(" 0644 ")).toBe(0o644);
    expect(parseOctal("4755")).toBe(0o4755);
    for (const bad of ["", "8", "75a", "17777", "-1", "7 5"]) expect(parseOctal(bad)).toBeNull();
    expect(toOctal(0o644)).toBe("644");
    expect(toOctal(0o7)).toBe("007");
    expect(toOctal(0o4755)).toBe("4755");
  });
});
```

### `e2e/sftp-actions.spec.ts` (nouveau)

```ts
// T25b: the explorer's actions, over the mock file system of T24 (nas: home /home/admin).
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
    .getByRole("row", { name: new RegExp(`^${name.replace(".", "\\.")}\\b`) });
}

async function menu(page: Page, name: string, item: string) {
  await row(page, name).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: item }).click();
}

test("a new folder from the toolbar, refused with a slash, created and selected", async ({
  page,
}) => {
  await nas(page).getByRole("button", { name: "New folder" }).click();
  const dialog = page.getByRole("dialog", { name: "New folder" });
  await dialog.getByLabel("Folder name").fill("a/b");
  await expect(dialog.getByText("nor contain “/”")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Create" })).toBeDisabled();
  await expectSaneUi(page);
  await dialog.getByLabel("Folder name").fill("reports");
  await dialog.getByRole("button", { name: "Create" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(row(page, "reports")).toHaveAttribute("aria-selected", "true");
});

test("the empty area's menu offers New folder only", async ({ page }) => {
  // Below the last line: the list is short, the tab is tall.
  const box = await nas(page).boundingBox();
  if (!box) throw new Error("the tab is on screen");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height - 40, { button: "right" });
  const items = page.getByRole("menu").getByRole("menuitem");
  await expect(items).toHaveText(["New folder"]);
});

test("rename in place: Enter keeps the new name, Escape gives up", async ({ page }) => {
  await menu(page, "notes.txt", "Rename");
  const field = nas(page).getByRole("textbox", { name: "Rename" });
  await expect(field).toBeFocused();
  await field.fill("todo.txt");
  await page.keyboard.press("Enter");
  await expect(row(page, "todo.txt")).toHaveAttribute("aria-selected", "true");
  await expect(names(page)).not.toContainText(["notes.txt"]);

  await page.keyboard.press("F2");
  await nas(page).getByRole("textbox", { name: "Rename" }).fill("other.txt");
  await page.keyboard.press("Escape");
  await expect(row(page, "todo.txt")).toBeVisible();
});

test("deleting a folder says how many entries go with it", async ({ page }) => {
  await menu(page, "projects", "Delete…");
  const confirm = page.getByRole("alertdialog", { name: "Delete “projects”?" });
  await expect(confirm).toContainText("4 items in all");
  await expectSaneUi(page);
  await confirm.getByRole("button", { name: "Delete" }).click();
  await expect(names(page)).not.toContainText(["projects"]);

  // The Delete key asks too; Cancel keeps the file.
  await row(page, "notes.txt").click();
  await page.keyboard.press("Delete");
  const file = page.getByRole("alertdialog", { name: "Delete “notes.txt”?" });
  await expect(file).toContainText("This cannot be undone.");
  await file.getByRole("button", { name: "Cancel" }).click();
  await expect(row(page, "notes.txt")).toBeVisible();
});

test("permissions: the boxes and the octal field agree, and Apply changes the mode", async ({
  page,
}) => {
  await menu(page, "notes.txt", "Permissions…");
  const dialog = page.getByRole("dialog", { name: "Permissions of “notes.txt”" });
  const octal = dialog.getByLabel("Octal");
  await expect(octal).toHaveValue("644");
  await dialog.getByRole("checkbox", { name: "Group: Write" }).click();
  await expect(octal).toHaveValue("664");
  await octal.fill("6x");
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
  await octal.fill("600");
  await expect(dialog.getByRole("checkbox", { name: "Others: Read" })).not.toBeChecked();
  await expectSaneUi(page);
  await dialog.getByRole("button", { name: "Apply" }).click();
  await expect(row(page, "notes.txt")).toContainText("-rw-------");
});

test("Copy path puts the full path on the clipboard", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await menu(page, "notes.txt", "Copy path");
  await expect(page.getByText("Copied to the clipboard")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("/home/admin/notes.txt");
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T25b`.
2. `permissions.ts`, ajouts de `sftp-model.ts` : `npx vitest run src/features/sftp`.
3. `use-entry-actions.ts`, les trois dialogues, `EntryMenu.tsx`, puis `EntryTable.tsx`, `SftpToolbar.tsx`,
   `SftpExplorer.tsx`, `en.json`, `fr.json` : `npm run typecheck`, `npm run check`,
   `npx playwright test e2e/sftp-actions.spec.ts e2e/sftp.spec.ts`.
4. `npm run format`, `npm run review`, cases, statut, ligne « Works today » du `README.md`, commit
   `feat: SFTP explorer actions: new folder, rename, delete, permissions (T25b)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T25b --check` affiche `OK` partout.
- [ ] `grep -rn "sftpRemove" src/features/sftp` ne montre qu'un appel, précédé d'un `sftpCount` dans le même fichier.
- [ ] Aucune nouvelle exception `project-rules: allow`.
- [ ] Visuel : le dialogue des droits aligne ses cases sous leurs en-têtes, en clair et en sombre ; « Supprimer… » se
      lit comme une action destructive sans être criarde.

## À regarder par Florian

`npm run tauri dev`, un onglet SFTP sur un serveur de test : crée un dossier, renomme-le (`F2`), change ses droits,
supprime-le (`Suppr`) : la confirmation dit combien d'éléments partent.
