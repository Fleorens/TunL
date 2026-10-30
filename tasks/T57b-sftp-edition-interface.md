# T57b — SFTP : éditer un fichier distant — interface

| | |
|---|---|
| **Jalon** | M10 — Nouvelles fonctions (lot 8) |
| **Dépend de** | T57 |
| **Lire avant** | `docs/10-fonctions-a-venir.md` § « SFTP : éditer un fichier distant » ; `docs/03-design.md` (dialogues) |
| **Livrable** | `src/features/sftp/edits-store.ts` (nouveau), `EditConflictDialog.tsx` (nouveau), `EntryMenu.tsx`, `SftpExplorer.tsx`, `use-entry-actions.ts`, `en.json` / `fr.json` ; `src/features/sftp/edits-store.test.ts`, `e2e/sftp-edit.spec.ts` |

## Pourquoi

T57 a livré le moteur (`sftpEdit`, `sftpEditResolve`, les événements `EditEvent`). Il manque de quoi s'en servir :
l'entrée de menu, l'avertissement pour un gros fichier, la question en cas de conflit, et les retours à l'écran.

## À réutiliser (ne pas réécrire)

- `ipc.sftpEdit`, `ipc.sftpEditResolve`, le type `EditEvent` (`src/bindings/`), le mock de T57 (`notes.txt` →
  `saved`, `.bashrc` → `conflict`).
- `formatSize` (`sftp-model.ts`), `notifyError` (`lib/errors.ts`), `toast` de `sonner` avec un texte traduit.
- `useEntryActions` : le dialogue ouvert de l'explorateur (`dialog`) ; `isDownloadable` (T54) comme modèle de règle.

## Contrat — Store (`edits-store.ts`)

```ts
export type EditStatus = "opening" | "watching" | "conflict";

export interface Edit {
  id: string;
  sessionId: string;
  name: string;
  status: EditStatus;
}

interface EditsState {
  edits: Record<string, Edit>;
  /** Start editing `entry` on tab `sessionId`. */
  edit: (sessionId: string, entry: RemoteEntry) => Promise<void>;
  /** Answer a conflict: `true` replaces the server's version, `false` sends nothing. */
  resolve: (id: string, overwrite: boolean) => Promise<void>;
}
export const useEdits: UseBoundStore<StoreApi<EditsState>>;

/** Above this size, a confirmation comes before the download: 10 MiB. */
export const EDIT_WARN_BYTES = 10 * 1024 * 1024;
/** A file, or a link to a file: the entries the menu offers to edit. */
export function isEditable(entry: RemoteEntry): boolean;
```

Les événements, appliqués à l'édition de même `id` (une édition inconnue les ignore) :

| Événement | État | À l'écran |
|---|---|---|
| (appel) | `opening` | — |
| `opened` | `watching` | toast `sftp.edit.opened` |
| `saved` | `watching` | toast de succès `sftp.edit.saved` |
| `conflict` | `conflict` | le dialogue de conflit (voir plus bas) |
| `failed` | inchangé | `notifyError(error)` |
| `closed` | retirée de `edits` | — |

Un refus de l'appel `sftpEdit` (onglet fermé, fichier illisible) : `notifyError`, et l'édition est retirée. `resolve`
remet l'état à `watching` **avant** d'appeler `sftpEditResolve` (le dialogue se ferme tout de suite) ; une erreur de
l'appel passe par `notifyError`.

## Contrat — Interface

- **Menu** : « Modifier » (`sftp.menu.edit`), juste après « Télécharger », pour **une seule** entrée qui passe
  `isEditable`. Pas pour un dossier, un lien vers un dossier, une entrée inconnue, ni une sélection multiple.
- **Gros fichier** : au-delà de `EDIT_WARN_BYTES`, un `AlertDialog` vient d'abord : titre `sftp.edit.bigTitle`, texte
  `sftp.edit.big` (`{{name}}`, `{{size}}` par `formatSize`), boutons « Annuler » et `sftp.edit.open`. Annuler : rien
  ne part. C'est un dialogue de l'explorateur (`dialog` de `useEntryActions`, type `editLarge`).
- **Conflit** : `EditConflictDialog` s'affiche pour toute édition de l'onglet à l'état `conflict` (la première, s'il
  y en a plusieurs) : titre `sftp.edit.conflictTitle` (`{{name}}`), texte `sftp.edit.conflict`, boutons
  `sftp.edit.keep` (`resolve(id, false)`) et `sftp.edit.replace` (`resolve(id, true)`, variante destructive). Fermer
  le dialogue par Échap vaut `keep`.

| Clé `sftp.…` | en | fr |
|---|---|---|
| `menu.edit` | Edit | Modifier |
| `edit.opened` | {{name}} is open: each save is sent to the server | {{name}} est ouvert : chaque enregistrement part sur le serveur |
| `edit.saved` | {{name}} saved to the server | {{name}} enregistré sur le serveur |
| `edit.bigTitle` | Open a large file? | Ouvrir un gros fichier ? |
| `edit.big` | {{name}} is {{size}}: it is downloaded in full before it opens. | {{name}} fait {{size}} : il sera téléchargé en entier avant de s'ouvrir. |
| `edit.open` | Open | Ouvrir |
| `edit.conflictTitle` | {{name}} changed on the server | {{name}} a changé sur le serveur |
| `edit.conflict` | It was modified since you opened it. Replace the server's version with yours? | Il a été modifié depuis son ouverture. Remplacer la version du serveur par la vôtre ? |
| `edit.keep` | Don't send | Ne pas envoyer |
| `edit.replace` | Replace | Remplacer |

## Pièges

- Le store reçoit les événements par une fonction de rappel ; le `Channel` n'est construit que dans `ipc.ts`.
- `EntryMenu.tsx` et `use-entry-actions.ts` grossissent : rester sous 400 lignes, la règle `isEditable` vit dans le
  store (ou `sftp-model.ts`), pas dans le menu.
- Un toast se traduit au moment de l'afficher : `toast(i18n.t("sftp.edit.saved", { name }))`, jamais une clé brute.

## Tests du contrat

### `src/features/sftp/edits-store.test.ts`

```ts
// T57b: an edit's life in the store, from the backend's events, and the entries that can be edited.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { EditEvent } from "@/bindings/EditEvent";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import { ipc } from "@/lib/ipc";
import { isEditable, useEdits } from "./edits-store";

const notes: RemoteEntry = {
  name: "notes.txt",
  path: "/home/me/notes.txt",
  kind: "file",
  size: 512,
  modifiedAt: null,
  permissions: 0o644,
  hidden: false,
};

let send: (event: EditEvent) => void = () => {};

beforeEach(() => {
  useEdits.setState({ edits: {} });
  vi.spyOn(ipc, "sftpEdit").mockImplementation(async (_session, _id, _path, onEvent) => {
    send = onEvent;
  });
  vi.spyOn(ipc, "sftpEditResolve").mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function only() {
  return Object.values(useEdits.getState().edits)[0];
}

describe("edits", () => {
  test("opened, conflict, resolved, then closed", async () => {
    await useEdits.getState().edit("tab-1", notes);
    expect(only()).toMatchObject({ sessionId: "tab-1", name: "notes.txt", status: "opening" });

    send({ type: "opened", localPath: "/run/user/1000/tunl/edit/x/notes.txt" });
    expect(only().status).toBe("watching");
    send({ type: "conflict" });
    expect(only().status).toBe("conflict");

    await useEdits.getState().resolve(only().id, true);
    expect(only().status).toBe("watching");
    expect(ipc.sftpEditResolve).toHaveBeenCalledWith(only().id, true);

    send({ type: "closed" });
    expect(useEdits.getState().edits).toEqual({});
  });

  test("a refused call leaves no edit behind", async () => {
    vi.spyOn(ipc, "sftpEdit").mockRejectedValue({ kind: "notFound", message: "x", detail: null });
    await useEdits.getState().edit("tab-1", notes);
    expect(useEdits.getState().edits).toEqual({});
  });

  test("a file or a link to a file can be edited, nothing else", () => {
    expect(isEditable(notes)).toBe(true);
    expect(isEditable({ ...notes, kind: "symlink", targetKind: "file" })).toBe(true);
    expect(isEditable({ ...notes, kind: "symlink", targetKind: "dir" })).toBe(false);
    expect(isEditable({ ...notes, kind: "dir" })).toBe(false);
    expect(isEditable({ ...notes, kind: "other" })).toBe(false);
  });
});
```

### `e2e/sftp-edit.spec.ts`

```ts
// T57b: Edit opens a remote file in its application, says when a save reached the server, and asks before
// replacing a version changed on the server. Mock: notes.txt saves once, .bashrc meets a conflict,
// backup.tar.gz is 700 MB.
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

async function menu(page: Page, name: string) {
  await names(page)
    .filter({ hasText: new RegExp(`^${name.replace(".", "\\.")}$`) })
    .click({ button: "right" });
  return page.getByRole("menu");
}

test("a file opens, and each save is reported", async ({ page }) => {
  await (await menu(page, "notes.txt")).getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByText("notes.txt is open: each save is sent to the server")).toBeVisible();
  await expect(page.getByText("notes.txt saved to the server")).toBeVisible();
});

test("a version changed on the server is replaced only when asked", async ({ page }) => {
  await nas(page).getByRole("button", { name: "Show hidden files" }).click();
  await (await menu(page, ".bashrc")).getByRole("menuitem", { name: "Edit" }).click();

  const dialog = page.getByRole("alertdialog", { name: ".bashrc changed on the server" });
  await expect(dialog).toBeVisible();
  await expectSaneUi(page);
  await dialog.getByRole("button", { name: "Replace" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText(".bashrc saved to the server")).toBeVisible();
});

test("a large file asks first, and Cancel opens nothing", async ({ page }) => {
  await (await menu(page, "backup.tar.gz")).getByRole("menuitem", { name: "Edit" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Open a large file?" });
  await expect(dialog).toContainText("backup.tar.gz is");
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await page.waitForTimeout(500);
  await expect(page.getByText(/backup\.tar\.gz is open/)).toHaveCount(0);
});

test("a folder cannot be edited", async ({ page }) => {
  const folderMenu = await menu(page, "projects");
  await expect(folderMenu.getByRole("menuitem", { name: "Download" })).toBeVisible();
  await expect(folderMenu.getByRole("menuitem", { name: "Edit" })).toHaveCount(0);
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T57b`.
2. `edits-store.ts` : `npx vitest run src/features/sftp`.
3. `EditConflictDialog.tsx`, `EntryMenu.tsx`, `use-entry-actions.ts`, `SftpExplorer.tsx`, textes :
   `npx playwright test e2e/sftp-edit.spec.ts e2e/sftp-actions.spec.ts`.
4. `npm run format`, `npm run review`, cases, statut, commit `feat: edit a remote file from the SFTP menu (T57b)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T57b --check` affiche `OK` partout.
- [ ] Aucune nouvelle exception `project-rules: allow`.
- [ ] Le dialogue de conflit garde ses deux boutons sur une ligne, « Remplacer » en rouge (à l'écran).

## À regarder par Florian

`npm run tauri dev`, un onglet SFTP sur un de tes serveurs : « Modifier » sur un fichier texte l'ouvre dans ton
éditeur ; chaque Ctrl+S affiche « … enregistré sur le serveur ». Modifie le même fichier sur le serveur (par un
terminal), puis enregistre encore : TunL demande avant d'écraser. Ferme l'onglet SFTP : le dossier
`$XDG_RUNTIME_DIR/tunl/edit` se vide. **Flatpak** : vérifier que l'éditeur ouvert par le portail renvoie bien ses
enregistrements.
