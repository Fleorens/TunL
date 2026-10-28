# T48 — SFTP : un lien symbolique vers un fichier se télécharge comme un fichier

| | |
|---|---|
| **Jalon** | M9 — Revue globale (lot 7) |
| **Dépend de** | T47 |
| **Lire avant** | `docs/05-modele-donnees.md` § 8 (entrées distantes) ; `docs/06-securite.md` S11 |
| **Livrable** | `sftp/mod.rs` (`RemoteEntry.target_kind`), `sftp/ops.rs` (`list`), bindings, `SftpExplorer.tsx`, `EntryMenu.tsx`, `lib/mock/sftp-fs.ts` (+ mock des transferts si besoin) ; `src-tauri/tests/ssh_symlink_target.rs`, `e2e/sftp-symlink.spec.ts` |

## Pourquoi

Revue globale du 2026-10-27, **supposé (lecture du code)** : un lien symbolique n'a que le type `symlink`. Le double-
clic l'ouvre toujours comme un dossier (`navigate`), et le menu n'offre « Télécharger » que pour un fichier. Un lien
vers un **fichier** (`current.log -> app-2026-10-27.log`, `~/.bashrc -> dotfiles/bashrc`…) ne peut donc pas être
téléchargé : le double-clic finit sur une erreur « list failed ».

## À réutiliser (ne pas réécrire)

- `entry_from`, `list`, `map_sftp_error` (`ops.rs`) ; `SftpSession::metadata` (suit le lien).
- `useEntryActions().download` ; le téléchargement du backend lit déjà la cible du lien (`open_remote`).

## Contrat — Rust

- `RemoteEntry` gagne `target_kind: Option<EntryKind>` : le type de ce que vise un lien, `None` pour tout ce qui
  n'est pas un lien, et pour un lien cassé ou illisible. Attributs : `#[serde(skip_serializing_if = "Option::is_none")]`
  et `#[ts(optional)]`, pour que le type TypeScript soit `targetKind?: EntryKind` (les fixtures existantes de
  `sftp-model.test.ts` n'ont pas ce champ, et doivent continuer à compiler).
- `entry_from` met `None`. `list` complète, **pour les liens seulement**, avec `sftp.metadata(path)` (un appel par
  lien, aucun pour les autres entrées). Une erreur sur ce `metadata` donne `None`, jamais une erreur de `list`.
- Puis `npm run bindings`.

## Contrat — Frontend

- Un lien dont `targetKind === "file"` se comporte comme un fichier : le double-clic le télécharge, le menu propose
  « Télécharger ». Un lien vers un dossier s'ouvre comme avant. Un lien cassé : le double-clic ne fait rien.
- Le tri ne change pas (seuls les vrais dossiers passent en tête).
- **Mock** : le lien `current` du dossier personnel vise un fichier (`targetKind: "file"`), de 4 Kio, et son
  téléchargement réussit. Aucune autre entrée du mock ne change (les listes exactes des tests de T25 restent vraies).

## Pièges

- `#[ts(optional)]` sur un `Option<T>` donne `field?: T` ; sans lui, ts-rs écrit `field: T | null`, obligatoire.
- Ne jamais suivre un lien dans `count` ni `remove` (S11) : ce champ ne sert qu'à l'affichage et au double-clic.

## Tests du contrat

### `src-tauri/tests/ssh_symlink_target.rs` (nouveau)

```rust
//! T48 against the podman target: a link says what it points to, a broken link says nothing. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::Arc;
use std::time::Duration;

use support::{TestEnv, context, respond};
use tokio::io::AsyncWriteExt;
use tokio_util::sync::CancellationToken;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink};
use tunl_lib::sftp::session::open_sftp;
use tunl_lib::sftp::{EntryKind, ops};
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::link::establish;
use tunl_lib::ssh::session::SshTarget;
use uuid::Uuid;

struct Quiet;

impl SessionSink for Quiet {
    fn event(&self, _event: SessionEvent) {}
    fn output(&self, _bytes: Vec<u8>) {}
}

#[tokio::test]
async fn a_link_says_what_it_points_to() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
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
    let ctx = context(&env, dir.path(), broker, secrets);
    let link = establish(&ctx, &target, Uuid::new_v4(), CancellationToken::new(), &Quiet)
        .await
        .expect("a link to the target");
    let sftp = open_sftp(&link.target).await.unwrap();
    let base = format!("/tmp/tunl-links-{}", Uuid::new_v4());
    ops::mkdir(&sftp, &base).await.unwrap();

    let file = format!("{base}/file.txt");
    let folder = format!("{base}/folder");
    let mut created = sftp.create(file.clone()).await.unwrap();
    created.write_all(b"hello").await.unwrap();
    created.shutdown().await.unwrap();
    ops::mkdir(&sftp, &folder).await.unwrap();
    // OpenSSH reads SSH_FXP_SYMLINK's two paths in reverse: russh-sftp's `symlink` gets the target first.
    sftp.symlink(file.clone(), format!("{base}/to-file")).await.unwrap();
    sftp.symlink(folder.clone(), format!("{base}/to-folder")).await.unwrap();
    sftp.symlink(format!("{base}/missing"), format!("{base}/broken"))
        .await
        .unwrap();

    let kinds: Vec<(String, EntryKind, Option<EntryKind>)> = ops::list(&sftp, &base)
        .await
        .unwrap()
        .into_iter()
        .map(|entry| (entry.name, entry.kind, entry.target_kind))
        .collect();
    assert_eq!(
        kinds,
        vec![
            ("broken".to_string(), EntryKind::Symlink, None),
            ("file.txt".to_string(), EntryKind::File, None),
            ("folder".to_string(), EntryKind::Dir, None),
            ("to-file".to_string(), EntryKind::Symlink, Some(EntryKind::File)),
            ("to-folder".to_string(), EntryKind::Symlink, Some(EntryKind::Dir)),
        ]
    );

    ops::remove(&sftp, &base).await.unwrap();
    link.disconnect().await;
}
```

### `e2e/sftp-symlink.spec.ts` (nouveau)

```ts
// T48: a link to a file downloads like a file, from a double-click or from its menu.
// Mock: in the home folder, "current" is a link to a 4 KiB file.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page
    .getByRole("button", { name: /^nas/ })
    .first()
    .click({ button: "right" });
  await page.getByRole("menu").getByRole("menuitem", { name: "Open in SFTP" }).click();
  await expect(names(page).first()).toHaveText("projects");
});

function nas(page: Page) {
  return page.getByRole("region", { name: "nas", exact: true });
}

function names(page: Page) {
  return nas(page).getByRole("table", { name: "Files" }).locator("tbody tr td:first-child");
}

test("double-clicking a link to a file downloads it and stays in the folder", async ({ page }) => {
  await names(page).filter({ hasText: /^current$/ }).dblclick();
  await expect(
    nas(page).getByRole("list", { name: "Transfers" }).getByRole("listitem", { name: "current" }),
  ).toContainText("Done");
  await expect(names(page).first()).toHaveText("projects");
});

test("the menu of a link to a file offers Download", async ({ page }) => {
  await names(page).filter({ hasText: /^current$/ }).click({ button: "right" });
  await expect(page.getByRole("menu").getByRole("menuitem", { name: "Download" })).toBeVisible();
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T48`.
2. `sftp/mod.rs`, `sftp/ops.rs` : `cd src-tauri && cargo test --lib sftp`, puis `npm run bindings`.
3. `npm run test:ssh` (pas pendant un job `dev`).
4. Mock (`lib/mock/sftp-fs.ts`, transferts), `SftpExplorer.tsx`, `EntryMenu.tsx` :
   `npx playwright test e2e/sftp-symlink.spec.ts e2e/sftp.spec.ts e2e/sftp-transfers.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, commit
   `feat: a symbolic link to a file downloads like a file (T48)`.

## Critères d'acceptation

- [x] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T48 --check` affiche `OK` partout.
- [x] `src/bindings/RemoteEntry.ts` contient `targetKind?: EntryKind`.
- [x] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

`npm run tauri dev`, un onglet SFTP sur un serveur où un fichier est un lien (`ln -s vrai.txt lien.txt`) : double-clic
sur `lien.txt`, il se télécharge.
