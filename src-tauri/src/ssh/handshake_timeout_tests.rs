//! T49: a server that accepts TCP but never speaks SSH fails the handshake in time, without podman.
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio::net::{TcpListener, TcpStream};

use crate::error::ErrorKind;
use crate::prompts::PromptBroker;
use crate::secrets::SecretStore;
use crate::ssh::SshContext;
use crate::ssh::connect::{client_config, handshake_timed};
use crate::ssh::handler::HostKeyTarget;
use crate::ssh::known_hosts::KnownHosts;

fn context(dir: &std::path::Path) -> SshContext {
    SshContext {
        known_hosts: Arc::new(KnownHosts::new(dir.join("known_hosts"), None)),
        prompts: Arc::new(PromptBroker::new()),
        secrets: Arc::new(SecretStore::memory()),
        agent_socket: None,
    }
}

#[tokio::test]
async fn a_server_that_never_speaks_ssh_times_out() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    // Accept, then hold the socket open without ever sending a banner.
    let silent = tokio::spawn(async move {
        let (socket, _) = listener.accept().await.unwrap();
        tokio::time::sleep(Duration::from_secs(30)).await;
        drop(socket);
    });

    let dir = tempfile::tempdir().unwrap();
    let stream = TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    let started = Instant::now();
    let result = handshake_timed(
        stream,
        HostKeyTarget {
            host: "127.0.0.1".into(),
            port,
            session_id: None,
        },
        client_config(0),
        &context(dir.path()),
        Duration::from_millis(500),
    )
    .await;

    let error = result.err().expect("the handshake must fail");
    assert_eq!(error.kind, ErrorKind::Timeout);
    assert!(
        error.message.starts_with("no SSH answer from 127.0.0.1:"),
        "{}",
        error.message
    );
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "it fails in time"
    );
    silent.abort();
}
