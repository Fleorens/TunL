# T44 — Éditeur de connexion : un seul enregistrement, focus sur le nom, champs resserrés, plusieurs écrans en plein écran

| | |
|---|---|
| **Jalon** | M9 — Revue globale (lot 7) |
| **Dépend de** | T43 |
| **Lire avant** | `docs/03-design.md` § espacements (tokens seulement) ; `docs/04-ecrans.md` § « Éditeur de connexion » |
| **Livrable** | `ConnectionEditor.tsx`, `GeneralTab.tsx` (et les champs partagés de `form-fields.tsx` si besoin), `RdpAdvancedFields.tsx` ; `e2e/editor-save-once.spec.ts` |

## Pourquoi

Revue globale du 2026-10-27 :

1. **Double enregistrement — constaté dans le mock** : un double-clic sur « Enregistrer » d'une nouvelle connexion
   en crée **deux** identiques (le backend n'impose pas de nom unique). `save` est appelé directement par
   `onClick`, pas par `form.handleSubmit` : `formState.isSubmitting` ne passe jamais à `true`, et le bouton reste
   actif pendant l'appel. Même chose avec Ctrl+S tapé deux fois.
2. **Focus — constaté (capture)** : à l'ouverture d'une nouvelle connexion, le focus est sur le bouton « SSH », pas
   sur le champ « Nom ».
3. **Espacements — constaté (capture)** : environ 90 px de vide entre deux champs de l'onglet Général. En
   960 × 600, « Couleur » et « Notes » sont sous le pli, sans indice qu'il faut défiler.
4. **« Plusieurs écrans » — constaté (capture + `rdp/args.rs`)** : l'interrupteur est actif même en « Ajuster à la
   fenêtre » ou « Taille fixe », alors que `build_tunnel_args` n'ajoute `/multimon` qu'en plein écran.

## À réutiliser (ne pas réécrire)

- `useConnections().create` / `update` (retour `Result`), `applySecrets`, `secretsValid`, `FieldError`
  (sa hauteur réservée évite les sauts quand un message apparaît : la garder, mais réduire l'écart propre au champ).
- `SwitchField` (`form-fields.tsx`) : ajouter une prop `disabled` si elle n'existe pas, sans dupliquer le composant.

## Contrat — Frontend

- **Un seul enregistrement à la fois** : un état `saving` (ou `form.handleSubmit(save)`, au choix) bloque `save`
  tant que l'appel précédent n'est pas fini. Le bouton « Enregistrer » est désactivé pendant ce temps, Ctrl+S est
  ignoré. Après un échec (erreur de champ), on peut réenregistrer.
- **Focus** : en création, le champ « Nom » reçoit le focus à l'ouverture. En modification, on ne change rien.
- **Espacements** : un écart vertical régulier entre les champs de l'onglet Général, du même ordre que l'onglet
  Avancé (tokens Tailwind `gap-*` / `space-y-*`, pas de valeur en dur). Le formulaire de création tient sans
  défilement jusqu'à « Couleur » inclus en 1280 × 800.
- **Plusieurs écrans** : `rdpMultimon` est désactivé (`disabled`) quand l'affichage n'est pas « Plein écran ». Sa
  valeur est conservée.

## Pièges

- `form.handleSubmit` appelle `save` seulement si le schéma zod est valide : garder la vérification
  `secretsValid(drafts)` en plus.
- Radix `Sheet` met le focus sur le premier élément focalisable à l'ouverture : utiliser `onOpenAutoFocus` de
  `SheetContent` (avec `event.preventDefault()`) pour viser le champ « Nom », plutôt qu'un `setTimeout`.
- Les champs ne doivent s'afficher qu'après le `reset` (règle « Formulaire react-hook-form » d'`AGENTS.md`) : le
  focus se donne quand `ready` est vrai.

## Tests du contrat

### `e2e/editor-save-once.spec.ts` (nouveau)

```ts
// T44: the editor saves once, opens on the Name field, and offers "Multiple monitors" in full screen only.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function editor(page: Page) {
  return page.getByRole("dialog");
}

test("a double click on Save creates one connection", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await editor(page)
    .getByRole("textbox", { name: /^Name/ })
    .fill("once-01");
  await editor(page)
    .getByRole("textbox", { name: /^Host/ })
    .fill("10.9.9.9");
  await editor(page).getByRole("button", { name: "Save" }).dblclick();
  await expect(editor(page)).toHaveCount(0);
  await expect(
    page.getByRole("complementary").locator("[data-sidebar-row]", { hasText: "once-01" }),
  ).toHaveCount(1);
});

test("a new connection opens on the Name field", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await expect(editor(page).getByRole("textbox", { name: /^Name/ })).toBeFocused();
});

test("Multiple monitors is only offered in full screen", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  await editor(page).getByRole("radio", { name: "RDP", exact: true }).click();
  await editor(page).getByRole("tab", { name: "Advanced" }).click();
  const multimon = editor(page).getByRole("switch", { name: "Multiple monitors" });
  await expect(multimon).toBeDisabled();
  await editor(page).getByRole("radio", { name: "Full screen" }).click();
  await expect(multimon).toBeEnabled();
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T44`.
2. `ConnectionEditor.tsx` (enregistrement unique, focus), puis `GeneralTab.tsx` (espacements), puis
   `RdpAdvancedFields.tsx` / `form-fields.tsx` (interrupteur désactivé).
3. `npx playwright test e2e/editor-save-once.spec.ts e2e/editor.spec.ts e2e/editor-network.spec.ts`.
4. `npm run format`, `npm run review`, cases, statut, commit
   `fix: save a connection once, focus its name, tighter fields, multimon in full screen only (T44)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T44 --check` affiche `OK` partout.
- [ ] Aucune nouvelle exception `project-rules: allow`.
- [ ] Onglet Général : écarts réguliers entre les champs, « Couleur » visible sans défiler en 1280 × 800 (à l'écran).

## À regarder par Florian

`npm run tauri dev` : Ctrl+Maj+N, on tape directement le nom ; l'onglet Général tient dans la fenêtre ; une
connexion RDP, onglet Avancé : « Plusieurs écrans » grisé tant que l'affichage n'est pas « Plein écran ».
