//! Import of a file we did not write ourselves: a third-party RDP connection may carry its own
//! extra arguments or home-directory sharing, which are dropped on import (docs/06-securite.md).
//! A group with an invalid name must not fail the whole import (T40).
use uuid::Uuid;

use super::Store;
use super::exchange::{EXPORT_FORMAT, EXPORT_VERSION, ExportFile, plan_import};
use crate::model::{Connection, ConnectionInput, Group, Protocol, ProtocolSettings};

fn ids() -> impl FnMut() -> Uuid {
    Uuid::new_v4
}

fn ssh(name: &str, host: &str) -> ConnectionInput {
    ConnectionInput {
        name: name.into(),
        host: host.into(),
        username: Some("admin".into()),
        ..ConnectionInput::template(Protocol::Ssh)
    }
}

fn rdp(name: &str, host: &str) -> ConnectionInput {
    ConnectionInput {
        name: name.into(),
        host: host.into(),
        username: Some("admin".into()),
        ..ConnectionInput::template(Protocol::Rdp)
    }
}

/// An RDP connection that carries its own extra arguments and home-directory sharing.
fn rdp_with_options(name: &str, host: &str) -> ConnectionInput {
    let mut input = rdp(name, host);
    if let ProtocolSettings::Rdp(settings) = &mut input.settings {
        settings.extra_args = vec!["/multimon".into()];
        settings.share_home = true;
    }
    input
}

fn connection(input: ConnectionInput, id: Uuid, now: i64) -> Connection {
    Connection::from_input(id, input, now)
}

fn file(groups: Vec<Group>, connections: Vec<Connection>) -> ExportFile {
    ExportFile {
        format: EXPORT_FORMAT.into(),
        version: EXPORT_VERSION,
        exported_at: 1_000,
        groups,
        connections,
    }
}

#[test]
fn an_imported_rdp_connection_has_its_extra_options_dropped() {
    let file = file(
        vec![],
        vec![connection(
            rdp_with_options("win", "10.0.0.5"),
            Uuid::new_v4(),
            1_000,
        )],
    );
    let (store, report) = plan_import(&Store::default(), &file, 2_000, ids()).unwrap();

    let win = store.connections.iter().find(|c| c.name == "win").unwrap();
    match &win.settings {
        ProtocolSettings::Rdp(settings) => {
            assert!(
                settings.extra_args.is_empty(),
                "extra arguments are dropped"
            );
            assert!(!settings.share_home, "home sharing is dropped");
        }
        other => panic!("expected RDP, got {other:?}"),
    }
    assert_eq!(report.rdp_options_removed, Some(1));
}

#[test]
fn an_imported_rdp_connection_without_extra_options_is_not_counted() {
    let file = file(
        vec![],
        vec![connection(rdp("win", "10.0.0.6"), Uuid::new_v4(), 1_000)],
    );
    let (_store, report) = plan_import(&Store::default(), &file, 2_000, ids()).unwrap();
    assert_eq!(report.rdp_options_removed, None);
}

#[test]
fn a_group_with_an_invalid_name_is_ignored_without_failing_the_import() {
    let gid = Uuid::new_v4();
    let mut web = ssh("web", "10.0.0.7");
    web.group_id = Some(gid);
    let file = file(
        vec![Group {
            id: gid,
            name: "   ".into(),
            color: None,
        }],
        vec![connection(web, Uuid::new_v4(), 1_000)],
    );
    let (store, report) = plan_import(&Store::default(), &file, 2_000, ids()).unwrap();

    assert_eq!(report.added, 1, "the connection is imported");
    assert_eq!(report.groups_created, 0, "the invalid group is not created");
    let web = store.connections.iter().find(|c| c.name == "web").unwrap();
    assert_eq!(web.group_id, None, "the connection arrives without a group");
}
