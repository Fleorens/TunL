# T21 — Onglets de session : terminal branché, étapes de connexion, erreur, fin, reconnexion

| | |
|---|---|
| **Jalon** | M2 — SSH |
| **Dépend de** | T20, T19b |
| **Lire avant** | `docs/04-ecrans.md` §1 (TabBar, StatusBar) et §5, `docs/01-architecture.md` §6, `docs/03-design.md` §4 et §7 |
| **Livrable** | `src/features/sessions/` (modèle, store, ports, vues), TabBar / StatusBar / AppLayout branchés, `openSession` réel, `demo-data.ts` supprimé ; 8 tests Vitest, 10 scénarios e2e + 3 fichiers e2e mis à jour |

## Pourquoi

C'est la fiche où TunL devient un vrai client SSH : double-clic sur une connexion → un onglet → les étapes de
connexion défilent → le terminal. Les onglets de démonstration (T04) disparaissent au profit d'un store de sessions.
Chaque onglet garde son terminal monté même inactif (on retrouve l'écran en revenant), affiche une carte si la
connexion échoue, un bandeau quand le shell se termine, et se reconnecte d'un clic.

Les prompts (clé d'hôte inconnue, mot de passe…) arrivent en T21b : d'ici là, dans la vraie app, une première
connexion attend 5 minutes puis échoue en `cancelled`. Le mock n'en pose aucun.

## À réutiliser (ne pas réécrire)

- T19 : `ipc.sshOpen`, `sshWrite`, `sshResize`, `sessionClose`, `SessionCallbacks`, `TerminalSize` ; le mock des
  sessions (scénarios : `nas`, `pi-hole` directs, `web-01` derrière `bastion-01`, `unreachable.test`).
- T20 : `TerminalView`, `createTerminalPort`, `TerminalPort`.
- `StatusDot` et son type `Status`, `ProtocolIcon`, `ProtocolBadge` ; `describeError`, `notifyError`,
  `toAppError` (`lib/errors.ts`) ; `notifyComingSoon` ; `useSettings` (`settings.ui.confirmCloseActiveSession`) ;
  `useUi.getState().openEditor`, `openPalette` ; les composants `AlertDialog`, `Button`, `Collapsible` (si présent,
  sinon un bouton `aria-expanded`) de `components/ui`.
- La logique de voisinage de `useDemoTabs.close` (quel onglet devient actif quand on en ferme un) : à reprendre
  dans le nouveau store, puis supprimer `features/shell/demo-data.ts` et son test.

## Contrat

### `src/features/sessions/session-model.ts` (pur)

```ts
export type SessionStatus = "connecting" | "connected" | "closed" | "error";
export interface SessionStepView { step: StepKind; label: string; state: StepState }
export interface Session {
  id: string;              // the tab
  runId: string;           // the backend session of the current attempt (sessionId of ssh_open)
  title: string;
  target: SessionTarget;
  connectionId: string | null;          // from a "saved" target
  status: SessionStatus;
  steps: readonly SessionStepView[];
  error: AppError | null;
  exitStatus: number | null;
  size: TerminalSize | null;
}
export function newSession(id: string, title: string, target: SessionTarget): Session;   // runId = id, connecting
export function applySessionEvent(session: Session, event: SessionEvent): Session;
export function restartSession(session: Session, runId: string): Session;   // connecting again; keeps id, title, size
export function uniqueTitle(name: string, taken: readonly string[]): string; // "web-01", "web-01 (2)"…
export function quickTitle(target: { host: string; port: number; username: string | null }): string;
export function tabStatus(status: SessionStatus): Status;   // connecting→connecting, connected→online, closed→offline, error→error
```

`applySessionEvent` : `step` → remplace l'étape de même `step` ou l'ajoute à la fin ; `connected` → `connected` ;
`closed` → `closed` + `exitStatus` ; `error` → `error` + `error` ; `log` → inchangé. Toujours un nouvel objet.
`quickTitle` : `user@host`, ou `host` sans utilisateur, suivi de `:port` si le port n'est pas 22.

### `src/features/sessions/store.ts` (zustand) et `session-ports.ts`

```ts
interface SessionsState {
  sessions: readonly Session[];
  activeId: string | null;
  closing: string | null;                           // the tab waiting for the close confirmation
  open(target: SessionTarget, name: string): string; // returns the tab id and makes it active
  activate(id: string): void;
  activateIndex(index: number): void;               // Alt+1…8 ; Alt+9 = last
  activateRelative(delta: 1 | -1): void;
  requestClose(id: string): void;
  confirmClose(): void;
  cancelClose(): void;
  close(id: string): void;
  reconnect(id: string): void;
}
export const useSessions: UseBoundStore<StoreApi<SessionsState>>;
```

- `open` : `id = crypto.randomUUID()`, titre `uniqueTitle(name, titres ouverts)`, `newSession`, onglet actif, puis
  le démarrage (ci-dessous).
- **Démarrage d'un essai** (partagé avec `reconnect`) : `ipc.sshOpen(runId, target, size ?? { cols: 80, rows: 24 },
  { onEvent, onOutput })`. `onEvent` applique l'événement **seulement si** `runId` est encore celui de la session
  (un événement tardif d'un essai précédent est ignoré). `onOutput` pousse dans le port de l'onglet. Un rejet de
  `sshOpen` (cible refusée d'emblée) devient `applySessionEvent(…, { type: "error", error: toAppError(e) })`.
- Événement `connected` d'une connexion enregistrée → `useConnections.getState().touch(connectionId)` : nouvelle
  action du store des connexions, qui appelle `ipc.connectionTouch` et remplace la connexion (les « Récents » de
  l'accueil suivent). Échec → `notifyError`.
- `session-ports.ts` : une `Map` de module, id d'onglet → `{ port, push }` (`createTerminalPort`), créée à
  l'ouverture, **gardée** à la reconnexion, supprimée à la fermeture. L'émetteur du port envoie `sshWrite(runId…)`
  et `sshResize(runId…)` de l'essai courant, et seulement si la session est `connecting` ou `connected` ; il retient
  la taille dans la session (`size`). Un rejet `notFound` de ces deux appels est ignoré (la session vient de finir) ;
  tout autre → `notifyError`. Les ports ne vont **jamais** dans le state zustand (ce ne sont pas des données).
- `requestClose(id)` : session `connected` **et** `settings.ui.confirmCloseActiveSession` → `closing = id` ;
  sinon `close(id)`. `close(id)` : `ipc.sessionClose(runId)` (rejet → `notifyError`), port supprimé, session
  retirée, voisin activé (même règle que les onglets de démo).
- `reconnect(id)` : nouvel essai avec `runId = crypto.randomUUID()` et `restartSession`.

### `src/features/sessions/open-session.ts`

- `openSession(connection, kind?)` : `kind === "sftp"` ou connexion RDP → `notifyComingSoon()` (T25, T28) ; sinon
  `useSessions.getState().open({ type: "saved", connectionId: connection.id }, connection.name)`.
- `openQuickSession(target)` : RDP → `notifyComingSoon()` ; sinon
  `open({ type: "quick", host, port, username }, quickTitle(target))`.
- Barre latérale : le double-clic / `Entrée` sur une ligne (`onActivate`) et « Connect » du menu contextuel
  appellent `openSession`. « Open SFTP » et « Wake » restent « Coming soon ».

### Les vues

- `SessionView({ session, active })` : `<section aria-label={session.title} hidden={!active}>` en `relative h-full`,
  qui contient **toujours** `<TerminalView port={…} active={active} />` (monté dès l'ouverture, jamais démonté avant
  la fermeture), et selon le statut :
  - `connecting` → `ConnectingOverlay` : `role="status"`, carte centrée (`glass`, `shadow-elevated`) par-dessus le
    terminal ; titre « Connecting to {{name}}… » ; une ligne par étape : `Loader2` qui tourne (`started`), `Check`
    (`done`), `X` en `text-destructive` (`failed`), et le texte `sessions.steps.<step>` avec `{{label}}` ; bouton
    « Cancel » → `close(id)`. Animation d'entrée douce (`motion`, respectant la réduction des animations).
  - `error` → `SessionErrorCard` : `role="alert"`, carte centrée, icône `Unplug` (`ShieldAlert` pour les erreurs de
    clé d'hôte), titre `describeError(error).title`, un bouton « Details » (`aria-expanded`) qui montre
    `error.message` en `font-mono text-xs`, boutons « Retry » (`reconnect`) et, s'il y a une connexion enregistrée,
    « Edit connection » (éditeur en modification).
  - `closed` → `ClosedBanner` en bas de la section (le terminal reste lisible au-dessus, pas de rôle ARIA) :
    « Session ended (exit code {{code}}) » ou « Session ended », bouton « Reconnect ».
- `TabBar` : les sessions du store (plus rien de `demo-data`) : `StatusDot` (`tabStatus`, `aria-label` traduit
  `status.<…>`), `ProtocolIcon` SSH, titre, croix (`tabs.close`) → `requestClose` ; clic du milieu → `requestClose`.
  Le bouton `+` ouvre la palette en connexion rapide.
- `AppLayout` : aucune session → `HomeView` ; sinon toutes les `SessionView` (une seule visible). Les raccourcis
  `tab.*` passent par `useSessions` (`tab.close` → `requestClose` de l'onglet actif). Monter `CloseSessionDialog` :
  `AlertDialog` ouvert quand `closing` est posé, titre « Close {{name}}? », texte « The session is still open:
  closing the tab ends it. », « Cancel » / « Close ».
- `StatusBar` : nombre de sessions `connected` ; pour l'onglet actif : `ProtocolBadge`, adresse
  (`user@host:port` de la connexion, ou de la cible rapide), « via <bastion> » (déjà là), taille
  « {{cols}}×{{rows}} » (`statusbar.size`) quand elle est connue.

### Textes (anglais exact ; en français dans `fr.json`)

| Clé | Anglais |
|---|---|
| `sessions.connecting` | Connecting to {{name}}… |
| `sessions.steps.wake` / `hop` / `target` | Waking up {{label}} / Through {{label}} / Connecting to {{label}} |
| `sessions.steps.hostKey` / `auth` / `open` / `launch` | Checking the host key of {{label}} / Signing in as {{label}} / Opening the shell / Starting the RDP client |
| `sessions.cancel` | Cancel |
| `sessions.error.details` / `retry` / `edit` | Details / Retry / Edit connection |
| `sessions.closed.withCode` / `withoutCode` | Session ended (exit code {{code}}) / Session ended |
| `sessions.reconnect` | Reconnect |
| `sessions.confirmClose.title` / `description` / `confirm` | Close {{name}}? / The session is still open: closing the tab ends it. / Close |
| `statusbar.size` | {{cols}}×{{rows}} |

## Pièges

- `hidden` sur la section : Tailwind 4 met `[hidden]` en `display: none !important` ; ne pas le contourner par une
  classe `flex` (`TerminalView` sait déjà ne pas s'ajuster à taille nulle).
- Ne pas créer un `Channel` ni appeler `invoke` ici : tout passe par `ipc.ts` (T19).
- Un store qui garde des ports (objets vivants) dans son state casse l'immuabilité et les tests : `session-ports.ts`.
- Trois fichiers e2e d'avant sont **remplacés** par ceux de cette fiche (`e2e/shell.spec.ts`, `e2e/home.spec.ts`,
  `e2e/palette.spec.ts`) : ils attendaient « Coming soon » ou les onglets de démo. Le script les réécrit.

## Tests du contrat

### `src/features/sessions/session-model.test.ts`

```ts
import { describe, expect, test } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import {
  applySessionEvent,
  newSession,
  quickTitle,
  restartSession,
  type Session,
  tabStatus,
  uniqueTitle,
} from "./session-model";

const saved = { type: "saved", connectionId: "c-1" } as const;

function applyAll(session: Session, events: SessionEvent[]): Session {
  return events.reduce(applySessionEvent, session);
}

describe("session model", () => {
  test("a new session is connecting, with nothing done yet", () => {
    expect(newSession("s-1", "web-01", saved)).toEqual({
      id: "s-1",
      runId: "s-1",
      title: "web-01",
      target: saved,
      connectionId: "c-1",
      status: "connecting",
      steps: [],
      error: null,
      exitStatus: null,
      size: null,
    });
    const quick = { type: "quick", host: "10.5.5.5", port: 22, username: null } as const;
    expect(newSession("s-2", "10.5.5.5", quick).connectionId).toBeNull();
  });

  test("a step updates its line in place; a new kind of step is appended", () => {
    const session = applyAll(newSession("s-1", "web-01", saved), [
      { type: "step", step: "target", label: "10.0.0.12:22", state: "started" },
      { type: "step", step: "target", label: "10.0.0.12:22", state: "done" },
      { type: "step", step: "hostKey", label: "10.0.0.12", state: "started" },
    ]);
    expect(session.steps).toEqual([
      { step: "target", label: "10.0.0.12:22", state: "done" },
      { step: "hostKey", label: "10.0.0.12", state: "started" },
    ]);
    expect(session.status).toBe("connecting");
  });

  test("connected, closed and error set the status", () => {
    const start = newSession("s-1", "web-01", saved);
    const connected = applySessionEvent(start, { type: "connected" });
    expect(connected.status).toBe("connected");

    const closed = applySessionEvent(connected, {
      type: "closed",
      reason: "remoteClosed",
      exitStatus: 0,
    });
    expect(closed).toMatchObject({ status: "closed", exitStatus: 0 });

    const error = { kind: "network", message: "connection refused", detail: null } as const;
    const failed = applySessionEvent(start, { type: "error", error });
    expect(failed).toMatchObject({ status: "error", error });
  });

  test("events never mutate the session they are given", () => {
    const start = Object.freeze(newSession("s-1", "web-01", saved));
    const next = applySessionEvent(start, {
      type: "step",
      step: "auth",
      label: "deploy",
      state: "started",
    });
    expect(next).not.toBe(start);
    expect(start.steps).toEqual([]);
    expect(applySessionEvent(start, { type: "log", line: "ignored" })).toEqual(start);
  });

  test("restarting clears the previous attempt but keeps the tab and its size", () => {
    const failed = applyAll(newSession("s-1", "web-01", saved), [
      { type: "step", step: "target", label: "10.0.0.12:22", state: "failed" },
      { type: "error", error: { kind: "network", message: "refused", detail: null } },
    ]);
    // A new attempt is a new backend session: a late event of the old one can be told apart.
    const again = restartSession({ ...failed, size: { cols: 80, rows: 24 } }, "run-2");
    expect(again).toMatchObject({
      id: "s-1",
      runId: "run-2",
      title: "web-01",
      status: "connecting",
      steps: [],
      error: null,
      exitStatus: null,
      size: { cols: 80, rows: 24 },
    });
  });

  test("a second tab of the same connection is numbered", () => {
    expect(uniqueTitle("web-01", [])).toBe("web-01");
    expect(uniqueTitle("web-01", ["web-01"])).toBe("web-01 (2)");
    expect(uniqueTitle("web-01", ["web-01", "web-01 (2)"])).toBe("web-01 (3)");
    expect(uniqueTitle("web-01", ["web-01 (2)"])).toBe("web-01");
  });

  test("a quick target is titled like an ssh command line", () => {
    expect(quickTitle({ host: "10.5.5.5", port: 22, username: "deploy" })).toBe("deploy@10.5.5.5");
    expect(quickTitle({ host: "10.5.5.5", port: 2222, username: null })).toBe("10.5.5.5:2222");
  });

  test("the tab dot follows the status", () => {
    expect(tabStatus("connecting")).toBe("connecting");
    expect(tabStatus("connected")).toBe("online");
    expect(tabStatus("closed")).toBe("offline");
    expect(tabStatus("error")).toBe("error");
  });
});
```

### `e2e/sessions.spec.ts`

```ts
// T21: terminal tabs over the mock sessions of T19 (nas, pi-hole: direct; web-01: behind bastion-01).
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

async function typeLine(page: Page, title: string, line: string) {
  await view(page, title).locator("[data-terminal]").click();
  await page.keyboard.type(line);
  await page.keyboard.press("Enter");
}

function activeTab(page: Page) {
  return page.getByRole("tab", { selected: true });
}

test("double-clicking a connection opens a terminal that connects", async ({ page }) => {
  await open(page, "nas");
  await expect(activeTab(page)).toContainText("nas");
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  await expect(screen(page, "nas")).toContainText("admin@192.168.1.10:~$");
  await expect(activeTab(page).getByRole("img", { name: "Online" })).toBeVisible();
});

test("the connecting overlay lists the steps, the bastion first", async ({ page }) => {
  await open(page, "web-01");
  const overlay = view(page, "web-01").getByRole("status");
  await expect(overlay).toContainText("Connecting to web-01");
  await expect(overlay).toContainText("Through bastion-01");
  await expect(screen(page, "web-01")).toContainText("Welcome to web-01");
  await expect(overlay).toHaveCount(0);
});

test("the shell runs commands; exit shows the end banner and Reconnect starts again", async ({
  page,
}) => {
  await open(page, "nas");
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  await typeLine(page, "nas", "echo ok-42");
  await expect(screen(page, "nas")).toContainText(/echo ok-42\s*ok-42/);

  await typeLine(page, "nas", "exit 2");
  const banner = view(page, "nas").getByText("Session ended (exit code 2)");
  await expect(banner).toBeVisible();
  await expect(activeTab(page).getByRole("img", { name: "Offline" })).toBeVisible();
  await expectSaneUi(page);

  await view(page, "nas").getByRole("button", { name: "Reconnect" }).click();
  await expect(banner).toHaveCount(0);
  await expect(activeTab(page).getByRole("img", { name: "Online" })).toBeVisible();
});

test("a connection opened twice gets a numbered tab; Alt+n switches and keeps each screen", async ({
  page,
}) => {
  await open(page, "nas");
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  await open(page, "nas");
  await expect(activeTab(page)).toContainText("nas (2)");
  await expect(screen(page, "nas (2)")).toContainText("Welcome to nas");
  await open(page, "pi-hole");
  await expect(screen(page, "pi-hole")).toContainText("pi@192.168.1.2:~$");

  await page.keyboard.press("Alt+Digit1");
  await expect(view(page, "nas")).toBeVisible();
  await expect(view(page, "pi-hole")).toBeHidden();
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  await page.keyboard.press("Alt+Digit9");
  await expect(activeTab(page)).toContainText("pi-hole");
});

test("an unreachable quick connection shows an error card with Retry", async ({ page }) => {
  await page.keyboard.press("Control+Shift+T");
  await page.getByRole("dialog").getByRole("combobox").fill("root@unreachable.test");
  await page.keyboard.press("Enter");

  const card = view(page, "root@unreachable.test").getByRole("alert");
  await expect(card).toContainText("Connection failed");
  await expect(card.getByRole("button", { name: "Edit connection" })).toHaveCount(0);
  await expectSaneUi(page);
  await card.getByRole("button", { name: "Details" }).click();
  await expect(card).toContainText("unreachable.test:22");

  await card.getByRole("button", { name: "Retry" }).click();
  await expect(card).toContainText("Connection failed");
  await expect(activeTab(page).getByRole("img", { name: "Error" })).toBeVisible();
});

test("closing a connected session asks first; the last tab closed shows the home screen", async ({
  page,
}) => {
  await open(page, "nas");
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  await page.keyboard.press("Control+Shift+W");
  const confirm = page.getByRole("alertdialog");
  await expect(confirm).toContainText("Close nas?");
  await confirm.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("a session that is not connected closes without a question", async ({ page }) => {
  await page.keyboard.press("Control+Shift+T");
  await page.getByRole("dialog").getByRole("combobox").fill("root@unreachable.test");
  await page.keyboard.press("Enter");
  await expect(view(page, "root@unreachable.test").getByRole("alert")).toBeVisible();
  await activeTab(page).getByRole("button", { name: "Close root@unreachable.test" }).click();
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("the status bar shows the session's address, its size and the active count", async ({
  page,
}) => {
  await open(page, "nas");
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  const footer = page.getByRole("contentinfo");
  await expect(footer).toContainText("admin@192.168.1.10:22");
  await expect(footer).toContainText(/\d+×\d+/);
  await expect(footer).toContainText("1 active session");
});

test("app shortcuts still work while the terminal has the focus", async ({ page }) => {
  await open(page, "nas");
  await expect(screen(page, "nas")).toContainText("Welcome to nas");
  await view(page, "nas").locator("[data-terminal]").click();
  await page.keyboard.press("Control+Shift+P");
  await expect(page.getByRole("dialog").getByRole("combobox")).toBeFocused();
});

test("the sidebar's Connect opens a session; RDP is not there yet", async ({ page }) => {
  await page
    .getByRole("button", { name: /^pi-hole/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Connect" }).click();
  await expect(screen(page, "pi-hole")).toContainText("Welcome to pi-hole");

  await page
    .getByRole("button", { name: /^ad-01/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Connect" }).click();
  await expect(page.getByText("Coming soon")).toBeVisible();
});
```

### `e2e/shell.spec.ts` (remplace la version de T14)

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

test("placeholder actions show a translated toast, never a raw key", async ({ page }) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(page.getByText("Coming soon")).toBeVisible();
  await expect(page.getByText("shell.notYetAvailable")).toHaveCount(0);
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

### `e2e/home.spec.ts` (remplace la version de T14)

```ts
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

async function closeAllTabs(page: Page) {
  await page.goto("/");
  await page.keyboard.press("Control+Shift+W");
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("tab")).toHaveCount(0);
}

test("the home screen greets and lists favorites and recents", async ({ page }) => {
  await closeAllTabs(page);
  await expect(
    page.getByRole("heading", { level: 1, name: /^Good (morning|afternoon|evening|night)/ }),
  ).toBeVisible();
  await expect(page.getByRole("article", { name: "web-01" })).toBeVisible();
  await expect(page.getByRole("article", { name: "ad-01" })).toBeVisible();
  const recent = page.getByRole("region", { name: "Recent", exact: true });
  await expect(recent.getByText("web-01")).toBeVisible();
  await expect(recent.getByText("5 minutes ago")).toBeVisible();
  await expectSaneUi(page);
});

test("a card's edit action opens the editor", async ({ page }) => {
  await closeAllTabs(page);
  const card = page.getByRole("article", { name: "web-01" });
  await card.hover();
  await card.getByRole("button", { name: "Edit web-01" }).click();
  await expect(
    page.getByRole("dialog").getByRole("heading", { name: "Edit web-01" }),
  ).toBeVisible();
});

test("the quick connect field checks the address", async ({ page }) => {
  await closeAllTabs(page);
  const field = page.getByPlaceholder("user@host[:port] — quick connect");
  await field.fill("not an address!");
  await field.press("Enter");
  await expect(page.getByText("Enter an address like deploy@10.0.0.5:22")).toBeVisible();
  await field.fill("deploy@10.0.0.5");
  await expect(page.getByText("Enter an address like deploy@10.0.0.5:22")).toHaveCount(0);
  await field.press("Enter");
  await expect(page.getByRole("tab", { selected: true })).toContainText("deploy@10.0.0.5");
});

test("clicking an SSH card opens a terminal tab", async ({ page }) => {
  await closeAllTabs(page);
  await page
    .getByRole("article", { name: "web-01" })
    .getByRole("button", { name: "web-01", exact: true })
    .click();
  await expect(page.getByRole("tab", { selected: true })).toContainText("web-01");
});

test("clicking an RDP card says it is coming (RDP arrives with T28)", async ({ page }) => {
  await closeAllTabs(page);
  await page
    .getByRole("article", { name: "ad-01" })
    .getByRole("button", { name: "ad-01", exact: true })
    .click();
  await expect(page.getByText("Coming soon")).toBeVisible();
});
```

### `e2e/palette.spec.ts` (remplace la version de T13)

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
  await page.keyboard.press("Control+Shift+P");
  await palette(page).getByRole("combobox").fill("rdp://win-02");
  await expect(palette(page).getByRole("option", { name: "RDP to win-02" })).toBeVisible();
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


## Étapes

1. Les tests : `node scripts/contract-tests.mjs T21`.
2. `session-model.ts`, puis `npx vitest run src/features/sessions`.
3. `session-ports.ts`, `store.ts`, `touch` dans le store des connexions, `open-session.ts`.
4. `SessionView` et ses trois états, `CloseSessionDialog`, puis `TabBar`, `AppLayout`, `StatusBar`, la barre
   latérale ; supprimer `demo-data.ts` et son test ; les textes en / fr.
5. `npm run format`, `npm run review`, cases, statut, commit `feat: SSH session tabs with connecting steps, errors and reconnect (T21)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T21 --check` affiche `OK` partout.
- [x] `grep -rn "demo-data\|useDemoTabs" src` ne trouve rien.
- [ ] Visuel : la carte d'étapes est centrée sur le terminal, les icônes alignées ; le bandeau de fin ne cache pas la
      dernière ligne du terminal ; la carte d'erreur est lisible en clair et en sombre.

## À regarder par Florian

**La première vraie connexion SSH de TunL.** `npm run tauri dev` : double-clic sur une connexion **sans bastion**
(les bastions arrivent en T22). Pour un serveur déjà présent dans ton `~/.ssh/known_hosts`, avec l'agent ou une clé
sans passphrase, tout doit passer sans question. Une clé d'hôte inconnue ou un mot de passe à saisir attendront
T21b. Essayer : `htop`, `vim`, redimensionner la fenêtre, `exit`, « Reconnect ».
