use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;

use uuid::Uuid;

use super::*;
use crate::error::ErrorKind;
use crate::model::{Connection, ConnectionInput, Group, Protocol, Settings, ThemeMode};

fn sample_store() -> Store {
    let group = Group {
        id: Uuid::new_v4(),
        name: "Production".into(),
        color: None,
    };
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
    assert!(
        text.starts_with("{\n  \"version\": 1,"),
        "pretty-printed, version first:\n{text}"
    );
    assert!(text.contains("\"groupId\""));
}

#[test]
fn saving_keeps_a_backup_and_private_permissions() {
    let dir = tempfile::tempdir().unwrap();
    let first = sample_store();
    save_store(dir.path(), &first).unwrap();
    let second = Store {
        groups: Vec::new(),
        ..first.clone()
    };
    save_store(dir.path(), &second).unwrap();

    let main = dir.path().join(STORE_FILE);
    let backup = dir.path().join("connections.json.bak");
    assert_eq!(load_store(dir.path(), 1).unwrap().value, second);
    let backup_json: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(&backup).unwrap()).unwrap();
    assert_eq!(backup_json["groups"].as_array().map(Vec::len), Some(1));
    assert_eq!(mode_of(&main), 0o600);
    assert_eq!(mode_of(&backup), 0o600);
    assert_eq!(
        names_in(dir.path()),
        ["connections.json", "connections.json.bak"],
        "no .tmp left behind"
    );
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
    assert_eq!(
        fs::read_to_string(dir.path().join(STORE_FILE)).unwrap(),
        content
    );
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
    let newer =
        migrate_to_current(serde_json::json!({ "version": STORE_VERSION + 1 })).unwrap_err();
    assert_eq!(newer.kind, ErrorKind::Store);
    assert!(newer.message.contains("newer"));
    let missing = migrate_to_current(serde_json::json!({ "groups": [] })).unwrap_err();
    assert_eq!(missing.kind, ErrorKind::Store);
}

#[test]
fn settings_default_when_missing_and_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(
        load_settings(dir.path(), 1).unwrap().value,
        Settings::default()
    );
    let dark = Settings {
        theme: ThemeMode::Dark,
        ..Settings::default()
    };
    save_settings(dir.path(), &dark).unwrap();
    assert_eq!(load_settings(dir.path(), 1).unwrap().value, dark);
    assert_eq!(mode_of(&dir.path().join(SETTINGS_FILE)), 0o600);
}

#[test]
fn invalid_settings_are_quarantined_and_reset() {
    let dir = tempfile::tempdir().unwrap();
    fs::write(
        dir.path().join(SETTINGS_FILE),
        r#"{ "terminal": { "fontSize": 200 } }"#,
    )
    .unwrap();
    let loaded = load_settings(dir.path(), 55).unwrap();
    assert_eq!(loaded.value, Settings::default());
    assert!(dir.path().join("settings.json.corrupt-55").exists());
}
