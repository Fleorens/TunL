# T15b — Dialogue d'import `~/.ssh/config`

| | |
|---|---|
| **Jalon** | M1 — Connexions |
| **Dépend de** | T15 |
| **Lire avant** | `docs/04-ecrans.md` §11, `docs/03-design.md` §7 et §10. Du code de T15, seulement les types générés `src/bindings/ImportCandidate.ts`, `ImportJump.ts`, `ImportPreview.ts` et les deux lignes d'`ipc.ts` |
| **Livrable** | `ImportDialog` ouvert depuis la barre latérale et l'accueil ; 7 tests unitaires, 1 test de composant et 3 scénarios e2e verts |

## Pourquoi

T15 sait lire le fichier et créer les connexions. Il manque l'écran où l'utilisateur voit ce qui va être importé,
décoche ce qu'il ne veut pas, choisit un groupe, et comprend pourquoi une ligne est grisée ou signalée.

## À réutiliser (ne pas réécrire)

- `components/ui` : `Dialog`, `Table`, `Checkbox`, `Select`, `Badge`, `Empty`, `Skeleton`, `Button`, `Tooltip`.
- `describeError` et `notifyError` (`lib/errors.ts`) pour les erreurs ; `useConnections` (groupes) ; `useUi`.
- Le sélecteur de groupe avec sentinelle `"__none__"` : même logique que `GroupSelect` dans
  `editor/GeneralTab.tsx` (lis-le, ne le déplace pas).

## Contrat

### `src/features/shell/ui-store.ts`

Ajouter `importOpen: boolean` (faux au départ), `openImport()` et `closeImport()`.

### `src/features/connections/store.ts`

Ajouter `replaceSnapshot(snapshot: StoreSnapshot): void`, qui remplace `groups` et `connections` d'un coup (comme le
fait déjà `removeGroup`, qu'on fait passer par cette action).

### `src/features/import/selection.ts` (pur)

```ts
/** A candidate with an `error` can never be imported. */
export function isSelectable(candidate: ImportCandidate): boolean;
/** Selected at first: selectable and not already present, in file order. */
export function initialSelection(candidates: readonly ImportCandidate[]): string[];
/** Adds or removes `alias`; returns a new array. */
export function toggleAlias(selection: readonly string[], alias: string): string[];
/** Every selectable alias when at least one is unselected, otherwise none. */
export function toggleAll(candidates: readonly ImportCandidate[], selection: readonly string[]): string[];
/** The jump host as shown in the table: the alias, the existing connection's name, or null (none / unresolved). */
export function jumpLabel(jump: ImportJump | null): string | null;
/** `user@host:port`, without `user@` when there is no user and without `:port` for 22. */
export function candidateAddress(candidate: ImportCandidate): string;
```

### `src/features/import/ImportDialog.tsx`

Monté une fois dans `AppLayout`, à côté de `ConnectionEditor`. Ouvert si `importOpen`.

- `Dialog`, `sm:max-w-5xl`. Titre « Import ~/.ssh/config » ; description = `preview.path`.
- À l'ouverture : `ipc.importSshConfigPreview(null)`, puis `initialSelection`. Le groupe choisi repart à « No group ».
- États :
  - chargement → trois lignes `Skeleton` ;
  - erreur `notFound` → `Empty` « No SSH config found » / « TunL reads ~/.ssh/config. » ;
  - autre erreur → `Empty` avec le texte traduit de `errors.kind.<kind>` et un bouton « Retry » ;
  - aucun candidat → `Empty` « Nothing to import ».
- Tableau (`Table` de shadcn), une ligne par candidat, dans l'ordre :
  - case à cocher, `aria-label` « Select <alias> », désactivée si `!isSelectable` ;
  - **Host** : l'alias (`font-medium`) ;
  - **Address** : `candidateAddress`, en `font-mono` ;
  - **Key** : `keyPath` ou « — » ;
  - **Jump host** : `jumpLabel`, sinon « — » ; pour `unresolved`, une icône d'alerte et le saut, en `text-warning` ;
  - **Notes** : badge « Already present » si `duplicateOf` ; chaque avertissement sur sa ligne, en
    `text-muted-foreground text-xs` ; `error` en `text-destructive text-xs`.
- En-tête : une case « Select all » (`aria-label`), qui applique `toggleAll`.
- Pied :
  - à gauche, « Import into » + `Select` des groupes (« No group », puis les groupes du store) ;
  - à droite, « Cancel » et « Import {{count}} connections » (pluriel i18next), désactivé à 0 ou pendant l'envoi.
- Importer : `ipc.importSshConfigApply(null, selection, groupId)` → `replaceSnapshot`, toast
  « Imported {{count}} connections » (le nombre **créé** : connexions après moins connexions avant), fermeture.
  Échec : `notifyError`, le dialogue reste ouvert.

### Points d'entrée

- Barre latérale : le bouton « Import connections » (aujourd'hui `notifyComingSoon`) → `openImport()`.
- Accueil : le bouton « Import ~/.ssh/config » → `openImport()`.

### Textes (anglais exact ; en français dans `fr.json`)

| Clé | Anglais |
|---|---|
| `import.title` | Import ~/.ssh/config |
| `import.columns.host` / `address` / `key` / `jump` / `notes` | Host / Address / Key / Jump host / Notes |
| `import.selectAll` | Select all |
| `import.select` | Select {{alias}} |
| `import.alreadyPresent` | Already present |
| `import.into` | Import into |
| `import.noGroup` | No group |
| `import.submit_one` / `import.submit_other` | Import {{count}} connection / Import {{count}} connections |
| `import.done_one` / `import.done_other` | Imported {{count}} connection / Imported {{count}} connections |
| `import.notFoundTitle` | No SSH config found |
| `import.notFoundDescription` | TunL reads ~/.ssh/config. |
| `import.empty` | Nothing to import |

### Pièges

- Radix `Checkbox` : `checked` + `onCheckedChange`, pas `onChange`. Une case désactivée se met avec `disabled`.
- `Select` du groupe : sentinelle `"__none__"` pour « No group » (tableau d'`AGENTS.md`).
- Le tableau peut dépasser la hauteur de la fenêtre : `max-h-[60vh] overflow-y-auto` autour du `Table`, pied fixe.

## Tests du contrat

### `src/features/import/selection.test.ts`

```ts
import { describe, expect, test } from "vitest";
import type { ImportCandidate } from "@/bindings/ImportCandidate";
import {
  candidateAddress,
  initialSelection,
  isSelectable,
  jumpLabel,
  toggleAlias,
  toggleAll,
} from "./selection";

function candidate(alias: string, patch: Partial<ImportCandidate> = {}): ImportCandidate {
  return {
    alias,
    host: `${alias}.lan`,
    port: 22,
    username: null,
    keyPath: null,
    jump: null,
    duplicateOf: null,
    warnings: [],
    error: null,
    ...patch,
  };
}

const CANDIDATES = [
  candidate("a"),
  candidate("dup", { duplicateOf: "a1000000-0000-4000-8000-000000000101" }),
  candidate("bad", { error: "host: must be a valid IPv4, IPv6 address or host name" }),
  candidate("b", { warnings: ["ProxyCommand is ignored"] }),
];

describe("import selection", () => {
  test("a candidate with an error is not selectable", () => {
    expect(isSelectable(CANDIDATES[0])).toBe(true);
    expect(isSelectable(CANDIDATES[1])).toBe(true);
    expect(isSelectable(CANDIDATES[2])).toBe(false);
  });

  test("duplicates and errors start unselected, warnings do not matter", () => {
    expect(initialSelection(CANDIDATES)).toEqual(["a", "b"]);
  });

  test("toggleAlias adds and removes without mutating", () => {
    const start = ["a"];
    const added = toggleAlias(start, "dup");
    expect(added).toEqual(["a", "dup"]);
    expect(start).toEqual(["a"]);
    expect(toggleAlias(added, "a")).toEqual(["dup"]);
  });

  test("toggleAll selects every selectable alias, then none", () => {
    const all = toggleAll(CANDIDATES, ["a"]);
    expect([...all].sort()).toEqual(["a", "b", "dup"]);
    expect(toggleAll(CANDIDATES, all)).toEqual([]);
  });

  test("toggleAll with nothing selectable gives nothing", () => {
    expect(toggleAll([CANDIDATES[2]], [])).toEqual([]);
  });

  test("jump labels", () => {
    expect(jumpLabel(null)).toBeNull();
    expect(jumpLabel({ type: "candidate", alias: "jump-box" })).toBe("jump-box");
    expect(
      jumpLabel({ type: "existing", id: "a1000000-0000-4000-8000-000000000104", name: "bastion-01" }),
    ).toBe("bastion-01");
    expect(jumpLabel({ type: "unresolved", hop: "nowhere" })).toBeNull();
  });

  test("addresses leave out what is implicit", () => {
    expect(candidateAddress(candidate("a"))).toBe("a.lan");
    expect(candidateAddress(candidate("a", { username: "ops", port: 2222 }))).toBe("ops@a.lan:2222");
    expect(candidateAddress(candidate("a", { username: "root" }))).toBe("root@a.lan");
  });
});
```

### `src/features/import/ImportDialog.test.tsx`

```tsx
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, test } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useConnections } from "@/features/connections/store";
import { useUi } from "@/features/shell/ui-store";
import { failNextCall, resetMockBackend } from "@/lib/ipc-mock";
import { ImportDialog } from "./ImportDialog";
import "@/i18n";

beforeEach(async () => {
  resetMockBackend();
  await useConnections.getState().load();
});

test("a missing ~/.ssh/config gets a friendly message, not an error toast", async () => {
  failNextCall("import_ssh_config_preview", {
    kind: "notFound",
    message: "ssh config ~/.ssh/config not found",
    detail: null,
  });
  useUi.getState().openImport();
  render(
    <TooltipProvider>
      <ImportDialog />
    </TooltipProvider>,
  );
  expect(await screen.findByText("No SSH config found")).toBeInTheDocument();
  expect(screen.getByText("TunL reads ~/.ssh/config.")).toBeInTheDocument();
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
  await expect(dialog(page).getByText("host: must be a valid IPv4, IPv6 address or host name")).toBeVisible();
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

1. Les tests : `node scripts/contract-tests.mjs T15b`.
2. `selection.ts`, puis `npx vitest run src/features/import`.
3. `ui-store`, `replaceSnapshot`, `ImportDialog`, les points d'entrée, les textes en / fr.
4. `npm run format`, `npm run review`, cases, statut, commit `feat: ~/.ssh/config import dialog (T15b)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T15b --check` affiche `OK` partout.
- [x] `grep -rn "notifyComingSoon" src/features/shell/sidebar/Sidebar.tsx` ne trouve plus le bouton d'import.
- [ ] Visuel : le tableau tient dans le dialogue, les colonnes sont alignées, les avertissements ne cassent pas la hauteur
      des lignes au point de les rendre illisibles.
- [ ] Visuel : une ligne « Already present » est visiblement décochée, une ligne en erreur est grisée.

## À regarder par Florian

Dans `npm run tauri dev`, cliquer « Import connections » en bas de la barre latérale : ton vrai `~/.ssh/config`
s'affiche. Vérifier que les bastions (`ProxyJump`) sont bien reconnus, puis importer une ou deux machines dans un groupe.
