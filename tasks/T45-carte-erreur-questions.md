# T45 — Sessions : carte d'erreur explicite, questions retirées en fin de tentative, « Modifier » sur la carte RDP

| | |
|---|---|
| **Jalon** | M9 — Revue globale (lot 7) |
| **Dépend de** | T44 |
| **Lire avant** | `docs/04-ecrans.md` § « Onglet de session » (états connexion / erreur) |
| **Livrable** | `SessionView.tsx`, `sessions/store.ts`, `RdpCard.tsx`, `en.json` / `fr.json` ; `src/features/sessions/prompts-cleanup.test.ts`, `e2e/session-error-card.spec.ts` |

## Pourquoi

Revue globale du 2026-10-27 :

1. **Carte d'erreur muette — constaté (capture)** : une connexion qui échoue affiche « Échec de la connexion » et un
   bouton « Détails ». On ne sait ni **quelle étape** a échoué (le bastion ? la cible ? la clé d'hôte ?), ni quoi
   faire. Le détail est le message technique anglais du backend. La carte n'a pas non plus de bouton pour fermer
   l'onglet : `SessionErrorCard` reçoit `onClose` mais ne s'en sert pas.
2. **Question restée affichée — supposé (lecture du code)** : le backend abandonne une question après 5 minutes
   (`PROMPT_TIMEOUT`, `prompts.rs`). L'onglet passe alors en erreur « Annulé », mais le dialogue (mot de passe,
   clé d'hôte…) reste à l'écran. La réponse tapée ensuite part dans le vide (`answerPrompt` ignore le `notFound`).
   Seule la fermeture de l'onglet retire ses questions (`close` → `dropSession`).
3. **Carte RDP — constaté (capture)** : quand FreeRDP refuse l'utilisateur ou le mot de passe (code 134), la carte
   propose « Fermer l'onglet » et « Relancer », mais pas « Modifier la connexion », que la carte SSH propose.

## À réutiliser (ne pas réécrire)

- `StepLine` et `stepKey` (`SessionView.tsx`, `session-model.ts`) : la carte d'erreur réutilise la même ligne
  d'étape que la carte de connexion.
- `usePrompts().dropSession(sessionId)`, `useUi().openEditor({ mode: "edit", id })`, `describeError`.

## Contrat — Frontend

- **Carte d'erreur** (`SessionErrorCard`, hors clé d'hôte changée qui garde sa carte) :
  - sous le titre, la liste des étapes de la tentative (`session.steps`, mêmes lignes que pendant la connexion :
    l'étape échouée a sa croix rouge) ;
  - une phrase d'aide traduite quand le type d'erreur en a une : clé `sessions.error.hints.<kind>`, pour ces types :

    | kind | en | fr |
    |---|---|---|
    | `network` | Check the host name, the port and your network. | Vérifiez le nom d'hôte, le port et votre réseau. |
    | `timeout` | The server did not answer in time. Is it on, and is the port right? | Le serveur n'a pas répondu à temps. Est-il allumé, et le port est-il le bon ? |
    | `auth` | Check the user name and the password or key. | Vérifiez le nom d'utilisateur et le mot de passe ou la clé. |
    | `cancelled` | The connection was stopped before its end. | La connexion a été interrompue avant la fin. |

  - « Détails » garde le message technique ;
  - boutons : « Fermer l'onglet » (`sessions.error.close` : en « Close tab », fr « Fermer l'onglet », même flux que
    le × de l'onglet), « Modifier la connexion » (si elle existe encore), « Réessayer ».
- **Questions** : dans `start()` (`sessions/store.ts`), quand un événement fait passer la tentative en `error` ou en
  `closed`, retirer toutes les questions de ce `runId` (`dropSession`). Aucun autre événement n'y touche.
- **Carte RDP** : quand la session est terminée et que la connexion existe encore, un bouton « Modifier la
  connexion » (`sessions.error.edit`) ouvre l'éditeur sur elle.

## Pièges

- La carte d'erreur est en `absolute inset-0` au-dessus du terminal : la liste des étapes ne doit pas la faire
  déborder (`max-h` + défilement si plus de 6 lignes).
- `dropSession` reçoit le `runId` (l'identifiant de la tentative), pas l'identifiant de l'onglet : après une
  reconnexion, ce n'est plus le même.
- Les clés i18n sont typées : ajoute les quatre `hints` dans `en.json` **et** `fr.json`, et lis-les avec une clé
  construite à partir d'une liste fermée de types (pas `t(\`…${error.kind}\`)` sur un type sans clé).

## Tests du contrat

### `src/features/sessions/prompts-cleanup.test.ts` (nouveau)

```ts
// T45: a tab's pending questions go away when its attempt fails or ends, not only when the tab closes.
import { afterEach, describe, expect, test, vi } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import { usePrompts } from "@/features/prompts/store";
import { ipc } from "@/lib/ipc";
import { useSessions } from "./store";

afterEach(() => {
  vi.restoreAllMocks();
  useSessions.setState({ sessions: [], activeId: null, closing: null });
  usePrompts.setState({ queue: [] });
});

/** Open a quick tab whose backend never answers, and return the way to send it events. */
function openTab(): { id: string; emit: (event: SessionEvent) => void } {
  const handlers: Array<(event: SessionEvent) => void> = [];
  vi.spyOn(ipc, "sshOpen").mockImplementation((_id, _target, _size, callbacks) => {
    handlers.push(callbacks.onEvent);
    return Promise.resolve();
  });
  const id = useSessions
    .getState()
    .open({ type: "quick", host: "10.0.0.1", port: 22, username: null }, "quick");
  const emit = (event: SessionEvent): void => {
    for (const handler of handlers) handler(event);
  };
  return { id, emit };
}

function ask(sessionId: string): void {
  usePrompts.getState().push({
    id: crypto.randomUUID(),
    sessionId,
    prompt: {
      kind: "password",
      connectionName: "quick",
      username: "root",
      host: "10.0.0.1",
      canSave: false,
      retry: false,
    },
  });
}

describe("the pending questions of a tab", () => {
  test.each<SessionEvent>([
    { type: "error", error: { kind: "cancelled", message: "prompt timed out", detail: null } },
    { type: "closed", reason: "remoteClosed", exitStatus: null },
  ])("go away when its attempt ends ($type)", (event) => {
    const tab = openTab();
    ask(tab.id);
    ask("another-session");
    tab.emit(event);
    expect(usePrompts.getState().queue.map((request) => request.sessionId)).toEqual([
      "another-session",
    ]);
  });

  test("stay while the attempt goes on", () => {
    const tab = openTab();
    ask(tab.id);
    tab.emit({ type: "step", step: "auth", label: "root", state: "started" });
    expect(usePrompts.getState().queue).toHaveLength(1);
  });
});
```

### `e2e/session-error-card.spec.ts` (nouveau)

```ts
// T45: the error card says which step failed and how to fix it, and can close its tab; an ended RDP session
// offers to edit its connection.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("a failed attempt shows the failed step and a hint, and Close tab closes it", async ({
  page,
}) => {
  await page.keyboard.press("Control+Shift+T");
  await page.keyboard.type("unreachable.test");
  await page.keyboard.press("Enter");
  const card = page.getByRole("alert").filter({ hasText: "Connection failed" });
  await expect(card).toContainText("Connecting to unreachable.test:22");
  await expect(card).toContainText("Check the host name, the port and your network.");
  await expectSaneUi(page);
  await card.getByRole("button", { name: "Close tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("an ended RDP session offers to edit its connection", async ({ page }) => {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^win-desktop/ })
    .first()
    .dblclick();
  const card = page.getByRole("region", { name: "Remote desktop win-desktop" });
  await expect(card).toContainText("code 134");
  await card.getByRole("button", { name: "Edit connection" }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Edit win-desktop" }),
  ).toBeVisible();
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T45`.
2. `sessions/store.ts` (questions retirées) : `npx vitest run src/features/sessions`.
3. `SessionView.tsx` (carte d'erreur), `RdpCard.tsx`, `en.json` / `fr.json`.
4. `npx playwright test e2e/session-error-card.spec.ts e2e/sessions.spec.ts e2e/prompts.spec.ts e2e/rdp.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, commit
   `fix: explicit error card, prompts dropped when an attempt ends, edit from the RDP card (T45)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T45 --check` affiche `OK` partout.
- [x] Aucune nouvelle exception `project-rules: allow`.
- [ ] La carte d'erreur garde sa largeur (`w-80`) et ne déborde pas avec une chaîne de deux bastions (à l'écran).

## À regarder par Florian

`npm run tauri dev` : une connexion vers une machine éteinte ou un mauvais port. La carte dit à quelle étape ça a
cassé et quoi vérifier ; « Fermer l'onglet » ferme. Une connexion RDP au mauvais mot de passe : « Modifier la
connexion » ouvre l'éditeur.
