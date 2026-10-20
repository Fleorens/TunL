# T28b — Onglet RDP : carte de session, journal, fin traduite, client introuvable

| | |
|---|---|
| **Jalon** | M5 — RDP |
| **Dépend de** | T28, T26d |
| **Lire avant** | `docs/04-ecrans.md` §7 (onglet RDP), `docs/03-design.md` (cartes, `bg-brand-soft`, `shadow-elevated`) |
| **Livrable** | onglets de type `rdp` (store, ouverture, journal dans le modèle) ; `src/features/rdp/` (modèle pur, `RdpCard`, `RdpMissingCard`) ; texte de l'étape `open` selon ce qu'elle ouvre ; mock : un client qui sort tout seul ; 6 fichiers de tests (dont 4 remplacent des versions antérieures) |

## Pourquoi

Le backend sait lancer FreeRDP (T28) ; l'interface dit encore « bientôt disponible » pour une connexion RDP. Cette
fiche ouvre un **onglet RDP** : les mêmes étapes de connexion qu'un terminal, puis une **carte** (FreeRDP affiche le
bureau dans sa propre fenêtre) avec la connexion, la durée de la session ou la raison de sa fin (les codes de sortie
de FreeRDP traduits en phrase), le bastion et l'adresse du tunnel, « Déconnecter » / « Relancer », et le journal
filtré du client. Sans client FreeRDP 3, l'onglet montre comment en installer un.

Au passage, l'étape `open` affiche enfin ce qu'elle ouvre : « Opening the shell », « Opening SFTP » ou « Opening the
tunnel » (jusqu'ici, un onglet SFTP disait « Opening the shell »).

Prototypé par l'orchestrateur sur le mock de T28 : les tests de cette fiche passent.

## À réutiliser (ne pas réécrire)

- T28 : `ipc.rdpOpen`, le mock `rdp_open` (`lib/mock/rdp-session.ts`), le `Log` `tunnel 127.0.0.1:<port> → …`.
- T21 / T25 : `useSessions`, `session-model.ts`, `SessionView` (carte d'étapes, carte d'erreur), `openSession`.
- `jumpChainNames`, `useConnections`, `copyText`, `ProtocolIcon` / `ProtocolBadge` (connaissent `rdp`).
- shadcn : `button`, `collapsible`. Utilitaires : `bg-brand-soft`, `shadow-elevated`, `text-protocol-rdp`.

## Contrat — Sessions

- `session-model.ts` :
  - `SessionKind = "ssh" | "sftp" | "rdp"` ; `export const LOG_LIMIT = 200;`
  - `Session` gagne `log: readonly string[]` (vide dans `newSession` et `restartSession`) ;
  - `applySessionEvent` : `log` ajoute la ligne et garde les `LOG_LIMIT` dernières (nouvel objet) ;
  - `stepKey(step)` (pur) : `open` + libellé `sftp` → `"sessions.steps.openSftp"`, `open` + `tunnel` →
    `"sessions.steps.openTunnel"`, sinon `` `sessions.steps.${step.step}` ``. Son type de retour est l'union de ces
    clés (les clés i18n sont typées).
- `store.ts` : une fonction privée `openBackend(session, runId, onEvent, onOutput)` choisit l'appel : `rdp` (cible
  enregistrée) → `ipc.rdpOpen(runId, connectionId, onEvent)`, `sftp` → `ipc.sftpOpen`, sinon `ipc.sshOpen`.
- `open-session.ts` : une connexion RDP ouvre un onglet `"rdp"`. Une **connexion rapide** RDP reste « bientôt
  disponible » (`rdp_open` demande une connexion enregistrée).
- `SessionView.tsx` :
  - la ligne d'étape affiche `t(stepKey(step), { label })` ;
  - un onglet `rdp` connecté **ou** terminé montre `<RdpCard key={`rdp-${runId}`} session={…} />` (pas de bandeau de
    fin pour lui) ;
  - en erreur `rdpClientMissing` : `<RdpMissingCard onRetry={reconnect} onClose={requestClose} />` ; toute autre
    erreur garde la carte d'erreur habituelle.
- i18n : `sessions.steps.openSftp` (« Opening SFTP » / « Ouverture de SFTP »), `sessions.steps.openTunnel`
  (« Opening the tunnel » / « Ouverture du tunnel »).

## Contrat — `src/features/rdp/`

### `rdp-model.ts` (pur)

```ts
export type ExitKey = "ended" | "timeout" | "replaced" | "denied" | "license" | "unreachable" | "dns"
  | "credentials" | "account" | "passwordExpired" | "tls" | "cancelled" | "arguments" | "unknown";
export function exitKey(code: number | null): ExitKey;
export function tunnelAddress(log: readonly string[]): string | null;
export function minutesSince(since: number, now: number): number;
```

`exitKey` regroupe les codes de sortie de FreeRDP 3 (les mêmes pour ses clients SDL et X11, vérifiés dans ses
sources) :

| Clé | Codes |
|---|---|
| `ended` | 0, 1, 2, 11, 12 |
| `timeout` | 3, 4 |
| `replaced` | 5 |
| `denied` | 7, 8, 9, 144, 155, 158 |
| `license` | 16 à 26 |
| `unreachable` | 131, 141, 142, 147 |
| `dns` | 139, 140 |
| `credentials` | 132, 134, 154, 159 |
| `account` | 135, 151, 156, 157 |
| `passwordExpired` | 148, 149, 152 |
| `tls` | 143 |
| `cancelled` | 145 |
| `arguments` | 128 |
| `unknown` | tout autre code, et `null` |

`tunnelAddress` : la première ligne qui commence par `tunnel 127.0.0.1:<port> ` (celle du backend) → `127.0.0.1:<port>`,
sinon `null`. `minutesSince` : minutes entières, jamais négatives.

### `RdpCard.tsx`

Une carte centrée (`w-110`, `rounded-xl`, `border`, `bg-card`, `shadow-elevated`, `p-6`), `section` avec
`aria-label` « Remote desktop <titre> » :
- une icône `Monitor` en `text-protocol-rdp` dans un halo `bg-brand-soft rounded-2xl p-4` ; le titre ;
  `user@hôte:port` en `font-mono` (depuis la connexion enregistrée) ;
- connectée : pastille verte + « Session open · N min » (`rdp.card.open`, pluriel ; N compté depuis l'affichage de la
  carte, rafraîchi toutes les 30 s) ; terminée : la phrase de `exitKey(exitStatus)` (en `text-destructive` sauf
  `ended`) suivie de « (code N) » quand ce n'est pas `ended` ;
- avec un bastion : « via a → b (127.0.0.1:40123) » (`rdp.card.viaTunnel`), ou « via a → b » tant que l'adresse n'est
  pas dans le journal ;
- connectée : « Disconnect » (`requestClose`, donc la confirmation de T21) ; terminée : « Close tab » (`close`) et
  « Relaunch » (`reconnect`) ;
- un `Collapsible` replié « FreeRDP log (filtered) » : un `<pre role="log">` (`aria-label` identique, `max-h-48`,
  défilant, `font-mono text-[11px]`) avec les lignes, ou « Nothing logged yet. ».
Les sous-parties (`OpenFor`, `EndedBecause`, `LogPanel`) sont des composants **au niveau du module**.

### `RdpMissingCard.tsx`

`export const INSTALL_COMMANDS` (Debian, Ubuntu : `sudo apt install freerdp3-sdl` ; Fedora : `sudo dnf install
freerdp` ; Arch Linux : `sudo pacman -S freerdp` ; openSUSE : `sudo zypper install freerdp`) et
`RdpMissingCard({ onRetry, onClose })` : une carte `role="alert"`, icône `MonitorX`, titre « No FreeRDP 3 client
found », une phrase, une ligne par distribution (nom, commande en `code`, bouton « Copy the command for <distro> »
→ `copyText`), puis « Close tab » et « Retry ».

### i18n (`en.json` et `fr.json`)

Bloc `rdp` : `card.{label, open_one, open_other, via, viaTunnel, disconnect, relaunch, closeTab, code, log,
logEmpty}`, `exit.<chaque clé de ExitKey>`, `missing.{title, description, copy}`. Les textes anglais exacts sont ceux
des tests (« Remote desktop {{name}} », « Session open · {{count}} min », « The user name or password was refused »,
« (code {{code}}) », « FreeRDP log (filtered) »…).

## Contrat — Mock

`lib/mock/rdp-session.ts` : `export const MOCK_RDP_EXITS = { "win-desktop": 134 }`. Après ses deux lignes de
journal, un client de cette liste écrit `"[ERROR][com.freerdp.core] ERRCONNECT_LOGON_FAILURE"`, puis l'onglet reçoit
`closed` (`processExited`, ce code) et la session du mock est oubliée.

## Pièges (vus au prototype)

- Biome refuse un `aria-label` sur un `<pre>` sans rôle : `role="log"`.
- `t(…)` n'accepte que des clés connues : `stepKey` doit déclarer son union de clés comme type de retour, pas
  `string`.
- Le texte de la barre d'état est collé sans espaces par `textContent` ; la carte, elle, se cherche par son nom
  accessible (`getByRole("region", { name: "Remote desktop ad-01" })`).
- Quatre fichiers de test changent parce que le RDP n'est plus « bientôt disponible » ou parce que la session a un
  journal : ils sont **remplacés** par ceux de cette fiche (`contract-tests.mjs` garde la version la plus récente).
  `e2e/review-lot3.spec.ts` n'appartient à aucune fiche : la fiche le fournit aussi, ne le modifie pas à la main.

## Tests du contrat

### `src/features/rdp/rdp-model.test.ts` (nouveau)

```ts
// T28b: what the RDP card reads from FreeRDP's exit code and log.
import { describe, expect, test } from "vitest";
import { exitKey, minutesSince, tunnelAddress } from "./rdp-model";

describe("exitKey", () => {
  test("the codes FreeRDP 3 documents, grouped", () => {
    expect(exitKey(0)).toBe("ended");
    expect(exitKey(11)).toBe("ended");
    expect(exitKey(131)).toBe("unreachable");
    expect(exitKey(132)).toBe("credentials");
    expect(exitKey(134)).toBe("credentials");
    expect(exitKey(140)).toBe("dns");
    expect(exitKey(143)).toBe("tls");
    expect(exitKey(145)).toBe("cancelled");
    expect(exitKey(149)).toBe("passwordExpired");
    expect(exitKey(155)).toBe("denied");
    expect(exitKey(18)).toBe("license");
  });

  test("an unknown code, or none, is unknown", () => {
    expect(exitKey(77)).toBe("unknown");
    expect(exitKey(255)).toBe("unknown");
    expect(exitKey(null)).toBe("unknown");
  });
});

describe("tunnelAddress", () => {
  test("found in the backend's tunnel line, wherever it is", () => {
    expect(
      tunnelAddress(["[INFO] hello", "tunnel 127.0.0.1:40123 → 10.0.0.5:3389", "[INFO] bye"]),
    ).toBe("127.0.0.1:40123");
  });

  test("none without a bastion, and a client line that looks alike does not count", () => {
    expect(tunnelAddress(["[INFO] connected"])).toBeNull();
    expect(tunnelAddress(["[INFO] tunnel 127.0.0.1:1 → x"])).toBeNull();
  });
});

describe("minutesSince", () => {
  test("whole minutes, never negative", () => {
    expect(minutesSince(0, 59_999)).toBe(0);
    expect(minutesSince(0, 12 * 60_000 + 5)).toBe(12);
    expect(minutesSince(1000, 0)).toBe(0);
  });
});
```

### `src/features/rdp/RdpMissingCard.test.tsx` (nouveau)

```tsx
// T28b: an RDP tab without a FreeRDP 3 client says how to install one.
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import "@/i18n";
import { INSTALL_COMMANDS, RdpMissingCard } from "./RdpMissingCard";

describe("RdpMissingCard", () => {
  test("lists an install command per family of distributions, each with a copy button", () => {
    render(<RdpMissingCard onRetry={() => {}} onClose={() => {}} />);
    expect(screen.getByRole("alert")).toHaveTextContent("No FreeRDP 3 client found");
    for (const { distro, command } of INSTALL_COMMANDS) {
      expect(screen.getByText(command)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: `Copy the command for ${distro}` }),
      ).toBeInTheDocument();
    }
    expect(INSTALL_COMMANDS.map((c) => c.command)).toContain("sudo apt install freerdp3-sdl");
  });

  test("Retry and Close tab call back", () => {
    const onRetry = vi.fn();
    const onClose = vi.fn();
    render(<RdpMissingCard onRetry={onRetry} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    fireEvent.click(screen.getByRole("button", { name: "Close tab" }));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
```

### `src/features/sessions/session-model.test.ts` (remplace la version de T25 : journal, `stepKey`)

```ts
import { describe, expect, test } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import {
  applySessionEvent,
  LOG_LIMIT,
  newSession,
  quickTitle,
  restartSession,
  type Session,
  stepKey,
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
      kind: "ssh",
      runId: "s-1",
      title: "web-01",
      target: saved,
      connectionId: "c-1",
      status: "connecting",
      steps: [],
      error: null,
      exitStatus: null,
      size: null,
      log: [],
    });
    const quick = { type: "quick", host: "10.5.5.5", port: 22, username: null } as const;
    expect(newSession("s-2", "10.5.5.5", quick).connectionId).toBeNull();
    // T25: an SFTP tab is the same session, of another kind.
    expect(newSession("s-3", "web-01", saved, "sftp").kind).toBe("sftp");
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
    // T28b: a log line is kept, on a new object.
    const logged = applySessionEvent(start, { type: "log", line: "[INFO] connected" });
    expect(logged.log).toEqual(["[INFO] connected"]);
    expect(start.log).toEqual([]);
  });

  test("the log keeps its last LOG_LIMIT lines, and a new attempt starts it again", () => {
    const lines = Array.from({ length: LOG_LIMIT + 5 }, (_, i) => `line ${i}`);
    const full = applyAll(
      newSession("s-1", "ad-01", saved, "rdp"),
      lines.map((line) => ({ type: "log", line })),
    );
    expect(full.log).toHaveLength(LOG_LIMIT);
    expect(full.log[0]).toBe("line 5");
    expect(full.log.at(-1)).toBe(`line ${LOG_LIMIT + 4}`);
    expect(restartSession(full, "run-2").log).toEqual([]);
  });

  test("an Open step reads as what it opens", () => {
    expect(stepKey({ step: "open", label: "shell" })).toBe("sessions.steps.open");
    expect(stepKey({ step: "open", label: "sftp" })).toBe("sessions.steps.openSftp");
    expect(stepKey({ step: "open", label: "tunnel" })).toBe("sessions.steps.openTunnel");
    expect(stepKey({ step: "launch", label: "sdl-freerdp3" })).toBe("sessions.steps.launch");
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

### `e2e/rdp.spec.ts` (nouveau)

```ts
// T28b: RDP tabs over the mock of T28 (ad-01: direct; win-desktop: wakes, then its client exits with 134).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function open(page: Page, name: string) {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: new RegExp(`^${name}`) })
    .first()
    .dblclick();
}

function card(page: Page, name: string) {
  return page.getByRole("region", { name: `Remote desktop ${name}` });
}

test("double-clicking an RDP connection opens its card, open, with the client's log", async ({
  page,
}) => {
  await open(page, "ad-01");
  const ad01 = card(page, "ad-01");
  await expect(ad01).toContainText("Session open · 0 min");
  await expect(ad01).toContainText("admin@10.0.0.5:3389");
  await expect(page.getByRole("contentinfo")).toContainText("rdp");
  await expectSaneUi(page);

  await ad01.getByRole("button", { name: "FreeRDP log (filtered)" }).click();
  await expect(ad01.getByRole("log", { name: "FreeRDP log (filtered)" })).toContainText(
    "connected to 10.0.0.5",
  );

  await ad01.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("a client that exits says why, and Relaunch starts it again", async ({ page }) => {
  await open(page, "win-desktop");
  const desk = card(page, "win-desktop");
  await expect(desk).toContainText("The user name or password was refused");
  await expect(desk).toContainText("(code 134)");
  await expect(
    page.getByRole("tab", { selected: true }).getByRole("img", { name: "Offline" }),
  ).toBeVisible();

  await desk.getByRole("button", { name: "Relaunch" }).click();
  await expect(
    page.getByRole("region", { name: "win-desktop", exact: true }).getByRole("status"),
  ).toContainText("Waking up win-desktop");
  await expect(desk).toContainText("(code 134)");
  await desk.getByRole("button", { name: "Close tab" }).click();
  await expect(page.getByRole("tab")).toHaveCount(0);
});

test("behind a bastion, the card shows the chain and the tunnel's local address", async ({
  page,
}) => {
  await page
    .getByRole("complementary")
    .getByRole("button", { name: /^ad-01/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  const editor = page.getByRole("dialog");
  await editor.getByRole("tab", { name: "Network" }).click();
  await editor.getByRole("combobox", { name: "Jump host" }).click();
  await page.getByRole("option", { name: "bastion-01" }).click();
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);

  await open(page, "ad-01");
  await expect(card(page, "ad-01")).toContainText("via bastion-01 (127.0.0.1:40123)");
});
```

### `e2e/home.spec.ts` (remplace la version précédente : une carte RDP ouvre son onglet)

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

test("clicking an RDP card opens its RDP tab (T28b)", async ({ page }) => {
  await closeAllTabs(page);
  await page
    .getByRole("article", { name: "ad-01" })
    .getByRole("button", { name: "ad-01", exact: true })
    .click();
  await expect(page.getByRole("region", { name: "Remote desktop ad-01" })).toBeVisible();
});
```

### `e2e/sessions.spec.ts` (remplace la version précédente : « Connect » sur une connexion RDP)

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

test("the sidebar's Connect opens a session, a terminal for SSH, a card for RDP", async ({
  page,
}) => {
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
  await expect(page.getByRole("region", { name: "Remote desktop ad-01" })).toBeVisible();
});
```

### `e2e/review-lot3.spec.ts` (remplace la version de la revue du lot 3)

```ts
// Regressions found at the lot 3 review (T12–T15b): each scenario pins a defect that `npm run review` had missed.
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

async function closeAllTabs(page: Page) {
  await page.keyboard.press("Control+Shift+W");
  await page.keyboard.press("Control+Shift+W");
  await expect(page.getByRole("tab")).toHaveCount(0);
}

test("the palette is 640 px wide, a third of the way down", async ({ page }) => {
  await page.keyboard.press("Control+Shift+P");
  const box = await page.getByRole("dialog").boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  if (!box || !viewport) return;
  // The shadcn dialog caps its width at `sm:max-w-sm` (384 px) unless the palette overrides it.
  expect(Math.round(box.width)).toBe(640);
  expect(Math.abs(box.y - viewport.height / 3)).toBeLessThan(4);
});

test("a card's hover actions sit in one row and hide the status dot", async ({ page }) => {
  await closeAllTabs(page);
  const card = page.getByRole("article", { name: "web-01" });
  await card.hover();
  // Let the hover lift (-translate-y-px, 120 ms) finish before measuring.
  await card.evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)),
  );
  const actions = [
    card.getByRole("button", { name: "Connect to web-01" }),
    card.getByRole("button", { name: "Open SFTP on web-01" }),
    card.getByRole("button", { name: "Edit web-01" }),
  ];
  const tops = await Promise.all(actions.map(async (a) => (await a.boundingBox())?.y));
  expect(new Set(tops).size, "one row of actions").toBe(1);
  // Whatever its probe found (T30), the dot hides under the actions.
  await expect(card.getByRole("img", { name: /^(Online|Offline|Unknown)$/ })).toBeHidden();
});

test("the card's padding opens the connection too", async ({ page }) => {
  await closeAllTabs(page);
  const box = await page.getByRole("article", { name: "ad-01" }).boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;
  await page.mouse.click(box.x + 6, box.y + box.height - 6);
  await expect(page.getByRole("region", { name: "Remote desktop ad-01" })).toBeVisible();
});

test("toggling import rows with the keyboard keeps the focus", async ({ page }) => {
  await page.getByRole("button", { name: "Import connections", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const staging = dialog.getByRole("checkbox", { name: "Select staging" });
  await staging.focus();
  await page.keyboard.press("Space");
  await expect(staging).toBeFocused();
  await expect(staging).toHaveAttribute("data-state", "unchecked");
  await page.keyboard.press("Space");
  await expect(staging).toHaveAttribute("data-state", "checked");
});

test("import: partial selection and rows in error are visible as such", async ({ page }) => {
  await page.getByRole("button", { name: "Import connections", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("checkbox", { name: "Select all" })).toHaveAttribute(
    "aria-checked",
    "mixed",
  );
  // A dash, not the check mark of "checked" (the shadcn checkbox drew the same icon for both).
  await expect(dialog.getByRole("checkbox", { name: "Select all" }).locator("svg")).toHaveClass(
    /lucide-minus/,
  );
  const broken = dialog.getByRole("row").filter({ hasText: "broken" });
  const staging = dialog.getByRole("row").filter({ hasText: "staging" });
  await expect(broken).toHaveAttribute("aria-disabled", "true");
  const colorOf = (row: typeof broken) =>
    row
      .getByRole("cell")
      .nth(1)
      .evaluate((cell) => getComputedStyle(cell).color);
  expect(await colorOf(broken)).not.toBe(await colorOf(staging));
});

test("replacing a stored secret keeps a compact Cancel button", async ({ page }) => {
  await page.keyboard.press("Control+Shift+N");
  const editor = page.getByRole("dialog");
  await editor.getByLabel("Name", { exact: true }).fill("vault");
  await editor.getByLabel("Host", { exact: true }).fill("10.9.9.9");
  await editor.getByRole("tab", { name: "Authentication" }).click();
  await editor.getByRole("radio", { name: "Password", exact: true }).click();
  await editor.getByLabel("Password (optional)").fill("hunter2");
  await editor.getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor).toHaveCount(0);

  await page
    .getByRole("button", { name: /^vault/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  await editor.getByRole("tab", { name: "Authentication" }).click();
  await editor.getByRole("button", { name: "Replace", exact: true }).click();
  await expect(editor.getByLabel("Password (optional)")).toBeVisible();
  await expectSaneUi(page);
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T28b`.
2. `session-model.ts`, `store.ts`, `open-session.ts` : `npx vitest run src/features/sessions`.
3. `rdp/rdp-model.ts`, `RdpCard.tsx`, `RdpMissingCard.tsx`, `en.json`, `fr.json` : `npx vitest run src/features/rdp`.
4. `SessionView.tsx`, `lib/mock/rdp-session.ts` : `npm run typecheck`, `npm run check`,
   `npx playwright test e2e/rdp.spec.ts e2e/home.spec.ts e2e/sessions.spec.ts e2e/review-lot3.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, ligne « Works today » du `README.md` (et retirer RDP de la
   colonne « Not yet »), commit `feat: RDP tab with session card, exit reasons and client install help (T28b)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T28b --check` affiche `OK` partout.
- [x] `grep -rn "Opening the shell" src/i18n/locales/en.json` ne trouve qu'une clé (`sessions.steps.open`).
- [x] Aucune nouvelle exception `project-rules: allow`.
- [ ] Visuel : en clair et en sombre, la carte est centrée, le halo de l'icône est doux, la raison d'une fin se lit
      comme un échec sans être criarde, et le journal déplié défile sans élargir la carte.

## À regarder par Florian

`npm run tauri dev`, avec FreeRDP 3 installé : double-clic sur une connexion RDP. La fenêtre de FreeRDP s'ouvre,
l'onglet montre la carte « Session open ». Ferme la fenêtre de FreeRDP : la carte dit pourquoi la session s'est
terminée, et « Relaunch » la rouvre. Sans FreeRDP, l'onglet donne la commande d'installation de ta distribution.
