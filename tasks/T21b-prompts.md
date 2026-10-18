# T21b — Prompts de connexion (clé d'hôte, mot de passe, passphrase, 2FA) et clé d'hôte changée

| | |
|---|---|
| **Jalon** | M2 — SSH |
| **Dépend de** | T21 |
| **Lire avant** | `docs/04-ecrans.md` §9, `docs/06-securite.md` §2 (S2, S6), `docs/01-architecture.md` §7 |
| **Livrable** | `lib/events.ts`, `lib/mock/prompts.ts` et quatre scénarios du mock, `features/prompts/` (file d'attente, trois dialogues), carte « clé d'hôte changée » ; 7 tests Vitest, 7 scénarios e2e |

## Pourquoi

Depuis T17, le backend sait **demander** : « faites-vous confiance à cette clé ? », « quel est le mot de passe ? »,
« code de vérification ? ». Il émet l'événement global `tunl://prompt` et attend `prompt_answer`. Il manque
l'interface qui écoute, affiche le bon dialogue et répond. Sans elle, toute première connexion à un serveur reste
bloquée 5 minutes. Cette fiche ajoute aussi l'écran d'une clé d'hôte **changée**, le seul refus de TunL qu'il faut
expliquer (S6), avec la suppression de l'ancienne clé après confirmation.

## À réutiliser (ne pas réécrire)

- `ipc.promptAnswer`, `ipc.knownHostRemove` (T17) ; les types générés `PromptRequest`, `PromptKind`, `PromptAnswer`,
  `ErrorDetail`.
- Le store des sessions de T21 (`useSessions` : `close`, `reconnect`) et `SessionErrorCard` (c'est lui qui choisit la
  carte « clé changée ») ; le mock des sessions de T19 (`lib/mock/sessions.ts`).
- `AlertDialog`, `Dialog`, `Input`, `Label`, `Checkbox`, `Button`, `Tooltip` ; `notifyError`, `toAppError` ; `toast`.

## Contrat

### `src/lib/events.ts` (le **seul** fichier qui appelle `listen()`)

```ts
export const PROMPT_EVENT = "tunl://prompt";
/** Calls `handler` for every prompt the backend asks. Returns the unsubscribe function. */
export function onPrompt(handler: (request: PromptRequest) => void): () => void;
```

Tauri : `listen<PromptRequest>(PROMPT_EVENT, (event) => handler(event.payload))` (`@tauri-apps/api/event`) ; la
promesse rend la fonction de désabonnement : la retenir, et l'appeler si le désabonnement arrive avant elle. Mock :
`subscribeMockPrompts(handler)`.

### Le mock : `src/lib/mock/prompts.ts`

```ts
export function subscribeMockPrompts(handler: (request: PromptRequest) => void): () => void;
/** Emits at once (synchronously) to every subscriber, then waits for prompt_answer. */
export function askMockPrompt(sessionId: string, prompt: PromptKind): Promise<PromptAnswer>;
/** Resolves every pending prompt of this session with { kind: "cancel" }. */
export function cancelMockPrompts(sessionId: string): void;
export const promptHandlers: Record<string, Handler>;   // replaces T17's placeholders
export function resetMockPrompts(): void;               // called by resetMockBackend
```

- `prompt_answer` : résout l'attente ; id inconnu (ou déjà répondu) → rejet `notFound`.
- `known_host_remove` : voir le scénario `kiosk-01`. `session_close` (T19) appelle aussi `cancelMockPrompts`.

Scénarios ajoutés au mock des sessions, **par nom de connexion** (les autres ne changent pas ; la logique peut
vivre dans un nouveau `lib/mock/scenarios.ts`). L'état retenu (clés apprises, mots de passe mémorisés, clé retirée)
est une variable du module, remise à zéro par `resetMockPrompts` :

| Connexion | Étape | Comportement |
|---|---|---|
| `db-prod` | `hostKey` | si `db.internal:22` n'est pas encore appris : prompt `hostKeyUnknown` (`db.internal`, 22, `ssh-ed25519`, `SHA256:` + une empreinte fixe) ; `accept` → appris, suite normale ; sinon `hostKey` `failed` et erreur `hostKeyRejected` (`"host key rejected"`) |
| `router` | `auth` | si aucun mot de passe mémorisé : prompt `password` (`router`, `root`, `192.168.1.1`, `canSave: true`, `retry`) ; valeur `wrong` → nouveau prompt avec `retry: true` ; autre valeur → réussi (et mémorisé si `save`) ; `cancel` → `auth` `failed`, erreur `cancelled` (`"authentication cancelled"`) |
| `media-server` | `auth` | prompt `keyboardInteractive` : `name` vide, `instructions` « Two-factor authentication », questions `Password: ` (`echo: false`) et `Verification code: ` (`echo: true`) ; deux réponses → réussi ; `cancel` → erreur `cancelled` |
| `kiosk-01` | `hostKey` | tant que la clé n'est pas retirée : `hostKey` `failed`, erreur `hostKeyChanged` (`"host key changed"`) avec `detail` `{ type: "hostKeyChanged", host: "172.16.0.40", port: 22, keyType: "ssh-ed25519", fingerprint: "SHA256:newKiosk…", knownFingerprint: "SHA256:oldKiosk…", knownHostsPath: "~/.config/io.github.fleorens.TunL/known_hosts", line: 3, removable: true }`. `known_host_remove("172.16.0.40", 22)` → `1` et la clé est retirée (puis `0`) ; ensuite, comme `db-prod` (prompt de première connexion) |

Une session fermée pendant un prompt ne produit plus aucun événement.

### La file d'attente : `src/features/prompts/store.ts`

```ts
interface PromptsState {
  queue: readonly PromptRequest[];
  push(request: PromptRequest): void;
  resolve(id: string): void;                 // removes it
  dropSession(sessionId: string): void;      // removes every prompt of that session
}
export const usePrompts: UseBoundStore<StoreApi<PromptsState>>;
```

`useSessions.close` (T21) appelle `usePrompts.getState().dropSession(runId)` : fermer l'onglet retire son dialogue
(le backend, lui, annule l'attente dans `session_close`).

### `src/features/prompts/PromptHost.tsx` (monté une fois dans `AppLayout`)

S'abonne par `onPrompt` au montage (désabonnement au démontage), montre **le premier** de la file, un seul à la fois.
Répondre = `resolve(id)` puis `ipc.promptAnswer(id, answer)` ; un rejet `notFound` est ignoré (la session a fini
entre-temps), tout autre → `notifyError`.

| Prompt | Composant | Contenu | Réponses |
|---|---|---|---|
| `hostKeyUnknown` | `AlertDialog` | icône `ShieldQuestion` ; titre « First connection to {{host}}:{{port}} » ; type de clé ; empreinte en `font-mono select-all break-all` ; « Check this fingerprint with the server's administrator before you trust it. » | « Cancel » (et `Échap`) → `reject` ; « Trust and continue » (primaire) → `accept` |
| `password`, `passphrase` | `Dialog` | titre « Password for {{username}}@{{host}} » ou « Passphrase for {{keyPath}} » ; si `retry`, en `text-destructive` : « Wrong password, try again. » / « Wrong passphrase, try again. » ; champ (label « Password » / « Passphrase »), masqué, avec un bouton œil (« Show password » / « Hide password », idem passphrase) ; case « Remember in the keyring » si `canSave` | `Entrée` ou « Connect » (désactivé tant que vide) → `{ kind: "secret", value, save }` ; « Cancel », `Échap`, croix → `cancel` |
| `keyboardInteractive` | `Dialog` | titre « Sign in to {{connectionName}} » (ou `name` s'il n'est pas vide) ; `instructions` en paragraphe ; un champ par question, label = texte de la question sans espaces autour, `type="password"` si `echo` est faux | « Continue » → `{ kind: "responses", values }` (dans l'ordre) ; « Cancel » → `cancel` |

Le secret tapé ne vit que dans l'état local du dialogue, vidé à la fermeture ; jamais dans un store, un log ou le
`localStorage` (S1, S2).

### Carte « clé d'hôte changée »

`SessionErrorCard` (T21) affiche `HostKeyChangedCard` quand `error.detail?.type === "hostKeyChanged"` :
`role="alert"`, icône `ShieldAlert` en `text-destructive`, titre « The host key of {{name}} has changed » (titre de
l'onglet), explication « This can mean the server was reinstalled, or that someone is intercepting the connection.
TunL will not connect until the old key is removed. », deux lignes en `font-mono` : « Known key » (`knownFingerprint`)
et « Key presented now » (`fingerprint`). Puis :
- `removable` → bouton « Remove the old key… » : `AlertDialog` titré « Remove the old key of {{host}}? », texte
  « Type {{host}} to confirm. », un champ, « Cancel » / « Remove the key » (désactivé tant que le champ ne vaut pas
  exactement l'hôte, S6). Confirmer → `ipc.knownHostRemove(host, port)`, toast « Old key removed », puis
  `reconnect` de l'onglet (le serveur est alors inconnu : TunL redemande).
- sinon : « This key is recorded in {{path}}, which TunL does not modify. Remove it with: » et la commande
  `ssh-keygen -R "[host]:port"` (ou `ssh-keygen -R host` pour le port 22) en `font-mono select-all`.
- Toujours : « Close tab ».

### Textes (anglais exact ; en français dans `fr.json`)

Clés sous `prompts.*` et `hostKeyChanged.*`, reprenant **mot pour mot** les textes anglais des tableaux ci-dessus
(les e2e les lisent), plus : `prompts.hostKey.keyType` « Key type », `prompts.hostKey.fingerprint` « Fingerprint »,
`prompts.connect` « Connect », `prompts.continue` « Continue », `prompts.cancel` « Cancel »,
`hostKeyChanged.close` « Close tab », `hostKeyChanged.removed` « Old key removed ».

## Pièges

- `listen()` est asynchrone : un composant démonté avant la résolution doit quand même se désabonner (voir plus haut).
- Deux `AlertDialog` peuvent coexister une fraction de seconde (fermeture animée de la confirmation, ouverture du
  prompt suivant) : les e2e les distinguent par leur **titre** (nom accessible), garder un titre par dialogue.
- `Checkbox` dans un dialogue : pas de `Tooltip` en `asChild` dessus (piège du lot 3, `AGENTS.md`).

## Tests du contrat

### `src/lib/mock/prompts.test.ts`

```ts
import { beforeEach, describe, expect, test } from "vitest";
import type { PromptKind } from "@/bindings/PromptKind";
import type { PromptRequest } from "@/bindings/PromptRequest";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { askMockPrompt, cancelMockPrompts, subscribeMockPrompts } from "@/lib/mock/prompts";

const hostKey: PromptKind = {
  kind: "hostKeyUnknown",
  host: "db.internal",
  port: 22,
  keyType: "ssh-ed25519",
  fingerprint: "SHA256:x",
};

function listen() {
  const seen: PromptRequest[] = [];
  const unsubscribe = subscribeMockPrompts((request) => seen.push(request));
  return { seen, unsubscribe };
}

beforeEach(() => {
  resetMockBackend();
});

describe("mock prompts", () => {
  test("a prompt reaches the subscribers and waits for prompt_answer", async () => {
    const { seen } = listen();
    const answer = askMockPrompt("s-1", hostKey);
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ sessionId: "s-1", prompt: hostKey });
    await ipc.promptAnswer(seen[0].id, { kind: "accept" });
    await expect(answer).resolves.toEqual({ kind: "accept" });
  });

  test("answering twice, or an unknown id, is not found", async () => {
    const { seen } = listen();
    void askMockPrompt("s-1", hostKey);
    await ipc.promptAnswer(seen[0].id, { kind: "reject" });
    try {
      await ipc.promptAnswer(seen[0].id, { kind: "reject" });
      throw new Error("expected a rejection");
    } catch (error) {
      expect(toAppError(error).kind).toBe("notFound");
    }
  });

  test("closing a session cancels its prompts only", async () => {
    listen();
    const closed = askMockPrompt("s-1", hostKey);
    const other = askMockPrompt("s-2", hostKey);
    cancelMockPrompts("s-1");
    await expect(closed).resolves.toEqual({ kind: "cancel" });
    let settled = false;
    void other.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  test("an unsubscribed listener hears nothing more", () => {
    const { seen, unsubscribe } = listen();
    unsubscribe();
    void askMockPrompt("s-1", hostKey);
    expect(seen).toHaveLength(0);
  });
});
```

### `src/features/prompts/store.test.ts`

```ts
import { beforeEach, describe, expect, test } from "vitest";
import type { PromptRequest } from "@/bindings/PromptRequest";
import { usePrompts } from "./store";

function request(id: string, sessionId: string | null): PromptRequest {
  return {
    id,
    sessionId,
    prompt: {
      kind: "password",
      connectionName: "router",
      username: "root",
      host: "192.168.1.1",
      canSave: true,
      retry: false,
    },
  };
}

beforeEach(() => {
  usePrompts.setState({ queue: [] });
});

describe("prompt queue", () => {
  test("prompts are shown one at a time, oldest first", () => {
    const { push } = usePrompts.getState();
    push(request("p-1", "s-1"));
    push(request("p-2", "s-2"));
    expect(usePrompts.getState().queue.map((r) => r.id)).toEqual(["p-1", "p-2"]);
    usePrompts.getState().resolve("p-1");
    expect(usePrompts.getState().queue.map((r) => r.id)).toEqual(["p-2"]);
  });

  test("closing a session drops its prompts", () => {
    const { push } = usePrompts.getState();
    push(request("p-1", "s-1"));
    push(request("p-2", "s-2"));
    push(request("p-3", "s-1"));
    usePrompts.getState().dropSession("s-1");
    expect(usePrompts.getState().queue.map((r) => r.id)).toEqual(["p-2"]);
  });

  test("the queue is replaced, never mutated", () => {
    const before = usePrompts.getState().queue;
    usePrompts.getState().push(request("p-1", null));
    expect(before).toEqual([]);
  });
});
```

### `e2e/prompts.spec.ts`

```ts
// T21b: what the user answers while connecting (mock scenarios: db-prod, router, media-server, kiosk-01).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function open(page: Page, name: string) {
  await page
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .dblclick();
}

function view(page: Page, title: string) {
  return page.getByRole("region", { name: title, exact: true });
}

function screen(page: Page, title: string) {
  return view(page, title).locator(".xterm-rows");
}

test("a first connection asks to trust the host key, then remembers it", async ({ page }) => {
  await open(page, "db-prod");
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toContainText("First connection to db.internal:22");
  await expect(dialog).toContainText("ssh-ed25519");
  await expect(dialog).toContainText(/SHA256:\S+/);
  await expectSaneUi(page);
  await dialog.getByRole("button", { name: "Trust and continue" }).click();
  await expect(screen(page, "db-prod")).toContainText("Welcome to db-prod");

  await open(page, "db-prod");
  await expect(screen(page, "db-prod (2)")).toContainText("Welcome to db-prod");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("refusing the host key stops the connection", async ({ page }) => {
  await open(page, "db-prod");
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel" }).click();
  await expect(view(page, "db-prod").getByRole("alert")).toContainText("Host key rejected");
});

test("a wrong password asks again; a remembered one is not asked any more", async ({ page }) => {
  await open(page, "router");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Password for root@192.168.1.1");
  const field = dialog.getByLabel("Password", { exact: true });
  await expect(field).toHaveAttribute("type", "password");
  await dialog.getByRole("button", { name: "Show password" }).click();
  await expect(field).toHaveAttribute("type", "text");
  await expect(dialog.getByRole("button", { name: "Connect" })).toBeDisabled();
  await field.fill("wrong");
  await dialog.getByRole("button", { name: "Connect" }).click();

  await expect(dialog).toContainText("Wrong password, try again.");
  await field.fill("right");
  await dialog.getByRole("checkbox", { name: "Remember in the keyring" }).click();
  await expectSaneUi(page);
  await dialog.getByRole("button", { name: "Connect" }).click();
  await expect(screen(page, "router")).toContainText("Welcome to router");

  await open(page, "router");
  await expect(screen(page, "router (2)")).toContainText("Welcome to router");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("cancelling a password prompt ends the attempt; Retry asks again", async ({ page }) => {
  await open(page, "router");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  const card = view(page, "router").getByRole("alert");
  await expect(card).toContainText("Cancelled");
  await card.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("dialog")).toContainText("Password for root@192.168.1.1");
});

test("keyboard-interactive shows every question, masking the secret ones", async ({ page }) => {
  await open(page, "media-server");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Two-factor authentication");
  const password = dialog.getByLabel("Password:");
  const code = dialog.getByLabel("Verification code:");
  await expect(password).toHaveAttribute("type", "password");
  await expect(code).toHaveAttribute("type", "text");
  await expectSaneUi(page);
  await password.fill("secret");
  await code.fill("123456");
  await dialog.getByRole("button", { name: "Continue" }).click();
  await expect(screen(page, "media-server")).toContainText("Welcome to media-server");
});

test("closing the tab withdraws its prompt", async ({ page }) => {
  await open(page, "db-prod");
  await expect(page.getByRole("alertdialog")).toBeVisible();
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("a changed host key is explained, and the old key can be removed", async ({ page }) => {
  await open(page, "kiosk-01");
  const card = view(page, "kiosk-01").getByRole("alert");
  await expect(card).toContainText("The host key of kiosk-01 has changed");
  await expect(card).toContainText("SHA256:oldKiosk");
  await expect(card).toContainText("SHA256:newKiosk");
  await expectSaneUi(page);

  await card.getByRole("button", { name: "Remove the old key…" }).click();
  const confirm = page.getByRole("alertdialog", { name: "Remove the old key of 172.16.0.40?" });
  const remove = confirm.getByRole("button", { name: "Remove the key" });
  await expect(remove).toBeDisabled();
  await confirm.getByRole("textbox").fill("172.16.0.4");
  await expect(remove).toBeDisabled();
  await confirm.getByRole("textbox").fill("172.16.0.40");
  await remove.click();
  await expect(page.getByText("Old key removed")).toBeVisible();

  // The session starts again: the server is now unknown, so TunL asks.
  await expect(confirm).toHaveCount(0);
  const trust = page.getByRole("alertdialog", { name: "First connection to 172.16.0.40:22" });
  await expect(trust).toBeVisible();
  await trust.getByRole("button", { name: "Trust and continue" }).click();
  await expect(screen(page, "kiosk-01")).toContainText("Welcome to kiosk-01");
});
```


## Étapes

1. Les tests : `node scripts/contract-tests.mjs T21b`.
2. `lib/mock/prompts.ts`, les scénarios, `lib/events.ts`, puis `npx vitest run src/lib`.
3. `features/prompts/store.ts`, puis `npx vitest run src/features/prompts`.
4. `PromptHost` et les trois dialogues, `HostKeyChangedCard` et sa confirmation, `dropSession` dans `useSessions.close`,
   les textes en / fr.
5. `npm run format`, `npm run review`, cases, statut, commit `feat: connection prompts and changed host key screen (T21b)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T21b --check` affiche `OK` partout.
- [x] `grep -rn "listen(" src --include=*.ts --include=*.tsx` ne trouve que `src/lib/events.ts`.
- [x] Visuel : l'empreinte tient sur la largeur du dialogue (retour à la ligne, pas de débordement) ; la carte « clé
      changée » se lit comme un avertissement (rouge), sans être criarde.

## À regarder par Florian

`npm run tauri dev`, sur un serveur **absent** de ton `~/.ssh/known_hosts` : le dialogue de première connexion, puis
le mot de passe (coche « Remember in the keyring », puis vérifie l'entrée dans KWallet). Pour une clé changée :
`npm run test-env:up`, connexion enregistrée vers `127.0.0.1:2222` (utilisateur `tunl`, mot de passe
`tunl-password`), accepter la clé, puis `scripts/test-env/rotate-host-key.sh target` et « Reconnect ». Ensuite `npm run test-env:up` remet l'environnement
d'aplomb pour `npm run test:ssh`.
