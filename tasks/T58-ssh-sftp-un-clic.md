# T58 — SSH ↔ SFTP en un clic

| | |
|---|---|
| **Jalon** | M10 — Nouvelles fonctions (lot 8) |
| **Dépend de** | T57b |
| **Lire avant** | `docs/10-fonctions-a-venir.md` § « SSH ↔ SFTP en un clic » ; `docs/04-ecrans.md` § 1 (TabBar), § 4, § 6 |
| **Livrable** | `src/features/sessions/shell-quote.ts` (nouveau), `sessions/store.ts`, `features/shell/TabMenu.tsx` (nouveau), `TabBar.tsx`, `SftpToolbar.tsx`, `SftpExplorer.tsx`, `CommandPalette.tsx`, `en.json` / `fr.json` ; `src/features/sessions/shell-quote.test.ts`, `e2e/ssh-sftp-switch.spec.ts` |

## Pourquoi

Passer du terminal aux fichiers du même serveur demande de retrouver la connexion dans la barre latérale ; passer d'un
dossier SFTP à un terminal ouvre le shell dans le dossier personnel, et il faut retaper le chemin.

## À réutiliser (ne pas réécrire)

- `useSessions().open(target, name, kind)` : un onglet sur la même cible (`session.target`), **une nouvelle
  connexion** à chaque fois (`docs/10` : pas de multiplexage).
- `getSessionPort(id).port.write(data)` : écrit dans le shell de l'attempt en cours (`session-ports.ts`).
- `quickTitle` (`session-model.ts`), le nom d'une connexion enregistrée (`useConnections`).
- `normalizeForSearch` (`connections/filter.ts`) pour filtrer la ligne de palette comme les actions.
- Les composants `context-menu` de shadcn.

## Contrat

### `shell-quote.ts` (pur)

```ts
/** `value` between single quotes, a quote inside written `'\''`: safe in sh, bash, zsh and fish. */
export function shellQuote(value: string): string;
/** The line typed into a new shell to go to `dir`: `cd '<dir>'` then Enter (`\r`). */
export function cdCommand(dir: string): string;
```

### Store des sessions

- `open(target, name, kind = "ssh", options?: { dir?: string })`. Avec `dir` et `kind === "ssh"`, le dossier est
  retenu **hors** de l'objet `Session` (le contrat de `session-model.test.ts` fixe sa forme exacte) : un champ
  `startDirs: Record<string, string>` du store, par id d'onglet, retiré à la fermeture.
- À chaque `connected` d'un onglet SSH qui a un dossier retenu, `cdCommand(dir)` part par le port de l'onglet. Une
  reconnexion revient donc dans le même dossier.
- Le titre d'un onglet ouvert « à côté » : le nom de la connexion enregistrée, ou `quickTitle(target)` pour une cible
  rapide (puis `uniqueTitle` ajoute ` (2)`, comme toujours).

### Interface

- **Menu d'onglet** (`TabMenu.tsx`, clic droit sur un onglet de session) : « Ouvrir en SFTP » (`tabMenu.openSftp`,
  onglets SSH seulement), séparateur, « Fermer l'onglet » (`tabMenu.close`, `requestClose`, donc avec la confirmation
  habituelle). L'onglet Paramètres n'a pas de menu. T59 complètera ce menu.
- **Palette** (mode « tout ») : quand l'onglet actif est un onglet SSH, un groupe « Onglet actif »
  (`palette.groups.tab`) propose « Ouvrir en SFTP », filtré par la recherche comme les actions. Il n'entre **pas**
  dans `PALETTE_ACTIONS` (le contrat de `palette-model.test.ts` fixe cette liste). Ordre des groupes : Connexions,
  Onglet actif, Connexion rapide, Actions ; la ligne mise en surbrillance d'office (`firstValue`) suit cet ordre, pour
  qu'Entrée choisisse la première ligne affichée (T51).
- **SFTP** : bouton « Ouvrir un terminal ici » (`sftp.openTerminal`, icône `SquareTerminal`) dans la barre d'outils,
  qui ouvre un onglet SSH sur la même cible avec `dir` = le dossier affiché.

| Clé | en | fr |
|---|---|---|
| `tabMenu.openSftp` | Open in SFTP | Ouvrir en SFTP |
| `tabMenu.close` | Close tab | Fermer l'onglet |
| `palette.groups.tab` | Current tab | Onglet actif |
| `sftp.openTerminal` | Open a terminal here | Ouvrir un terminal ici |

## Pièges

- `TabFrame` devient l'enfant d'un `ContextMenuTrigger asChild` : il doit accepter `ComponentProps<"div">` et
  propager le reste (`{...props}`), sinon le menu ne s'ouvre jamais (piège d'`AGENTS.md`). Ses propres `onClick` /
  `onKeyDown` se combinent avec ceux reçus.
- Le chemin vient du serveur : il ne passe dans le shell **que** par `shellQuote`. Jamais de concaténation brute
  (un nom de dossier `x'; rm -rf ~; '` doit rester un nom).
- Le `cd` part sur `connected`, pas à l'ouverture : avant, il n'y a pas de shell.
- `store.ts` fait 232 lignes ; T59 y ajoutera du code : rester sobre.

## Tests du contrat

### `src/features/sessions/shell-quote.test.ts`

```ts
// T58: a folder path reaches a new shell only quoted, whatever it contains.
import { describe, expect, test } from "vitest";
import { cdCommand, shellQuote } from "./shell-quote";

describe("shell quoting", () => {
  test("a plain path is put between single quotes", () => {
    expect(shellQuote("/var/www/html")).toBe("'/var/www/html'");
    expect(shellQuote("/srv/my files")).toBe("'/srv/my files'");
  });

  test("a single quote is closed, escaped, then reopened", () => {
    expect(shellQuote("/home/o'neil")).toBe("'/home/o'\\''neil'");
    expect(shellQuote("x'; rm -rf ~; '")).toBe("'x'\\''; rm -rf ~; '\\'''");
  });

  test("$, backquotes and newlines stay literal inside the quotes", () => {
    expect(shellQuote("/tmp/$HOME/`id`")).toBe("'/tmp/$HOME/`id`'");
    expect(shellQuote("/tmp/a\nb")).toBe("'/tmp/a\nb'");
  });

  test("cd goes to the folder, then Enter", () => {
    expect(cdCommand("/var/www")).toBe("cd '/var/www'\r");
  });
});
```

### `e2e/ssh-sftp-switch.spec.ts`

```ts
// T58: a terminal tab opens its server in SFTP, and an SFTP folder opens a terminal already in it.
// Mock: nas's user is admin, its home holds projects; the mock shell echoes what it receives.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function region(page: Page, name: string) {
  return page.getByRole("region", { name, exact: true });
}

async function openTerminal(page: Page) {
  await page.getByRole("button", { name: /^nas/ }).first().dblclick();
  await expect(region(page, "nas").locator(".xterm-rows")).toContainText("Welcome to nas");
}

test("the menu of a terminal tab opens the same server in SFTP", async ({ page }) => {
  await openTerminal(page);
  await page.getByRole("tab", { name: /nas/ }).click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();

  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas (2)");
  await expect(
    region(page, "nas (2)").getByRole("table", { name: "Files" }).locator("tbody tr").first(),
  ).toContainText("projects");
});

test("the palette offers Open in SFTP for the active terminal tab", async ({ page }) => {
  await openTerminal(page);
  await page.keyboard.press("Control+Shift+P");
  const palette = page.getByRole("dialog");
  await palette.getByRole("combobox").fill("sftp");
  await expect(palette.locator("[cmdk-group-heading]").filter({ hasText: /^Current tab$/ })).toHaveCount(1);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas (2)");
});

test("Open a terminal here starts the shell in the folder shown", async ({ page }) => {
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  const files = region(page, "nas").getByRole("table", { name: "Files" });
  await files
    .locator("tbody tr td:first-child")
    .filter({ hasText: /^projects$/ })
    .dblclick();
  await expect(files.locator("tbody tr").first()).toContainText("app");

  await region(page, "nas").getByRole("button", { name: "Open a terminal here" }).click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("nas (2)");
  await expect(region(page, "nas (2)").locator(".xterm-rows")).toContainText(
    "cd '/home/admin/projects'",
  );
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T58`.
2. `shell-quote.ts`, `store.ts` : `npx vitest run src/features/sessions`.
3. `TabMenu.tsx`, `TabBar.tsx`, `SftpToolbar.tsx`, `SftpExplorer.tsx`, `CommandPalette.tsx`, textes :
   `npx playwright test e2e/ssh-sftp-switch.spec.ts e2e/shell.spec.ts e2e/palette.spec.ts e2e/palette-groups.spec.ts`.
4. `npm run format`, `npm run review`, cases, statut, commit
   `feat: open a terminal tab in SFTP, and a terminal in the SFTP folder shown (T58)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T58 --check` affiche `OK` partout.
- [x] `grep -rn "cd '" src --include=*.ts --include=*.tsx` ne trouve que `shell-quote.ts` et son test.
- [x] Aucune nouvelle exception `project-rules: allow`.
- [ ] Le bouton « Ouvrir un terminal ici » est aligné avec les autres boutons de la barre SFTP (à l'écran).

## À regarder par Florian

`npm run tauri dev` : clic droit sur un onglet SSH, « Ouvrir en SFTP ». Dans un onglet SFTP, descends dans un dossier,
puis « Ouvrir un terminal ici » : le shell démarre dans ce dossier, avec bash comme avec fish.
