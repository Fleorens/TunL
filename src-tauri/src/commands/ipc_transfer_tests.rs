use serde_json::json;

use super::ipc_tests::{invoke, mock_app, ok};

#[test]
fn transfer_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let session = "5b6f2d3e-0000-4000-8000-000000000051";
    let transfer = "5b6f2d3e-0000-4000-8000-000000000052";

    // No SFTP tab is connected: the arguments were read, the session was not found.
    let error = invoke(
        &webview,
        "sftp_download",
        json!({
            "sessionId": session,
            "transferId": transfer,
            "remotePath": "/srv/a.txt",
            "onEvent": "__CHANNEL__:1"
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound", "{error}");

    let error = invoke(
        &webview,
        "sftp_upload",
        json!({
            "sessionId": session,
            "transferId": transfer,
            "localPath": "/tmp/a.txt",
            "remoteDir": "/srv",
            "onEvent": "__CHANNEL__:1"
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound", "{error}");

    // Cancelling an unknown transfer is not an error.
    ok(
        &webview,
        "transfer_cancel",
        json!({ "transferId": transfer }),
    );
}
