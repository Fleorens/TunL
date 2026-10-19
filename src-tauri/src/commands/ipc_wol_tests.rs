use std::net::UdpSocket;
use std::time::Duration;

use serde_json::json;

use super::ipc_tests::{create_connection, invoke, mock_app, ok};

#[test]
fn wol_wake_accepts_the_id_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    // Without Wake-on-LAN: refused, with the field to blame.
    let plain = create_connection(&webview, "plain");
    let error = invoke(&webview, "wol_wake", json!({ "id": plain["id"] })).unwrap_err();
    assert_eq!(error["kind"], "validation");
    assert!(
        error["message"].as_str().unwrap().starts_with("wol"),
        "{error}"
    );

    // With Wake-on-LAN aimed at a local UDP socket: the packet arrives.
    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let port = socket.local_addr().unwrap().port();
    let templates = ok(&webview, "connection_templates", json!({}));
    let mut input = templates["ssh"].clone();
    input["name"] = json!("sleepy");
    input["host"] = json!("10.0.0.2");
    input["wol"] = json!({
        "mac": "52:54:00:12:34:56",
        "broadcast": "127.0.0.1",
        "port": port,
        "wakeBeforeConnect": false,
        "waitTimeoutSecs": 120
    });
    let sleepy = ok(&webview, "connection_create", json!({ "input": input }));
    ok(&webview, "wol_wake", json!({ "id": sleepy["id"] }));

    let mut buffer = [0u8; 256];
    let (len, _) = socket.recv_from(&mut buffer).expect("the magic packet");
    assert_eq!(len, 102);
}
