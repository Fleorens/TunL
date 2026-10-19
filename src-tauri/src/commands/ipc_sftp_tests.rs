use serde_json::json;

use super::ipc_tests::{create_connection, invoke, mock_app, ok};

#[test]
fn sftp_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let id = "5b6f2d3e-0000-4000-8000-000000000042";

    // No SFTP tab is connected: every command read its arguments, then found no session.
    let calls = [
        ("sftp_realpath", json!({ "sessionId": id, "path": "." })),
        ("sftp_list", json!({ "sessionId": id, "path": "/srv" })),
        ("sftp_mkdir", json!({ "sessionId": id, "path": "/srv/new" })),
        (
            "sftp_rename",
            json!({ "sessionId": id, "from": "/srv/a", "to": "/srv/b" }),
        ),
        ("sftp_count", json!({ "sessionId": id, "path": "/srv/a" })),
        ("sftp_remove", json!({ "sessionId": id, "path": "/srv/a" })),
        (
            "sftp_chmod",
            json!({ "sessionId": id, "path": "/srv/a", "mode": 420 }),
        ),
    ];
    for (cmd, args) in calls {
        let error = invoke(&webview, cmd, args).unwrap_err();
        assert_eq!(error["kind"], "notFound", "{cmd}: {error}");
    }
}

#[test]
fn sftp_open_accepts_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let web = create_connection(&webview, "web");
    let session = "5b6f2d3e-0000-4000-8000-000000000043";

    // The tab runs in the background: `sftp_open` answers at once, its steps go to the channel.
    let opened = ok(
        &webview,
        "sftp_open",
        json!({
            "sessionId": session,
            "target": { "type": "saved", "connectionId": web["id"] },
            "onEvent": "__CHANNEL__:1"
        }),
    );
    assert_eq!(opened, json!(null));
    ok(&webview, "session_close", json!({ "sessionId": session }));

    // A target refused before anything starts.
    let error = invoke(
        &webview,
        "sftp_open",
        json!({
            "sessionId": "5b6f2d3e-0000-4000-8000-000000000044",
            "target": { "type": "quick", "host": "bad host!", "port": 22, "username": null },
            "onEvent": "__CHANNEL__:1"
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "validation");
}
