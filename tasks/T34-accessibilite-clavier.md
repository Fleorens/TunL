# T34 — Accessibilité et clavier : boutons icône nommés, flèches dans la sidebar et les onglets, aide F1

| | |
|---|---|
| **Jalon** | M7 — Finitions |
| **Dépend de** | T33 |
| **Lire avant** | `docs/03-design.md` §8 et §10, `docs/00-vision.md` (principe 1 « Clavier d'abord ») |
| **Livrable** | `components/IconButton.tsx` et la règle `icon-button` ; `lib/list-keys.ts` ; flèches dans la sidebar et la barre d'onglets ; section « Listes et fichiers » de F1 ; 2 fichiers de tests |

## Pourquoi

`docs/03-design.md` §10 est « non négociable ». L'audit du lot 6 a trouvé :
- **onze boutons icône sans infobulle** (l'`aria-label` y est, l'infobulle non) : la barre d'outils SFTP (5), le
  panneau des transferts (2), l'œil du mot de passe, la copie d'une commande d'installation RDP, le « ⋯ » d'un groupe,
  l'import du pied de la sidebar. Les autres répètent à la main `Tooltip` + `Button` + `aria-label`.
- La **sidebar** ne se parcourt qu'avec Tab, ligne par ligne ; §10 demande les flèches.
- Dans la **barre d'onglets**, seul l'onglet actif est dans l'ordre de Tab (`tabIndex` −1 pour les autres) : sans
  souris, on n'atteint les autres que par les raccourcis de l'app.
- L'aide **F1** liste les raccourcis globaux et ceux du terminal, pas les touches des listes (Entrée, Maj+F10, F2,
  Suppr, Retour arrière).

Déjà bon, à ne pas casser : le menu contextuel s'ouvre au clavier (Menu ou Maj+F10) sur une ligne de la sidebar ou
du tableau SFTP ; le tableau SFTP gère déjà ses flèches, F2, Suppr, Entrée et Retour arrière (T25, T25b).

Prototypé par l'orchestrateur : les tests de cette fiche passent, avec toute la recette.

## À réutiliser (ne pas réécrire)

- `Button`, `Tooltip`, `TooltipTrigger`, `TooltipContent`, `TooltipProvider` (shadcn).
- `TERMINAL_SHORTCUTS` (`features/shell/shortcuts.ts`) et sa section dans `ShortcutsDialog` : la nouvelle section
  est faite pareil.
- `TabFrame` (T31), `ConnectionRow`, `ConnectionsList` (`Sidebar.tsx`).

## Contrat

### `src/components/IconButton.tsx` (nouveau)

```ts
type IconButtonProps = Omit<ComponentProps<typeof Button>, "size"> & {
  /** Traduit : le nom accessible ET l'infobulle. */
  label: string;
  /** `xs` → `icon-xs` (24 px), `sm` → `icon-sm` (32 px, défaut), `md` → `icon` (36 px). */
  size?: "xs" | "sm" | "md";
};
export function IconButton(props: IconButtonProps): JSX.Element;
```

- Rend `TooltipProvider delayDuration={400}` › `Tooltip` › `TooltipTrigger asChild` › `Button` (`variant` `ghost`
  par défaut, `aria-label={label}`, **toutes** les autres props propagées) ; `TooltipContent` = `label`.
- Son propre `TooltipProvider` : un test de composant (celui de `RdpMissingCard`, T28b) le rend sans l'app autour.
- Propager les props, c'est ce qui le laisse vivre dans un `DropdownMenuTrigger asChild` (le « ⋯ » d'un groupe) :
  le menu lui passe ses gestionnaires, sa `ref` et son `data-state`, qui l'emporte sur celui de l'infobulle.

### Tous les boutons icône passent par lui

`git grep 'size="icon' src/features src/components` ne doit plus rien trouver hors de `IconButton.tsx` et de
`components/ui/`. Les fichiers à convertir : `PromptPassword.tsx` (l'œil, `md`), `RdpMissingCard.tsx`,
`SftpToolbar.tsx` (5, `variant="outline"`), `TransfersPanel.tsx` (2, `xs`), `GroupSection.tsx` (`md`, dans le
`DropdownMenuTrigger`), `Sidebar.tsx` (nouveau groupe et import, `md`), `TopBar.tsx` (2), `TerminalSearch.tsx` (2,
`outline`, `md`), `TabBar.tsx` (le `+`, `xs`), `ConnectionCard.tsx` (les actions de survol), `KnownHostsList.tsx`
(T31b). Le `Toggle` des fichiers cachés reste un `Toggle` (pas d'infobulle sur un contrôle à état, voir les pièges
d'`AGENTS.md`).

### La règle `icon-button` (`scripts/project-rules.mjs`, dans `LINE_RULES`, avant `e2e-console-guard`)

```js
  {
    id: "icon-button",
    files: own.filter(
      (p) => !isTest(p) && !p.startsWith("src/dev/") && p !== "src/components/IconButton.tsx",
    ),
    pattern: /size="icon/,
    message: "an icon-only button is an IconButton: its label is both its aria-label and its tooltip (docs/03 §10)",
  },
```

(La galerie `src/dev/` montre les composants shadcn bruts : elle est exclue.)

### `src/lib/list-keys.ts` (nouveau, pur)

```ts
export type ListMove = "next" | "previous" | "first" | "last";
/** Flèches dans le sens de la liste (`vertical` : ↓ ↑, `horizontal` : → ←), Home, End ; sinon `null`. */
export function listMove(key: string, orientation: "vertical" | "horizontal"): ListMove | null;
/** L'index d'arrivée. `wrap` : après le dernier vient le premier (onglets) ; sinon les bouts tiennent (lignes).
 *  Rien de focalisé (`current` −1) : next → le premier, previous → le dernier. Liste vide → −1. */
export function moveIndex(move: ListMove, current: number, count: number, wrap: boolean): number;
```

### Sidebar

- `ConnectionRow` : l'attribut `data-sidebar-row` sur son `<button>`.
- `Sidebar.tsx` : une fonction de module `moveBetweenRows(event)` posée en `onKeyDown` sur la `ScrollArea` : si la
  touche est un `listMove(…, "vertical")` et que la cible est un `[data-sidebar-row]`, `preventDefault` puis focus sur
  la ligne d'arrivée parmi **toutes** les lignes de la sidebar (toutes sections confondues), sans boucler.

### Barre d'onglets (motif ARIA « tabs », activation **manuelle**)

- `TabBar.tsx` : une fonction de module `moveBetweenTabs(event)` en `onKeyDown` du `tablist` : `listMove(…,
  "horizontal")` sur un `[role=tab]` → `preventDefault` et **focus** de l'onglet d'arrivée (avec bouclage). Elle
  n'active pas : `Entrée` ou `Espace` (déjà gérés par `TabFrame`) ouvrent l'onglet focalisé.

### Aide F1

- `shortcuts.ts` : `export type ListKeyAction = "move" | "open" | "menu" | "rename" | "delete" | "parent" | "tabs"` et
  `LIST_SHORTCUTS` (affichage seulement) : `move` ↑ ↓ Home End, `open` Enter, `menu` ⇧ F10, `rename` F2, `delete`
  Del, `parent` Backspace, `tabs` ← →.
- `ShortcutsDialog` : une 3ᵉ section après celle du terminal, titrée `shortcuts.lists.title`, même présentation.

| Clé `shortcuts.lists.*` | en | fr |
|---|---|---|
| `title` | Lists and files | Listes et fichiers |
| `move` | Move in a list | Se déplacer dans une liste |
| `open` | Connect, or open a file or folder | Se connecter, ou ouvrir un fichier ou un dossier |
| `menu` | Open the menu of the item | Ouvrir le menu de l'élément |
| `rename` | Rename a file | Renommer un fichier |
| `delete` | Delete a file | Supprimer un fichier |
| `parent` | Go to the parent folder | Aller au dossier parent |
| `tabs` | Move between the tabs (tab row focused) | Passer d'un onglet à l'autre (barre d'onglets active) |

## Pièges (vus au prototype)

- **Activation automatique des onglets : non.** Activer un onglet de terminal lui donne le focus (T20) : des flèches
  qui activeraient perdraient le focus dès le premier onglet SSH.
- `onKeyDown` sur un `<div>` sans rôle : Biome le refuse (`noStaticElementInteractions`) ; sur la `ScrollArea`
  (un composant) et sur le `tablist` (un rôle interactif), il passe.
- Le type de l'événement : `React.KeyboardEvent<HTMLElement>` ; `event.target` se teste avec `instanceof
  HTMLElement` avant `matches` ou `getAttribute`.
- Un dialogue modal masque le reste aux requêtes par rôle (voir T33) : sans objet ici, mais à savoir pour tes tests.
- Après la conversion, `Button` et les composants `Tooltip` deviennent inutilisés dans plusieurs fichiers :
  `npx biome check --write` retire les imports morts.

## Tests du contrat

### `src/lib/list-keys.test.ts` (nouveau)

```ts
// T34: which key moves where in a list, and the index it lands on.
import { describe, expect, test } from "vitest";
import { listMove, moveIndex } from "./list-keys";

describe("listMove", () => {
  test("arrows along the list's direction, Home and End; nothing else", () => {
    expect(listMove("ArrowDown", "vertical")).toBe("next");
    expect(listMove("ArrowUp", "vertical")).toBe("previous");
    expect(listMove("ArrowRight", "horizontal")).toBe("next");
    expect(listMove("ArrowLeft", "horizontal")).toBe("previous");
    expect(listMove("Home", "vertical")).toBe("first");
    expect(listMove("End", "horizontal")).toBe("last");
    expect(listMove("ArrowRight", "vertical")).toBeNull();
    expect(listMove("ArrowDown", "horizontal")).toBeNull();
    expect(listMove("Enter", "vertical")).toBeNull();
  });
});

describe("moveIndex", () => {
  test("a list of rows stops at its ends", () => {
    expect(moveIndex("next", 1, 3, false)).toBe(2);
    expect(moveIndex("next", 2, 3, false)).toBe(2);
    expect(moveIndex("previous", 0, 3, false)).toBe(0);
    expect(moveIndex("first", 2, 3, false)).toBe(0);
    expect(moveIndex("last", 0, 3, false)).toBe(2);
  });

  test("the tab row wraps around", () => {
    expect(moveIndex("next", 2, 3, true)).toBe(0);
    expect(moveIndex("previous", 0, 3, true)).toBe(2);
  });

  test("nothing focused yet: next is the first, previous the last; an empty list has no index", () => {
    expect(moveIndex("next", -1, 3, false)).toBe(0);
    expect(moveIndex("previous", -1, 3, true)).toBe(2);
    expect(moveIndex("next", 0, 0, true)).toBe(-1);
  });
});
```

### `e2e/keyboard.spec.ts` (nouveau)

```ts
// T34: the keyboard reaches everything — sidebar rows, the tab row, menus — and every icon button says what it does.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function sidebarRows(page: Page) {
  return page.getByRole("complementary").locator("[data-sidebar-row]");
}

test("arrows, Home and End move from row to row across the sidebar sections", async ({ page }) => {
  const rows = sidebarRows(page);
  await rows.first().focus();
  await page.keyboard.press("ArrowDown");
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(rows.last()).toBeFocused();
  await page.keyboard.press("Home");
  await expect(rows.first()).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(rows.first()).toBeFocused();
});

test("Shift+F10 opens the menu of the focused row, Enter connects", async ({ page }) => {
  const nas = sidebarRows(page).filter({ hasText: /^nas/ }).first();
  await nas.focus();
  await page.keyboard.press("Shift+F10");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem", { name: "Open in SFTP" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);

  await nas.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas");
});

test("Left and Right move along the tab row, wrapping around; Enter opens the tab", async ({
  page,
}) => {
  for (const name of ["nas", "pi-hole"]) {
    await sidebarRows(page)
      .filter({ hasText: new RegExp(`^${name}`) })
      .first()
      .dblclick();
  }
  await page.keyboard.press("Control+,");
  const tab = (name: string) => page.getByRole("tab", { name: new RegExp(name) });
  await tab("Settings").focus();

  await page.keyboard.press("ArrowRight");
  await expect(tab("nas")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tab("Settings")).toBeFocused();
  await page.keyboard.press("Home");
  await expect(tab("nas")).toBeFocused();
  await page.keyboard.press("End");
  await expect(tab("Settings")).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(tab("pi-hole")).toBeFocused();
  // Moving does not open: Settings is still the open tab, until Enter.
  await expect(page.getByRole("tab", { selected: true })).toContainText("Settings");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { selected: true })).toContainText("pi-hole");
});

test("an icon button shows its name in a tooltip when it gets the focus", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  const up = page.getByRole("region", { name: "nas", exact: true }).getByRole("button", {
    name: "Parent folder",
  });
  await up.focus();
  await expect(page.getByRole("tooltip")).toHaveText("Parent folder");
  await expectSaneUi(page);
});

test("F1 lists the keys of lists and files", async ({ page }) => {
  await page.keyboard.press("F1");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Lists and files" })).toBeVisible();
  await expect(dialog).toContainText("Open the menu of the item");
  await expect(dialog).toContainText("Rename a file");
  await expectSaneUi(page);
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T34`.
2. `lib/list-keys.ts` : `npx vitest run src/lib/list-keys.test.ts`.
3. `components/IconButton.tsx`, puis les fichiers à convertir, puis la règle `icon-button` :
   `npm run typecheck`, `npm run check`, `npm run rules`, `npx vitest run src/features`.
4. `ConnectionRow.tsx`, `Sidebar.tsx`, `TabBar.tsx`, `shortcuts.ts`, `ShortcutsDialog.tsx`, `en.json`, `fr.json` :
   `npx playwright test e2e/keyboard.spec.ts e2e/palette.spec.ts e2e/terminal.spec.ts e2e/connections.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, commit
   `feat: named icon buttons, arrow keys in the sidebar and the tab row, list keys in F1 (T34)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T34 --check` affiche `OK` partout.
- [ ] `git grep -n 'size="icon' src/features src/components | grep -v "components/ui\|IconButton.tsx"` ne trouve rien.
- [ ] `npm run rules` connaît la règle `icon-button`.
- [ ] Aucune nouvelle exception `project-rules: allow`.
- [ ] Visuel : l'anneau de focus se voit sur une ligne de la sidebar, un onglet et un bouton icône, en clair et en
      sombre ; les infobulles ne cachent pas le bouton voisin dans la barre d'outils SFTP.

## À regarder par Florian

`npm run tauri dev`, sans souris : Tab jusqu'à la sidebar, flèches, Entrée (connexion), Maj+F10 (menu). Tab jusqu'à
la barre d'onglets, flèches, Entrée. F1 : la section « Listes et fichiers ». Survole les boutons de la barre d'outils
SFTP : chacun dit ce qu'il fait. **WebKitGTK** : vérifie que la touche Menu et Maj+F10 ouvrent bien le menu (le
navigateur des tests est Chromium).
