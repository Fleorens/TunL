# T43 — Barre latérale : la liste défile seule, Récents toujours affichés, groupes repliés conservés

| | |
|---|---|
| **Jalon** | M9 — Revue globale (lot 7) |
| **Dépend de** | T34 |
| **Lire avant** | `docs/04-ecrans.md` § « Sidebar » ; `docs/03-design.md` (tokens seulement) |
| **Livrable** | `Sidebar.tsx`, `GroupSection.tsx`, `AppLayout.tsx`, `en.json` / `fr.json` ; `e2e/sidebar-scroll.spec.ts` |

## Pourquoi

Revue globale du 2026-10-27 (captures du mock, Playwright, 1280 × 800). Trois défauts **constatés** :

1. **La liste ne défile pas d'elle-même.** Le `ScrollArea` de la sidebar prend la hauteur de son contenu
   (viewport 868 px pour un contenu de 868 px) et l'`aside` (968 px) déborde de son panneau (724 px). La molette
   fait défiler **tout le panneau** : le champ « Filtrer… » sort par le haut, et le pied (nombre de connexions,
   bouton « Importer des connexions ») reste sous la fenêtre tant qu'on n'est pas tout en bas.
2. **Ouvrir le premier onglet fait sauter la liste.** `AppLayout` passe `showRecents={activeId !== null}` : la
   section « Récents » (5 lignes) apparaît en haut dès qu'un onglet s'ouvre et disparaît quand le dernier se ferme.
   Toutes les lignes descendent d'environ 200 px sous le curseur, juste après le double-clic.
3. **Un groupe replié se rouvre** dès qu'on tape dans le filtre puis qu'on l'efface : `GroupSection` garde son état
   dans un `useState(true)`, et les sections sont démontées pendant le filtre.

## À réutiliser (ne pas réécrire)

- `ScrollArea` (`src/components/ui/scroll-area.tsx`, ne pas le modifier), `SectionHeader`, `buildSidebarSections`,
  `RECENTS_LIMIT` (5).
- `Collapsible` de `GroupSection` : seul l'endroit où vit l'état `open` change.

## Contrat — Frontend

- **Défilement** : l'`aside` occupe exactement la hauteur de son panneau (`h-full min-h-0`), le `ScrollArea` prend
  le reste (`min-h-0 flex-1`). Seule la liste défile ; le champ de filtre et le pied restent visibles en permanence.
- **Récents** : la section « Récents » est affichée **tout le temps** dans la sidebar (comme « Favoris », déjà
  présent aussi sur l'accueil), conformément à `docs/04` § Sidebar. Supprimer la prop `showRecents` de `Sidebar` et
  son calcul dans `AppLayout`.
  - Le nom accessible de cette section devient `t("sidebar.recentsRegion")` : en « Recent connections »,
    fr « Connexions récentes ». Le titre visible reste `t("sidebar.recents")`. Raison : l'accueil a déjà une région
    nommée « Recent », et `e2e/home.spec.ts` la cherche avec `exact: true`.
- **Groupes repliés** : l'ensemble des groupes repliés vit dans `Sidebar` (un `Set` d'identifiants, remplacé à chaque
  changement, jamais muté). `GroupSection` reçoit `open` et `onOpenChange`. L'état survit au filtre ; il n'a pas à
  survivre à un redémarrage de l'app.

## Pièges

- `ScrollArea` de shadcn : c'est le **viewport** interne qui défile. Sans `min-h-0` sur l'élément `flex-1`, un flex
  item ne rétrécit jamais sous la taille de son contenu.
- Ne pas mettre `overflow-hidden` sur le panneau de `react-resizable-panels` pour « cacher » le problème : le pied
  resterait hors de la fenêtre.
- Les tests du contrat existants trouvent les lignes avec `.first()` ou dans une région nommée : une connexion qui
  apparaît à la fois dans Récents et dans son groupe ne les gêne pas. Si un test existant échoue malgré tout,
  arrête-toi et signale-le.

## Tests du contrat

### `e2e/sidebar-scroll.spec.ts` (nouveau)

```ts
// T43: the sidebar list scrolls on its own (the filter and the footer stay put), opening a tab moves no row,
// and a folded group stays folded after a search.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function sidebar(page: Page) {
  return page.getByRole("complementary");
}

function filter(page: Page) {
  return sidebar(page).getByRole("textbox", { name: "Filter connections…" });
}

async function openTab(page: Page, name: string) {
  await sidebar(page)
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .dblclick();
  await expect(page.getByRole("tab", { selected: true })).toContainText(name);
}

test("with a tab open, the footer is in view and the wheel scrolls the list only", async ({
  page,
}) => {
  await openTab(page, "web-02");
  const importButton = sidebar(page).getByRole("button", { name: "Import connections" });
  await expect(importButton).toBeInViewport();

  await sidebar(page)
    .getByRole("button", { name: /^nas/ })
    .first()
    .hover();
  await page.mouse.wheel(0, 2000);
  await expect(filter(page)).toBeInViewport();
  await expect(importButton).toBeInViewport();
  await expect(
    sidebar(page)
      .getByRole("button", { name: /^router/ })
      .first(),
  ).toBeInViewport();
  await expectSaneUi(page);
});

test("opening the first tab does not move the groups", async ({ page }) => {
  const production = sidebar(page).getByRole("button", { name: /^Production/ });
  const before = await production.boundingBox();
  await openTab(page, "web-02");
  const after = await production.boundingBox();
  expect(after?.y).toBe(before?.y);
});

test("the recent connections are listed in the sidebar from the start", async ({ page }) => {
  const recents = sidebar(page).getByRole("region", { name: "Recent connections" });
  await expect(recents.getByRole("button", { name: /^web-01/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Recent", exact: true })).toHaveCount(1);
});

test("a folded group stays folded after a search", async ({ page }) => {
  const production = sidebar(page).getByRole("button", { name: /^Production/ });
  await production.click();
  await expect(production).toHaveAttribute("aria-expanded", "false");
  await filter(page).fill("web");
  await filter(page).fill("");
  await expect(production).toHaveAttribute("aria-expanded", "false");
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T43`.
2. `GroupSection.tsx` (props `open` / `onOpenChange`), puis `Sidebar.tsx` (hauteur, `Set` des groupes repliés,
   Récents toujours là, `aria-label` de la section), puis `AppLayout.tsx`.
3. `en.json` et `fr.json` : `sidebar.recentsRegion`.
4. `npx playwright test e2e/sidebar-scroll.spec.ts e2e/home.spec.ts e2e/connections.spec.ts e2e/keyboard.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, commit
   `fix: sidebar list scrolls on its own, recents always shown, folded groups kept (T43)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T43 --check` affiche `OK` partout.
- [ ] `grep -rn "showRecents" src` ne trouve plus rien.
- [ ] Aucune nouvelle exception `project-rules: allow`.
- [ ] La barre de défilement de la liste est visible au survol quand la liste dépasse (à l'écran).

## À regarder par Florian

`npm run tauri dev`, fenêtre à sa taille minimale (960 × 600) :
- la molette sur la liste : le champ « Filtrer… » et le pied (« N connexions », bouton Importer) ne bougent pas ;
- double-clic sur une connexion de l'accueil : aucune ligne ne saute ;
- replie un groupe, tape un filtre puis efface-le : le groupe reste replié.
