# T07 — Store JSON atomique, sauvegarde `.bak`, quarantaine `.corrupt`, migrations

| | |
|---|---|
| **Jalon** | M1 — Connexions |
| **Dépend de** | T06 |
| **Lire avant** | `AGENTS.md` (« Fiches contrat »), `docs/01-architecture.md` §9, `docs/05-modele-donnees.md` §4 et §5, `docs/06-securite.md` (S1, S9) |
| **Livrable** | `src-tauri/src/store/` : lecture et écriture de `connections.json` et `settings.json`, 11 tests Rust verts |

## Pourquoi

Les connexions d'un utilisateur ne doivent **jamais** disparaître : pas de fichier à moitié écrit après une coupure,
pas d'effacement silencieux d'un fichier illisible, et pas d'écrasement d'un fichier écrit par une version plus
récente de TunL. Cette fiche ne fait que des entrées et sorties sur le disque. Aucune commande Tauri : c'est T08 qui
branchera ce module dans `AppState`.

## Contrat

### Fichiers

```
src-tauri/src/store/
├── mod.rs        constantes, Store, Loaded<T>, load_store / save_store / load_settings / save_settings,
│                 `pub use migrate::migrate_to_current;`, `#[cfg(test)] mod tests;`
├── file.rs       write_json_atomic, quarantine, read (outils génériques, sans connaissance du modèle)
├── migrate.rs    migrate_to_current
└── tests.rs      ⚠ fourni ci-dessous, à l'identique
```

Dans `lib.rs` : `pub mod store;`.

### API

```rust
pub const STORE_FILE: &str = "connections.json";
pub const SETTINGS_FILE: &str = "settings.json";
pub const STORE_VERSION: u32 = 1;

/// The in-memory store. Never mutated in place: every change builds a new Store (T08).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Store { pub groups: Vec<Group>, pub connections: Vec<Connection> }

#[derive(Debug)]
pub struct Loaded<T> {
    pub value: T,
    /// Set when the file was unreadable and has been moved aside (`<file>.corrupt-<now_ms>`).
    pub quarantined: Option<PathBuf>,
}

pub fn load_store(config_dir: &Path, now_ms: i64) -> AppResult<Loaded<Store>>;
pub fn save_store(config_dir: &Path, store: &Store) -> AppResult<()>;
pub fn load_settings(config_dir: &Path, now_ms: i64) -> AppResult<Loaded<Settings>>;
pub fn save_settings(config_dir: &Path, settings: &Settings) -> AppResult<()>;

// migrate.rs
pub fn migrate_to_current(value: serde_json::Value) -> AppResult<serde_json::Value>;
```

Le format sur disque de `connections.json` est une struct privée
`StoreFile { version: u32, groups, connections }`, dans cet ordre, en camelCase.

### Comportement de `load_store`

| Situation | Résultat |
|---|---|
| Fichier absent | `Ok`, store vide, `quarantined: None`, **rien n'est écrit** |
| JSON valide, `version` = 1 | `Ok`, store lu. Si les droits du fichier ne sont pas `0600`, ils le deviennent |
| `version` > `STORE_VERSION` | `Err(ErrorKind::Store)`, message contenant `newer`, par exemple `"connections.json was created by a newer TunL (version 99)"`. Le fichier n'est **ni déplacé, ni modifié** |
| JSON illisible, `version` absente ou pas un entier, ou forme inattendue (`serde` échoue) | fichier renommé en `connections.json.corrupt-<now_ms>`, `log::warn!`, `Ok` avec un store vide et `quarantined: Some(chemin)` |
| Autre erreur d'entrée-sortie (droits refusés…) | `Err(ErrorKind::Io)` |

Pas de revalidation métier au chargement (bastion manquant, groupe inconnu…) : l'UI et la connexion s'en
accommodent. Un fichier modifié à la main ne doit pas tout faire basculer en quarantaine pour un détail.

### Comportement de `load_settings`

Comme `load_store`, sans notion de version :
- les champs manquants prennent leur défaut (`#[serde(default)]`, déjà en place depuis T06) ;
- les champs inconnus sont ignorés ;
- après la lecture, `normalize_settings` s'applique. Un réglage hors bornes est traité comme un fichier illisible :
  quarantaine, puis valeurs par défaut.

### Écriture atomique (`file.rs`)

Ordre imposé, pour que le fichier principal existe **à chaque instant** :

1. Supprimer un `<fichier>.tmp` laissé par un plantage, puis le recréer avec
   `OpenOptions::new().write(true).create_new(true).mode(0o600)`.
2. Écrire le JSON (`serde_json::to_vec_pretty`, suivi d'un `\n` final), puis `sync_all()`.
3. Si le fichier principal existe : supprimer l'ancien `.bak`, puis `fs::hard_link(principal, bak)`. Le lien dur
   garde l'ancien contenu sans le copier, avec les mêmes droits.
4. `fs::rename(tmp, principal)`, qui est atomique.
5. `File::open(dossier)?.sync_all()` : le renommage survit ainsi à une coupure de courant.

Les lignes vraiment piégeuses :

```rust
// Append a suffix without going through `display()` (lossy on non-UTF-8 paths).
fn with_suffix(path: &Path, suffix: &str) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(suffix);
    PathBuf::from(name)
}

// Removing a file that may not exist, without swallowing the other errors.
fn remove_if_exists(path: &Path) -> AppResult<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error.into()),
        _ => Ok(()),
    }
}
```

### Pièges

- `OpenOptions::mode()` ne s'applique qu'**à la création**. Ouvrir un `.tmp` existant avec `truncate` garderait ses
  anciens droits. D'où `create_new`, après suppression.
- `std::os::unix::fs::{OpenOptionsExt, PermissionsExt}` : ce sont ces traits qui fournissent `.mode()` et
  `from_mode()`.
- Le numéro de version doit être lu **avant** toute désérialisation typée. Sinon un fichier `version: 99` qui a
  changé de forme partirait en quarantaine au lieu d'être refusé proprement.
- Aucun `unwrap()` ni `expect()` hors de `tests.rs`.

## Tests du contrat — `src-tauri/src/store/tests.rs` (à l'identique)

```rust
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use uuid::Uuid;

use super::*;
use crate::error::ErrorKind;
use crate::model::{Connection, ConnectionInput, Group, Protocol, Settings, ThemeMode};

fn sample_store() -> Store {
    let group = Group { id: Uuid::new_v4(), name: "Production".into(), color: None };
    let input = ConnectionInput {
        name: "web-01".into(),
        host: "10.0.0.12".into(),
        group_id: Some(group.id),
        ..ConnectionInput::template(Protocol::Ssh)
    };
    Store {
        groups: vec![group],
        connections: vec![Connection::from_input(Uuid::new_v4(), input, 1_000)],
    }
}

fn mode_of(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

fn names_in(dir: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
        .collect();
    names.sort();
    names
}

#[test]
fn a_missing_file_loads_an_empty_store_without_writing() {
    let dir = tempfile::tempdir().unwrap();
    let loaded = load_store(dir.path(), 1).unwrap();
    assert_eq!(loaded.value, Store::default());
    assert_eq!(loaded.quarantined, None);
    assert!(names_in(dir.path()).is_empty());
}

#[test]
fn saving_then_loading_round_trips() {
    let dir = tempfile::tempdir().unwrap();
    let store = sample_store();
    save_store(dir.path(), &store).unwrap();
    let loaded = load_store(dir.path(), 1).unwrap();
    assert_eq!(loaded.value, store);
    assert_eq!(loaded.quarantined, None);
}

#[test]
fn the_file_is_versioned_pretty_json_in_camel_case() {
    let dir = tempfile::tempdir().unwrap();
    save_store(dir.path(), &sample_store()).unwrap();
    let text = fs::read_to_string(dir.path().join(STORE_FILE)).unwrap();
    assert!(text.ends_with('\n'));
    assert!(text.starts_with("{\n  \"version\": 1,"), "pretty-printed, version first:\n{text}");
    assert!(text.contains("\"groupId\""));
}

#[test]
fn saving_keeps_a_backup_and_private_permissions() {
    let dir = tempfile::tempdir().unwrap();
    let first = sample_store();
    save_store(dir.path(), &first).unwrap();
    let second = Store { groups: Vec::new(), ..first.clone() };
    save_store(dir.path(), &second).unwrap();

    let main = dir.path().join(STORE_FILE);
    let backup = dir.path().join("connections.json.bak");
    assert_eq!(load_store(dir.path(), 1).unwrap().value, second);
    let backup_json: serde_json::Value = serde_json::from_str(&fs::read_to_string(&backup).unwrap()).unwrap();
    assert_eq!(backup_json["groups"].as_array().map(Vec::len), Some(1));
    assert_eq!(mode_of(&main), 0o600);
    assert_eq!(mode_of(&backup), 0o600);
    assert_eq!(names_in(dir.path()), ["connections.json", "connections.json.bak"], "no .tmp left behind");
}

#[test]
fn an_unreadable_file_is_quarantined_not_deleted() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join(STORE_FILE), "{ not json").unwrap();
    let loaded = load_store(dir.path(), 1234).unwrap();
    assert_eq!(loaded.value, Store::default());
    let quarantined = dir.path().join("connections.json.corrupt-1234");
    assert_eq!(loaded.quarantined.as_deref(), Some(quarantined.as_path()));
    assert_eq!(fs::read_to_string(&quarantined).unwrap(), "{ not json");
    assert!(!dir.path().join(STORE_FILE).exists());
}

#[test]
fn a_file_with_the_wrong_shape_is_quarantined_too() {
    let dir = tempfile::tempdir().unwrap();
    let content = r#"{ "version": 1, "groups": "oops", "connections": [] }"#;
    fs::write(dir.path().join(STORE_FILE), content).unwrap();
    let loaded = load_store(dir.path(), 7).unwrap();
    assert!(loaded.quarantined.is_some());
    assert!(dir.path().join("connections.json.corrupt-7").exists());
}

#[test]
fn a_file_from_a_newer_tunl_is_refused_and_left_untouched() {
    let dir = tempfile::tempdir().unwrap();
    let content = r#"{ "version": 99, "groups": [], "connections": [], "shape": "changed" }"#;
    fs::write(dir.path().join(STORE_FILE), content).unwrap();
    let error = load_store(dir.path(), 1).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Store);
    assert!(error.message.contains("newer"), "{}", error.message);
    assert_eq!(fs::read_to_string(dir.path().join(STORE_FILE)).unwrap(), content);
    assert_eq!(names_in(dir.path()), ["connections.json"]);
}

#[test]
fn loading_tightens_loose_permissions() {
    let dir = tempfile::tempdir().unwrap();
    save_store(dir.path(), &sample_store()).unwrap();
    let main = dir.path().join(STORE_FILE);
    fs::set_permissions(&main, fs::Permissions::from_mode(0o644)).unwrap();
    load_store(dir.path(), 1).unwrap();
    assert_eq!(mode_of(&main), 0o600);
}

#[test]
fn migration_accepts_the_current_version_and_refuses_the_rest() {
    let current = serde_json::json!({ "version": STORE_VERSION, "groups": [], "connections": [] });
    assert_eq!(migrate_to_current(current.clone()).unwrap(), current);
    let newer = migrate_to_current(serde_json::json!({ "version": STORE_VERSION + 1 })).unwrap_err();
    assert_eq!(newer.kind, ErrorKind::Store);
    assert!(newer.message.contains("newer"));
    let missing = migrate_to_current(serde_json::json!({ "groups": [] })).unwrap_err();
    assert_eq!(missing.kind, ErrorKind::Store);
}

#[test]
fn settings_default_when_missing_and_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(load_settings(dir.path(), 1).unwrap().value, Settings::default());
    let dark = Settings { theme: ThemeMode::Dark, ..Settings::default() };
    save_settings(dir.path(), &dark).unwrap();
    assert_eq!(load_settings(dir.path(), 1).unwrap().value, dark);
    assert_eq!(mode_of(&dir.path().join(SETTINGS_FILE)), 0o600);
}

#[test]
fn invalid_settings_are_quarantined_and_reset() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(dir.path().join(SETTINGS_FILE), r#"{ "terminal": { "fontSize": 200 } }"#).unwrap();
    let loaded = load_settings(dir.path(), 55).unwrap();
    assert_eq!(loaded.value, Settings::default());
    assert!(dir.path().join("settings.json.corrupt-55").exists());
}
```

## Étapes

1. `store/tests.rs` d'abord, puis `file.rs`, `migrate.rs`, `mod.rs`.
2. `npm run format`, `npm run review`, cases, statut, commit `feat: atomic JSON store with backup, quarantine and migrations (T07)`.

## Critères d'acceptation

- [x] `npm run review` passe, avec les 11 tests de `store/tests.rs`.
- [x] `store/tests.rs` est identique à la fiche (au formatage `cargo fmt` près).
- [x] `grep -rn "unwrap()\|expect(" src-tauri/src/store --include=*.rs | grep -v tests.rs` est vide.
- [x] `grep -rn "let _ =" src-tauri/src/store` est vide : aucune erreur avalée.

## À regarder par Florian

Rien à l'écran : le store n'est pas encore branché dans l'app (T08).
