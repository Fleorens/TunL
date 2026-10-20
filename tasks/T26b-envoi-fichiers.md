# T26b — Envoi de fichiers : sélecteur natif et glisser-déposer depuis le bureau

| | |
|---|---|
| **Jalon** | M4 — SFTP |
| **Dépend de** | T26d, T28b |
| **Lire avant** | `docs/04-ecrans.md` §6 (« Glisser-déposer », bouton « Envoyer »), `docs/06-securite.md` S14 |
| **Livrable** | plugin `dialog` ; `lib/files.ts` (`pickFiles`) ; `onFileDrop` dans `lib/events.ts` ; bouton « Envoyer des fichiers » et voile « Déposer pour envoyer vers … » de l'explorateur ; 1 fichier de tests |

## Pourquoi

T26 a écrit le moteur d'envoi (`sftp_upload`, `useTransfers().upload`) sans interface pour s'en servir. Cette fiche
ajoute les deux gestes de `docs/04-ecrans.md` §6 : le bouton « Envoyer » (le sélecteur de fichiers du système,
plusieurs à la fois) et le **glisser-déposer** depuis le gestionnaire de fichiers. Chaque fichier part dans le
dossier affiché ; à chaque envoi terminé, le dossier est relu.

Dans Tauri, la fenêtre prend les fichiers déposés et donne leurs **chemins** (`onDragDropEvent`) ; le WebView ne voit
alors aucun événement de dépôt de fichier. Dans le navigateur de `npm run dev`, ce sont les événements HTML5 de
l'explorateur, qui ne donnent que des **noms** : le mock les place dans un faux dossier. Deux chemins de code, un seul
comportement.

Prototypé par l'orchestrateur sur le mock : les tests de cette fiche passent. Le glisser-déposer **réel** ne se
teste qu'à l'écran (« À regarder par Florian »).

## À réutiliser (ne pas réécrire)

- T26 : `useTransfers().upload(sessionId, localPath, remoteDir, onDone)`, le panneau, le mock `sftp_upload` (qui
  évite déjà un nom existant).
- T25 / T25b : `SftpExplorer` (`navigate(path, select?)`), `SftpToolbar`, le `ContextMenuTrigger` qui enveloppe le
  tableau.
- `lib/events.ts` (modèle d'abonnement asynchrone de `onPrompt`), `isMockBackend`, `notifyError`.

## Dépendances

- `src-tauri/Cargo.toml` : `tauri-plugin-dialog = "2.8"` (sous `tauri-plugin-clipboard-manager`). **Pas** la 3.0, en
  alpha.
- `npm install @tauri-apps/plugin-dialog@^2.8`.
- `lib.rs` : `.plugin(tauri_plugin_dialog::init())` après le plugin du presse-papiers.
- `capabilities/default.json` : `"dialog:allow-open"`, et rien d'autre (S14).

## Contrat

### `src/lib/files.ts` (nouveau ; le **seul** fichier qui importe `@tauri-apps/plugin-dialog`)

```ts
export const MOCK_PICKED_FILES: readonly string[];   // "/home/user/Documents/report.pdf", "/home/user/Documents/notes.txt"
export const MOCK_DROP_DIR = "/home/user/Desktop";
/** Les fichiers choisis dans le sélecteur du système (plusieurs), ou aucun si l'utilisateur annule. */
export async function pickFiles(): Promise<string[]>;
```

Dans Tauri : `open({ multiple: true, directory: false })`, `null` → `[]`. Avec le mock : une copie de
`MOCK_PICKED_FILES`.

### `src/lib/events.ts` : `onFileDrop`

```ts
export interface FileDropHandlers { onOver: () => void; onLeave: () => void; onDrop: (paths: string[]) => void }
export function onFileDrop(handlers: FileDropHandlers): () => void;
```

Dans Tauri : `getCurrentWebview().onDragDropEvent(…)` ; `drop` → `onDrop(paths)`, `leave` → `onLeave`, `enter` et
`over` → `onOver`. Même gestion de l'abonnement que `onPrompt` (le désabonnement arrive plus tard : le garder, et
désabonner même si l'appelant est parti avant). Hors Tauri : rien (une fonction vide). Mettre à jour le commentaire
d'en-tête du fichier (« et les fichiers déposés sur la fenêtre, T26b »).

### `src/features/sftp/use-file-drop.ts` (nouveau)

`useFileDrop(active, onFiles)` → `{ dragging, dropProps }` :
- tant que `active` (l'onglet est à l'écran) : `onFileDrop` ; `onOver` → `dragging = true`, `onLeave` → `false`,
  `onDrop` → `false` puis `onFiles(paths)` ;
- `dropProps`, avec le mock seulement (vide sinon) : `onDragOver` (seulement si `dataTransfer.types` contient
  `"Files"` : `preventDefault`, `dragging = true`), `onDragLeave` (`false` quand on sort vraiment de la zone :
  `relatedTarget` hors de `currentTarget`), `onDrop` (`"Files"` seulement : `preventDefault`, `false`, puis
  `onFiles` avec `MOCK_DROP_DIR/<nom>` pour chaque fichier) ;
- `onFiles` passe par un `useRef` (la dernière version), pour ne pas se réabonner à chaque rendu.

### Explorateur

- `SftpExplorer({ sessionId, active })` (`SessionView` passe `active`).
- `uploadAll(paths)` : pour chaque chemin, `useTransfers().upload(sessionId, chemin, dossier affiché, () =>
  navigate(dossier, sélection))`.
- `SftpToolbar` : bouton « Upload files » (`Upload`), **avant** « New folder » ; prop `onUpload` →
  `pickFiles().then(uploadAll).catch(notifyError)`.
- `{...drop.dropProps}` sur le `ContextMenuTrigger` du tableau (Biome refuse des gestionnaires sur un `div`).
- Pendant `dragging` : un voile `pointer-events-none absolute inset-2 top-13 z-20`, bordure `border-2 border-dashed
  border-primary`, fond `bg-primary/5`, et au centre « Drop to upload to <dossier> » (`sftp.dropHere`) sur un fond
  `bg-background` avec `shadow-elevated`. Le conteneur de l'explorateur devient `relative`.
- i18n : `sftp.upload` (« Upload files » / « Envoyer des fichiers »), `sftp.dropHere` (« Drop to upload to
  {{path}} » / « Déposer pour envoyer vers {{path}} »).

## Pièges (vus au prototype)

- Avec `dragDropEnabled` (le défaut de Tauri 2), le WebView ne reçoit **aucun** `drop` de fichier : seul
  `onDragDropEvent` les voit. D'où les deux chemins. Ne pas désactiver `dragDropEnabled` : on perdrait les chemins.
- Un `DataTransfer` qui ne porte pas de fichier (du texte glissé depuis l'app) ne doit rien déclencher.
- Les envois du sélecteur partent ensemble : chacun relit le dossier en finissant, c'est voulu (le dernier gagne).
- Playwright simule un dépôt avec `page.evaluateHandle(() => { const t = new DataTransfer(); t.items.add(new
  File(["x"], "photo.jpg")); return t; })`, puis `dispatchEvent("dragover" | "drop", { dataTransfer })`.

## Tests du contrat

### `e2e/sftp-upload.spec.ts` (nouveau)

```ts
// T26b: uploads, from the toolbar's file chooser (mock: report.pdf and notes.txt) and by dropping files on the list.
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

function transfers(page: Page) {
  return nas(page).getByRole("list", { name: "Transfers" });
}

test("Upload files sends what was chosen, beside an existing name, then lists it", async ({
  page,
}) => {
  await nas(page).getByRole("button", { name: "Upload files" }).click();
  await expect(transfers(page).getByRole("listitem", { name: "report.pdf" })).toContainText("Done");
  await expect(transfers(page).getByRole("listitem", { name: "notes.txt" })).toContainText("Done");
  await expect(names(page)).toContainText(["notes (1).txt", "notes.txt", "report.pdf"]);
  // An upload has nothing to show in a local folder.
  await expect(transfers(page).getByRole("button", { name: /in its folder/ })).toHaveCount(0);
});

test("dropping files on the list shows where they go, then uploads them", async ({ page }) => {
  const list = nas(page).getByRole("table", { name: "Files" });
  const files = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "photo.jpg"));
    return transfer;
  });
  await list.dispatchEvent("dragover", { dataTransfer: files });
  await expect(nas(page).getByText("Drop to upload to /home/admin")).toBeVisible();
  await expectSaneUi(page);
  await list.dispatchEvent("drop", { dataTransfer: files });
  await expect(nas(page).getByText("Drop to upload to /home/admin")).toHaveCount(0);
  await expect(transfers(page).getByRole("listitem", { name: "photo.jpg" })).toContainText("Done");
  await expect(names(page)).toContainText(["photo.jpg"]);
});

test("a drag that is not files changes nothing", async ({ page }) => {
  const list = nas(page).getByRole("table", { name: "Files" });
  const text = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.setData("text/plain", "hello");
    return transfer;
  });
  await list.dispatchEvent("dragover", { dataTransfer: text });
  await expect(nas(page).getByText(/Drop to upload/)).toHaveCount(0);
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T26b`.
2. Dépendances (Rust et npm), `lib.rs`, `capabilities/default.json` : `cd src-tauri && cargo check`.
3. `lib/files.ts`, `lib/events.ts` (`onFileDrop`), `features/sftp/use-file-drop.ts` : `npm run typecheck`.
4. `SftpToolbar.tsx`, `SftpExplorer.tsx`, `SessionView.tsx`, `en.json`, `fr.json` :
   `npx playwright test e2e/sftp-upload.spec.ts e2e/sftp-transfers.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, ligne « Works today » du `README.md`, commit
   `feat: upload files from the file chooser or by drag and drop (T26b)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T26b --check` affiche `OK` partout.
- [x] `grep -rn "plugin-dialog" src` ne trouve que `src/lib/files.ts`.
- [x] `grep -rn "onDragDropEvent" src` ne trouve que `src/lib/events.ts`.
- [x] Aucune nouvelle exception `project-rules: allow`.
- [x] Visuel : le voile de dépôt couvre la liste sans cacher la barre d'outils, et son texte se lit en clair et en
      sombre.

## À regarder par Florian

`npm run tauri dev`, un onglet SFTP : « Envoyer des fichiers » ouvre le sélecteur du système (plusieurs fichiers à la
fois). Puis glisse un fichier depuis ton gestionnaire de fichiers sur l'onglet : le voile « Déposer pour envoyer
vers … » apparaît, le dépôt lance l'envoi. Un fichier qui existe déjà arrive sous `nom (1).ext`.
