# T26c — Transferts SFTP : modèle et store (frontend)

| | |
|---|---|
| **Jalon** | M4 — SFTP |
| **Dépend de** | T26 |
| **Lire avant** | `docs/05-modele-donnees.md` §8 (`TransferEvent`), `docs/06-securite.md` S14 |
| **Livrable** | `lib/opener.ts` (`revealInFolder`), `transfer-model.ts`, `transfers-store.ts` ; 1 fichier de tests |

## Pourquoi

T26 a écrit le moteur Rust des transferts, ses commandes (`sftp_download`, `sftp_upload`, `transfer_cancel`), leur
IPC (`ipc.sftpDownload`…) et leur mock. Cette fiche ajoute, **sans interface**, un modèle pur et le store zustand. T26d s'en servira pour le panneau et l'explorateur,
T26b pour l'envoi.

## À réutiliser (ne pas réécrire)

- T26 : `src/bindings/TransferEvent.ts` (généré, jamais édité), `ipc.sftpDownload`, `ipc.sftpUpload`,
  `ipc.transferCancel`, le mock des transferts.
- T25 : `formatSize` (`sftp-model.ts`).
- `lib/opener.ts` (le **seul** fichier qui importe le plugin `opener`), `describeError`, `notifyError`, `toAppError`.

## Contrat

### `src-tauri/capabilities/default.json`

Ajouter `"opener:allow-reveal-item-in-dir"` (bouton « Afficher dans son dossier »). Rien d'autre (S14).

### Frontend

- `lib/opener.ts` : `revealInFolder(path)` → `revealItemInDir(path)` ; dans le navigateur, rien.

### `src/features/sftp/`

| Fichier | Contenu |
|---|---|
| `transfer-model.ts` (pur) | `Transfer { id, sessionId, direction: "download" \| "upload", name, transferred, total, bytesPerSec, status: "running" \| "done" \| "failed" \| "cancelled", error, path }` ; `newTransfer(id, sessionId, direction, name)` ; `applyTransferEvent(t, event)` (nouvel objet ; un transfert fini ne bouge plus et est rendu **tel quel**) ; `percentOf(t)` (`done` → 100, total inconnu ou nul → `null`, sinon l'entier inférieur) |
| `transfers-store.ts` | `useTransfers` (zustand) : `transfers`, `download(sessionId, entry)`, `upload(sessionId, localPath, remoteDir, onDone?)` (pour T26b), `cancel(id)`, `clearFinished(sessionId)`. Un appel `ipc` rejeté devient un événement `failed` du transfert |

## Pièges

- `Channel` de Tauri : construit **seulement** dans `src/lib/ipc.ts` (déjà fait en T26) : le store passe une
  simple fonction de rappel.
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

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T26c`.
2. `capabilities/default.json`, `lib/opener.ts` : `npm run typecheck`.
3. `transfer-model.ts`, `transfers-store.ts` : `npx vitest run src/features/sftp`.
4. `npm run format`, `npm run review`, cases, statut, commit
   `feat: SFTP transfers: model and store (T26c)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T26c --check` affiche `OK` partout.
- [x] `grep -rn "plugin-opener" src` ne trouve que `src/lib/opener.ts`.
- [x] `grep -rn "new Channel" src` ne trouve que `src/lib/ipc.ts`.
- [x] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

Rien à l'écran : pas encore d'interface (T26d).
