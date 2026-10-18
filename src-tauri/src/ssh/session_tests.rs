use std::time::Duration;

use uuid::Uuid;

use super::auth::AuthPlan;
use super::session::{SessionTarget, resolve_target};
use crate::error::ErrorKind;
use crate::model::{
    Connection, ConnectionInput, Protocol, ProtocolSettings, SshAuth, SshDefaults, SshSettings,
};
use crate::store::Store;

fn connection(input: ConnectionInput) -> Connection {
    Connection::from_input(Uuid::new_v4(), input, 1_000)
}

fn ssh(name: &str, username: Option<&str>, settings: SshSettings) -> Connection {
    connection(ConnectionInput {
        name: name.into(),
        host: "10.0.0.12".into(),
        username: username.map(Into::into),
        settings: ProtocolSettings::Ssh(settings),
        ..ConnectionInput::template(Protocol::Ssh)
    })
}

fn defaults() -> SshDefaults {
    SshDefaults {
        connect_timeout_secs: 10,
        keepalive_secs: 30,
    }
}

fn store(connections: Vec<Connection>) -> Store {
    Store {
        groups: vec![],
        connections,
    }
}

#[test]
fn a_saved_connection_gives_its_address_user_and_plan() {
    let web = ssh(
        "web-01",
        Some("deploy"),
        SshSettings {
            auth: SshAuth::Key {
                path: "~/.ssh/id_ed25519".into(),
            },
            keepalive_secs: Some(5),
            connect_timeout_secs: None,
        },
    );
    let target = SessionTarget::Saved {
        connection_id: web.id,
    };
    let resolved =
        resolve_target(&target, &store(vec![web.clone()]), &defaults(), Some("ada")).unwrap();

    assert_eq!(resolved.connection_id, Some(web.id));
    assert_eq!(resolved.connection_name, "web-01");
    assert_eq!(resolved.host, "10.0.0.12");
    assert_eq!(resolved.port, 22);
    assert_eq!(resolved.username, "deploy");
    assert_eq!(
        resolved.plan,
        AuthPlan::Key {
            path: "~/.ssh/id_ed25519".into()
        }
    );
    // The connection's own values win over the global defaults.
    assert_eq!(resolved.keepalive_secs, 5);
    assert_eq!(resolved.connect_timeout, Duration::from_secs(10));
}

#[test]
fn without_a_username_the_local_user_is_used() {
    let web = ssh("web-01", None, SshSettings::default());
    let target = SessionTarget::Saved {
        connection_id: web.id,
    };
    let resolved = resolve_target(&target, &store(vec![web]), &defaults(), Some("ada")).unwrap();
    assert_eq!(resolved.username, "ada");
}

#[test]
fn an_unknown_connection_is_not_found() {
    let target = SessionTarget::Saved {
        connection_id: Uuid::new_v4(),
    };
    let error = resolve_target(&target, &store(vec![]), &defaults(), Some("ada")).unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotFound);
}

#[test]
fn no_username_at_all_is_a_validation_error() {
    let web = ssh("web-01", None, SshSettings::default());
    let target = SessionTarget::Saved {
        connection_id: web.id,
    };
    let error = resolve_target(&target, &store(vec![web]), &defaults(), None).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert!(error.message.starts_with("username"), "{}", error.message);
}

#[test]
fn an_rdp_connection_cannot_open_a_shell() {
    let rdp = connection(ConnectionInput {
        name: "ad-01".into(),
        host: "10.0.0.5".into(),
        ..ConnectionInput::template(Protocol::Rdp)
    });
    let target = SessionTarget::Saved {
        connection_id: rdp.id,
    };
    let error = resolve_target(&target, &store(vec![rdp]), &defaults(), Some("ada")).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
}

#[test]
fn bastions_are_resolved_first_dialled_first_each_with_its_own_settings() {
    // web-01 → inner → outer: TunL dials outer by TCP, then inner through it, then web-01.
    let outer = ssh(
        "outer",
        None,
        SshSettings {
            auth: SshAuth::Agent,
            keepalive_secs: Some(7),
            connect_timeout_secs: Some(3),
        },
    );
    let mut inner = ssh("inner", Some("ops"), SshSettings::default());
    inner.jump_host_id = Some(outer.id);
    let mut web = ssh("web-01", Some("deploy"), SshSettings::default());
    web.jump_host_id = Some(inner.id);
    let target = SessionTarget::Saved {
        connection_id: web.id,
    };
    let resolved = resolve_target(
        &target,
        &store(vec![web.clone(), inner.clone(), outer.clone()]),
        &defaults(),
        Some("ada"),
    )
    .unwrap();

    assert_eq!(resolved.connection_id, Some(web.id));
    assert_eq!(resolved.username, "deploy");
    let names: Vec<&str> = resolved
        .jump_hosts
        .iter()
        .map(|hop| hop.connection_name.as_str())
        .collect();
    assert_eq!(names, ["outer", "inner"]);

    let first = &resolved.jump_hosts[0];
    assert_eq!(first.connection_id, Some(outer.id));
    assert_eq!(
        first.username, "ada",
        "a bastion without a user takes the local one"
    );
    assert_eq!(first.plan, AuthPlan::Agent);
    assert_eq!(first.keepalive_secs, 7);
    assert_eq!(first.connect_timeout, Duration::from_secs(3));
    assert!(first.jump_hosts.is_empty());
    assert_eq!(resolved.jump_hosts[1].username, "ops");
}

#[test]
fn a_direct_connection_has_no_bastion() {
    let web = ssh("web-01", Some("deploy"), SshSettings::default());
    let target = SessionTarget::Saved {
        connection_id: web.id,
    };
    let resolved = resolve_target(&target, &store(vec![web]), &defaults(), Some("ada")).unwrap();
    assert!(resolved.jump_hosts.is_empty());
}

#[test]
fn a_bastion_deleted_since_is_not_found() {
    let mut web = ssh("web-01", Some("deploy"), SshSettings::default());
    web.jump_host_id = Some(Uuid::new_v4());
    let target = SessionTarget::Saved {
        connection_id: web.id,
    };
    let error = resolve_target(&target, &store(vec![web]), &defaults(), Some("ada")).unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotFound);
}

#[test]
fn a_quick_target_uses_the_defaults_and_the_auto_plan() {
    let target = SessionTarget::Quick {
        host: "10.5.5.5".into(),
        port: 2222,
        username: Some("deploy".into()),
    };
    let resolved = resolve_target(&target, &store(vec![]), &defaults(), Some("ada")).unwrap();
    assert_eq!(resolved.connection_id, None);
    assert_eq!(resolved.connection_name, "deploy@10.5.5.5");
    assert_eq!((resolved.host.as_str(), resolved.port), ("10.5.5.5", 2222));
    assert_eq!(resolved.plan, AuthPlan::Auto);
    assert_eq!(resolved.keepalive_secs, 30);
    assert_eq!(resolved.connect_timeout, Duration::from_secs(10));
}

#[test]
fn a_quick_target_is_validated_like_a_connection() {
    for (host, port) in [("", 22), ("bad host!", 22), ("10.5.5.5", 0)] {
        let target = SessionTarget::Quick {
            host: host.into(),
            port,
            username: None,
        };
        let error = resolve_target(&target, &store(vec![]), &defaults(), Some("ada")).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Validation, "{host}:{port}");
    }
}
