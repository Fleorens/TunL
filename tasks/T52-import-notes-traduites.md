# T52 — Import `~/.ssh/config` : notes et erreurs traduites, avertissements du fichier affichés

| | |
|---|---|
| **Jalon** | M9 — Revue globale (lot 7) |
| **Dépend de** | T51 |
| **Lire avant** | `docs/04-ecrans.md` § « Import ~/.ssh/config » |
| **Livrable** | `src/features/import/import-notes.ts` (nouveau), `ImportTable.tsx`, `ImportDialog.tsx`, `FieldError.tsx` (commentaire), `en.json` / `fr.json` ; `src/features/import/import-notes.test.ts` |

## Pourquoi

Revue globale du 2026-10-27 :

1. **Anglais dans l'interface française — constaté (capture en français)** : la colonne « Notes » de l'import affiche
   le texte brut du backend : « ProxyCommand is ignored », « host: must be a valid IPv4, IPv6 address or host name ».
2. **Avertissements perdus — constaté (lecture)** : `ImportPreview.warnings` (avertissements du fichier entier, par
   exemple « Match blocks are ignored ») n'est affiché nulle part.
3. Le commentaire de `FieldError` affirme que « le backend envoie un texte déjà traduit » : c'est faux, il envoie de
   l'anglais technique (`docs/06` S7).

Le backend ne change pas : ses textes sont figés par les tests de T15 (`ssh_config_tests.rs`, `plan_tests.rs`). La
traduction se fait côté interface, sur une liste fermée de formes connues.

## À réutiliser (ne pas réécrire)

- `i18n` (`@/i18n`), `ImportCandidate`, `ImportPreview` (bindings).

## Contrat — Frontend

`src/features/import/import-notes.ts` exporte deux fonctions pures (elles lisent `i18n.t`) :

- `importNoteText(raw: string): string` — traduit une note d'hôte ou du fichier :

  | Texte du backend | Clé | en | fr |
  |---|---|---|---|
  | `<Option> is ignored` | `import.notes.optionIgnored` | `{{option}} is ignored` | `{{option}} est ignoré` |
  | `only the last ProxyJump hop is used` | `import.notes.lastHopOnly` | `Only the last ProxyJump hop is used` | `Seul le dernier saut de ProxyJump est repris` |
  | `Match blocks are ignored` | `import.notes.matchIgnored` | `Match blocks are ignored` | `Les blocs Match sont ignorés` |
  | `Include nested too deeply: <chemin>` | `import.notes.includeTooDeep` | `Include nested too deeply: {{path}}` | `Include trop imbriqué : {{path}}` |
  | `HostName tokens other than %h are not supported` | `import.notes.hostTokens` | `Only the %h token is supported in HostName` | `Seul le jeton %h est pris en charge dans HostName` |
  | `invalid Port: <valeur>` | `import.notes.invalidPort` | `Invalid port: {{value}}` | `Port invalide : {{value}}` |

  Un texte qui ne correspond à aucune forme est rendu tel quel.
- `importErrorText(raw: string): string` — un refus `champ: raison` devient `import.notes.invalidField` avec le libellé
  du champ (`import.fields.<champ>`) : en `Invalid {{field}}`, fr `{{field}} invalide`. Libellés :
  `name` (en `name`, fr `Nom`), `host` (`host`, `Hôte`), `port` (`port`, `Port`), `username` (`user name`,
  `Utilisateur`), `settings.auth.path` (`key file`, `Fichier de clé`). Un champ inconnu, ou un texte sans `: `, est
  rendu tel quel.
- `ImportTable` : notes et erreur passent par ces fonctions. `ImportDialog` : les avertissements du fichier
  (`preview.warnings`) s'affichent sous le chemin du fichier, en petit et en gris, traduits par `importNoteText`.
- `FieldError.tsx` : corriger le commentaire (le backend envoie de l'anglais technique, affiché tel quel).

## Pièges

- `<Option>` est un seul mot (`ProxyCommand`, `LocalForward`…) : une expression du type `^(\S+) is ignored$`.
- Les clés i18n sont typées : construire la clé à partir d'une liste fermée, jamais d'un texte venu du backend.

## Tests du contrat

### `src/features/import/import-notes.test.ts` (nouveau)

```ts
// T52: the backend's import notes (technical English) are shown translated; anything unknown is shown as it came.
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { i18n } from "@/i18n";
import { importErrorText, importNoteText } from "./import-notes";

beforeAll(async () => {
  await i18n.changeLanguage("fr");
});

afterAll(async () => {
  await i18n.changeLanguage("en");
});

describe("the notes of an imported host, in French", () => {
  test.each([
    ["ProxyCommand is ignored", "ProxyCommand est ignoré"],
    ["only the last ProxyJump hop is used", "Seul le dernier saut de ProxyJump est repris"],
    ["Match blocks are ignored", "Les blocs Match sont ignorés"],
    ["Include nested too deeply: ~/.ssh/conf.d/a", "Include trop imbriqué : ~/.ssh/conf.d/a"],
    [
      "HostName tokens other than %h are not supported",
      "Seul le jeton %h est pris en charge dans HostName",
    ],
    ["invalid Port: 99999", "Port invalide : 99999"],
  ])("%s", (raw, expected) => {
    expect(importNoteText(raw)).toBe(expected);
  });

  test("an unknown note is shown as it came", () => {
    expect(importNoteText("something new")).toBe("something new");
  });
});

describe("the refusal of an imported host, in French", () => {
  test("names the wrong field", () => {
    expect(importErrorText("host: must be a valid IPv4, IPv6 address or host name")).toBe(
      "Hôte invalide",
    );
    expect(importErrorText("settings.auth.path: is too long")).toBe("Fichier de clé invalide");
  });

  test("an unknown field or shape is shown as it came", () => {
    expect(importErrorText("color: is unknown")).toBe("color: is unknown");
    expect(importErrorText("broken")).toBe("broken");
  });
});
```

### `e2e/import.spec.ts`

```ts
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function dialog(page: Page) {
  return page.getByRole("dialog");
}

async function openImport(page: Page) {
  await page.getByRole("button", { name: "Import connections", exact: true }).click();
  await expect(dialog(page).getByRole("heading", { name: "Import ~/.ssh/config" })).toBeVisible();
}

test("importing selected hosts into a group", async ({ page }) => {
  await openImport(page);
  await expect(dialog(page).getByText("Already present")).toBeVisible();
  await expect(dialog(page).getByRole("button", { name: "Import 3 connections" })).toBeEnabled();

  await dialog(page).getByRole("checkbox", { name: "Select legacy" }).click();
  await dialog(page).getByRole("combobox").click();
  await page.getByRole("option", { name: "Homelab", exact: true }).click();
  await dialog(page).getByRole("button", { name: "Import 2 connections" }).click();

  await expect(dialog(page)).toHaveCount(0);
  await expect(page.getByText("Imported 2 connections")).toBeVisible();
  const homelab = page.getByRole("region", { name: "Homelab", exact: true });
  await expect(homelab.getByRole("button", { name: /^staging/ })).toBeVisible();
  await expect(homelab.getByRole("button", { name: /^jump-box/ })).toBeVisible();
});

test("a host with an error cannot be selected", async ({ page }) => {
  await openImport(page);
  await expect(dialog(page).getByRole("checkbox", { name: "Select broken" })).toBeDisabled();
  await expect(dialog(page).getByText("Invalid host")).toBeVisible();
  await expect(dialog(page).getByText("ProxyCommand is ignored")).toBeVisible();
  await expectSaneUi(page);
});

test("select all toggles every selectable host", async ({ page }) => {
  await openImport(page);
  const all = dialog(page).getByRole("checkbox", { name: "Select all" });
  await all.click();
  await expect(dialog(page).getByRole("button", { name: "Import 4 connections" })).toBeEnabled();
  await all.click();
  await expect(dialog(page).getByRole("button", { name: "Import 0 connections" })).toBeDisabled();
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T52`.
2. `import-notes.ts`, `en.json` / `fr.json` : `npx vitest run src/features/import`.
3. `ImportTable.tsx`, `ImportDialog.tsx`, `FieldError.tsx` : `npx playwright test e2e/import.spec.ts`.
4. `npm run format`, `npm run review`, cases, statut, commit
   `fix: translate import notes and refusals, show the file warnings (T52)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T52 --check` affiche `OK` partout.
- [x] Aucune nouvelle exception `project-rules: allow`.
- [ ] En français, le dialogue d'import n'affiche plus d'anglais dans la colonne « Notes » (à l'écran).

## À regarder par Florian

`npm run tauri dev` en français, Importer `~/.ssh/config` sur un fichier qui a un `ProxyCommand` ou un bloc `Match` :
les notes sont en français, et l'avertissement du bloc `Match` apparaît en haut du dialogue.
