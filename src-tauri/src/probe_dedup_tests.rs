use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use tokio::net::TcpListener;
use uuid::Uuid;

use crate::model::{Connection, ConnectionInput, Protocol};
use crate::probe::{ProbeStatus, probe_all};

fn connection(name: &str, host: &str, port: u16) -> Connection {
    Connection::from_input(
        Uuid::new_v4(),
        ConnectionInput {
            name: name.into(),
            host: host.into(),
            port,
            ..ConnectionInput::template(Protocol::Ssh)
        },
        1_000,
    )
}

#[tokio::test]
async fn one_probe_per_address_shared_by_its_connections() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let accepted = Arc::new(AtomicUsize::new(0));
    let counter = accepted.clone();
    tokio::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            counter.fetch_add(1, Ordering::SeqCst);
            drop(socket);
        }
    });

    // Three connections on one server (another user, another name, the host in capitals): one connect.
    let all = vec![
        connection("root", "localhost", port),
        connection("deploy", "LOCALHOST", port),
        connection("backup", "localhost", port),
    ];
    let results = probe_all(&all, Duration::from_millis(500), 16).await;
    assert!(results.iter().all(|r| r.status == ProbeStatus::Online));
    assert!(results.iter().all(|r| r.latency_ms.is_some()));
    assert_eq!(
        results.iter().map(|r| r.connection_id).collect::<Vec<_>>(),
        all.iter().map(|c| c.id).collect::<Vec<_>>()
    );
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(accepted.load(Ordering::SeqCst), 1);
}
