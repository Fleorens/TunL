# T46 — SFTP (interface) : un envoi ne ramène plus au dossier de départ, la suppression montre qu'elle travaille

| | |
|---|---|
| **Jalon** | M9 — Revue globale (lot 7) |
| **Dépend de** | T45 |
| **Lire avant** | `docs/04-ecrans.md` § « Onglet SFTP » |
| **Livrable** | `SftpExplorer.tsx`, `use-entry-actions.ts`, `SftpToolbar.tsx`, `lib/mock/transfers.ts`, `en.json` / `fr.json` ; `e2e/sftp-upload-stay.spec.ts` |

## Pourquoi

Revue globale du 2026-10-27, à la lecture du code :

1. **Retour forcé — supposé (lecture)** : `uploadAll` passe à chaque envoi `() => navigate(path)`, avec le `path`
   du moment où l'envoi a commencé. Un gros envoi, puis un double-clic dans un autre dossier : à la fin de l'envoi,
   l'explorateur **revient de force** au dossier d'envoi.
2. **Suppression sans retour visuel — supposé (lecture)** : « Supprimer… » demande d'abord le nombre d'éléments au
   serveur (`sftp_count`), puis supprime (`sftp_remove`). Sur un gros dossier, ou un serveur lointain, chacun peut
   durer plusieurs secondes. Pendant ce temps, rien ne bouge à l'écran, et un deuxième « Supprimer » lance un
   deuxième comptage.

## À réutiliser (ne pas réécrire)

- `navigate` (avec son compteur « la dernière navigation gagne ») et `useTransfers().upload(…, onDone)`.
- `Spinner` (`components/ui/spinner`), `IconButton`.

## Contrat — Frontend

- **Envoi** : à la fin d'un envoi, l'explorateur relit le dossier d'envoi **seulement s'il l'affiche encore**. Le
  dossier affiché se lit dans une référence tenue à jour (`useRef`), pas dans la valeur capturée au début.
- **Suppression** : `useEntryActions` expose `busy: boolean`, vrai du début du comptage à la fin de la suppression
  (ou à l'annulation du dialogue, ou à une erreur). Tant qu'il est vrai :
  - un nouveau « Supprimer… », « Nouveau dossier » ou « Renommer » est ignoré ;
  - la barre d'outils affiche un `Spinner` avec le nom accessible `t("sftp.working")` (en « Working… »,
    fr « En cours… ») à la place du bouton « Actualiser ».
- **Mock** (`lib/mock/transfers.ts`) : un fichier envoyé dont le nom finit par `.iso` mesure 100 Mio (cinq pas de
  progression, 150 ms entre deux), pour qu'un test puisse agir pendant l'envoi. Les autres envois ne changent pas.

## Pièges

- `navigate` est déjà un `useCallback` : la référence du dossier affiché se met à jour quand la navigation
  **réussit** (`setPath`), pas quand elle commence.
- Ne pas désactiver toute la table pendant `busy` : on doit pouvoir continuer à parcourir et à télécharger.

## Tests du contrat

### `e2e/sftp-upload-stay.spec.ts` (nouveau)

```ts
// T46: an upload that ends while you browse elsewhere leaves you where you are.
// Mock: a dropped file whose name ends with ".iso" takes five progress steps.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /^nas/ })
    .first()
    .click({ button: "right" });
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

test("an upload that ends while you browse elsewhere leaves you in that other folder", async ({
  page,
}) => {
  const list = nas(page).getByRole("table", { name: "Files" });
  const files = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "disk.iso"));
    return transfer;
  });
  await list.dispatchEvent("dragover", { dataTransfer: files });
  await list.dispatchEvent("drop", { dataTransfer: files });

  await names(page).filter({ hasText: /^projects$/ }).dblclick();
  await expect(names(page).first()).toHaveText("app");
  await expect(transfers(page).getByRole("listitem", { name: "disk.iso" })).toContainText("Done");
  await page.waitForTimeout(500);
  await expect(names(page).first()).toHaveText("app");
});

test("an upload that ends in the folder shown lists the new file", async ({ page }) => {
  const list = nas(page).getByRole("table", { name: "Files" });
  const files = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(["x"], "image.iso"));
    return transfer;
  });
  await list.dispatchEvent("dragover", { dataTransfer: files });
  await list.dispatchEvent("drop", { dataTransfer: files });
  await expect(transfers(page).getByRole("listitem", { name: "image.iso" })).toContainText(
    "Done",
  );
  await expect(names(page)).toContainText(["image.iso"]);
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T46`.
2. `lib/mock/transfers.ts` (envoi `.iso`), puis `SftpExplorer.tsx` (référence du dossier affiché).
3. `use-entry-actions.ts` (`busy`), `SftpToolbar.tsx` (indicateur), `en.json` / `fr.json`.
4. `npx playwright test e2e/sftp-upload-stay.spec.ts e2e/sftp-upload.spec.ts e2e/sftp-actions.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, commit
   `fix: an upload no longer drags the explorer back, deletion shows it is working (T46)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T46 --check` affiche `OK` partout.
- [ ] Aucune nouvelle exception `project-rules: allow`.
- [ ] Pendant une suppression, l'indicateur remplace « Actualiser » sans décaler la barre d'outils (à l'écran).

## À regarder par Florian

`npm run tauri dev`, un onglet SFTP sur un vrai serveur : envoie un gros fichier, entre dans un autre dossier pendant
l'envoi, tu y restes à la fin. Supprime un dossier bien rempli : l'indicateur tourne jusqu'à la fin.
