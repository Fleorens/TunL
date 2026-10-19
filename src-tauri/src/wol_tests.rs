use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::net::{TcpListener, UdpSocket};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::ErrorKind;
use crate::model::{Connection, ConnectionInput, Protocol, WolConfig};
use crate::sessions::{CloseReason, SessionEvent, SessionSink, StepKind, StepState};
use crate::wol::{
    WakeTarget, magic_packet, run_wake_step, send_magic_packet, wait_for_port, wake_target,
};

const EVERY: Duration = Duration::from_millis(100);

#[derive(Default)]
struct Recorder(Mutex<Vec<SessionEvent>>);

impl SessionSink for Recorder {
    fn event(&self, event: SessionEvent) {
        self.0.lock().unwrap().push(event);
    }
    fn output(&self, _bytes: Vec<u8>) {}
}

impl Recorder {
    fn events(&self) -> Vec<SessionEvent> {
        self.0.lock().unwrap().clone()
    }
}

fn wake(label: StepState) -> SessionEvent {
    SessionEvent::Step {
        step: StepKind::Wake,
        label: "nas".into(),
        state: label,
    }
}

/// A WoL config that sends its packet to a local UDP socket instead of the LAN broadcast.
fn local_config(udp_port: u16, wait_timeout_secs: u32) -> WolConfig {
    WolConfig {
        mac: "52:54:00:12:34:56".into(),
        broadcast: "127.0.0.1".into(),
        port: udp_port,
        wake_before_connect: true,
        wait_timeout_secs,
    }
}

async fn udp_sink() -> (UdpSocket, u16) {
    let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let port = socket.local_addr().unwrap().port();
    (socket, port)
}

fn connection(wol: Option<WolConfig>, jump: Option<Uuid>) -> Connection {
    Connection::from_input(
        Uuid::new_v4(),
        ConnectionInput {
            name: "nas".into(),
            host: "192.168.1.10".into(),
            port: 22,
            wol,
            jump_host_id: jump,
            ..ConnectionInput::template(Protocol::Ssh)
        },
        1_000,
    )
}

#[test]
fn the_magic_packet_is_six_ff_then_sixteen_macs() {
    let packet = magic_packet("52:54:00:12:34:56").unwrap();
    assert_eq!(packet.len(), 102);
    assert_eq!(packet[..6], [0xFF; 6]);
    for i in 0..16 {
        let start = 6 + i * 6;
        assert_eq!(
            packet[start..start + 6],
            [0x52, 0x54, 0x00, 0x12, 0x34, 0x56]
        );
    }
}

#[test]
fn a_malformed_mac_is_refused() {
    for mac in [
        "",
        "52:54:00:12:34",
        "52:54:00:12:34:56:78",
        "zz:54:00:12:34:56",
    ] {
        let error = magic_packet(mac).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Validation, "{mac}");
    }
}

#[tokio::test]
async fn the_packet_goes_to_the_broadcast_address_and_port() {
    let (socket, port) = udp_sink().await;
    send_magic_packet(&local_config(port, 10)).await.unwrap();
    let mut buffer = [0u8; 256];
    let (len, _) = tokio::time::timeout(Duration::from_secs(2), socket.recv_from(&mut buffer))
        .await
        .expect("the packet arrives")
        .unwrap();
    assert_eq!(buffer[..len], magic_packet("52:54:00:12:34:56").unwrap());
}

#[tokio::test]
async fn the_wait_ends_as_soon_as_the_port_answers() {
    let probe = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    // The host "boots": its port opens after 300 ms.
    let server = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        let _ = listener.accept().await;
    });
    let started = Instant::now();
    wait_for_port("127.0.0.1", port, Duration::from_secs(5), EVERY)
        .await
        .unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "{:?}",
        started.elapsed()
    );
    server.abort();
}

#[tokio::test]
async fn a_host_that_never_wakes_is_a_timeout_on_time() {
    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let started = Instant::now();
    let error = wait_for_port("127.0.0.1", port, Duration::from_millis(500), EVERY)
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Timeout);
    assert!(
        error.message.contains("did not wake up"),
        "{}",
        error.message
    );
    let elapsed = started.elapsed();
    assert!(elapsed >= Duration::from_millis(450), "{elapsed:?}");
    assert!(elapsed < Duration::from_millis(1500), "{elapsed:?}");
}

#[test]
fn only_a_direct_connection_that_asks_for_it_is_woken() {
    let config = local_config(9, 120);
    assert_eq!(wake_target(&connection(None, None)), None);

    let not_asked = WolConfig {
        wake_before_connect: false,
        ..config.clone()
    };
    assert_eq!(wake_target(&connection(Some(not_asked), None)), None);

    // Behind a bastion, a broadcast from here would not reach the host's network.
    let behind = connection(Some(config.clone()), Some(Uuid::new_v4()));
    assert_eq!(wake_target(&behind), None);

    let direct = connection(Some(config.clone()), None);
    assert_eq!(
        wake_target(&direct),
        Some(WakeTarget {
            name: "nas".into(),
            host: "192.168.1.10".into(),
            port: 22,
            config,
        })
    );
}

#[tokio::test]
async fn the_wake_step_sends_waits_and_reports() {
    let (_socket, udp) = udp_sink().await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = WakeTarget {
        name: "nas".into(),
        host: "127.0.0.1".into(),
        port: listener.local_addr().unwrap().port(),
        config: local_config(udp, 5),
    };
    let recorder = Recorder::default();
    assert!(run_wake_step(&target, EVERY, CancellationToken::new(), &recorder).await);
    assert_eq!(
        recorder.events(),
        [wake(StepState::Started), wake(StepState::Done)]
    );
}

#[tokio::test]
async fn a_failed_wake_stops_the_session_with_an_error() {
    let (_socket, udp) = udp_sink().await;
    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let target = WakeTarget {
        name: "nas".into(),
        host: "127.0.0.1".into(),
        port,
        // wait_timeout_secs is whole seconds: 1 s is the shortest wait.
        config: local_config(udp, 1),
    };
    let recorder = Recorder::default();
    assert!(!run_wake_step(&target, EVERY, CancellationToken::new(), &recorder).await);
    let events = recorder.events();
    assert_eq!(
        events[..2],
        [wake(StepState::Started), wake(StepState::Failed)]
    );
    assert!(matches!(
        &events[2],
        SessionEvent::Error { error } if error.kind == ErrorKind::Timeout
    ));
    assert_eq!(events.len(), 3);
}

#[tokio::test]
async fn closing_the_tab_during_the_wait_ends_quietly() {
    let (_socket, udp) = udp_sink().await;
    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let target = WakeTarget {
        name: "nas".into(),
        host: "127.0.0.1".into(),
        port,
        config: local_config(udp, 60),
    };
    let cancel = CancellationToken::new();
    let later = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(200)).await;
        later.cancel();
    });
    let recorder = Recorder::default();
    let started = Instant::now();
    assert!(!run_wake_step(&target, EVERY, cancel, &recorder).await);
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(
        recorder.events(),
        [
            wake(StepState::Started),
            SessionEvent::Closed {
                reason: CloseReason::UserClosed,
                exit_status: None,
            },
        ]
    );
}
