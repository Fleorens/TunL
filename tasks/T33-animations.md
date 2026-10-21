# T33 — Animations : le tunnel de connexion, la coche tracée, et « Réduire les animations » partout

| | |
|---|---|
| **Jalon** | M7 — Finitions |
| **Dépend de** | T32 |
| **Lire avant** | `docs/03-design.md` §4 (« Mouvement », en entier) et §10 |
| **Livrable** | `lib/motion.ts` ; `useApplySettings` qui pose la classe `reduce-motion` ; `TunnelAnimation` dans la carte de connexion ; utilitaire `draw-in` et règle `.reduce-motion` dans `index.css` ; 2 fichiers de tests |

## Pourquoi

Trois des quatre animations « signature » de `docs/03-design.md` §4 existent : l'indicateur d'onglet qui glisse, la
pastille qui pulse, les cartes qui se soulèvent au survol. Il manque la plus visible, le **tunnel** de la carte de
connexion (trois carrés arrondis au contour en dégradé de marque, qui grandissent et s'estompent autour de l'icône
du protocole), et la coche qui se **dessine** quand une étape est faite.

Et le réglage « Réduire les animations » (T31) ne tient qu'à moitié : il passe à `<MotionConfig>`, donc aux
composants de motion, mais **rien** côté CSS — le spinner des étapes, la pulsation de la pastille, les transitions,
les animations d'entrée de shadcn continuent. La règle de `docs/03-design.md` §4 : réglage `on`, **ou** réglage
`system` et préférence du système → toutes les durées à 0, les boucles arrêtées.

Prototypé par l'orchestrateur : les tests de cette fiche passent, avec toute la recette.

## À réutiliser (ne pas réécrire)

- `useApplySettings` (`features/settings/use-apply-settings.ts`) et `<MotionConfig>` dans `App.tsx`.
- `useSettings` ; `ProtocolIcon` (`ssh`, `sftp`, `rdp`) ; les variables `--brand-from` / `--brand-to` (le logo s'en
  sert déjà dans un `linearGradient`).
- `ConnectingOverlay` et `StepLine` (`features/sessions/SessionView.tsx`).
- Le modèle de `useResolvedTheme` (`lib/theme.ts`) : `useSyncExternalStore` sur une media query.

## Contrat

### `src/lib/motion.ts` (nouveau)

```ts
export const REDUCE_MOTION_CLASS = "reduce-motion";
/** `on` → oui, `off` → non, `system` (ou réglages pas encore chargés : `undefined`) → la préférence du système. */
export function shouldReduceMotion(setting: ReduceMotion | undefined, systemPrefersReduce: boolean): boolean;
/** Pose ou retire la classe sur <html>. */
export function applyReducedMotion(reduce: boolean): void;
/** `(prefers-reduced-motion: reduce)`, suivie en direct (`useSyncExternalStore`, `false` côté serveur). */
export function useSystemPrefersReducedMotion(): boolean;
/** `shouldReduceMotion(setting, useSystemPrefersReducedMotion())`. */
export function useReducedMotionNow(setting: ReduceMotion | undefined): boolean;
```

### `useApplySettings`

- `AppliedMotion` devient `"always" | "never"` ; `reduceMotionToMotion` disparaît.
- `const reduce = useReducedMotionNow(settings?.reduceMotion)` ; un effet `applyReducedMotion(reduce)` dépendant de
  `[reduce]` ; la fonction renvoie `reduce ? "always" : "never"`.
- Mettre à jour son commentaire (animations : la classe pour le CSS, la valeur pour motion).

### `src/index.css`

- Un utilitaire `draw-in` : sur les `path` et `polyline` de l'icône, `stroke-dasharray: 24`,
  `stroke-dashoffset: 24`, `animation: tunl-draw 150ms var(--ease-out-soft) forwards` ; `@keyframes tunl-draw`
  (`to { stroke-dashoffset: 0 }`).
- Une règle **hors couche** (comme `.theme-switching`) :
  `.reduce-motion *, .reduce-motion *::before, .reduce-motion *::after` → `animation-duration: 0s`,
  `animation-delay: 0s`, `animation-iteration-count: 1`, `transition-duration: 0s`, `transition-delay: 0s`,
  `scroll-behavior: auto`. Hors couche, elle l'emporte sur les utilitaires Tailwind (qui vivent dans une couche)
  **sans** `!important` (Biome le refuse : `noImportantStyles`).

### `src/features/sessions/TunnelAnimation.tsx` (nouveau)

`TunnelAnimation({ protocol }: { protocol: Protocol })` :
- un conteneur `relative mx-auto flex size-24 items-center justify-center`, `aria-hidden="true"`, avec
  `data-tunnel` et `data-animated="true" | "false"` ;
- un `<svg viewBox="0 0 96 96" aria-hidden="true">` en `absolute inset-0`, avec un `linearGradient` (id unique :
  `useId()`) de `var(--brand-from)` à `var(--brand-to)`, et **trois** `rect` (`x=20 y=20 width=56 height=56 rx=14`,
  contour `url(#id)`, épaisseur 1,5) ;
- animé (`motion.rect`) : `initial={{ scale: 0.6, opacity: 0.8 }}`, `animate={{ scale: 1.4, opacity: 0 }}`,
  `transition={{ duration: 1.2, delay, repeat: Infinity, ease: "easeOut" }}` avec `delay` = 0, 0,4 et 0,8 s,
  `style={{ transformOrigin: "48px 48px" }}` ;
- immobile quand `useReducedMotionNow(settings?.reduceMotion)` : des `rect` simples, mis à l'échelle et estompés de
  façon fixe (de l'intérieur vers l'extérieur), et `data-animated="false"` ;
- au centre, `<ProtocolIcon protocol={protocol} className="relative size-6" />`.

### `SessionView.tsx`

- `ConnectingOverlay` : `<TunnelAnimation protocol={session.kind} />` en haut de la carte, puis le titre (`mt-3`).
- `StepLine` : la coche d'une étape faite devient `<Check className="size-4 draw-in" />`.

## Pièges (vus au prototype)

- `<MotionConfig reducedMotion="always">` fait écrire à motion, **en développement seulement**, l'avertissement
  « You have Reduced Motion enabled on your device… » à chaque élément animé. La garde console des e2e
  (`e2e/support/test.ts`) le laisse passer : l'orchestrateur l'a ajouté à sa liste `EXPECTED_WARNINGS`. N'ajoute
  aucun autre motif.
- motion réduit les transformations, mais une boucle d'**opacité** continuerait : c'est pourquoi `TunnelAnimation`
  rend des `rect` immobiles au lieu de compter sur `MotionConfig`.
- L'icône SSH (`SquareTerminal`) contient elle-même un `rect` : dans un test, vise les anneaux par
  `svg[viewBox='0 0 96 96'] > rect`.
- Un dialogue modal (la question de clé d'hôte) masque le reste de la page aux requêtes par rôle : la pastille de
  l'onglet se vise en CSS (`[role=tab] .animate-tunl-pulse`).
- Avec la règle `.reduce-motion`, une boucle s'arrête **à sa fin** : l'anneau de la pastille (qui finit transparent)
  disparaît, la pastille elle-même reste. C'est l'« anneau statique » attendu.

## Tests du contrat

### `src/lib/motion.test.ts` (nouveau)

```ts
// T33: when the app reduces motion, and the class that tells the CSS.
import { afterEach, describe, expect, test } from "vitest";
import { applyReducedMotion, REDUCE_MOTION_CLASS, shouldReduceMotion } from "./motion";

afterEach(() => {
  document.documentElement.classList.remove(REDUCE_MOTION_CLASS);
});

describe("shouldReduceMotion", () => {
  test("on always, off never, system (or not loaded yet) as the system says", () => {
    expect(shouldReduceMotion("on", false)).toBe(true);
    expect(shouldReduceMotion("off", true)).toBe(false);
    expect(shouldReduceMotion("system", true)).toBe(true);
    expect(shouldReduceMotion("system", false)).toBe(false);
    expect(shouldReduceMotion(undefined, true)).toBe(true);
    expect(shouldReduceMotion(undefined, false)).toBe(false);
  });
});

describe("applyReducedMotion", () => {
  test("puts the class on <html> and takes it off", () => {
    applyReducedMotion(true);
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(true);
    applyReducedMotion(false);
    expect(document.documentElement.classList.contains("reduce-motion")).toBe(false);
  });
});
```

### `e2e/motion.spec.ts` (nouveau)

```ts
// T33: the tunnel of the connecting card, and "Reduce animations" (setting or system) stopping every loop.
// Mock: db-prod waits on its host-key prompt, so its tab stays "connecting".
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

async function connectDbProd(page: Page) {
  await page
    .getByRole("button", { name: /^db-prod/ })
    .first()
    .dblclick();
  await expect(page.getByRole("alertdialog")).toBeVisible();
}

async function setReduceMotion(page: Page, option: "System" | "On" | "Off") {
  await page.keyboard.press("Control+,");
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings.getByRole("combobox", { name: "Reduce animations" }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

/** The pulsing ring of the connecting tab's dot (the open prompt hides the tabs from role queries). */
function pulse(page: Page) {
  return page.locator("[role=tab] .animate-tunl-pulse");
}

test("the connecting card shows the tunnel around the protocol icon", async ({ page }) => {
  await page.goto("/");
  await connectDbProd(page);
  const tunnel = page
    .getByRole("region", { name: "db-prod", exact: true })
    .locator("[data-tunnel]");
  await expect(tunnel).toBeVisible();
  await expect(tunnel).toHaveAttribute("data-animated", "true");
  await expect(tunnel.locator("svg[viewBox='0 0 96 96'] > rect")).toHaveCount(3);
  await expect(pulse(page)).toHaveCSS("animation-iteration-count", "infinite");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expectSaneUi(page);
});

test("Reduce animations: On stops the tunnel and the status pulse", async ({ page }) => {
  await page.goto("/");
  await setReduceMotion(page, "On");
  await expect(page.locator("html")).toHaveClass(/\breduce-motion\b/);
  await connectDbProd(page);
  await expect(page.locator("[data-tunnel]")).toHaveAttribute("data-animated", "false");
  await expect(pulse(page)).toHaveCSS("animation-iteration-count", "1");
});

test("System follows the desktop; Off animates even when the desktop asks for less", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expect(page.locator("html")).toHaveClass(/\breduce-motion\b/);

  await setReduceMotion(page, "Off");
  await expect(page.locator("html")).not.toHaveClass(/\breduce-motion\b/);
  await connectDbProd(page);
  await expect(page.locator("[data-tunnel]")).toHaveAttribute("data-animated", "true");
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T33`.
2. `lib/motion.ts` : `npx vitest run src/lib/motion.test.ts`.
3. `use-apply-settings.ts`, `index.css` : `npm run typecheck`, `npm run check`.
4. `TunnelAnimation.tsx`, `SessionView.tsx` : `npx playwright test e2e/motion.spec.ts e2e/sessions.spec.ts
   e2e/prompts.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, commit
   `feat: tunnel animation while connecting, reduce motion for every animation (T33)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T33 --check` affiche `OK` partout.
- [x] `grep -n "important" src/index.css` ne trouve que le commentaire de `.theme-switching`.
- [x] Aucune nouvelle exception `project-rules: allow`.
- [ ] Visuel : le tunnel est centré au-dessus du titre de la carte, ses anneaux ne sont pas coupés en grandissant,
      lisible en clair et en sombre ; la coche se dessine au lieu d'apparaître.

## À regarder par Florian

`npm run tauri dev`, une connexion qui demande un mot de passe (la carte reste affichée) : le tunnel s'anime autour de
l'icône. Paramètres › Apparence › Réduire les animations : « Activé » → la carte et la pastille ne bougent plus ;
« Système » suit le réglage d'accessibilité de Plasma (Effets de bureau › Animations).
