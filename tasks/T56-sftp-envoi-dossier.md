# T56 — SFTP : envoi récursif d'un dossier

| | |
|---|---|
| **Jalon** | M10 — Nouvelles fonctions (lot 8) |
| **Dépend de** | T55 |
| **Lire avant** | `docs/10-fonctions-a-venir.md` § « SFTP : dossiers récursifs » ; `docs/06-securite.md` S8, S11 |
| **Livrable** | `src-tauri/src/sftp/tree.rs` (`upload_dir`), `commands/transfer.rs`, `SftpToolbar.tsx`, `SftpExplorer.tsx`, `TransfersPanel.tsx`, `lib/mock/transfers.ts` (+ `lib/mock/sftp.ts` si besoin), `en.json` / `fr.json` ; `src-tauri/tests/ssh_upload_tree.rs`, `e2e/sftp-upload-folder.spec.ts` |

## Pourquoi

Depuis T47, un dossier glissé depuis le bureau est refusé (« Les dossiers ne peuvent pas encore être envoyés »). T55
a apporté le téléchargement d'un dossier ; voici l'envoi, sur le même modèle.

## À réutiliser (ne pas réécrire)

- `tree.rs` (T55) : le parcours, l'adaptateur de `Progress` cumulés, `Counted`, la règle des `.part`.
- `ops.rs` : `reserve_remote` (`.part` en `O_EXCL`), `valid_name`, `join`, `map_sftp_error`, `list`.
- `transfer.rs` : `copy`, `first_free`, `local_io_error`, `emit_final`.
- `pickFolder` (`lib/files.ts`) : le sélecteur de dossier, déjà simulé dans le mock (`MOCK_PICKED_FOLDER`).

## Contrat — Rust

### `sftp::tree::upload_dir`

```rust
pub async fn upload_dir(
    sftp: &SftpSession,
    local: &Path,
    remote_dir: &str,
    cancel: CancellationToken,
    sink: &dyn TransferSink,
)
```

1. **Parcours local** avec `symlink_metadata` : un lien n'est **jamais** suivi (S11), il est compté dans `skipped`,
   comme tout ce qui n'est ni un fichier ni un dossier. Un nom qui n'est pas de l'UTF-8 ou que `valid_name` refuse est
   ignoré (`log::warn!`) et compté dans `skipped`.
2. `Counted { files, bytes, skipped }`, une fois.
3. **Dossier de tête** : un nom libre dans `remote_dir` (même règle que `reserve_remote` : la liste du dossier, puis
   ` (1)`, ` (2)`… ; un `create_dir` refusé par `Failure` passe au nom suivant, au plus 100 essais, toute autre erreur
   arrête). Puis les sous-dossiers, vides compris.
4. **Fichiers** : chacun par `reserve_remote` dans son dossier distant, `copy`, `shutdown`, `rename` — exactement
   comme `upload`. `Progress` cumulés sur tout le dossier (`total = Some(bytes)`).
5. **Fin** : `Done { path }` (le dossier de tête distant). Annulé : `Cancelled` ; erreur : arrêt, `Failed`. Le `.part`
   distant en cours est supprimé ; les fichiers terminés restent. **Aucun `.part` ne reste** sur le serveur.

### `upload` et `sftp_upload`

- `upload` ne change pas : il refuse toujours un dossier (`localPath: is a directory`). Le test de T47 qui le vérifie
  (`ssh_upload_race.rs`) reste vrai, ne le touche pas.
- `sftp_upload` (mêmes arguments) : si `local_path` est un dossier (`symlink_metadata`, donc pas un lien vers un
  dossier), elle lance `upload_dir` ; sinon `upload`.

## Contrat — Frontend

- Un dossier glissé depuis le bureau s'envoie : une ligne du panneau, son nombre de fichiers, ses liens ignorés (T55).
- La barre d'outils gagne un bouton « Envoyer un dossier » (`sftp.uploadFolder` : en « Upload a folder », fr « Envoyer
  un dossier » ; icône `FolderUp`) à côté de « Envoyer » : `pickFolder()`, puis le même envoi que le glisser-déposer.
- `TransfersPanel` : `isFolderError` et la clé `sftp.transfers.folder` disparaissent (en et fr) : plus rien ne les
  produit depuis la fenêtre.
- **Mock** : deux dossiers locaux simulés, `MOCK_DROP_DIR/photos` (3 fichiers `IMG_1.jpg` → `IMG_3.jpg` de 1 Mio, et
  1 lien) et `MOCK_PICKED_FOLDER` (`Transfers` : 2 fichiers `a.txt`, `b.txt` de 1 Kio). Leur envoi émet `counted`, les
  étapes, puis `done` ; le dossier apparaît dans le système de fichiers simulé (nom libre, avec ses fichiers). Tout
  autre chemin reste un fichier, comme aujourd'hui.

## Pièges

- `tree.rs` contient déjà le téléchargement : s'il dépasse 400 lignes, sépare `tree_upload.rs` (et garde
  `sftp::tree::upload_dir` comme chemin public, par un `pub use`).
- Le parcours local se fait avec `tokio::fs` (ou `spawn_blocking`), jamais un appel bloquant dans une tâche async.
- Un dossier vide s'envoie aussi (`Counted { files: 0, … }`, puis `Done`).

## Tests du contrat

### `src-tauri/tests/ssh_upload_tree.rs` (nouveau)

```rust
//! T56 against the podman target: a local folder uploads with its content, links are skipped and counted, a
//! second upload takes a free name, and a cancel leaves no `.part` on the server. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh_sftp::client::SftpSession;
use support::{TestEnv, context, respond};
use tokio_util::sync::CancellationToken;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink};
use tunl_lib::sftp::ops;
use tunl_lib::sftp::session::open_sftp;
use tunl_lib::sftp::transfer::{TransferEvent, TransferSink};
use tunl_lib::sftp::tree::upload_dir;
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
    let base = format!("/tmp/tunl-up-tree-{}", Uuid::new_v4());
    ops::mkdir(&sftp, &base).await.unwrap();
    (link, sftp, base)
}

/// `<root>/photos/{a.txt, sub/b.txt, empty/, to-hostname -> /etc/hostname}`.
fn local_tree(root: &std::path::Path) -> std::path::PathBuf {
    let photos = root.join("photos");
    std::fs::create_dir_all(photos.join("sub")).unwrap();
    std::fs::create_dir_all(photos.join("empty")).unwrap();
    std::fs::write(photos.join("a.txt"), b"aaa").unwrap();
    std::fs::write(photos.join("sub").join("b.txt"), b"bbbbb").unwrap();
    std::os::unix::fs::symlink("/etc/hostname", photos.join("to-hostname")).unwrap();
    photos
}

#[tokio::test]
async fn a_folder_uploads_with_its_content_and_skips_links() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;
    let local = tempfile::tempdir().unwrap();
    let photos = local_tree(local.path());

    let events = Events::default();
    upload_dir(&sftp, &photos, &base, CancellationToken::new(), &events).await;

    let all = events.all();
    assert!(all.contains(&TransferEvent::Counted {
        files: 2,
        bytes: 8,
        skipped: 1
    }));
    assert_eq!(
        all.last(),
        Some(&TransferEvent::Done {
            path: format!("{base}/photos")
        })
    );
    assert_eq!(sftp.read(format!("{base}/photos/a.txt")).await.unwrap(), b"aaa");
    assert_eq!(sftp.read(format!("{base}/photos/sub/b.txt")).await.unwrap(), b"bbbbb");
    assert!(sftp.try_exists(format!("{base}/photos/empty")).await.unwrap());
    assert!(
        !sftp.try_exists(format!("{base}/photos/to-hostname")).await.unwrap(),
        "a link is never followed"
    );

    let again = Events::default();
    upload_dir(&sftp, &photos, &base, CancellationToken::new(), &again).await;
    assert_eq!(
        again.all().last(),
        Some(&TransferEvent::Done {
            path: format!("{base}/photos (1)")
        })
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_cancelled_folder_upload_leaves_no_part_file_on_the_server() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = sftp(&env, dir.path()).await;
    let local = tempfile::tempdir().unwrap();
    let photos = local_tree(local.path());
    std::fs::write(photos.join("big.bin"), vec![7u8; 8 * 1024 * 1024]).unwrap();

    let cancel = CancellationToken::new();
    let stop = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        stop.cancel();
    });
    let events = Events::default();
    upload_dir(&sftp, &photos, &base, cancel, &events).await;
    assert_eq!(events.all().last(), Some(&TransferEvent::Cancelled));

    let mut parts = Vec::new();
    let mut stack = vec![base.clone()];
    while let Some(folder) = stack.pop() {
        for entry in ops::list(&sftp, &folder).await.unwrap() {
            if entry.name.ends_with(".part") {
                parts.push(entry.path.clone());
            }
            if entry.kind == tunl_lib::sftp::EntryKind::Dir {
                stack.push(entry.path);
            }
        }
    }
    assert!(parts.is_empty(), "no .part left: {parts:?}");

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}
```

### `e2e/sftp-upload-folder.spec.ts`

```ts
// T56: a folder dropped from the desktop, or picked with "Upload a folder", is sent with its content.
// Mock: the desktop folder "photos" holds 3 images and 1 link; the picked folder "Transfers" holds 2 files.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  await expect(names(page).first()).toHaveText("projects");
});

function nas(page: Page) {
  return page.getByRole("region", { name: "nas", exact: true });
}

function names(page: Page) {
  return nas(page).getByRole("table", { name: "Files" }).locator("tbody tr td:first-child");
}

function line(page: Page, name: string) {
  return nas(page).getByRole("list", { name: "Transfers" }).getByRole("listitem", { name });
}

async function dropFolder(page: Page, name: string) {
  const list = nas(page).getByRole("table", { name: "Files" });
  const files = await page.evaluateHandle((folder) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([""], folder));
    return transfer;
  }, name);
  await list.dispatchEvent("dragover", { dataTransfer: files });
  await list.dispatchEvent("drop", { dataTransfer: files });
}

test("a dropped folder is sent with its files, and its link is skipped", async ({ page }) => {
  await dropFolder(page, "photos");
  await expect(line(page, "photos")).toContainText("3 files");
  await expect(line(page, "photos")).toContainText("Done");
  await expect(line(page, "photos")).toContainText("1 link skipped");
  await expect(names(page)).toContainText(["photos"]);

  await names(page)
    .filter({ hasText: /^photos$/ })
    .dblclick();
  await expect(names(page)).toHaveText(["IMG_1.jpg", "IMG_2.jpg", "IMG_3.jpg"]);
});

test("a folder sent twice takes a free name", async ({ page }) => {
  await dropFolder(page, "photos");
  await expect(line(page, "photos")).toContainText("Done");
  await nas(page).getByRole("button", { name: "Clear finished" }).click();
  await dropFolder(page, "photos");
  await expect(line(page, "photos")).toContainText("Done");
  await expect(names(page)).toContainText(["photos", "photos (1)"]);
});

test("Upload a folder sends the folder picked", async ({ page }) => {
  await nas(page).getByRole("button", { name: "Upload a folder" }).click();
  await expect(line(page, "Transfers")).toContainText("2 files");
  await expect(line(page, "Transfers")).toContainText("Done");
  await expect(names(page)).toContainText(["Transfers"]);
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T56`.
2. `tree.rs` (`upload_dir`), `commands/transfer.rs` : `cd src-tauri && cargo test --lib sftp`, puis `npm run test:ssh`
   (pas pendant un job `dev`).
3. Mock, `SftpToolbar.tsx`, `SftpExplorer.tsx`, `TransfersPanel.tsx`, textes :
   `npx playwright test e2e/sftp-upload-folder.spec.ts e2e/sftp-transfers.spec.ts e2e/sftp-upload-stay.spec.ts`.
4. `npm run format`, `npm run review`, cases, statut, commit `feat: upload a whole folder over SFTP (T56)`.

## Critères d'acceptation

- [ ] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T56 --check` affiche `OK` partout.
- [ ] `grep -rn "transfers.folder\|isFolderError" src` ne trouve plus rien.
- [ ] Aucune nouvelle exception `project-rules: allow`.
- [ ] Le bouton « Envoyer un dossier » a la taille et l'alignement des autres boutons de la barre (à l'écran).

## À regarder par Florian

`npm run tauri dev`, un onglet SFTP : glisse un dossier depuis Dolphin, il arrive entier ; les liens qu'il contient
sont ignorés et comptés. « Envoyer un dossier » fait de même depuis le sélecteur.
