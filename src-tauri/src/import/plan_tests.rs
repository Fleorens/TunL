use uuid::Uuid;

use super::plan::{ImportJump, apply_import, build_candidates};
use super::ssh_config::{ParsedSshConfig, parse_ssh_config};
use crate::model::{ConnectionInput, GroupInput, Protocol, ProtocolSettings, SshAuth};
use crate::store::Store;

fn parsed(text: &str) -> ParsedSshConfig {
    parse_ssh_config(text, &|_: &str| Vec::new())
}

fn with_existing(store: &Store, name: &str, host: &str, username: Option<&str>) -> (Store, Uuid) {
    let id = Uuid::new_v4();
    let input = ConnectionInput {
        name: name.into(),
        host: host.into(),
        username: username.map(Into::into),
        ..ConnectionInput::template(Protocol::Ssh)
    };
    let (next, _) = store.create_connection(&input, id, 1).unwrap();
    (next, id)
}

fn selected(aliases: &[&str]) -> Vec<String> {
    aliases.iter().map(|alias| alias.to_string()).collect()
}

fn ssh_auth(settings: &ProtocolSettings) -> &SshAuth {
    match settings {
        ProtocolSettings::Ssh(ssh) => &ssh.auth,
        ProtocolSettings::Rdp(_) => panic!("expected SSH"),
    }
}

#[test]
fn candidates_take_defaults_and_keep_the_file_order() {
    let candidates = build_candidates(
        &parsed("Host b\n  HostName 10.0.0.2\nHost a\n"),
        &Store::default(),
    );
    let names: Vec<&str> = candidates.iter().map(|c| c.alias.as_str()).collect();
    assert_eq!(names, ["b", "a"]);
    let a = &candidates[1];
    assert_eq!((a.host.as_str(), a.port), ("a", 22));
    assert_eq!((a.username.clone(), a.key_path.clone()), (None, None));
    assert_eq!(
        (a.jump.clone(), a.duplicate_of, a.error.clone()),
        (None, None, None)
    );
}

#[test]
fn a_known_host_is_a_duplicate() {
    let (store, id) = with_existing(&Store::default(), "web", "Web.Example.com", Some("deploy"));
    let candidates = build_candidates(
        &parsed(
            "Host w\n  HostName web.example.com\n  User deploy\nHost w2\n  HostName web.example.com\n  User other\n",
        ),
        &store,
    );
    assert_eq!(candidates[0].duplicate_of, Some(id));
    assert_eq!(candidates[1].duplicate_of, None);
}

#[test]
fn jumps_resolve_to_candidates_then_existing_connections() {
    let (store, id) = with_existing(&Store::default(), "bastion-prod", "203.0.113.1", None);
    let candidates = build_candidates(
        &parsed(
            "Host jump\n  HostName 10.0.0.1\nHost a\n  ProxyJump jump\nHost b\n  ProxyJump bastion-prod\nHost c\n  ProxyJump ops@203.0.113.1:22\nHost d\n  ProxyJump nowhere\n",
        ),
        &store,
    );
    let existing = ImportJump::Existing {
        id,
        name: "bastion-prod".into(),
    };
    assert_eq!(
        candidates[1].jump,
        Some(ImportJump::Candidate {
            alias: "jump".into()
        })
    );
    assert_eq!(candidates[2].jump, Some(existing.clone()));
    assert_eq!(candidates[3].jump, Some(existing));
    assert_eq!(
        candidates[4].jump,
        Some(ImportJump::Unresolved {
            hop: "nowhere".into()
        })
    );
    assert_eq!(candidates[4].warnings, ["jump host nowhere not found"]);
}

#[test]
fn a_jump_through_a_duplicate_uses_the_existing_connection() {
    let (store, id) = with_existing(&Store::default(), "bastion", "10.0.0.1", None);
    let candidates = build_candidates(
        &parsed("Host jb\n  HostName 10.0.0.1\nHost app\n  ProxyJump jb\n"),
        &store,
    );
    assert_eq!(candidates[0].duplicate_of, Some(id));
    assert_eq!(
        candidates[1].jump,
        Some(ImportJump::Existing {
            id,
            name: "bastion".into()
        })
    );
}

#[test]
fn only_the_last_hop_is_kept() {
    let candidates = build_candidates(
        &parsed("Host j1\nHost j2\nHost app\n  ProxyJump j1,j2\n"),
        &Store::default(),
    );
    assert_eq!(
        candidates[2].jump,
        Some(ImportJump::Candidate { alias: "j2".into() })
    );
    assert!(
        candidates[2]
            .warnings
            .contains(&"only the last ProxyJump hop is used".to_string())
    );
}

#[test]
fn invalid_hosts_get_an_error_and_are_never_imported() {
    let candidates = build_candidates(
        &parsed("Host ok\n  HostName 10.0.0.1\nHost bad\n  HostName under_score!\n"),
        &Store::default(),
    );
    assert_eq!(candidates[0].error, None);
    assert!(candidates[1].error.as_deref().unwrap().starts_with("host:"));
    let (store, created) = apply_import(
        &Store::default(),
        &candidates,
        &selected(&["ok", "bad"]),
        None,
        5,
        Uuid::new_v4,
    )
    .unwrap();
    assert_eq!(created.len(), 1);
    assert_eq!(store.connections.len(), 1);
}

#[test]
fn apply_creates_jump_hosts_first_and_links_them() {
    let config = "Host app\n  HostName 10.0.0.2\n  User deploy\n  IdentityFile ~/.ssh/id_app\n  ProxyJump jump\nHost jump\n  HostName 10.0.0.1\n";
    let candidates = build_candidates(&parsed(config), &Store::default());
    let original = Store::default();
    let (store, created) = apply_import(
        &original,
        &candidates,
        &selected(&["app", "jump"]),
        None,
        5,
        Uuid::new_v4,
    )
    .unwrap();
    assert!(original.connections.is_empty());
    assert_eq!(store.connections.len(), 2);
    assert_eq!(created[0].name, "jump");
    let app = &created[1];
    assert_eq!(app.name, "app");
    assert_eq!(app.jump_host_id, Some(created[0].id));
    assert_eq!(app.username.as_deref(), Some("deploy"));
    assert_eq!(app.created_at, 5);
    assert_eq!(
        ssh_auth(&app.settings),
        &SshAuth::Key {
            path: "~/.ssh/id_app".into()
        }
    );
    assert_eq!(ssh_auth(&created[0].settings), &SshAuth::Agent);
}

#[test]
fn apply_drops_a_jump_to_an_unselected_candidate() {
    let candidates = build_candidates(
        &parsed("Host app\n  ProxyJump jump\nHost jump\n"),
        &Store::default(),
    );
    let (_, created) = apply_import(
        &Store::default(),
        &candidates,
        &selected(&["app"]),
        None,
        5,
        Uuid::new_v4,
    )
    .unwrap();
    assert_eq!(created.len(), 1);
    assert_eq!(created[0].jump_host_id, None);
}

#[test]
fn apply_puts_everything_in_the_chosen_group() {
    let group_id = Uuid::new_v4();
    let (store, _) = Store::default()
        .create_group(
            &GroupInput {
                name: "Imported".into(),
                color: None,
            },
            group_id,
        )
        .unwrap();
    let candidates = build_candidates(&parsed("Host a\nHost b\n"), &store);
    let (_, created) = apply_import(
        &store,
        &candidates,
        &selected(&["a", "b"]),
        Some(group_id),
        5,
        Uuid::new_v4,
    )
    .unwrap();
    assert!(
        created
            .iter()
            .all(|connection| connection.group_id == Some(group_id))
    );
}

#[test]
fn apply_breaks_a_jump_cycle() {
    let candidates = build_candidates(
        &parsed("Host a\n  ProxyJump b\nHost b\n  ProxyJump a\n"),
        &Store::default(),
    );
    let (_, created) = apply_import(
        &Store::default(),
        &candidates,
        &selected(&["a", "b"]),
        None,
        5,
        Uuid::new_v4,
    )
    .unwrap();
    assert_eq!(created.len(), 2);
    let with_jump = created
        .iter()
        .filter(|connection| connection.jump_host_id.is_some())
        .count();
    assert_eq!(with_jump, 1);
}

#[test]
fn apply_ignores_unknown_aliases() {
    let candidates = build_candidates(&parsed("Host a\n"), &Store::default());
    let (store, created) = apply_import(
        &Store::default(),
        &candidates,
        &selected(&["ghost"]),
        None,
        5,
        Uuid::new_v4,
    )
    .unwrap();
    assert!(created.is_empty());
    assert!(store.connections.is_empty());
}
