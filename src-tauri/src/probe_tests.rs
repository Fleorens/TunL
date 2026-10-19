use std::time::Duration;

use tokio::net::TcpListener;
use uuid::Uuid;

use crate::model::{Connection, ConnectionInput, Protocol};
use crate::probe::{ProbeStatus, probe, probe_all};

const QUICK: Duration = Duration::from_millis(500);

fn connection(host: &str, port: u16, jump: Option<Uuid>) -> Connection {
    Connection::from_input(
        Uuid::new_v4(),
        ConnectionInput {
            name: format!("{host}-{port}"),
            host: host.into(),
            port,
            jump_host_id: jump,
            ..ConnectionInput::template(Protocol::Ssh)
        },
        1_000,
    )
}

/// A port that answers, and one that refuses (a listener bound then dropped).
async fn open_and_closed_ports() -> (TcpListener, u16, u16) {
    let open = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let open_port = open.local_addr().unwrap().port();
    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let closed_port = closed.local_addr().unwrap().port();
    drop(closed);
    (open, open_port, closed_port)
}

#[tokio::test]
async fn an_open_port_answers_with_a_latency_a_closed_one_does_not() {
    let (_listener, open, closed) = open_and_closed_ports().await;
    let latency = probe("127.0.0.1", open, QUICK).await.expect("online");
    assert!(latency < QUICK);
    assert_eq!(probe("127.0.0.1", closed, QUICK).await, None);
}

#[tokio::test]
async fn an_unknown_name_is_offline() {
    assert_eq!(probe("nowhere.invalid", 22, QUICK).await, None);
}

#[tokio::test]
async fn nothing_is_sent_on_the_connection() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let server = tokio::spawn(async move {
        let (mut socket, _) = listener.accept().await.unwrap();
        let mut received = Vec::new();
        tokio::io::AsyncReadExt::read_to_end(&mut socket, &mut received)
            .await
            .unwrap();
        received
    });
    assert!(probe("127.0.0.1", port, QUICK).await.is_some());
    let received = tokio::time::timeout(Duration::from_secs(2), server)
        .await
        .expect("the probe closes the connection at once")
        .unwrap();
    assert!(received.is_empty(), "S15: TCP connect only, no data");
}

#[tokio::test]
async fn results_keep_the_order_and_a_bastion_target_is_skipped() {
    let (_listener, open, closed) = open_and_closed_ports().await;
    let bastion = connection("127.0.0.1", open, None);
    let behind = connection("db.internal", 22, Some(bastion.id));
    let down = connection("127.0.0.1", closed, None);
    let all = vec![behind.clone(), bastion.clone(), down.clone()];

    let results = probe_all(&all, QUICK, 16).await;
    let ids: Vec<Uuid> = results.iter().map(|r| r.connection_id).collect();
    assert_eq!(ids, [behind.id, bastion.id, down.id]);

    assert_eq!(results[0].status, ProbeStatus::Skipped);
    assert_eq!(results[0].latency_ms, None);
    assert_eq!(results[1].status, ProbeStatus::Online);
    assert!(results[1].latency_ms.is_some());
    assert_eq!(results[2].status, ProbeStatus::Offline);
    assert_eq!(results[2].latency_ms, None);
}

#[tokio::test]
async fn many_connections_are_all_probed_even_with_few_at_a_time() {
    let (_listener, open, closed) = open_and_closed_ports().await;
    let all: Vec<Connection> = (0..40)
        .map(|i| connection("127.0.0.1", if i % 2 == 0 { open } else { closed }, None))
        .collect();
    let results = probe_all(&all, QUICK, 3).await;
    assert_eq!(results.len(), 40);
    for (i, result) in results.iter().enumerate() {
        let expected = if i % 2 == 0 {
            ProbeStatus::Online
        } else {
            ProbeStatus::Offline
        };
        assert_eq!(result.status, expected, "connection {i}");
    }
}

#[tokio::test]
async fn no_connection_no_probe() {
    assert!(probe_all(&[], QUICK, 16).await.is_empty());
}
