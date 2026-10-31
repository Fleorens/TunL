//! `sftp_edit` and `sftp_edit_resolve` (T57) through Tauri's real IPC layer, with the keys sent by `ipc.ts`.
use serde_json::json;

use super::ipc_tests::{invoke, mock_app, ok};

#[test]
fn edit_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let session = "5b6f2d3e-0000-4000-8000-000000000071";
    let edit = "5b6f2d3e-0000-4000-8000-000000000072";

    // No SFTP tab is connected: the arguments were read, the session was not found.
    let error = invoke(
        &webview,
        "sftp_edit",
        json!({
            "sessionId": session,
            "editId": edit,
            "remotePath": "/etc/app.conf",
            "onEvent": "__CHANNEL__:1"
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound", "{error}");

    // Answering an unknown edit is not an error.
    ok(
        &webview,
        "sftp_edit_resolve",
        json!({ "editId": edit, "overwrite": true }),
    );
}
