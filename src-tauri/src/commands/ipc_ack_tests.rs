//! `ssh_ack` (T50) through Tauri's real IPC layer, with the argument keys sent by `ipc.ts`.
use serde_json::json;

use super::ipc_tests::{invoke, mock_app};

#[test]
fn ssh_ack_accepts_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    // The arguments were read: the registry answered that this session does not exist.
    let error = invoke(
        &webview,
        "ssh_ack",
        json!({ "sessionId": uuid::Uuid::new_v4(), "bytes": 4096 }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound");
}
