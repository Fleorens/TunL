//! `tabs_load` and `tabs_save` (T60) through Tauri's real IPC layer, with the keys sent by `ipc.ts`.
use serde_json::json;

use super::ipc_tests::{invoke, mock_app, ok};

#[test]
fn the_tab_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let id = "5b6f2d3e-0000-4000-8000-000000000081";

    ok(
        &webview,
        "tabs_save",
        json!({ "tabs": [{ "connectionId": id, "kind": "sftp" }] }),
    );
    let tabs = invoke(&webview, "tabs_load", json!({})).unwrap();
    assert_eq!(tabs, json!([{ "connectionId": id, "kind": "sftp" }]));
}
