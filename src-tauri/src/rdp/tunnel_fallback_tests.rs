//! T28c: when the tunnel falls back to another port, FreeRDP may be talking to a different machine,
//! so a trust-on-first-use policy becomes a prompt (so FreeRDP asks before trusting the certificate).
use std::net::Ipv4Addr;

use tokio::net::TcpListener;
use uuid::Uuid;

use crate::model::{RdpCertPolicy, RdpSettings};
use crate::rdp::args::{RdpCredentials, RdpEndpoint, build_tunnel_args};
use crate::rdp::session::tunnel_cert_policy;
use crate::ssh::forward::{bind_tunnel_checked, tunnel_port};

fn endpoint() -> RdpEndpoint<'static> {
    RdpEndpoint {
        name: "desk",
        host: "127.0.0.1",
        port: 61234,
    }
}

#[test]
fn a_stable_port_keeps_the_certificate_policy() {
    assert_eq!(
        tunnel_cert_policy(RdpCertPolicy::Tofu, true),
        RdpCertPolicy::Tofu
    );
    assert_eq!(
        tunnel_cert_policy(RdpCertPolicy::Prompt, true),
        RdpCertPolicy::Prompt
    );
}

#[test]
fn a_fallback_port_prompts_instead_of_trust_on_first_use() {
    assert_eq!(
        tunnel_cert_policy(RdpCertPolicy::Tofu, false),
        RdpCertPolicy::Prompt
    );
    assert_eq!(
        tunnel_cert_policy(RdpCertPolicy::Prompt, false),
        RdpCertPolicy::Prompt
    );
}

#[tokio::test]
async fn a_free_port_is_the_connection_own_stable_port() {
    let id = Uuid::new_v4();
    let tunnel = bind_tunnel_checked(id).await.unwrap();
    assert!(tunnel.stable);
    assert_eq!(
        tunnel.listener.local_addr().unwrap().port(),
        tunnel_port(id)
    );
    assert!(tunnel.listener.local_addr().unwrap().ip().is_loopback());
}

#[tokio::test]
async fn a_taken_port_falls_back_to_another_one() {
    let id = Uuid::new_v4();
    let taken = TcpListener::bind((Ipv4Addr::LOCALHOST, tunnel_port(id)))
        .await
        .unwrap();
    let tunnel = bind_tunnel_checked(id).await.unwrap();
    assert!(!tunnel.stable);
    assert_ne!(
        tunnel.listener.local_addr().unwrap().port(),
        tunnel_port(id)
    );
    assert!(tunnel.listener.local_addr().unwrap().ip().is_loopback());
    drop(taken);
}

#[test]
fn a_prompt_policy_builds_no_trust_on_first_use_argument() {
    let settings = RdpSettings {
        cert_policy: RdpCertPolicy::Prompt,
        ..RdpSettings::default()
    };
    let args = build_tunnel_args(
        &endpoint(),
        Some("desk.corp.lan"),
        &settings,
        &RdpCredentials::default(),
    )
    .unwrap();
    assert!(!args.lines().any(|l| l == "/cert:tofu"));
}

#[test]
fn a_trust_on_first_use_policy_builds_the_argument() {
    let settings = RdpSettings {
        cert_policy: RdpCertPolicy::Tofu,
        ..RdpSettings::default()
    };
    let args = build_tunnel_args(
        &endpoint(),
        Some("desk.corp.lan"),
        &settings,
        &RdpCredentials::default(),
    )
    .unwrap();
    assert!(args.lines().any(|l| l == "/cert:tofu"));
}
