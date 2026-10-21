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
