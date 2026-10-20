# T32 — Export et import des connexions (JSON, sans secrets)

| | |
|---|---|
| **Jalon** | M7 — Finitions |
| **Dépend de** | T31b |
| **Lire avant** | `docs/05-modele-donnees.md` §4 et §6, `docs/06-securite.md` S1, S7, S9, S14 |
| **Livrable** | `store/exchange.rs` (pur) ; commandes `store_export`, `store_import` (+ `ipc`, mock) ; `pickSaveFile` ; section « Sauvegarde » des Paramètres ; 5 fichiers de tests |

## Pourquoi

Changer de poste, garder une copie, partager une liste de serveurs avec un collègue : il faut sortir les connexions
de TunL et les y remettre. `connections.json` ne contient aucun secret (S1) ; l'export non plus, donc. Un poste qui
importe redemandera les mots de passe (ou les lira dans son propre trousseau).

L'import **fusionne** : rien n'est écrasé ni supprimé. Chaque connexion importée reçoit un nouvel identifiant ; une
connexion déjà présente (même protocole, hôte, port et utilisateur) est laissée de côté ; les groupes se retrouvent
par leur nom ; les bastions sont reliés aux nouveaux identifiants.

Prototypé par l'orchestrateur : les tests de cette fiche passent.

## À réutiliser (ne pas réécrire)

- `Store::create_connection`, `update_connection`, `create_group` (`store/ops.rs`) : ils valident tout
  (`normalize_connection_input` : bastion SSH, pas de boucle, 4 sauts au plus…). L'import passe **par eux**.
- `Connection::to_input()` ; `ProtocolSettings::protocol()`.
- `AppState::read_store`, `AppState::mutate` ; `now_ms` (`clock.rs`).
- `pickFile` (T31b), `useConnections().load()`, `notifyError`, `toast` (`sonner`) avec `i18n.t`.
- T31 : `SettingRow`, `SettingGroup`, `SETTINGS_SECTIONS`.

## Contrat — Rust

### `src-tauri/src/store/exchange.rs` (nouveau, pur ; `store/mod.rs` : `pub mod exchange;`, `#[cfg(test)] mod exchange_tests;`)

```rust
pub const EXPORT_FORMAT: &str = "tunl-connections";
pub const EXPORT_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)] #[serde(rename_all = "camelCase")]
pub struct ExportFile { pub format: String, pub version: u32, pub exported_at: i64,
                        pub groups: Vec<Group>, pub connections: Vec<Connection> }

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, TS)] #[serde(rename_all = "camelCase")] #[ts(export)]
pub struct ImportReport { pub added: u32, pub skipped: u32, pub invalid: u32, pub groups_created: u32 }

/// Tout le store ; `last_connected_at` vidé (c'est de l'historique, pas de la configuration).
pub fn export_file(store: &Store, now_ms: i64) -> ExportFile;

/// Fusionne `file` dans `store` : un nouveau store et le compte rendu. `store` n'est jamais modifié.
pub fn plan_import(store: &Store, file: &ExportFile, now_ms: i64, new_id: impl FnMut() -> Uuid)
    -> AppResult<(Store, ImportReport)>;
```

`plan_import`, dans l'ordre :
1. **En-tête** : `format` différent → `AppError::validation("format", "is not a TunL export")` ; `version` plus
   grande que `EXPORT_VERSION` → `validation("version", "comes from a newer TunL")`.
2. **Groupes** : chaque groupe du fichier est associé au groupe du store de même nom (sans casse, nom rogné) ; sinon
   il est créé par `create_group` (même nom, même couleur, un `new_id()`), et `groups_created` augmente.
3. **Connexions, sans leur bastion** : pour chacune, dans l'ordre du fichier :
   - déjà présente dans le store **en cours de construction** (même `settings.protocol()`, hôte sans casse, port,
     utilisateur) → `skipped`, et on retient « id du fichier → id de la connexion présente » ;
   - sinon `to_input()`, `group_id` traduit par l'étape 2 (un groupe inconnu → `None`), `jump_host_id: None`, et
     `create_connection(&input, new_id(), now_ms)` ; succès → `added` (on retient « id du fichier → nouvel id », et
     le bastion d'origine pour l'étape 4) ; refus de la validation → `invalid`, la connexion est laissée de côté.
4. **Bastions** : pour chaque connexion ajoutée qui en avait un, si l'id du bastion est connu (étape 3),
   `update_connection` avec `jump_host_id` = le nouvel id. Un refus (bastion devenu invalide, boucle…) laisse la
   connexion directe, sans erreur.

### `src-tauri/src/commands/exchange.rs` (nouveau ; `commands/mod.rs`, `lib.rs`)

```rust
#[tauri::command] pub async fn store_export(state: State<'_, AppState>, path: String) -> AppResult<u32>;
#[tauri::command] pub async fn store_import(state: State<'_, AppState>, path: String) -> AppResult<ImportReport>;
```

- `path` doit être absolu (`validation("path", "must be absolute")`).
- Export : `export_file(&store, now_ms())`, JSON indenté + `\n`, écrit dans `<path>.tmp` créé en **0600**
  (`create_new`, après avoir supprimé un `.tmp` resté là) puis renommé sur `path` (S9) ; **pas** de `.bak` à côté du
  fichier de l'utilisateur (n'utilise donc pas `write_json_atomic`). Renvoie le nombre de connexions.
- Import : refus au-delà de 5 Mio (`validation("path", "file is too large")`) ; JSON illisible →
  `validation("path", "is not a TunL export")`, **sans** recopier le message du parseur (il peut citer le fichier,
  S7) ; puis `state.mutate(|store| plan_import(store, &file, now, Uuid::new_v4))`.
- Un `log::info!` avec les comptes ; jamais le contenu.
- `lib.rs` : les deux commandes après `connection_templates`. `commands/mod.rs` : `pub mod exchange;` et
  `#[cfg(test)] mod ipc_exchange_tests;`.
- `npm run bindings` : `ImportReport.ts`.

### Capacité

`src-tauri/capabilities/default.json` : ajouter `"dialog:allow-save"` (la boîte « Enregistrer sous » ; S14 : cette
fiche la demande, rien d'autre).

## Contrat — Frontend

- `ipc.ts` (section `// Export and import (T32): …`) : `storeExport: (path: string) => call<number>("store_export",
  { path })`, `storeImport: (path: string) => call<ImportReport>("store_import", { path })`.
- `lib/mock/exchange.ts` (nouveau, `...exchangeHandlers` dans `ipc-mock.ts`) : `store_export` renvoie le nombre de
  connexions ; `store_import` « lit » un fichier fixe — `nas` (192.168.1.10:22, `admin`, déjà présent) et
  `backup-01` (192.168.1.30:22, `backup`), dans un groupe `Backups` (couleur `amber`, créé s'il manque,
  `MOCK_IMPORTED_GROUP`) — avec les mêmes règles de doublon ; la connexion ajoutée part de `TEMPLATES.ssh`.
- `lib/files.ts` : `export const MOCK_SAVE_PATH = "/home/user/tunl-connections.json"` et
  `pickSaveFile(defaultName): Promise<string | null>` (Tauri : `save({ defaultPath: defaultName, filters: [{ name:
  "JSON", extensions: ["json"] }] })`, le sélecteur demande lui-même avant de remplacer un fichier).
- `features/connections/exchange.ts` (nouveau) :
  - `EXPORT_FILE_NAME = "tunl-connections.json"` ;
  - `importSummary(report)` : `exchange.added` (toujours), puis `exchange.skipped` et `exchange.invalid` s'ils ne
    valent pas 0, joints par ` · ` ;
  - `exportConnections()` : `pickSaveFile` (`null` → rien), `ipc.storeExport`, `toast.success(exchange.exported,
    { description: path })` ;
  - `importConnections()` : `pickFile` (`null` → rien), `ipc.storeImport`, `useConnections.getState().load()`,
    `toast.success(exchange.imported, { description: importSummary(report) })` ;
  - toute erreur → `notifyError`.
- `settings/sections/BackupSection.tsx` : deux rangées, « Export connections » (bouton `Download` « Export… ») et
  « Import connections » (bouton `Upload` « Import… »), chacune avec son aide.
- `SettingsView` : la section `backup` (icône `DatabaseBackup`) entre `availability` et `about`.

### i18n

| Clé | en | fr |
|---|---|---|
| `settings.sections.backup` | Backup | Sauvegarde |
| `settings.backup.export` | Export connections | Exporter les connexions |
| `settings.backup.exportHelp` | Groups and connections, to a JSON file. No password goes with them: those stay in the keyring. | Les groupes et les connexions, dans un fichier JSON. Aucun mot de passe ne part avec : ils restent dans le trousseau. |
| `settings.backup.exportButton` | Export… | Exporter… |
| `settings.backup.import` | Import connections | Importer des connexions |
| `settings.backup.importHelp` | From a TunL export. A connection already here (same host, port and user) is left out. | Depuis un export de TunL. Une connexion déjà présente (même hôte, port et utilisateur) est laissée de côté. |
| `settings.backup.importButton` | Import… | Importer… |
| `exchange.exported_one` / `_other` | {{count}} connection exported / {{count}} connections exported | {{count}} connexion exportée / {{count}} connexions exportées |
| `exchange.imported` | Import done | Import terminé |
| `exchange.added_one` / `_other` | {{count}} connection added / {{count}} connections added | {{count}} connexion ajoutée / {{count}} connexions ajoutées |
| `exchange.skipped_one` / `_other` | {{count}} already here | {{count}} déjà présente / {{count}} déjà présentes |
| `exchange.invalid_one` / `_other` | {{count}} refused (invalid) | {{count}} refusée (invalide) / {{count}} refusées (invalides) |

## Pièges (vus au prototype)

- `Store::find` est privé à `ops.rs` : dans `exchange.rs`, cherche avec `next.connections.iter().find(|c| c.id == id)`.
- Les doublons se cherchent dans le store **en construction**, pas dans l'original : deux fois la même connexion
  dans un fichier n'en ajoute qu'une.
- Un bastion déjà présent (doublon) est réutilisé : la connexion importée qui passait par lui le garde.
- `write_json_atomic` laisse un `.bak` à côté du fichier : bien pour `connections.json`, pas pour un export rangé
  dans `~/Documents`.
- La palette n'a **pas** d'action d'export : son test du contrat (T13) fixe la liste des actions.

## Tests du contrat

### `src-tauri/src/store/exchange_tests.rs` (nouveau)

```rust
//! T32: export and import of the connections as one JSON file.
use uuid::Uuid;

use super::Store;
use super::exchange::{EXPORT_FORMAT, EXPORT_VERSION, ExportFile, export_file, plan_import};
use crate::error::ErrorKind;
use crate::model::{AccentColor, ConnectionInput, GroupInput, Protocol};

fn ssh(name: &str, host: &str) -> ConnectionInput {
    ConnectionInput {
        name: name.into(),
        host: host.into(),
        username: Some("admin".into()),
        ..ConnectionInput::template(Protocol::Ssh)
    }
}

/// A store with a group "Prod", a bastion and a web server behind it.
fn source() -> Store {
    let (store, prod) = Store::default()
        .create_group(
            &GroupInput {
                name: "Prod".into(),
                color: Some(AccentColor::Blue),
            },
            Uuid::new_v4(),
        )
        .unwrap();
    let (store, bastion) = store
        .create_connection(&ssh("bastion", "bastion.example.net"), Uuid::new_v4(), 10)
        .unwrap();
    let web = ConnectionInput {
        group_id: Some(prod.id),
        jump_host_id: Some(bastion.id),
        tags: vec!["web".into()],
        ..ssh("web", "10.0.0.12")
    };
    let (store, _) = store.create_connection(&web, Uuid::new_v4(), 10).unwrap();
    let id = store.connections[1].id;
    store.touch_connection(id, 99).unwrap().0
}

fn ids() -> impl FnMut() -> Uuid {
    Uuid::new_v4
}

#[test]
fn an_export_holds_the_groups_and_connections_without_their_history() {
    let store = source();
    let file = export_file(&store, 1_000);
    assert_eq!(file.format, EXPORT_FORMAT);
    assert_eq!(file.version, EXPORT_VERSION);
    assert_eq!(file.exported_at, 1_000);
    assert_eq!(file.groups, store.groups);
    assert_eq!(file.connections.len(), 2);
    assert!(
        file.connections
            .iter()
            .all(|c| c.last_connected_at.is_none())
    );
    let json = serde_json::to_value(&file).unwrap();
    assert_eq!(json["format"], "tunl-connections");
    assert!(json.get("exportedAt").is_some());
}

#[test]
fn importing_into_an_empty_store_recreates_everything_under_new_ids() {
    let file = export_file(&source(), 1_000);
    let (store, report) = plan_import(&Store::default(), &file, 2_000, ids()).unwrap();
    assert_eq!(report.added, 2);
    assert_eq!(report.skipped, 0);
    assert_eq!(report.invalid, 0);
    assert_eq!(report.groups_created, 1);

    let bastion = store
        .connections
        .iter()
        .find(|c| c.name == "bastion")
        .unwrap();
    let web = store.connections.iter().find(|c| c.name == "web").unwrap();
    assert!(
        file.connections
            .iter()
            .all(|c| c.id != bastion.id && c.id != web.id)
    );
    assert_eq!(
        web.jump_host_id,
        Some(bastion.id),
        "the jump host follows the new id"
    );
    assert_eq!(web.group_id, Some(store.groups[0].id));
    assert_eq!(store.groups[0].name, "Prod");
    assert_eq!(store.groups[0].color, Some(AccentColor::Blue));
    assert_eq!(web.tags, ["web"]);
    assert_eq!(web.created_at, 2_000);
}

#[test]
fn importing_twice_adds_nothing_the_second_time() {
    let file = export_file(&source(), 1_000);
    let (once, _) = plan_import(&Store::default(), &file, 2_000, ids()).unwrap();
    let (twice, report) = plan_import(&once, &file, 3_000, ids()).unwrap();
    assert_eq!(report.added, 0);
    assert_eq!(report.skipped, 2);
    assert_eq!(report.groups_created, 0);
    assert_eq!(twice, once);
}

#[test]
fn a_group_is_matched_by_name_and_a_present_bastion_is_reused() {
    let source = source();
    let file = export_file(&source, 1_000);
    // The target store already has a "prod" group and the bastion, but not the web server.
    let (target, prod) = Store::default()
        .create_group(
            &GroupInput {
                name: "prod".into(),
                color: None,
            },
            Uuid::new_v4(),
        )
        .unwrap();
    let (target, bastion) = target
        .create_connection(&ssh("my bastion", "BASTION.example.net"), Uuid::new_v4(), 5)
        .unwrap();

    let (store, report) = plan_import(&target, &file, 2_000, ids()).unwrap();
    assert_eq!(
        (report.added, report.skipped, report.groups_created),
        (1, 1, 0)
    );
    let web = store.connections.iter().find(|c| c.name == "web").unwrap();
    assert_eq!(web.group_id, Some(prod.id));
    assert_eq!(web.jump_host_id, Some(bastion.id));
}

#[test]
fn an_invalid_connection_is_left_out_and_counted() {
    let mut file = export_file(&source(), 1_000);
    file.connections[0].host = "not a host".into();
    let (store, report) = plan_import(&Store::default(), &file, 2_000, ids()).unwrap();
    assert_eq!((report.added, report.invalid), (1, 1));
    // Its dependent stays, without the jump host it can no longer reach.
    assert_eq!(store.connections[0].name, "web");
    assert_eq!(store.connections[0].jump_host_id, None);
}

#[test]
fn another_format_or_a_newer_version_is_refused() {
    let mut other = export_file(&source(), 1_000);
    other.format = "something-else".into();
    let error = plan_import(&Store::default(), &other, 2_000, ids()).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert!(error.message.starts_with("format:"), "{}", error.message);

    let newer = ExportFile {
        version: EXPORT_VERSION + 1,
        ..export_file(&source(), 1_000)
    };
    let error = plan_import(&Store::default(), &newer, 2_000, ids()).unwrap_err();
    assert!(error.message.starts_with("version:"), "{}", error.message);
}
```

### `src-tauri/src/commands/ipc_exchange_tests.rs` (nouveau)

```rust
use std::os::unix::fs::PermissionsExt;

use serde_json::json;

use super::ipc_tests::{create_connection, invoke, mock_app, ok};

#[test]
fn export_then_import_through_the_ipc_with_the_paths_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    create_connection(&webview, "web");
    create_connection(&webview, "db");

    let path = dir.path().join("export.json");
    let written = ok(
        &webview,
        "store_export",
        json!({ "path": path.to_str().unwrap() }),
    );
    assert_eq!(written, json!(2));
    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600, "S9: the export is private");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("\"format\": \"tunl-connections\""));

    // The same connections again: nothing added.
    let report = ok(
        &webview,
        "store_import",
        json!({ "path": path.to_str().unwrap() }),
    );
    assert_eq!(
        report,
        json!({ "added": 0, "skipped": 2, "invalid": 0, "groupsCreated": 0 })
    );
}

#[test]
fn a_relative_path_or_a_file_that_is_not_an_export_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    let error = invoke(&webview, "store_export", json!({ "path": "export.json" })).unwrap_err();
    assert_eq!(error["kind"], "validation");

    let other = dir.path().join("other.json");
    std::fs::write(&other, "{\"secret\": \"do-not-echo\"}").unwrap();
    let error = invoke(
        &webview,
        "store_import",
        json!({ "path": other.to_str().unwrap() }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "validation");
    assert!(
        !error["message"].as_str().unwrap().contains("do-not-echo"),
        "S7"
    );
}
```

### `src/features/connections/exchange.test.ts` (nouveau)

```ts
// T32: the toast text of an import, and the mock's fixed import file.
import { beforeEach, describe, expect, test } from "vitest";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { importSummary } from "./exchange";

beforeEach(() => {
  resetMockBackend();
});

describe("importSummary", () => {
  test("what was added, then only the counts that are not zero", () => {
    expect(importSummary({ added: 3, skipped: 0, invalid: 0, groupsCreated: 1 })).toBe(
      "3 connections added",
    );
    expect(importSummary({ added: 1, skipped: 2, invalid: 1, groupsCreated: 0 })).toBe(
      "1 connection added · 2 already here · 1 refused (invalid)",
    );
    expect(importSummary({ added: 0, skipped: 2, invalid: 0, groupsCreated: 0 })).toBe(
      "0 connections added · 2 already here",
    );
  });
});

describe("mock store_export and store_import", () => {
  test("the export counts every connection; the import adds once, then finds it already here", async () => {
    const { connections } = await ipc.storeLoad();
    expect(await ipc.storeExport("/home/user/tunl-connections.json")).toBe(connections.length);

    const first = await ipc.storeImport("/home/user/tunl-connections.json");
    expect(first).toEqual({ added: 1, skipped: 1, invalid: 0, groupsCreated: 1 });
    const after = await ipc.storeLoad();
    const backup = after.connections.find((c) => c.name === "backup-01");
    expect(after.groups.find((g) => g.id === backup?.groupId)?.name).toBe("Backups");

    const second = await ipc.storeImport("/home/user/tunl-connections.json");
    expect(second).toEqual({ added: 0, skipped: 2, invalid: 0, groupsCreated: 0 });
  });
});
```

### `e2e/backup.spec.ts` (nouveau)

```ts
// T32: Settings › Backup — export the connections, import a file (mock: nas already here, backup-01 new).
import { expectSaneUi } from "./support/sanity.ts";
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await page.keyboard.press("Control+,");
  await settings(page).getByRole("navigation").getByRole("button", { name: "Backup" }).click();
});

function settings(page: Page) {
  return page.getByRole("region", { name: "Settings", exact: true });
}

test("export says how many connections went to the file", async ({ page }) => {
  await expectSaneUi(page);
  await settings(page).getByRole("button", { name: "Export connections" }).click();
  await expect(page.getByText(/^\d+ connections exported$/)).toBeVisible();
  await expect(page.getByText("/home/user/tunl-connections.json")).toBeVisible();
});

test("import adds what is new, leaves out what is already here, and the list shows it", async ({
  page,
}) => {
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByRole("button", { name: /^backup-01/ })).toHaveCount(0);

  await settings(page).getByRole("button", { name: "Import connections" }).click();
  await expect(page.getByText("1 connection added · 1 already here")).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^backup-01/ })).toBeVisible();
  await expect(sidebar.getByRole("region", { name: "Backups" })).toContainText("backup-01");

  await settings(page).getByRole("button", { name: "Import connections" }).click();
  await expect(page.getByText("0 connections added · 2 already here")).toBeVisible();
  await expect(sidebar.getByRole("button", { name: /^backup-01/ })).toHaveCount(1);
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T32`.
2. `store/exchange.rs`, `store/mod.rs` : `cd src-tauri && cargo test --lib store::exchange`.
3. `commands/exchange.rs`, `commands/mod.rs`, `lib.rs`, `capabilities/default.json` : `cargo test --lib
   ipc_exchange`, puis `npm run bindings`.
4. `ipc.ts`, `lib/mock/exchange.ts`, `ipc-mock.ts`, `lib/files.ts`, `connections/exchange.ts` : `npm run typecheck`,
   `npx vitest run src/features/connections`.
5. `BackupSection.tsx`, `SettingsView.tsx`, `en.json`, `fr.json` : `npx playwright test e2e/backup.spec.ts
   e2e/settings.spec.ts`.
6. `npm run format`, `npm run review`, cases, statut, ligne « Works today » du `README.md`, commit
   `feat: export and import the connections as a JSON file (T32)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T32 --check` affiche `OK` partout.
- [ ] `git diff main -- src-tauri/capabilities/default.json` n'ajoute que `dialog:allow-save`.
- [ ] `grep -rniE "password|passphrase|secret" src-tauri/src/store/exchange.rs src-tauri/src/commands/exchange.rs`
      ne trouve rien (aucun secret n'existe dans le store).
- [ ] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

`npm run tauri dev`, Paramètres › Sauvegarde : « Exporter… » propose `tunl-connections.json` ; ouvre le fichier (aucun
mot de passe, `ls -l` : `-rw-------`). Sur une autre machine (ou après avoir renommé `connections.json`), « Importer… »
ce fichier : les connexions, les groupes et les bastions reviennent ; un second import n'ajoute rien.
