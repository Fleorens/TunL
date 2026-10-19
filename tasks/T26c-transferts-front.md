# T26c — Transferts SFTP : IPC, mock, modèle et store (frontend)

| | |
|---|---|
| **Jalon** | M4 — SFTP |
| **Dépend de** | T26 |
| **Lire avant** | `docs/05-modele-donnees.md` §8 (`TransferEvent`), `docs/06-securite.md` S14 |
| **Livrable** | `ipc.ts` (3 commandes), `lib/opener.ts` (`revealInFolder`), mock des transferts, `transfer-model.ts`, `transfers-store.ts` ; 2 fichiers de tests |

## Pourquoi

T26 a écrit le moteur Rust des transferts et ses commandes (`sftp_download`, `sftp_upload`, `transfer_cancel`) ainsi
que le binding `TransferEvent.ts`. Cette fiche les branche côté frontend, **sans interface** : l'IPC, le mock (pour
le navigateur et les e2e), un modèle pur et le store zustand. T26d s'en servira pour le panneau et l'explorateur,
T26b pour l'envoi.

## À réutiliser (ne pas réécrire)

- T26 : `src/bindings/TransferEvent.ts` (généré, jamais édité).
- T24 : le mock `lib/mock/sftp.ts` (son système de fichiers).
- T25 : `formatSize` (`sftp-model.ts`).
- `lib/opener.ts` (le **seul** fichier qui importe le plugin `opener`), `describeError`, `notifyError`, `toAppError`.

## Contrat

### `src-tauri/capabilities/default.json`

Ajouter `"opener:allow-reveal-item-in-dir"` (bouton « Afficher dans son dossier »). Rien d'autre (S14).

### Frontend

- `ipc.ts`, section `// Transfers (T26): …` : `sftpDownload(sessionId, transferId, remotePath, onEvent)`,
  `sftpUpload(sessionId, transferId, localPath, remoteDir, onEvent)`, `transferCancel(transferId)`. `onEvent` passe
  par une fonction `transferChannel(onEvent)` : la fonction elle-même pour le mock, un
  `new Channel<TransferEvent>(onEvent)` dans Tauri.
- `lib/opener.ts` : `revealInFolder(path)` → `revealItemInDir(path)` ; dans le navigateur, rien.
- Mock :
  - `lib/mock/sftp.ts` exporte en plus `mockRemoteNode(sessionId, path)` (refuse un onglet non connecté),
    `mockRemoteWrite(path, size)` et `mockRemoteNames(dir)` ;
  - `lib/mock/transfers.ts` (nouveau) : `MOCK_DOWNLOAD_DIR = "/home/user/Downloads"`, `transferHandlers` (les 3
    commandes) et `resetMockTransfers()`. Progression par pas : un pas par 20 Mo (1 à 40), un pas toutes les
    150 ms (**5 ms** en mode test, pas 0 : un gros fichier doit encore tourner quand un test l'annule), débit affiché
    12,4 Mo/s. Téléchargement : fichier absent ou dossier → `failed` `notFound` ; sinon `done` vers
    `MOCK_DOWNLOAD_DIR/<nom libre>` (les noms déjà téléchargés sont retenus). Envoi : `done` vers le premier nom libre
    du dossier distant, où le fichier apparaît (taille fictive). `transfer_cancel` arrête les pas et envoie
    `cancelled` ;
  - `ipc-mock.ts` : `...transferHandlers`, et `resetMockTransfers()` dans `resetMockBackend()`.

### `src/features/sftp/`

| Fichier | Contenu |
|---|---|
| `transfer-model.ts` (pur) | `Transfer { id, sessionId, direction: "download" \| "upload", name, transferred, total, bytesPerSec, status: "running" \| "done" \| "failed" \| "cancelled", error, path }` ; `newTransfer(id, sessionId, direction, name)` ; `applyTransferEvent(t, event)` (nouvel objet ; un transfert fini ne bouge plus et est rendu **tel quel**) ; `percentOf(t)` (`done` → 100, total inconnu ou nul → `null`, sinon l'entier inférieur) |
| `transfers-store.ts` | `useTransfers` (zustand) : `transfers`, `download(sessionId, entry)`, `upload(sessionId, localPath, remoteDir, onDone?)` (pour T26b), `cancel(id)`, `clearFinished(sessionId)`. Un appel `ipc` rejeté devient un événement `failed` du transfert |

## Pièges

- `Channel` de Tauri : construit **seulement** dans `src/lib/ipc.ts` (`transferChannel`), et seulement dans Tauri.
- Mock : un pas toutes les **5 ms** en mode test, pas 0 — un gros fichier doit encore tourner quand un test
  l'annule.
- `applyTransferEvent` : un transfert fini est rendu **tel quel** (même objet), pas une copie.

## Tests du contrat

### `src/features/sftp/transfer-model.test.ts` (nouveau)

```ts
// T26: a transfer's life, as the panel shows it.
import { describe, expect, test } from "vitest";
import { applyTransferEvent, newTransfer, percentOf } from "./transfer-model";

const start = newTransfer("t-1", "run-1", "download", "backup.tar.gz");

describe("transfers", () => {
  test("a new transfer runs, with nothing transferred yet", () => {
    expect(start).toMatchObject({ status: "running", transferred: 0, total: null, path: null });
    expect(percentOf(start)).toBeNull();
  });

  test("progress, then done", () => {
    const half = applyTransferEvent(start, {
      type: "progress",
      transferred: 50,
      total: 200,
      bytesPerSec: 1000,
    });
    expect(percentOf(half)).toBe(25);
    expect(half.bytesPerSec).toBe(1000);
    const done = applyTransferEvent(half, {
      type: "done",
      path: "/home/me/Downloads/backup.tar.gz",
    });
    expect(done.status).toBe("done");
    expect(done.path).toBe("/home/me/Downloads/backup.tar.gz");
    expect(percentOf(done)).toBe(100);
    expect(start.transferred).toBe(0);
  });

  test("failed and cancelled are final: a late event changes nothing", () => {
    const error = { kind: "notFound" as const, message: "/srv/x", detail: null };
    const failed = applyTransferEvent(start, { type: "failed", error });
    expect(failed).toMatchObject({ status: "failed", error });
    const cancelled = applyTransferEvent(start, { type: "cancelled" });
    expect(cancelled.status).toBe("cancelled");
    const late = applyTransferEvent(cancelled, {
      type: "progress",
      transferred: 9,
      total: 10,
      bytesPerSec: 1,
    });
    expect(late).toBe(cancelled);
  });

  test("an empty file is not a division by zero", () => {
    const empty = applyTransferEvent(start, {
      type: "progress",
      transferred: 0,
      total: 0,
      bytesPerSec: 0,
    });
    expect(percentOf(empty)).toBeNull();
  });
});
```

### `src/lib/mock/transfers.test.ts` (nouveau)

```ts
// T26: the mock's transfers, which the panel is built against.
import { beforeEach, describe, expect, test } from "vitest";
import type { TransferEvent } from "@/bindings/TransferEvent";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";

beforeEach(() => {
  resetMockBackend();
});

async function openTab(): Promise<string> {
  const id = crypto.randomUUID();
  await new Promise<void>((resolve) => {
    void ipc.sftpOpen(id, { type: "saved", connectionId: MOCK_IDS.nas }, (event) => {
      if (event.type === "connected") resolve();
    });
  });
  return id;
}

/** Start a transfer and collect its events until the last one. */
function collect(start: (onEvent: (e: TransferEvent) => void) => Promise<void>) {
  return new Promise<TransferEvent[]>((resolve) => {
    const events: TransferEvent[] = [];
    void start((event) => {
      events.push(event);
      if (event.type !== "progress") resolve(events);
    });
  });
}

describe("mock transfers", () => {
  test("a download reports progress, then where it landed; never over an earlier one", async () => {
    const tab = await openTab();
    const first = await collect((on) =>
      ipc.sftpDownload(tab, crypto.randomUUID(), "/home/admin/notes.txt", on),
    );
    expect(first[0]).toMatchObject({ type: "progress", total: 512 });
    expect(first.at(-1)).toEqual({ type: "done", path: "/home/user/Downloads/notes.txt" });
    const second = await collect((on) =>
      ipc.sftpDownload(tab, crypto.randomUUID(), "/home/admin/notes.txt", on),
    );
    expect(second.at(-1)).toEqual({ type: "done", path: "/home/user/Downloads/notes (1).txt" });
  });

  test("a missing file fails as not found", async () => {
    const tab = await openTab();
    const events = await collect((on) =>
      ipc.sftpDownload(tab, crypto.randomUUID(), "/home/admin/nope", on),
    );
    expect(events.at(-1)).toMatchObject({ type: "failed", error: { kind: "notFound" } });
  });

  test("an upload lands in the folder, beside an existing file of the same name", async () => {
    const tab = await openTab();
    const one = await collect((on) =>
      ipc.sftpUpload(tab, crypto.randomUUID(), "/home/me/notes.txt", "/home/admin", on),
    );
    expect(one.at(-1)).toEqual({ type: "done", path: "/home/admin/notes (1).txt" });
    const names = (await ipc.sftpList(tab, "/home/admin")).map((e) => e.name);
    expect(names).toContain("notes (1).txt");
  });

  test("a cancelled transfer ends with cancelled", async () => {
    const tab = await openTab();
    const id = crypto.randomUUID();
    const events = await collect(async (on) => {
      await ipc.sftpDownload(tab, id, "/home/admin/backup.tar.gz", on);
      await ipc.transferCancel(id);
    });
    expect(events.at(-1)).toEqual({ type: "cancelled" });
  });
});
```


## Étapes

1. Les tests : `node scripts/contract-tests.mjs T26c`.
2. `capabilities/default.json`, `ipc.ts`, `lib/opener.ts`, `lib/mock/sftp.ts`, `lib/mock/transfers.ts`,
   `ipc-mock.ts` : `npm run typecheck`, `npx vitest run src/lib`.
3. `transfer-model.ts`, `transfers-store.ts` : `npx vitest run src/features/sftp`.
4. `npm run format`, `npm run review`, cases, statut, commit
   `feat: SFTP transfers: IPC, mock, model and store (T26c)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T26c --check` affiche `OK` partout.
- [ ] `grep -rn "plugin-opener" src` ne trouve que `src/lib/opener.ts`.
- [ ] `grep -rn "new Channel" src` ne trouve que `src/lib/ipc.ts`.
- [ ] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

Rien à l'écran : pas encore d'interface (T26d).
