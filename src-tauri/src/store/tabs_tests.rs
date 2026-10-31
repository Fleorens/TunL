//! T60: the tabs of last time are kept in `tabs.json`, private, and a bad file never stops TunL.
use std::os::unix::fs::PermissionsExt;

use uuid::Uuid;

use super::tabs::{MAX_SAVED_TABS, SavedTab, SavedTabKind, load_tabs, save_tabs};
use crate::error::ErrorKind;

fn tab(kind: SavedTabKind) -> SavedTab {
    SavedTab {
        connection_id: Uuid::new_v4(),
        kind,
    }
}

#[test]
fn the_tabs_come_back_in_order_from_a_private_file() {
    let dir = tempfile::tempdir().unwrap();
    assert!(load_tabs(dir.path()).is_empty(), "no file, no tab");

    let tabs = vec![
        tab(SavedTabKind::Ssh),
        tab(SavedTabKind::Rdp),
        tab(SavedTabKind::Sftp),
    ];
    save_tabs(dir.path(), &tabs).unwrap();
    assert_eq!(load_tabs(dir.path()), tabs);

    let file = dir.path().join("tabs.json");
    let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    let json: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
    assert_eq!(json["version"], 1);
    assert_eq!(json["tabs"][1]["kind"], "rdp");
    assert!(json["tabs"][0]["connectionId"].is_string());
}

#[test]
fn a_bad_or_newer_file_gives_no_tab() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("tabs.json"), "{ not json").unwrap();
    assert!(load_tabs(dir.path()).is_empty());
    std::fs::write(
        dir.path().join("tabs.json"),
        r#"{ "version": 99, "tabs": [] }"#,
    )
    .unwrap();
    assert!(load_tabs(dir.path()).is_empty());
}

#[test]
fn too_many_tabs_are_refused_and_nothing_is_written() {
    let dir = tempfile::tempdir().unwrap();
    let tabs: Vec<SavedTab> = (0..=MAX_SAVED_TABS)
        .map(|_| tab(SavedTabKind::Ssh))
        .collect();
    let error = save_tabs(dir.path(), &tabs).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert!(!dir.path().join("tabs.json").exists());
}
