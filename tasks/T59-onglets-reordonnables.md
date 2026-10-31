# T59 — Onglets : glisser pour réordonner, menu d'onglet (dupliquer, fermer les autres)

| | |
|---|---|
| **Jalon** | M10 — Nouvelles fonctions (lot 8) |
| **Dépend de** | T58 |
| **Lire avant** | `docs/10-fonctions-a-venir.md` § « Onglets réordonnables » ; `docs/04-ecrans.md` § 1 (TabBar) ; `docs/02-decisions.md` D12 (raccourcis) |
| **Livrable** | `sessions/tabs.ts`, `sessions/store.ts`, `CloseSessionDialog.tsx`, `shell/TabBar.tsx`, `shell/TabMenu.tsx`, `shell/shortcuts.ts` (+ son branchement), `en.json` / `fr.json` ; `src/features/sessions/tabs-order.test.ts`, `e2e/tabs-order.spec.ts` |

## Pourquoi

Les onglets restent dans l'ordre d'ouverture. Pour rapprocher deux sessions, il faut les fermer et les rouvrir ; pour
ne garder qu'un onglet sur dix, dix fermetures et autant de confirmations.

## À réutiliser (ne pas réécrire)

- `tabs.ts` : `tabIds`, `relativeTab`, `neighbourTab`. `TabMenu.tsx` (T58) : le menu se complète ici.
- `useSessions` : `open`, `close`, `requestClose`, `confirmClose`, `cancelClose` ; `uniqueTitle` ; `startDirs` (T58).
- `Reorder` de `motion/react` pour le glisser-déposer (aucune dépendance nouvelle).
- `SHORTCUTS` et `matchShortcut` (`shortcuts.ts`), le dialogue F1 qui les liste (`shortcutRows`).

## Contrat

### `tabs.ts` (pur)

```ts
/** `ids` with `id` moved to `toIndex` (clamped to the row), a new array; an unknown id gives `ids` itself. */
export function moveTab(ids: readonly string[], id: string, toIndex: number): readonly string[];
/** The tabs after `id` in `ids` (none when unknown or last). */
export function tabsRightOf(ids: readonly string[], id: string): string[];
```

### Store

- `reorder(ids: readonly string[])` : l'ordre des sessions suit `ids` (une liste d'ids de sessions ; un id inconnu est
  ignoré, une session absente de `ids` garde sa place à la fin). Paramètres reste toujours le dernier onglet.
- `moveActive(delta: 1 | -1)` : déplace l'onglet actif d'un cran, **sans** faire le tour (au bord, rien ne bouge).
- `duplicate(id)` : un nouvel onglet sur la même cible et du même type, actif ; un SSH ouvert par « Ouvrir un terminal
  ici » garde son dossier (`startDirs`).
- `closing` devient `readonly string[] | null`. `requestCloseMany(ids)` ferme tout de suite les onglets non connectés
  et, si au moins un onglet est connecté et que `ui.confirmCloseActiveSession` est vrai, met les connectés dans
  `closing` : **une** confirmation pour tous. `requestClose(id)` = `requestCloseMany([id])`. `confirmClose` les ferme
  tous ; `cancelClose` les garde tous.
- `closeOthers(id)` et `closeRight(id)` passent par `requestCloseMany` (l'onglet Paramètres n'est jamais fermé par
  eux).

### Interface

- **Glisser-déposer** des onglets de session dans la barre (`Reorder.Group axis="x"`), l'indicateur d'onglet actif
  suit. Un clic sans déplacement active l'onglet comme avant ; le clic du milieu ferme toujours.
- **Clavier** : `Ctrl+Maj+PgSuiv` / `Ctrl+Maj+PgPréc` → `moveActive(1)` / `moveActive(-1)` (ids
  `tab.moveRight`, `tab.moveLeft`, affichés dans F1 : `Ctrl ⇧ PgDn`, `Ctrl ⇧ PgUp`). Ils marchent aussi dans le
  terminal, comme `tab.next`.
- **Menu d'onglet** (T58 + ceci) : « Dupliquer » (`tabMenu.duplicate`), « Ouvrir en SFTP » (SSH), séparateur,
  « Fermer l'onglet », « Fermer les autres onglets » (`tabMenu.closeOthers`), « Fermer les onglets à droite »
  (`tabMenu.closeRight`, désactivé sur le dernier onglet de session).
- **Confirmation** : un seul onglet, le dialogue d'aujourd'hui ; plusieurs, titre `sessions.confirmClose.titleMany`
  (en « Close {{count}} connected tabs? », fr « Fermer {{count}} onglets connectés ? »), texte
  `sessions.confirmClose.descriptionMany` (en « Their sessions are still open: closing the tabs ends them. », fr « Leurs
  sessions sont encore ouvertes : fermer les onglets les termine. »), mêmes boutons.

Au passage, fr `sessions.confirmClose.title` prend l'espace avant le point d'interrogation : « Fermer {{name}} ? ».

| Clé | en | fr |
|---|---|---|
| `tabMenu.duplicate` | Duplicate | Dupliquer |
| `tabMenu.closeOthers` | Close other tabs | Fermer les autres onglets |
| `tabMenu.closeRight` | Close tabs to the right | Fermer les onglets à droite |
| `shortcuts.labels.tab.moveLeft` / `moveRight` (selon la structure existante des libellés F1) | Move tab left / Move tab right | Déplacer l'onglet à gauche / à droite |

## Pièges

- `Reorder.Item` rend un `li` par défaut : `as="div"`, en gardant `role="tab"` et la navigation au clavier de T34. La
  barre reste un `role="tablist"`.
- Le menu (`ContextMenuTrigger asChild`) et `Reorder.Item` enveloppent le même onglet : les props doivent se propager
  jusqu'au `div` (piège `asChild` d'`AGENTS.md`).
- `matchShortcut` doit distinguer `Ctrl+PgDn` (onglet suivant) de `Ctrl+Maj+PgDn` (déplacer) : vérifier que la touche
  Maj est comparée exactement ; les tests de `shortcuts.test.ts` ne doivent pas changer.
- `closing` change de type : `CloseSessionDialog`, `requestClose`, et la remise à `null` quand une session n'est plus
  connectée (`start` dans `store.ts`, qui retire désormais l'id de la liste) suivent.
- `store.ts` : rester sous 400 lignes ; la logique pure dans `tabs.ts`.

## Tests du contrat

### `src/features/sessions/tabs-order.test.ts`

```ts
// T59: the tab row can be reordered, and "to the right" means after the tab, in the row's order.
import { describe, expect, test } from "vitest";
import { moveTab, tabsRightOf } from "./tabs";

const row = ["a", "b", "c", "d"];

describe("tab order", () => {
  test("a tab moves to an index, the others keep their order", () => {
    expect(moveTab(row, "a", 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveTab(row, "d", 0)).toEqual(["d", "a", "b", "c"]);
    expect(moveTab(row, "b", 9)).toEqual(["a", "c", "d", "b"]);
    expect(moveTab(row, "c", -3)).toEqual(["c", "a", "b", "d"]);
    expect(row).toEqual(["a", "b", "c", "d"]);
  });

  test("an unknown tab changes nothing", () => {
    expect(moveTab(row, "z", 1)).toBe(row);
  });

  test("the tabs to the right of one", () => {
    expect(tabsRightOf(row, "b")).toEqual(["c", "d"]);
    expect(tabsRightOf(row, "d")).toEqual([]);
    expect(tabsRightOf(row, "z")).toEqual([]);
  });
});
```

### `e2e/tabs-order.spec.ts`

```ts
// T59: tabs move with the keyboard or the mouse, duplicate, and close in groups with one confirmation.
// Mock: nas, pi-hole and web-01 connect without a question.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  for (const name of ["nas", "pi-hole", "web-01"]) {
    await page.getByRole("button", { name: new RegExp(`^${name}`) }).first().dblclick();
    await expect(page.getByRole("tab", { selected: true })).toContainText(name);
    await expect(
      page.getByRole("region", { name, exact: true }).locator(".xterm-rows"),
    ).toContainText(`Welcome to ${name}`);
  }
  await expect(page.getByRole("tab").last()).toContainText("web-01");
});

function titles(page: Page) {
  return page.getByRole("tab");
}

test("Ctrl+Shift+PgUp moves the active tab, without wrapping", async ({ page }) => {
  await page.keyboard.press("Control+Shift+PageUp");
  await expect(titles(page)).toHaveText([/nas/, /web-01/, /pi-hole/]);
  await page.keyboard.press("Control+Shift+PageUp");
  await page.keyboard.press("Control+Shift+PageUp");
  await expect(titles(page)).toHaveText([/web-01/, /nas/, /pi-hole/]);
  await expect(page.getByRole("tab", { selected: true })).toContainText("web-01");
});

test("a tab dragged onto another takes its place", async ({ page }) => {
  const from = await titles(page).nth(2).boundingBox();
  const to = await titles(page).nth(0).boundingBox();
  if (!from || !to) throw new Error("the tabs have no box");
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + 10, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(titles(page).first()).toContainText("web-01");
});

test("Duplicate opens the same connection in a new tab", async ({ page }) => {
  await page.getByRole("tab", { name: /nas/ }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Duplicate" }).click();
  await expect(titles(page)).toHaveCount(4);
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas (2)");
});

test("Close other tabs asks once for every connected tab", async ({ page }) => {
  await page.getByRole("tab", { name: /pi-hole/ }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Close other tabs" }).click();
  const dialog = page.getByRole("alertdialog", { name: "Close 2 connected tabs?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(titles(page)).toHaveCount(3);

  await page.getByRole("tab", { name: /pi-hole/ }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Close other tabs" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^Close/ })
    .click();
  await expect(titles(page)).toHaveCount(1);
  await expect(titles(page)).toContainText("pi-hole");
});

test("Close tabs to the right keeps the tab and those before it", async ({ page }) => {
  await page.getByRole("tab", { name: /nas/ }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Close tabs to the right" }).click();
  await page
    .getByRole("alertdialog")
    .getByRole("button", { name: /^Close/ })
    .click();
  await expect(titles(page)).toHaveCount(1);
  await expect(titles(page)).toContainText("nas");
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T59`.
2. `tabs.ts`, `store.ts` : `npx vitest run src/features/sessions src/features/shell`.
3. `CloseSessionDialog.tsx`, `TabBar.tsx`, `TabMenu.tsx`, raccourcis, textes :
   `npx playwright test e2e/tabs-order.spec.ts e2e/shell.spec.ts e2e/keyboard.spec.ts e2e/ssh-sftp-switch.spec.ts`.
4. `npm run format`, `npm run review`, cases, statut, commit
   `feat: reorder tabs, duplicate them, close others or to the right with one confirmation (T59)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T59 --check` affiche `OK` partout.
- [x] `wc -l src/features/sessions/store.ts src/features/shell/TabBar.tsx` : 400 lignes au plus chacun.
- [x] Aucune nouvelle exception `project-rules: allow`.
- [ ] Pendant un glisser, l'onglet suit la souris et les autres s'écartent sans sauter ; l'indicateur reste sous
  l'onglet actif (à l'écran).

## À regarder par Florian

`npm run tauri dev`, trois onglets : glisse le dernier en tête ; Ctrl+Maj+PgPréc le fait reculer. Clic droit,
« Fermer les autres onglets » : une seule confirmation.
