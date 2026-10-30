# T55 — SFTP : téléchargement récursif d'un dossier

| | |
|---|---|
| **Jalon** | M10 — Nouvelles fonctions (lot 8) |
| **Dépend de** | T54 |
| **Lire avant** | `docs/10-fonctions-a-venir.md` § « SFTP : dossiers récursifs » ; `docs/06-securite.md` S8, S11 ; `docs/01-architecture.md` § SFTP (transferts) |
| **Livrable** | `src-tauri/src/sftp/tree.rs` (nouveau), `sftp/transfer.rs` (`TransferEvent::Counted`, `copy` et `reserve_local` visibles du module), `sftp/ops.rs` (`is_dir` public), `commands/transfer.rs`, bindings, `transfer-model.ts`, `TransfersPanel.tsx`, `sftp-model.ts` (`isDownloadable`), `lib/mock/transfers.ts`, `en.json` / `fr.json` ; `src-tauri/tests/ssh_download_tree.rs`, `src/features/sftp/transfer-tree.test.ts`, `e2e/sftp-download-folder.spec.ts` |

## Pourquoi

Un dossier ne se télécharge pas : le menu ne propose « Télécharger » que pour un fichier, et `download` échoue sur un
dossier. Il faut aujourd'hui descendre dans chaque sous-dossier et télécharger fichier par fichier.

## À réutiliser (ne pas réécrire)

- `transfer.rs` : `copy`, `reserve_local`, `first_free`, `local_io_error`, `emit_final`, `PROGRESS_INTERVAL`
  (`pub(crate)` si besoin, sans changer leur comportement).
- `ops.rs` : `valid_name`, `join`, `map_sftp_error`, `is_dir` (lstat), et la règle de T47 pour le type d'un enfant de
  `read_dir` (`entry_is_dir` : ses attributs, sinon `symlink_metadata`).
- `TransferRegistry`, `ChannelSink` (`commands/transfer.rs`) : un dossier est **un** transfert, une seule annulation.

## Contrat — Rust

### `TransferEvent::Counted` (nouvelle variante, les autres ne changent pas)

```rust
/// What a folder transfer will copy, sent once after the scan, before the first byte (T55).
Counted { files: u32, bytes: u64, skipped: u32 },
```

`Progress`, `Done`, `Failed`, `Cancelled` gardent exactement leurs champs : des tests du contrat (T26, T47) les
construisent et les filtrent. Puis `npm run bindings`.

### `sftp::tree::download_dir`

```rust
pub async fn download_dir(
    sftp: &SftpSession,
    remote: &str,
    local_dir: &Path,
    cancel: CancellationToken,
    sink: &dyn TransferSink,
)
```

1. **Parcours** (pile, jamais de récursion à travers un `await`, comme `count`) : les dossiers et les fichiers sous
   `remote`, avec leur taille et leur chemin relatif. Un lien symbolique n'est **jamais** suivi (S11) : il est compté
   dans `skipped`, comme une entrée d'un autre type (`Other`). Un nom invalide (`valid_name`) est ignoré avec un
   `log::warn!`, comme dans `list`. L'annulation est vue pendant le parcours.
2. `Counted { files, bytes, skipped }`, une fois.
3. **Dossier de tête** : un nom libre dans `local_dir` (`first_free` : ` (1)`, ` (2)`…), créé avec `create_dir` (pas
   `create_dir_all`) ; s'il existe déjà au moment de la création (course), le nom suivant, comme `reserve_local`.
   Puis les sous-dossiers, dans l'ordre du parcours (un dossier vide est créé aussi).
4. **Fichiers** : chacun par `<nom>.part` créé avec `create_new`, copié par `copy`, renommé à la fin. Les `Progress`
   sont **cumulés** sur tout le dossier : `transferred` = octets déjà copiés de tout le dossier, `total =
   Some(bytes)`, `bytes_per_sec` mesuré depuis le début de la copie du dossier. Un adaptateur de `TransferSink` qui
   décale les `Progress` de `copy` suffit ; aucun `Progress` ne doit sortir avec le `total` d'un seul fichier.
5. **Fin** : `Done { path }` (le dossier de tête local). Annulé : `Cancelled`. Une erreur : on s'arrête, `Failed`.
   Dans ces deux cas, le `.part` en cours est supprimé ; les fichiers déjà terminés restent. **Aucun `.part` ne reste
   jamais** sur le disque.

### `sftp_download`

Même commande, mêmes arguments. Si `remote_path` est un dossier (lstat, `ops::is_dir`), elle lance `download_dir` ;
sinon `download`, inchangé.

## Contrat — Frontend

- `isDownloadable` (T54) accepte aussi un dossier (`kind === "dir"`). Un lien vers un dossier reste non
  téléchargeable. Le double-clic sur un dossier l'ouvre toujours.
- `Transfer` gagne `files: number | null` (`null` pour un fichier seul) et `skipped: number` (0). `counted` les remplit
  et fixe `total` à `bytes`. `newTransfer` les initialise.
- `TransfersPanel` : une ligne de dossier montre « {{count}} fichiers » à côté du nom ; terminée avec `skipped > 0`,
  « {{count}} liens ignorés » (clés `sftp.transfers.files`, `sftp.transfers.skipped`, au pluriel i18next `_one` /
  `_other` ; en : « 1 file / {{count}} files », « 1 link skipped / {{count}} links skipped » ; fr : « 1 fichier /
  {{count}} fichiers », « 1 lien ignoré / {{count}} liens ignorés »).
- **Mock** : un dossier se télécharge : `counted` (fichiers et liens sous lui, tailles additionnées), les étapes de
  progression sur le total, puis `done` vers `MOCK_DOWNLOAD_DIR/<nom libre>`. Aucune entrée du mock ne change.

## Pièges

- `transfer.rs` fait 373 lignes : tout le récursif va dans `tree.rs`. 400 lignes au plus par fichier.
- Le chemin relatif d'un fichier se construit **uniquement** de noms validés par `valid_name` : jamais de `..`, jamais
  de `/` venu du serveur (S11). Un `local_dir.join(relatif)` sur un nom non validé pourrait écrire hors du dossier.
- Ne jamais journaliser un contenu (S8) ; un nom de fichier dans un `log::warn!` est permis.
- `copy` émet un `Progress` final par fichier : l'adaptateur le décale aussi, sinon la barre recule.

## Tests du contrat

### `src-tauri/tests/ssh_download_tree.rs` (nouveau)

```rust
//! T55 against the podman target: a folder downloads with its content, links are skipped and counted, a second
//! download takes a free name, and a cancel leaves no `.part`. `npm run test:ssh`.
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
use tunl_lib::sftp::tree::download_dir;
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

/// A link to the target, its SFTP session, and a remote tree:
/// `<base>/photos/{a.txt, sub/b.txt, empty/, to-hostname -> /etc/hostname}`.
async fn tree(env: &TestEnv, dir: &std::path::Path) -> (SshLink, SftpSession, String) {
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
    let base = format!("/tmp/tunl-tree-{}", Uuid::new_v4());
    for folder in ["", "/photos", "/photos/sub", "/photos/empty"] {
        ops::mkdir(&sftp, &format!("{base}{folder}")).await.unwrap();
    }
    sftp.write(format!("{base}/photos/a.txt"), b"aaa").await.unwrap();
    sftp.write(format!("{base}/photos/sub/b.txt"), b"bbbbb").await.unwrap();
    // OpenSSH reads SSH_FXP_SYMLINK's two paths in reverse: russh-sftp's `symlink` gets the target first.
    sftp.symlink("/etc/hostname", format!("{base}/photos/to-hostname"))
        .await
        .unwrap();
    (link, sftp, base)
}

#[tokio::test]
async fn a_folder_downloads_with_its_content_and_skips_links() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = tree(&env, dir.path()).await;
    let local = tempfile::tempdir().unwrap();

    let events = Events::default();
    let remote = format!("{base}/photos");
    download_dir(&sftp, &remote, local.path(), CancellationToken::new(), &events).await;

    let all = events.all();
    assert!(all.contains(&TransferEvent::Counted {
        files: 2,
        bytes: 8,
        skipped: 1
    }));
    let top = local.path().join("photos");
    assert_eq!(
        all.last(),
        Some(&TransferEvent::Done {
            path: top.to_string_lossy().into_owned()
        })
    );
    for event in &all {
        if let TransferEvent::Progress { total, .. } = event {
            assert_eq!(*total, Some(8), "progress counts the whole folder");
        }
    }
    assert_eq!(std::fs::read(top.join("a.txt")).unwrap(), b"aaa");
    assert_eq!(std::fs::read(top.join("sub").join("b.txt")).unwrap(), b"bbbbb");
    assert!(top.join("empty").is_dir());
    assert!(!top.join("to-hostname").exists(), "a link is never followed");

    let again = Events::default();
    download_dir(&sftp, &remote, local.path(), CancellationToken::new(), &again).await;
    assert_eq!(
        again.all().last(),
        Some(&TransferEvent::Done {
            path: local.path().join("photos (1)").to_string_lossy().into_owned()
        })
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}

#[tokio::test]
async fn a_cancelled_folder_download_leaves_no_part_file() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let (link, sftp, base) = tree(&env, dir.path()).await;
    sftp.write(format!("{base}/photos/big.bin"), &vec![7u8; 8 * 1024 * 1024])
        .await
        .unwrap();
    let local = tempfile::tempdir().unwrap();

    let cancel = CancellationToken::new();
    let events = Events::default();
    let stop = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(50)).await;
        stop.cancel();
    });
    download_dir(&sftp, &format!("{base}/photos"), local.path(), cancel, &events).await;

    assert_eq!(events.all().last(), Some(&TransferEvent::Cancelled));
    let mut parts = Vec::new();
    let mut stack = vec![local.path().to_path_buf()];
    while let Some(folder) = stack.pop() {
        for entry in std::fs::read_dir(&folder).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                stack.push(path);
            } else if path.to_string_lossy().ends_with(".part") {
                parts.push(path);
            }
        }
    }
    assert!(parts.is_empty(), "no .part left: {parts:?}");

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}
```

### `src/features/sftp/transfer-tree.test.ts`

```ts
// T55: a folder is one transfer: its file count and skipped links come with `counted`, and it can be downloaded.
import { describe, expect, test } from "vitest";
import type { RemoteEntry } from "@/bindings/RemoteEntry";
import { isDownloadable } from "./sftp-model";
import { applyTransferEvent, newTransfer } from "./transfer-model";

function entry(kind: RemoteEntry["kind"], targetKind?: RemoteEntry["kind"]): RemoteEntry {
  return {
    name: "x",
    path: "/h/x",
    kind,
    size: 0,
    modifiedAt: null,
    permissions: 0o755,
    hidden: false,
    targetKind,
  };
}

describe("folder transfers", () => {
  test("counted sets the files, the skipped links and the total", () => {
    const start = newTransfer("t-1", "run-1", "download", "photos");
    expect(start).toMatchObject({ files: null, skipped: 0 });
    const counted = applyTransferEvent(start, {
      type: "counted",
      files: 2,
      bytes: 8,
      skipped: 1,
    });
    expect(counted).toMatchObject({ files: 2, skipped: 1, total: 8, status: "running" });
    expect(start.files).toBeNull();
  });

  test("a folder can be downloaded, a link to a folder cannot", () => {
    expect(isDownloadable(entry("dir"))).toBe(true);
    expect(isDownloadable(entry("file"))).toBe(true);
    expect(isDownloadable(entry("symlink", "file"))).toBe(true);
    expect(isDownloadable(entry("symlink", "dir"))).toBe(false);
    expect(isDownloadable(entry("symlink"))).toBe(false);
  });
});
```

### `e2e/sftp-download-folder.spec.ts`

```ts
// T55: a folder downloads from its menu, as one line of the transfers panel with its file count.
// Mock: projects holds README.md and app/main.rs.
import { expect, type Page, test } from "./support/test.ts";

function nas(page: Page) {
  return page.getByRole("region", { name: "nas", exact: true });
}

function names(page: Page) {
  return nas(page).getByRole("table", { name: "Files" }).locator("tbody tr td:first-child");
}

test("a folder downloads with its files, in one line", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /^nas/ }).first().click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  await expect(names(page).first()).toHaveText("projects");

  await names(page)
    .filter({ hasText: /^projects$/ })
    .click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Download" }).click();

  const line = nas(page)
    .getByRole("list", { name: "Transfers" })
    .getByRole("listitem", { name: "projects" });
  await expect(line).toContainText("2 files");
  await expect(line).toContainText("Done");
  await expect(names(page).first()).toHaveText("projects");
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T55`.
2. `transfer.rs` (`Counted`), `tree.rs`, `ops.rs`, `commands/transfer.rs` : `cd src-tauri && cargo test --lib sftp`,
   `npm run bindings`, puis `npm run test:ssh` (pas pendant un job `dev`).
3. `transfer-model.ts`, `sftp-model.ts` : `npx vitest run src/features/sftp`.
4. `TransfersPanel.tsx`, mock, textes : `npx playwright test e2e/sftp-download-folder.spec.ts e2e/sftp-transfers.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, commit `feat: download a whole SFTP folder (T55)`.

## Critères d'acceptation

- [ ] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T55 --check` affiche `OK` partout.
- [ ] `wc -l src-tauri/src/sftp/*.rs` : aucun fichier au-delà de 400 lignes.
- [ ] Aucune nouvelle exception `project-rules: allow`.
- [ ] La ligne d'un dossier dans le panneau reste sur une ligne, le nombre de fichiers lisible (à l'écran).

## À regarder par Florian

`npm run tauri dev`, un onglet SFTP : clic droit sur un dossier, « Télécharger ». Il arrive entier dans
Téléchargements ; un second téléchargement donne `dossier (1)`. Annule un gros dossier en cours : aucun `.part` ne
reste.
