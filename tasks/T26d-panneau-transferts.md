# T26d — Transferts SFTP : panneau, téléchargement depuis l'explorateur

| | |
|---|---|
| **Jalon** | M4 — SFTP |
| **Dépend de** | T26c |
| **Lire avant** | `docs/04-ecrans.md` §6 (panneau « Transferts »), `docs/03-design.md` (tokens) |
| **Livrable** | `TransfersPanel.tsx` ; téléchargement par double-clic et par le menu ; i18n ; 1 fichier de tests (e2e) |

## Pourquoi

T26 (moteur Rust) et T26c (IPC, mock, modèle, store) sont livrées : il reste l'interface. Cette fiche ajoute le
panneau des transferts, repliable sous l'explorateur, et branche le **téléchargement** : double-clic sur un fichier,
ou « Télécharger » dans le menu. L'envoi aura son interface en T26b.

## À réutiliser (ne pas réécrire)

- T26c : `useTransfers` (`transfers-store.ts`), `percentOf` (`transfer-model.ts`), `revealInFolder` (`lib/opener.ts`).
- T25 / T25b : `SftpExplorer` (son `open`), `EntryMenu`, `formatSize` (`sftp-model.ts`).
- shadcn : `collapsible`, `progress`, `button` (tailles `xs`, `icon-xs`).

## Contrat

### `src/features/sftp/`

| Fichier | Contenu |
|---|---|
| `TransfersPanel.tsx` | `TransfersPanel({ sessionId })` : rien sans transfert ; sinon un `Collapsible` ouvert par défaut, bordure haute : un en-tête bouton « Transfers (n) » (chevron qui tourne), « Clear finished » s'il y a un transfert fini ; une liste (`aria-label` « Transfers », `max-h-40`, défilante), une ligne par transfert (`aria-label` = son nom) : flèche (bas pour un téléchargement), nom, puis en cours une `Progress` (`aria-label` = le nom) + `NN %` + débit `12 MB/s`, sinon « Done » / « Cancelled » / le titre de l'erreur (en `text-destructive`) ; à droite « Cancel <nom> » (en cours) ou « Show <nom> in its folder » (téléchargement fini) |

- `SftpExplorer.tsx` : ouvrir un **fichier** (`file` ou `other`) → `download` ; `<TransfersPanel>` sous le tableau.
- `EntryMenu.tsx` : « Download » (`Download`), en tête, pour une entrée qui n'est pas un dossier.
- i18n (`en` et `fr`) : `sftp.menu.download`, `sftp.transfers.{title_one, title_other, list, clear, rate, done,
  failed, cancelled, cancel, reveal}` (anglais : « Transfers ({{count}}) », « Transfers », « Clear finished »,
  « {{rate}}/s », « Done », « Failed », « Cancelled », « Cancel {{name}} », « Show {{name}} in its folder »).

## Pièges (vus au prototype)

- Sélecteur zustand : `useTransfers((s) => s.transfers)` puis un `useMemo` qui filtre par session ; jamais
  `s.transfers.filter(…)` dans le sélecteur (nouveau tableau à chaque rendu → boucle infinie).
- Le panneau vit **dans** l'explorateur : une reconnexion (nouveau `runId`) repart d'un panneau vide.

## Tests du contrat

### `e2e/sftp-transfers.spec.ts` (nouveau)

```ts
// T26: downloads from the explorer, and the transfers panel (mock: backup.tar.gz is 700 MB, a few seconds).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  await expect(row(page, "notes.txt")).toBeVisible();
});

function nas(page: Page) {
  return page.getByRole("region", { name: "nas", exact: true });
}

function row(page: Page, name: string) {
  return nas(page)
    .getByRole("table", { name: "Files" })
    .getByRole("row", { name: new RegExp(`^${name.replace(".", "\\.")}\\b`) });
}

function transfers(page: Page) {
  return nas(page).getByRole("list", { name: "Transfers" });
}

test("double-clicking a file downloads it; the panel says when it is done", async ({ page }) => {
  await row(page, "notes.txt").dblclick();
  await expect(nas(page).getByRole("button", { name: "Transfers (1)" })).toBeVisible();
  const line = transfers(page).getByRole("listitem", { name: "notes.txt" });
  await expect(line).toContainText("Done");
  await expect(line.getByRole("button", { name: "Show notes.txt in its folder" })).toBeVisible();
  await expectSaneUi(page);
});

test("a folder has no Download in its menu; a file has", async ({ page }) => {
  await row(page, "projects").click({ button: "right" });
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Download" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await row(page, "notes.txt").click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Download" }).click();
  await expect(transfers(page).getByRole("listitem", { name: "notes.txt" })).toContainText("Done");
});

test("a long download shows its progress and can be cancelled", async ({ page }) => {
  await row(page, "backup.tar.gz").dblclick();
  const line = transfers(page).getByRole("listitem", { name: "backup.tar.gz" });
  await expect(line.getByRole("progressbar")).toBeVisible();
  await expect(line).toContainText("/s");
  await line.getByRole("button", { name: "Cancel backup.tar.gz" }).click();
  await expect(line).toContainText("Cancelled");
  await expect(line.getByRole("progressbar")).toHaveCount(0);
});

test("Clear finished empties the panel, which then goes away", async ({ page }) => {
  await row(page, "notes.txt").dblclick();
  await expect(transfers(page).getByRole("listitem", { name: "notes.txt" })).toContainText("Done");
  await nas(page).getByRole("button", { name: "Clear finished" }).click();
  await expect(transfers(page)).toHaveCount(0);
});

test("the panel folds away and comes back", async ({ page }) => {
  await row(page, "notes.txt").dblclick();
  const toggle = nas(page).getByRole("button", { name: "Transfers (1)" });
  await expect(transfers(page)).toBeVisible();
  await toggle.click();
  await expect(transfers(page)).toHaveCount(0);
  await toggle.click();
  await expect(transfers(page)).toBeVisible();
});
```


## Étapes

1. Les tests : `node scripts/contract-tests.mjs T26d`.
2. `en.json`, `fr.json`, `TransfersPanel.tsx`, `SftpExplorer.tsx`, `EntryMenu.tsx` :
   `npx playwright test e2e/sftp-transfers.spec.ts e2e/sftp-actions.spec.ts e2e/sftp.spec.ts`.
3. `npm run format`, `npm run review`, cases, statut, ligne « Works today » du `README.md`, commit
   `feat: SFTP transfers panel, download from the explorer (T26d)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T26d --check` affiche `OK` partout.
- [x] Aucune nouvelle exception `project-rules: allow`.
- [ ] Visuel : en clair et en sombre, une ligne de transfert garde ses colonnes alignées pendant et après le
      transfert, et le panneau ne cache pas la dernière ligne du tableau.

## À regarder par Florian

`npm run tauri dev`, un onglet SFTP : double-clic sur un fichier, il arrive dans ton dossier Téléchargements (un
deuxième téléchargement devient `nom (1).ext`) ; « Afficher dans son dossier » ouvre le gestionnaire de fichiers.
Lance un gros fichier, puis annule : aucun fichier `.part` ne reste.
