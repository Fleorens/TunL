//! T28c: behind a bastion, FreeRDP must find the certificate it trusted last time. It files it under
//! `<server>_<port>`: the server is the real host (`/server-name`), the port the connection's own tunnel port.
use uuid::Uuid;

use crate::model::RdpSettings;
use crate::rdp::args::{RdpCredentials, RdpEndpoint, build_args, build_tunnel_args};
use crate::ssh::forward::{TUNNEL_PORT_COUNT, TUNNEL_PORT_FIRST, bind_tunnel, tunnel_port};

fn tunnel() -> RdpEndpoint<'static> {
    RdpEndpoint {
        name: "desk",
        host: "127.0.0.1",
        port: 61234,
    }
}

#[test]
fn the_tunnel_port_is_the_same_for_a_connection_and_outside_the_ephemeral_range() {
    let id = Uuid::parse_str("6f1c2b4e-8d3a-4f5b-9c7e-0a1b2c3d4e5f").unwrap();
    assert_eq!(tunnel_port(id), tunnel_port(id));
    let last = TUNNEL_PORT_FIRST + (TUNNEL_PORT_COUNT - 1);
    assert_eq!(last, 65535);
    for _ in 0..200 {
        let port = tunnel_port(Uuid::new_v4());
        assert!((61000..=65535).contains(&port), "{port}");
    }
    // Spread over the range, not one port for everyone.
    let ports: std::collections::HashSet<u16> =
        (0..50).map(|_| tunnel_port(Uuid::new_v4())).collect();
    assert!(ports.len() > 40);
}

#[tokio::test]
async fn a_tunnel_takes_its_own_port_and_another_one_when_it_is_busy() {
    let id = Uuid::new_v4();
    let first = bind_tunnel(id).await.unwrap();
    let first_port = first.local_addr().unwrap().port();
    assert_eq!(first_port, tunnel_port(id));
    assert!(first.local_addr().unwrap().ip().is_loopback());

    // A second tab of the same connection: the port is held, any free loopback port will do.
    let second = bind_tunnel(id).await.unwrap();
    assert_ne!(second.local_addr().unwrap().port(), first_port);
    assert!(second.local_addr().unwrap().ip().is_loopback());

    // Freed, it is the connection's again.
    drop(first);
    drop(second);
    let again = bind_tunnel(id).await.unwrap();
    assert_eq!(again.local_addr().unwrap().port(), tunnel_port(id));
}

#[test]
fn behind_a_tunnel_the_real_host_follows_the_address() {
    let args = build_tunnel_args(
        &tunnel(),
        Some("desk.corp.lan"),
        &RdpSettings::default(),
        &RdpCredentials::default(),
    )
    .unwrap();
    let lines: Vec<&str> = args.lines().collect();
    assert_eq!(lines[0], "/v:127.0.0.1:61234");
    assert_eq!(lines[1], "/server-name:desk.corp.lan");
    assert_eq!(
        lines
            .iter()
            .filter(|l| l.starts_with("/server-name:"))
            .count(),
        1
    );
}

#[test]
fn without_a_tunnel_nothing_changes() {
    let settings = RdpSettings::default();
    let credentials = RdpCredentials::default();
    let direct = build_tunnel_args(&tunnel(), None, &settings, &credentials).unwrap();
    let plain = build_args(&tunnel(), &settings, &credentials).unwrap();
    assert_eq!(
        direct.lines().collect::<Vec<_>>(),
        plain.lines().collect::<Vec<_>>()
    );
    assert!(direct.lines().all(|l| !l.starts_with("/server-name:")));
}

#[test]
fn a_server_name_with_a_line_break_is_refused() {
    let error = build_tunnel_args(
        &tunnel(),
        Some("desk\n/p:stolen"),
        &RdpSettings::default(),
        &RdpCredentials::default(),
    )
    .unwrap_err();
    assert_eq!(error.kind, crate::error::ErrorKind::Validation);
    assert!(!error.message.contains("stolen"), "S7: {}", error.message);
}
