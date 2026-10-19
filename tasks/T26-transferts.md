# T26 — Transferts SFTP : moteur (téléchargement, envoi), annulation, panneau, téléchargement depuis l'explorateur

| | |
|---|---|
| **Jalon** | M4 — SFTP |
| **Dépend de** | T25b |
| **Lire avant** | `docs/04-ecrans.md` §6 (panneau « Transferts »), `docs/06-securite.md` **S11**, S7, S8 et S14, `docs/05-modele-donnees.md` §5 (`ui.downloadDir`) et §8 (`TransferEvent`) |
| **Livrable** | `sftp/transfer.rs` (téléchargement et envoi en flux), `TransferRegistry`, commandes `sftp_download`, `sftp_upload`, `transfer_cancel` + ipc + mock ; panneau des transferts ; téléchargement par double-clic et par le menu ; 6 fichiers de tests |

## Pourquoi

L'explorateur sait parcourir et agir ; il ne sait pas encore **transférer**. Cette fiche écrit le moteur dans les
deux sens (l'envoi servira à T26b, qui n'ajoute que son interface) et branche le **téléchargement** : double-clic
sur un fichier, ou « Télécharger » dans le menu. Les transferts tournent en tâche de fond, rapportent leur
progression par un `Channel`, et s'affichent dans un panneau repliable sous l'explorateur.

S11 : un fichier téléchargé garde **seulement son nom de base**, et rien n'est jamais écrasé (` (1)`, ` (2)`…).
Un transfert écrit d'abord un fichier `.part`, renommé à la fin : annulé ou raté, il ne laisse rien sous le vrai nom.

Prototypé par l'orchestrateur contre les conteneurs de T16 (3 Mo aller-retour octet pour octet, annulation d'un
fichier de 64 Mo) : les tests de cette fiche passent.

## À réutiliser (ne pas réécrire)

- T24 : `sftp::ops::{join, valid_name, validate_remote_path, map_sftp_error, list}`, `state.sftp.get(session_id)`,
  `commands/ipc_tests.rs`. Le mock : `lib/mock/sftp.ts` (son système de fichiers).
- T18 : `ssh::auth::expand_home(path, home)` (pour `ui.downloadDir` qui commence par `~/`).
- T25 / T25b : `SftpExplorer` (son `open`), `EntryMenu`, `formatSize` (`sftp-model.ts`).
- shadcn : `collapsible`, `progress`, `button` (tailles `xs`, `icon-xs`).
- `lib/opener.ts` (le **seul** fichier qui importe le plugin `opener`), `describeError`, `notifyError`, `toAppError`.

## Contrat — Rust

### `src-tauri/src/sftp/transfer.rs` (nouveau ; `sftp/mod.rs` : `pub mod transfer;` et `#[cfg(test)] mod transfer_tests;`)

```rust
pub const CHUNK_SIZE: usize = 64 * 1024;
pub const PROGRESS_INTERVAL: Duration = Duration::from_millis(100);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[ts(export)]
pub enum TransferEvent {
    Progress { transferred: u64, total: Option<u64>, bytes_per_sec: u64 },
    Done { path: String },     // où le fichier a fini : local pour un téléchargement, distant pour un envoi
    Failed { error: AppError },
    Cancelled,
}

pub trait TransferSink: Send + Sync { fn event(&self, event: TransferEvent); }

pub fn suffixed(name: &str, n: u32) -> String;
pub fn first_free(name: &str, taken: impl Fn(&str) -> bool) -> String;
pub fn local_target(dir: &Path, remote_name: &str) -> AppResult<PathBuf>;
pub async fn download(sftp: &SftpSession, remote: &str, local_dir: &Path, cancel: CancellationToken, sink: &dyn TransferSink);
pub async fn upload(sftp: &SftpSession, local: &Path, remote_dir: &str, cancel: CancellationToken, sink: &dyn TransferSink);
```

⚠ `Done { path }` : `docs/05-modele-donnees.md` §8 écrit `Done` sans champ ; le chemin d'arrivée sert au bouton
« Afficher dans son dossier ». L'orchestrateur mettra le document à jour.

| Fonction | Comportement |
|---|---|
| `suffixed` | ` (n)` avant l'extension : `report (1).pdf`, `archive.tar (2).gz`, `notes (3)`, `.bashrc (1)` (un point en tête n'est pas une extension) |
| `first_free` | `name` s'il est libre, sinon le premier `suffixed(name, 1, 2, …)` libre |
| `local_target` | nom invalide (`valid_name`) → `validation("path", …)` ; sinon `dir.join(first_free(…))`, où un nom est pris s'il existe **ou** si son `.part` existe |
| `download` | le nom de base de `remote` ; `local_target` ; taille par `sftp.metadata` (stat : un lien vers un fichier se télécharge) ; `sftp.open` ; le `.part` créé avec `create_new(true)` ; copie ; succès → `rename` du `.part` vers le vrai nom, `Done { path }` ; annulé → `.part` supprimé, `Cancelled` ; erreur → `.part` supprimé, `Failed` |
| `upload` | `local` doit avoir un nom de base valide (`validation("localPath", …)`) ; taille par les métadonnées locales ; le nom distant libre d'après `ops::list(remote_dir)` (un `.part` compte) ; `sftp.create("<cible>.part")` ; copie ; `shutdown` ; succès → `sftp.rename` vers la cible, `Done { path: cible }` ; annulé ou raté → `sftp.remove_file` du `.part` |
| la copie (privée) | blocs de `CHUNK_SIZE` ; chaque lecture dans un `tokio::select!` avec `cancel` ; un `Progress` au plus toutes les `PROGRESS_INTERVAL`, **et un dernier à la fin** (transféré = total) ; `bytes_per_sec` = transféré / temps écoulé |

`download` et `upload` envoient **exactement un** événement final (`Done`, `Failed` ou `Cancelled`), en dernier.
Erreur locale → `ErrorKind::Io` avec un message fixe (`"cannot create the local file"`, `"cannot read the local
file"`, `"the transfer broke off"`…) et l'erreur système dans un `log::warn!`. Jamais le contenu d'un fichier dans
un journal (S8).

### `src-tauri/src/sftp/mod.rs`

```rust
/// Les transferts en cours, par id : le jeton qui annule chacun.
#[derive(Default)]
pub struct TransferRegistry { /* Mutex<HashMap<Uuid, CancellationToken>> */ }
impl TransferRegistry {
    pub fn insert(&self, id: Uuid, cancel: CancellationToken) -> AppResult<()>;   // id déjà pris → validation("transferId", …)
    pub fn cancel(&self, id: Uuid);   // inconnu ou fini : rien
    pub fn remove(&self, id: Uuid);
}
```

`state.rs` : `pub transfers: Arc<TransferRegistry>` dans `AppState` (aux deux endroits où `sftp` est construit).

### `src-tauri/src/commands/transfer.rs` (nouveau)

| Commande | Arguments | Comportement |
|---|---|---|
| `sftp_download` | `app: AppHandle<R>`, `session_id: Uuid`, `transfer_id: Uuid`, `remote_path: String`, `on_event: Channel<TransferEvent>` | la session (`NotFound` si l'onglet n'est pas connecté) ; le dossier : `ui.downloadDir` (avec `~/` développé) s'il est réglé, sinon `app.path().download_dir()` ; pas un dossier → `validation("ui.downloadDir", …)` ; inscription dans `transfers`, puis `spawn` de `download`, et `transfers.remove` à la fin. Répond tout de suite |
| `sftp_upload` | `session_id`, `transfer_id`, `local_path: String`, `remote_dir: String`, `on_event` | `local_path` doit être absolu (`validation("localPath", …)`) ; même déroulé avec `upload` |
| `transfer_cancel` | `transfer_id: Uuid` | `transfers.cancel(id)` ; jamais d'erreur |

`sftp_download` est générique sur le runtime (`<R: Runtime>`) pour que `ipc_tests.rs` l'appelle avec `MockRuntime`.
Le `Channel` est enveloppé dans une petite struct qui implémente `TransferSink` (un envoi raté → `log::warn!`).
`commands/mod.rs` : `pub mod transfer;` et `#[cfg(test)] mod ipc_transfer_tests;`. `lib.rs` : les 3 commandes.

### `src-tauri/capabilities/default.json`

Ajouter `"opener:allow-reveal-item-in-dir"` (bouton « Afficher dans son dossier »). Rien d'autre (S14).

## Contrat — Frontend

- `npm run bindings` : `TransferEvent.ts`.
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
| `TransfersPanel.tsx` | `TransfersPanel({ sessionId })` : rien sans transfert ; sinon un `Collapsible` ouvert par défaut, bordure haute : un en-tête bouton « Transfers (n) » (chevron qui tourne), « Clear finished » s'il y a un transfert fini ; une liste (`aria-label` « Transfers », `max-h-40`, défilante), une ligne par transfert (`aria-label` = son nom) : flèche (bas pour un téléchargement), nom, puis en cours une `Progress` (`aria-label` = le nom) + `NN %` + débit `12 MB/s`, sinon « Done » / « Cancelled » / le titre de l'erreur (en `text-destructive`) ; à droite « Cancel <nom> » (en cours) ou « Show <nom> in its folder » (téléchargement fini) |

- `SftpExplorer.tsx` : ouvrir un **fichier** (`file` ou `other`) → `download` ; `<TransfersPanel>` sous le tableau.
- `EntryMenu.tsx` : « Download » (`Download`), en tête, pour une entrée qui n'est pas un dossier.
- i18n (`en` et `fr`) : `sftp.menu.download`, `sftp.transfers.{title_one, title_other, list, clear, rate, done,
  failed, cancelled, cancel, reveal}` (anglais : « Transfers ({{count}}) », « Transfers », « Clear finished »,
  « {{rate}}/s », « Done », « Failed », « Cancelled », « Cancel {{name}} », « Show {{name}} in its folder »).

## Pièges (vus au prototype)

- `tokio::fs::OpenOptions::create_new(true)` pour le `.part` : jamais d'écrasement, même en course.
- Côté serveur, `sftp.create` remplace un fichier existant : c'est pourquoi le nom libre est choisi d'abord, et
  pourquoi on écrit dans un `.part` distinct.
- `SftpSession::write(path, data)` n'ouvre qu'un fichier **existant** : pour envoyer, `create`, puis `write_all` et
  `shutdown`.
- Un `Progress` final est indispensable : sans lui, une barre resterait à 97 % jusqu'à `Done`.
- Sélecteur zustand : `useTransfers((s) => s.transfers)` puis un `useMemo` qui filtre par session ; jamais
  `s.transfers.filter(…)` dans le sélecteur (nouveau tableau à chaque rendu → boucle infinie).
- Le panneau vit **dans** l'explorateur : une reconnexion (nouveau `runId`) repart d'un panneau vide.
- **`npm run test:ssh` recrée les conteneurs** avec les clés de ton clone : ne le lance jamais pendant qu'un autre
  clone l'utilise.

## Tests du contrat

### `src-tauri/src/sftp/transfer_tests.rs` (nouveau)

```rust
use super::transfer::{first_free, local_target, suffixed};
use crate::error::ErrorKind;

#[test]
fn the_suffix_goes_before_the_extension() {
    assert_eq!(suffixed("report.pdf", 1), "report (1).pdf");
    assert_eq!(suffixed("archive.tar.gz", 2), "archive.tar (2).gz");
    assert_eq!(suffixed("notes", 3), "notes (3)");
    assert_eq!(suffixed(".bashrc", 1), ".bashrc (1)");
}

#[test]
fn the_first_free_name_is_kept() {
    assert_eq!(first_free("a.txt", |_| false), "a.txt");
    let taken = ["a.txt", "a (1).txt"];
    assert_eq!(first_free("a.txt", |n| taken.contains(&n)), "a (2).txt");
}

#[test]
fn a_download_never_replaces_a_local_file() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        local_target(dir.path(), "log.txt").unwrap(),
        dir.path().join("log.txt")
    );
    std::fs::write(dir.path().join("log.txt"), b"mine").unwrap();
    assert_eq!(
        local_target(dir.path(), "log.txt").unwrap(),
        dir.path().join("log (1).txt")
    );
    // A transfer in progress (its .part file) holds its name too.
    std::fs::write(dir.path().join("log (1).txt.part"), b"").unwrap();
    assert_eq!(
        local_target(dir.path(), "log.txt").unwrap(),
        dir.path().join("log (2).txt")
    );
}

#[test]
fn only_a_plain_base_name_is_accepted() {
    let dir = tempfile::tempdir().unwrap();
    for bad in ["", ".", "..", "a/b", "x\0y"] {
        let error = local_target(dir.path(), bad).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Validation, "{bad:?}");
    }
}
```

### `src-tauri/src/commands/ipc_transfer_tests.rs` (nouveau)

```rust
use serde_json::json;

use super::ipc_tests::{invoke, mock_app, ok};

#[test]
fn transfer_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let session = "5b6f2d3e-0000-4000-8000-000000000051";
    let transfer = "5b6f2d3e-0000-4000-8000-000000000052";

    // No SFTP tab is connected: the arguments were read, the session was not found.
    let error = invoke(
        &webview,
        "sftp_download",
        json!({
            "sessionId": session,
            "transferId": transfer,
            "remotePath": "/srv/a.txt",
            "onEvent": "__CHANNEL__:1"
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound", "{error}");

    let error = invoke(
        &webview,
        "sftp_upload",
        json!({
            "sessionId": session,
            "transferId": transfer,
            "localPath": "/tmp/a.txt",
            "remoteDir": "/srv",
            "onEvent": "__CHANNEL__:1"
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound", "{error}");

    // Cancelling an unknown transfer is not an error.
    ok(
        &webview,
        "transfer_cancel",
        json!({ "transferId": transfer }),
    );
}
```

### `src-tauri/tests/ssh_transfer.rs` (nouveau, contre podman : `npm run test:ssh`)

```rust
//! T26 against the podman target of T16: upload a file, download it back, byte for byte; cancel; never overwrite.
//! `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh_sftp::client::SftpSession;
use support::{TestEnv, context, respond};
use tokio_util::sync::CancellationToken;
use tunl_lib::error::ErrorKind;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink};
use tunl_lib::sftp::ops;
use tunl_lib::sftp::session::open_sftp;
use tunl_lib::sftp::transfer::{TransferEvent, TransferSink, download, upload};
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::link::{SshLink, establish};
use tunl_lib::ssh::session::SshTarget;
use uuid::Uuid;

struct Quiet;

impl SessionSink for Quiet {
    fn event(&self, _event: SessionEvent) {}
    fn output(&self, _bytes: Vec<u8>) {}
}

#[derive(Default)]
struct Events(Mutex<Vec<TransferEvent>>);

impl TransferSink for Events {
    fn event(&self, event: TransferEvent) {
        self.0.lock().unwrap().push(event);
    }
}

impl Events {
    fn all(&self) -> Vec<TransferEvent> {
        self.0.lock().unwrap().clone()
    }
    fn last(&self) -> Option<TransferEvent> {
        self.all().last().cloned()
    }
}

/// A link to the target, its SFTP session, and a fresh remote directory.
async fn sftp(env: &TestEnv, dir: &std::path::Path) -> (SshLink, SftpSession, String) {
    let target = SshTarget {
        connection_id: Some(Uuid::new_v4()),
        connection_name: "target".into(),
        host: env.host("target"),
        port: env.port("target"),
        username: env.user(),
        plan: AuthPlan::Password,
        connect_timeout: Duration::from_secs(5),
        keepalive_secs: 15,
        jump_hosts: Vec::new(),
    };
    let secrets = SecretStore::memory();
    secrets
        .set(
            target.connection_id.unwrap(),
            "target",
            SecretKind::Password,
            &SecretValue::new(env.password()),
        )
        .await
        .unwrap();
    let broker = Arc::new(PromptBroker::new());
    respond(&broker, vec![]);
    let ctx = context(env, dir, broker, secrets);
    let link = establish(
        &ctx,
        &target,
        Uuid::new_v4(),
        CancellationToken::new(),
        &Quiet,
    )
    .await
    .expect("a link to the target");
    let sftp = open_sftp(&link.target).await.unwrap();
    let base = format!("/tmp/tunl-transfer-{}", Uuid::new_v4());
    ops::mkdir(&sftp, &base).await.unwrap();
    (link, sftp, base)
}

/// Pseudo-random bytes, so a byte out of place shows.
fn payload(len: usize) -> Vec<u8> {
    (0..len).map(|i| ((i * 7919) % 251) as u8).collect()
}

#[tokio::test]
async fn upload_then_download_round_trips_byte_for_byte() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;

    let local = dir.path().join("data.bin");
    let bytes = payload(3 * 1024 * 1024 + 17);
    std::fs::write(&local, &bytes).unwrap();

    let up = Events::default();
    upload(&sftp, &local, &base, CancellationToken::new(), &up).await;
    let remote = format!("{base}/data.bin");
    assert_eq!(
        up.last(),
        Some(TransferEvent::Done {
            path: remote.clone()
        })
    );
    let progress: Vec<u64> = up
        .all()
        .iter()
        .filter_map(|e| match e {
            TransferEvent::Progress {
                transferred, total, ..
            } => {
                assert_eq!(*total, Some(bytes.len() as u64));
                Some(*transferred)
            }
            _ => None,
        })
        .collect();
    assert_eq!(
        progress.last(),
        Some(&(bytes.len() as u64)),
        "the last progress is complete"
    );
    assert!(
        progress.windows(2).all(|w| w[0] <= w[1]),
        "progress never goes back"
    );

    // Uploaded again: the remote copy is not replaced.
    let again = Events::default();
    upload(&sftp, &local, &base, CancellationToken::new(), &again).await;
    assert_eq!(
        again.last(),
        Some(TransferEvent::Done {
            path: format!("{base}/data (1).bin")
        })
    );

    let downloads = tempfile::tempdir().unwrap();
    let down = Events::default();
    download(
        &sftp,
        &remote,
        downloads.path(),
        CancellationToken::new(),
        &down,
    )
    .await;
    let landed = downloads.path().join("data.bin");
    assert_eq!(
        down.last(),
        Some(TransferEvent::Done {
            path: landed.display().to_string()
        })
    );
    assert_eq!(std::fs::read(&landed).unwrap(), bytes);

    // Downloaded again: the local copy is not replaced either.
    let twice = Events::default();
    download(
        &sftp,
        &remote,
        downloads.path(),
        CancellationToken::new(),
        &twice,
    )
    .await;
    assert!(downloads.path().join("data (1).bin").exists());
    assert_eq!(
        std::fs::read_dir(downloads.path()).unwrap().count(),
        2,
        "no .part left"
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_cancelled_transfer_leaves_no_partial_file() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;
    let local = dir.path().join("big.bin");
    std::fs::write(&local, payload(64 * 1024 * 1024)).unwrap();

    // Cancelled as soon as the first progress comes in.
    let cancel = CancellationToken::new();
    let events = Arc::new(Events::default());
    let watcher = {
        let (cancel, events) = (cancel.clone(), events.clone());
        tokio::spawn(async move {
            while !events
                .all()
                .iter()
                .any(|e| matches!(e, TransferEvent::Progress { .. }))
            {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
            cancel.cancel();
        })
    };
    upload(&sftp, &local, &base, cancel, &*events).await;
    watcher.await.unwrap();
    assert_eq!(events.last(), Some(TransferEvent::Cancelled));
    assert!(
        ops::list(&sftp, &base).await.unwrap().is_empty(),
        "nothing left remotely"
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_missing_remote_file_fails_without_a_local_file() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;
    let downloads = tempfile::tempdir().unwrap();

    let events = Events::default();
    download(
        &sftp,
        &format!("{base}/nope.txt"),
        downloads.path(),
        CancellationToken::new(),
        &events,
    )
    .await;
    match events.last() {
        Some(TransferEvent::Failed { error }) => assert_eq!(error.kind, ErrorKind::NotFound),
        other => panic!("expected a failure, got {other:?}"),
    }
    assert_eq!(std::fs::read_dir(downloads.path()).unwrap().count(), 0);

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}
```

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

### `e2e/sftp-transfers.spec.ts` (nouveau)

```ts
// T26: downloads from the explorer, and the transfers panel (mock: backup.tar.gz is 700 MB, a few seconds).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  await expect(row(page, "notes.txt")).toBeVisible();
});

function nas(page: Page) {
  return page.getByRole("region", { name: "nas", exact: true });
}

function row(page: Page, name: string) {
  return nas(page)
    .getByRole("table", { name: "Files" })
    .getByRole("row", { name: new RegExp(`^${name.replace(".", "\\.")}\\b`) });
}

function transfers(page: Page) {
  return nas(page).getByRole("list", { name: "Transfers" });
}

test("double-clicking a file downloads it; the panel says when it is done", async ({ page }) => {
  await row(page, "notes.txt").dblclick();
  await expect(nas(page).getByRole("button", { name: "Transfers (1)" })).toBeVisible();
  const line = transfers(page).getByRole("listitem", { name: "notes.txt" });
  await expect(line).toContainText("Done");
  await expect(line.getByRole("button", { name: "Show notes.txt in its folder" })).toBeVisible();
  await expectSaneUi(page);
});

test("a folder has no Download in its menu; a file has", async ({ page }) => {
  await row(page, "projects").click({ button: "right" });
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Download" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await row(page, "notes.txt").click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Download" }).click();
  await expect(transfers(page).getByRole("listitem", { name: "notes.txt" })).toContainText("Done");
});

test("a long download shows its progress and can be cancelled", async ({ page }) => {
  await row(page, "backup.tar.gz").dblclick();
  const line = transfers(page).getByRole("listitem", { name: "backup.tar.gz" });
  await expect(line.getByRole("progressbar")).toBeVisible();
  await expect(line).toContainText("/s");
  await line.getByRole("button", { name: "Cancel backup.tar.gz" }).click();
  await expect(line).toContainText("Cancelled");
  await expect(line.getByRole("progressbar")).toHaveCount(0);
});

test("Clear finished empties the panel, which then goes away", async ({ page }) => {
  await row(page, "notes.txt").dblclick();
  await expect(transfers(page).getByRole("listitem", { name: "notes.txt" })).toContainText("Done");
  await nas(page).getByRole("button", { name: "Clear finished" }).click();
  await expect(transfers(page)).toHaveCount(0);
});

test("the panel folds away and comes back", async ({ page }) => {
  await row(page, "notes.txt").dblclick();
  const toggle = nas(page).getByRole("button", { name: "Transfers (1)" });
  await expect(transfers(page)).toBeVisible();
  await toggle.click();
  await expect(transfers(page)).toHaveCount(0);
  await toggle.click();
  await expect(transfers(page)).toBeVisible();
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T26`.
2. `sftp/transfer.rs`, `TransferRegistry`, `state.rs` : `cd src-tauri && cargo test --lib sftp::transfer`.
3. `commands/transfer.rs`, `commands/mod.rs`, `lib.rs`, `capabilities/default.json` :
   `cargo test --lib commands::ipc_transfer`, puis `npm run test:ssh` (`ssh_transfer` compris), `npm run bindings`.
4. `ipc.ts`, `lib/opener.ts`, `lib/mock/sftp.ts`, `lib/mock/transfers.ts`, `ipc-mock.ts`, puis
   `transfer-model.ts`, `transfers-store.ts` : `npx vitest run src/lib src/features/sftp`.
5. `TransfersPanel.tsx`, `SftpExplorer.tsx`, `EntryMenu.tsx`, `en.json`, `fr.json` :
   `npx playwright test e2e/sftp-transfers.spec.ts e2e/sftp-actions.spec.ts e2e/sftp.spec.ts`.
6. `npm run format`, `npm run review`, cases, statut, ligne « Works today » du `README.md`, commit
   `feat: SFTP transfers: streaming download and upload, cancel, transfers panel (T26)`.

## Critères d'acceptation

- [ ] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T26 --check` affiche `OK`
      partout.
- [ ] `grep -rn "create_new(true)" src-tauri/src/sftp/transfer.rs` trouve la création du `.part` local.
- [ ] `grep -rn "plugin-opener" src` ne trouve que `src/lib/opener.ts`.
- [ ] Aucune nouvelle exception `project-rules: allow`.
- [ ] Visuel : en clair et en sombre, une ligne de transfert garde ses colonnes alignées pendant et après le
      transfert, et le panneau ne cache pas la dernière ligne du tableau.

## À regarder par Florian

`npm run tauri dev`, un onglet SFTP : double-clic sur un fichier, il arrive dans ton dossier Téléchargements (un
deuxième téléchargement devient `nom (1).ext`) ; « Afficher dans son dossier » ouvre le gestionnaire de fichiers.
Lance un gros fichier, puis annule : aucun fichier `.part` ne reste.
