use uuid::Uuid;

use super::Store;
use crate::error::{ErrorDetail, ErrorKind};
use crate::model::{ConnectionInput, GroupInput, Protocol};

fn ssh(name: &str) -> ConnectionInput {
    ConnectionInput {
        name: name.into(),
        host: "10.0.0.1".into(),
        ..ConnectionInput::template(Protocol::Ssh)
    }
}

fn group(name: &str) -> GroupInput {
    GroupInput {
        name: name.into(),
        color: None,
    }
}

#[test]
fn creating_validates_and_never_mutates_the_original() {
    let empty = Store::default();
    let (next, created) = empty
        .create_connection(&ssh("  web-01 "), Uuid::new_v4(), 10)
        .unwrap();
    assert_eq!(created.name, "web-01");
    assert_eq!((created.created_at, created.updated_at), (10, 10));
    assert!(empty.connections.is_empty());
    assert_eq!(next.connections, [created]);
    let error = empty
        .create_connection(&ssh(""), Uuid::new_v4(), 10)
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
}

#[test]
fn updating_keeps_the_creation_date_and_bumps_updated_at() {
    let id = Uuid::new_v4();
    let (store, _) = Store::default()
        .create_connection(&ssh("web"), id, 10)
        .unwrap();
    let (store, updated) = store
        .update_connection(id, &ssh("web-renamed"), 20)
        .unwrap();
    assert_eq!((updated.created_at, updated.updated_at), (10, 20));
    assert_eq!(store.connections[0].name, "web-renamed");
    let missing = store
        .update_connection(Uuid::new_v4(), &ssh("x"), 30)
        .unwrap_err();
    assert_eq!(missing.kind, ErrorKind::NotFound);
}

#[test]
fn duplicates_get_the_next_free_suffix_and_no_history() {
    let id = Uuid::new_v4();
    let (store, _) = Store::default()
        .create_connection(&ssh("web"), id, 10)
        .unwrap();
    let (store, _) = store.set_favorite(id, true, 11).unwrap();
    let (store, _) = store.touch_connection(id, 12).unwrap();
    let (store, first) = store.duplicate_connection(id, Uuid::new_v4(), 20).unwrap();
    let (store, second) = store.duplicate_connection(id, Uuid::new_v4(), 30).unwrap();
    assert_eq!(first.name, "web (2)");
    assert_eq!(second.name, "web (3)");
    assert!(!first.favorite);
    assert_eq!(first.last_connected_at, None);
    assert_eq!((first.created_at, first.updated_at), (20, 20));
    assert_eq!(store.connections.len(), 3);
}

#[test]
fn a_duplicate_name_stays_within_eighty_characters() {
    let id = Uuid::new_v4();
    let long = "x".repeat(80);
    let (store, _) = Store::default()
        .create_connection(&ssh(&long), id, 10)
        .unwrap();
    let (_, copy) = store.duplicate_connection(id, Uuid::new_v4(), 20).unwrap();
    assert_eq!(copy.name.chars().count(), 80);
    assert!(copy.name.ends_with(" (2)"));
}

#[test]
fn favorites_and_touch_update_the_right_fields() {
    let id = Uuid::new_v4();
    let (store, _) = Store::default()
        .create_connection(&ssh("web"), id, 10)
        .unwrap();
    let (store, favorite) = store.set_favorite(id, true, 20).unwrap();
    assert!(favorite.favorite);
    assert_eq!(favorite.updated_at, 20);
    let (_, touched) = store.touch_connection(id, 30).unwrap();
    assert_eq!(touched.last_connected_at, Some(30));
    assert_eq!(touched.updated_at, 20, "connecting is not an edit");
}

#[test]
fn a_bastion_in_use_cannot_be_deleted() {
    let bastion_id = Uuid::new_v4();
    let (store, _) = Store::default()
        .create_connection(&ssh("bastion-01"), bastion_id, 10)
        .unwrap();
    let behind = |name: &str| ConnectionInput {
        jump_host_id: Some(bastion_id),
        ..ssh(name)
    };
    let (store, _) = store
        .create_connection(&behind("web-02"), Uuid::new_v4(), 10)
        .unwrap();
    let (store, _) = store
        .create_connection(&behind("web-01"), Uuid::new_v4(), 10)
        .unwrap();
    let error = store.delete_connection(bastion_id).unwrap_err();
    assert_eq!(error.kind, ErrorKind::InUse);
    let names = vec!["web-01".to_string(), "web-02".to_string()];
    assert_eq!(error.detail.as_deref(), Some(&ErrorDetail::InUse { names }));
    assert_eq!(store.connections.len(), 3);
}

#[test]
fn deleting_a_connection_removes_only_it() {
    let id = Uuid::new_v4();
    let (store, _) = Store::default()
        .create_connection(&ssh("a"), id, 10)
        .unwrap();
    let (store, _) = store
        .create_connection(&ssh("b"), Uuid::new_v4(), 10)
        .unwrap();
    let store = store.delete_connection(id).unwrap();
    let names: Vec<&str> = store.connections.iter().map(|c| c.name.as_str()).collect();
    assert_eq!(names, ["b"]);
    assert_eq!(
        store.delete_connection(id).unwrap_err().kind,
        ErrorKind::NotFound
    );
}

#[test]
fn deleting_a_group_ungroups_its_connections() {
    let group_id = Uuid::new_v4();
    let (store, _) = Store::default()
        .create_group(&group("Prod"), group_id)
        .unwrap();
    let grouped = ConnectionInput {
        group_id: Some(group_id),
        ..ssh("web")
    };
    let (store, _) = store
        .create_connection(&grouped, Uuid::new_v4(), 10)
        .unwrap();
    let store = store.delete_group(group_id).unwrap();
    assert!(store.groups.is_empty());
    assert_eq!(store.connections[0].group_id, None);
    assert_eq!(store.connections[0].updated_at, 10);
}

#[test]
fn groups_are_validated_and_renamed() {
    let (a, b) = (Uuid::new_v4(), Uuid::new_v4());
    let (store, _) = Store::default().create_group(&group("A"), a).unwrap();
    let (store, _) = store.create_group(&group("B"), b).unwrap();
    assert_eq!(
        store
            .create_group(&group("a"), Uuid::new_v4())
            .unwrap_err()
            .kind,
        ErrorKind::Validation
    );
    let (store, renamed) = store.update_group(b, &group("Beta")).unwrap();
    assert_eq!(renamed.name, "Beta");
    assert_eq!(store.groups[1].name, "Beta");
}

#[test]
fn groups_are_reordered_only_by_a_full_permutation() {
    let (a, b, c) = (Uuid::new_v4(), Uuid::new_v4(), Uuid::new_v4());
    let (store, _) = Store::default().create_group(&group("A"), a).unwrap();
    let (store, _) = store.create_group(&group("B"), b).unwrap();
    let (store, _) = store.create_group(&group("C"), c).unwrap();
    let reordered = store.reorder_groups(&[c, a, b]).unwrap();
    let ids: Vec<Uuid> = reordered.groups.iter().map(|g| g.id).collect();
    assert_eq!(ids, [c, a, b]);
    assert_eq!(
        store.reorder_groups(&[c, a]).unwrap_err().kind,
        ErrorKind::Validation
    );
    assert_eq!(
        store.reorder_groups(&[c, a, a]).unwrap_err().kind,
        ErrorKind::Validation
    );
    assert_eq!(
        store
            .reorder_groups(&[c, a, b, Uuid::new_v4()])
            .unwrap_err()
            .kind,
        ErrorKind::Validation
    );
}
