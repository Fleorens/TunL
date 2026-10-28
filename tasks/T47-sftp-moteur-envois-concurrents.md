# T47 — SFTP (moteur) : envois simultanés sans collision, dossier refusé clairement, comptage sans un `stat` par entrée

| | |
|---|---|
| **Jalon** | M9 — Revue globale (lot 7) |
| **Dépend de** | T46 |
| **Lire avant** | `docs/06-securite.md` S11 ; `docs/01-architecture.md` § SFTP (transferts) |
| **Livrable** | `src-tauri/src/sftp/transfer.rs`, `src-tauri/src/sftp/ops.rs`, `TransfersPanel.tsx`, `en.json` / `fr.json` ; `src-tauri/tests/ssh_upload_race.rs` |

## Pourquoi

Revue globale du 2026-10-27, à la lecture du code :

1. **Deux envois du même nom en même temps — supposé (lecture)** : `upload` choisit un nom libre d'après la liste du
   dossier, puis ouvre `<nom>.part` avec `sftp.create` (création **et troncature**). Deux envois lancés ensemble
   (deux fichiers `rapport.pdf` de deux dossiers locaux, ou le même glissé deux fois) choisissent le même nom,
   écrivent dans le même `.part` et le corrompent ; le second renommage échoue. Le téléchargement a été corrigé à la
   revue du lot 5 (`create_new`), pas l'envoi.
2. **Dossier glissé depuis le bureau — supposé (lecture)** : `tokio::fs::File::open` accepte un dossier sous Linux,
   puis la lecture échoue (`EISDIR`) : le panneau affiche « Erreur du système de fichiers », après avoir créé un
   `.part` vide sur le serveur.
3. **Comptage et suppression lents — supposé (lecture)** : `count` et `remove` font un `symlink_metadata` (un aller-
   retour réseau) **pour chaque entrée**, alors que `read_dir` rend déjà le type de chaque entrée (OpenSSH remplit
   ses attributs avec `lstat`). Sur un dossier de 10 000 fichiers à 50 ms, le seul comptage prend plus de 8 minutes.

## À réutiliser (ne pas réécrire)

- `first_free`, `suffixed`, `valid_name`, `join`, `map_sftp_error`, `copy`, `emit_final` (`transfer.rs`, `ops.rs`).
- `russh_sftp::protocol::OpenFlags` et `SftpSession::open_with_flags`.

## Contrat — Rust

### `upload` : le `.part` est réservé sur le serveur

- Le `.part` s'ouvre avec `OpenFlags::CREATE | OpenFlags::EXCLUDE | OpenFlags::WRITE` (jamais `TRUNCATE`).
- S'il existe déjà (statut `Failure` ou `FileAlreadyExists`), le nom est considéré comme pris : on passe au nom libre
  suivant (même règle `first_free`, le nom raté compté comme pris), au plus 100 essais. Toute autre erreur (droits,
  dossier absent) s'arrête aussitôt, comme aujourd'hui.
- Un dossier local est refusé **avant** toute action sur le serveur : `AppError::validation("localPath", "is a
  directory")`, émis comme `Failed`.

### `count` et `remove` : le type vient de `read_dir`

- La racine passée est examinée avec `symlink_metadata`, comme aujourd'hui.
- Pour ses enfants, le type est lu dans les attributs que `read_dir` renvoie (`entry.metadata().file_type()`). Si un
  serveur ne donne pas de type (attributs sans permissions), on retombe sur `symlink_metadata` pour cette entrée.
- Un lien n'est jamais suivi, la racine `/` n'est jamais supprimée : le comportement attendu par les tests de T24 et
  T25b ne change pas.

## Contrat — Frontend

- `TransfersPanel` : un envoi refusé parce que c'est un dossier affiche `t("sftp.transfers.folder")`
  (en « Folders cannot be uploaded yet », fr « Les dossiers ne peuvent pas encore être envoyés »), reconnu par
  `error.kind === "validation"` et `error.message === "localPath: is a directory"`.

## Pièges

- OpenSSH rend `SSH_FX_FAILURE` (pas `FILE_ALREADY_EXISTS`, inconnu de SFTP v3) pour un `O_EXCL` sur un fichier
  existant. Ne pas réessayer sur `PermissionDenied` ni `NoSuchFile` : ça bouclerait 100 fois pour rien.
- Le `.part` d'un envoi annulé ou raté est toujours supprimé ; celui d'un **autre** envoi ne doit jamais l'être.
- `read_dir` de russh-sftp rend les entrées avec leurs attributs : pas de `stat` supplémentaire pour les fichiers.

## Tests du contrat

### `src-tauri/tests/ssh_upload_race.rs` (nouveau)

```rust
//! T47 against the podman target: two uploads of the same name at once keep both files whole, and a folder is
//! refused before anything reaches the server. `npm run test:ssh`.
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
use tunl_lib::sftp::transfer::{TransferEvent, TransferSink, upload};
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
    fn last(&self) -> Option<TransferEvent> {
        self.0.lock().unwrap().last().cloned()
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
    let link = establish(&ctx, &target, Uuid::new_v4(), CancellationToken::new(), &Quiet)
        .await
        .expect("a link to the target");
    let sftp = open_sftp(&link.target).await.unwrap();
    let base = format!("/tmp/tunl-race-{}", Uuid::new_v4());
    ops::mkdir(&sftp, &base).await.unwrap();
    (link, sftp, base)
}

fn done_path(events: &Events) -> String {
    match events.last() {
        Some(TransferEvent::Done { path }) => path,
        other => panic!("the upload did not finish: {other:?}"),
    }
}

#[tokio::test]
async fn two_uploads_of_the_same_name_at_once_keep_both_files_whole() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;

    let size = 2 * 1024 * 1024;
    let first = dir.path().join("a").join("same.bin");
    let second = dir.path().join("b").join("same.bin");
    std::fs::create_dir_all(first.parent().unwrap()).unwrap();
    std::fs::create_dir_all(second.parent().unwrap()).unwrap();
    std::fs::write(&first, vec![b'a'; size]).unwrap();
    std::fs::write(&second, vec![b'b'; size]).unwrap();

    let (one, two) = (Events::default(), Events::default());
    tokio::join!(
        upload(&sftp, &first, &base, CancellationToken::new(), &one),
        upload(&sftp, &second, &base, CancellationToken::new(), &two),
    );
    let (path_one, path_two) = (done_path(&one), done_path(&two));
    assert_ne!(path_one, path_two, "two uploads never share a name");

    let mut names: Vec<String> = ops::list(&sftp, &base)
        .await
        .unwrap()
        .into_iter()
        .map(|entry| entry.name)
        .collect();
    names.sort();
    assert_eq!(names, vec!["same (1).bin".to_string(), "same.bin".to_string()]);

    let mut contents = vec![
        sftp.read(path_one).await.unwrap(),
        sftp.read(path_two).await.unwrap(),
    ];
    contents.sort();
    assert_eq!(contents, vec![vec![b'a'; size], vec![b'b'; size]]);

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_folder_is_refused_before_anything_reaches_the_server() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;

    let folder = dir.path().join("photos");
    std::fs::create_dir_all(&folder).unwrap();
    let events = Events::default();
    upload(&sftp, &folder, &base, CancellationToken::new(), &events).await;
    match events.last() {
        Some(TransferEvent::Failed { error }) => {
            assert_eq!(error.kind, ErrorKind::Validation);
            assert_eq!(error.message, "localPath: is a directory");
        }
        other => panic!("a folder must be refused, got {other:?}"),
    }
    assert!(
        ops::list(&sftp, &base).await.unwrap().is_empty(),
        "nothing was created on the server"
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T47`.
2. `transfer.rs` (`.part` exclusif, dossier refusé), puis `ops.rs` (`count`, `remove`) :
   `cd src-tauri && cargo test --lib sftp`, puis `npm run test:ssh` (conteneurs podman ; pas pendant un job `dev`).
3. `TransfersPanel.tsx`, `en.json` / `fr.json`.
4. `npm run format`, `npm run review`, cases, statut, commit
   `fix: concurrent uploads never share a part file, folders refused, no stat per entry (T47)`.

## Critères d'acceptation

- [x] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T47 --check` affiche `OK` partout.
- [x] `grep -n "symlink_metadata" src-tauri/src/sftp/ops.rs` : seulement pour la racine et le repli.
- [x] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

`npm run tauri dev`, un onglet SFTP : glisse deux fois de suite le même gros fichier depuis Dolphin, les deux arrivent
entiers (`nom` et `nom (1)`). Glisse un dossier : le panneau dit que les dossiers ne passent pas encore.
