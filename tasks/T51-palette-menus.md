# T51 — Palette et menus : pas de groupe vide, connexion rapide RDP, favori sans coche, « bastion » en français

| | |
|---|---|
| **Jalon** | M9 — Revue globale (lot 7) |
| **Dépend de** | T50 |
| **Lire avant** | `docs/04-ecrans.md` § « Palette de commandes » et § « Menu contextuel » |
| **Livrable** | `CommandPalette.tsx`, `open-session.ts`, `coming-soon.ts` (supprimé s'il ne sert plus), `ConnectionContextMenu.tsx`, `fr.json` ; `e2e/palette-groups.spec.ts` |

## Pourquoi

Revue globale du 2026-10-27, captures du mock :

1. **Groupes vides — constaté** : la palette passe `shouldFilter={false}` à cmdk et affiche ses trois groupes même
   vides. Taper « web » montre un titre « Actions » sans rien dessous ; taper « settings », un titre « Connexions »
   vide.
2. **Connexion rapide RDP — constaté (lecture)** : `rdp://hôte` dans la palette propose « RDP vers hôte », qui affiche
   un toast « bientôt disponible » dans la v0.1.0 publiée. Le backend ne sait ouvrir un onglet RDP que sur une
   connexion enregistrée (`rdp_open`).
3. **Favori — constaté (capture)** : le menu contextuel affiche « Retirer des favoris ✓ » (une case cochée à côté
   d'un libellé qui dit déjà l'état).
4. **Vocabulaire — constaté (fichier `fr.json`)** : le même objet s'appelle « Connexion relais » dans l'éditeur,
   « Hôte sauteur » dans l'import, et « bastion » partout ailleurs (aide, documentation, fiches).

## À réutiliser (ne pas réécrire)

- `filterActions`, `parseQuickConnect`, `QuickConnectGroup` (`CommandPalette.tsx`) ; l'action « Enregistrer comme
  nouvelle connexion… » ouvre déjà l'éditeur prérempli (`openEditor({ mode: "create", protocol, prefill })`).

## Contrat — Frontend

- Palette : un groupe (Connexions, Connexion rapide, Actions) n'est rendu que s'il a au moins un élément.
- Connexion rapide RDP : pour une cible `rdp`, la palette ne propose plus « RDP vers … » ; son premier élément (celui
  qu'Entrée choisit) est « Enregistrer comme nouvelle connexion… », qui ouvre l'éditeur prérempli en RDP. La
  connexion rapide SSH ne change pas. `openQuickSession` ne reçoit plus que des cibles SSH ; `notifyComingSoon` et
  sa clé de traduction disparaissent s'ils ne servent plus nulle part.
- Menu contextuel : l'élément favori devient un `ContextMenuItem` simple (« Ajouter aux favoris » / « Retirer des
  favoris », étoile pleine ou vide), sans case à cocher.
- `fr.json` seulement : `editor.fields.jumpHost` et `import.columns.jump` deviennent « Bastion ». L'anglais garde
  « Jump host ».

## Pièges

- cmdk choisit le premier élément **rendu** : l'ordre des éléments du groupe « Connexion rapide » décide de ce que
  fait Entrée.
- Ne pas réactiver le filtre de cmdk (`shouldFilter`) : le filtre maison sans accents (`normalizeForSearch`) doit
  rester.

## Tests du contrat

### `e2e/palette-groups.spec.ts` (nouveau)

```ts
// T51: the palette hides empty groups, an RDP address opens the editor filled in, and the favorite item of the
// connection menu is a plain action.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function headings(page: Page) {
  return page.locator("[cmdk-group-heading]");
}

test("a search shows only the groups that have something", async ({ page }) => {
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("web");
  await expect(headings(page).filter({ hasText: /^Connections$/ })).toHaveCount(1);
  await expect(headings(page).filter({ hasText: /^Actions$/ })).toHaveCount(0);

  await page.keyboard.press("Control+a");
  await page.keyboard.type("settings");
  await expect(headings(page).filter({ hasText: /^Actions$/ })).toHaveCount(1);
  await expect(headings(page).filter({ hasText: /^Connections$/ })).toHaveCount(0);
});

test("an RDP address opens the editor filled in", async ({ page }) => {
  await page.keyboard.press("Control+Shift+T");
  await page.keyboard.type("rdp://10.0.0.9");
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("heading", { name: "New connection" })).toBeVisible();
  await expect(editor.getByRole("radio", { name: "RDP", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(editor.getByRole("textbox", { name: /^Host/ })).toHaveValue("10.0.0.9");
  await expect(editor.getByRole("textbox", { name: /^Port/ })).toHaveValue("3389");
});

test("the favorite item of the connection menu is a plain action", async ({ page }) => {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^web-01/ })
    .first()
    .click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Remove from favorites" })).toBeVisible();
  await expect(menu.getByRole("menuitemcheckbox")).toHaveCount(0);
});
```

Amendement validé par Florian le 2026-10-30 : la ligne « RDP vers … » disparaît aussi de la palette complète, et le toast « Bientôt disponible » avec elle. Les deux fichiers suivants remplacent les versions de T21 (`e2e/palette.spec.ts` : `rdp://` ouvre l'éditeur) et de T31 (`e2e/shell.spec.ts` : le test du toast provisoire est retiré, plus aucune action provisoire).

### `e2e/palette.spec.ts` (remplace la version de T21)

```ts
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function palette(page: Page) {
  return page.getByRole("dialog");
}

test("the palette finds a connection by host, and Alt+Enter edits it", async ({ page }) => {
  await page.keyboard.press("Control+Shift+P");
  await palette(page).getByRole("combobox").fill("10.0.0.12");
  await expect(palette(page).getByRole("option", { name: /web-01/ })).toBeVisible();
  await expectSaneUi(page);
  await page.keyboard.press("Alt+Enter");
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Edit web-01" }),
  ).toBeVisible();
});

test("Enter on a connection opens it in a new tab", async ({ page }) => {
  await page.getByRole("button", { name: /Search or connect/ }).click();
  await palette(page).getByRole("combobox").fill("pi-hole");
  await page.keyboard.press("Enter");
  await expect(palette(page)).toHaveCount(0);
  await expect(page.getByRole("tab", { selected: true })).toContainText("pi-hole");
});

test("quick connect can be saved as a new connection", async ({ page }) => {
  await page.keyboard.press("Control+Shift+T");
  await palette(page).getByRole("combobox").fill("deploy@10.5.5.5:2222");
  await expect(
    palette(page).getByRole("option", { name: "SSH to deploy@10.5.5.5:2222" }),
  ).toBeVisible();
  await palette(page).getByRole("option", { name: "Save as a new connection…" }).click();
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("heading", { name: "New connection" })).toBeVisible();
  await expect(editor.getByLabel("Host", { exact: true })).toHaveValue("10.5.5.5");
  await expect(editor.getByLabel("Port", { exact: true })).toHaveValue("2222");
  await expect(editor.getByLabel("Username", { exact: true })).toHaveValue("deploy");
  await expect(editor.getByRole("button", { name: "Save", exact: true })).toBeEnabled();
});

test("rdp:// switches the quick connect protocol", async ({ page }) => {
  // T51: an RDP tab opens only on a saved connection, so Enter opens the editor filled in, in RDP.
  await page.keyboard.press("Control+Shift+P");
  await palette(page).getByRole("combobox").fill("rdp://win-02");
  await expect(palette(page).getByRole("option", { name: "RDP to win-02" })).toHaveCount(0);
  await page.keyboard.press("Enter");
  const editor = page.getByRole("dialog");
  await expect(editor.getByRole("heading", { name: "New connection" })).toBeVisible();
  await expect(editor.getByRole("radio", { name: "RDP", exact: true })).toHaveAttribute(
    "aria-checked",
    "true",
  );
  await expect(editor.getByLabel("Host", { exact: true })).toHaveValue("win-02");
});

test("F1 lists the keyboard shortcuts", async ({ page }) => {
  await page.keyboard.press("F1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Keyboard shortcuts" })).toBeVisible();
  await expect(dialog.getByText("Command palette")).toBeVisible();
  await expect(dialog.getByText("Go to tab 1…8")).toBeVisible();
  await expectSaneUi(page);
});
```

### `e2e/shell.spec.ts` (remplace la version de T31)

```ts
import { expect, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("right-clicking a connection opens its menu, with the groups submenu", async ({ page }) => {
  await page
    .getByRole("button", { name: /^web-01/ })
    .first()
    .click({ button: "right" });
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Connect" })).toBeVisible();
  await menu.getByRole("menuitem", { name: "Move to group" }).hover();
  await expect(page.getByRole("menuitem", { name: "Homelab" })).toBeVisible();
});

test("only one connection row is highlighted at a time", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().click();
  await page
    .getByRole("button", { name: /^pi-hole/ })
    .first()
    .click();
  const current = page.locator('[aria-current="true"]');
  await expect(current).toHaveCount(1);
  await expect(current).toContainText("pi-hole");
});

test("keyboard shortcuts drive the tabs and the sidebar filter", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().dblclick();
  await page
    .getByRole("button", { name: /^pi-hole/ })
    .first()
    .dblclick();
  await expect(page.getByRole("tab", { selected: true })).toContainText("pi-hole");
  await page.keyboard.press("Alt+Digit1");
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas");
  await page.keyboard.press("Control+PageDown");
  await expect(page.getByRole("tab", { selected: true })).toContainText("pi-hole");

  await page.keyboard.press("Control+Shift+E");
  await expect(page.locator("#sidebar-filter")).toBeFocused();
  await page.keyboard.type("pg");
  await expect(page.getByRole("button", { name: /^db-prod/ })).toHaveCount(1);
});

test("the app starts on the home screen, and closing the last tab returns to it", async ({
  page,
}) => {
  await expect(page.getByRole("tab")).toHaveCount(0);
  const quickConnect = page.getByPlaceholder("user@host[:port] — quick connect");
  await quickConnect.fill("root@unreachable.test");
  await quickConnect.press("Enter");
  await expect(page.getByRole("tab")).toHaveCount(1);
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("outside Tauri, the status bar flags the mock backend", async ({ page }) => {
  await expect(page.getByText("Mock backend")).toBeVisible();
  await expect(page.getByText("v0.1.0-mock")).toBeVisible();
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T51`.
2. `CommandPalette.tsx`, `open-session.ts` (et `coming-soon.ts`), `ConnectionContextMenu.tsx`, `fr.json`.
3. `npx playwright test e2e/palette-groups.spec.ts e2e/palette.spec.ts e2e/connections.spec.ts`.
4. `npm run format`, `npm run review`, cases, statut, commit
   `fix: no empty palette groups, RDP quick connect opens the editor, plain favorite item (T51)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T51 --check` affiche `OK` partout.
- [x] `grep -rn "Hôte sauteur\|Connexion relais" src/i18n` ne trouve plus rien.
- [x] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

`npm run tauri dev` : Ctrl+Maj+P puis « web » (pas de titre « Actions » vide) ; Ctrl+Maj+T puis `rdp://une-machine`
et Entrée : l'éditeur s'ouvre en RDP, l'hôte rempli. En français, l'éditeur et l'import disent « Bastion ».
