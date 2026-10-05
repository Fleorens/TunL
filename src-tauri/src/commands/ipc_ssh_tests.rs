use serde_json::json;

use super::ipc_tests::{invoke, mock_app, ok};

const SESSION: &str = "7c9e6679-7425-40de-944b-e07fc1f90ae7";

#[test]
fn ssh_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    // Port 1 of this machine refuses at once: the background task ends quickly, without touching the network.
    let templates = ok(&webview, "connection_templates", json!({}));
    let mut input = templates["ssh"].clone();
    input["name"] = json!("local");
    input["host"] = json!("127.0.0.1");
    input["port"] = json!(1);
    input["username"] = json!("deploy");
    let web = ok(&webview, "connection_create", json!({ "input": input }));

    // The session runs in the background: `ssh_open` answers at once, its steps go to the channels.
    let opened = ok(
        &webview,
        "ssh_open",
        json!({
            "sessionId": SESSION,
            "target": { "type": "saved", "connectionId": web["id"] },
            "cols": 80,
            "rows": 24,
            "onEvent": "__CHANNEL__:1",
            "onOutput": "__CHANNEL__:2"
        }),
    );
    assert_eq!(opened, json!(null));
    ok(&webview, "session_close", json!({ "sessionId": SESSION }));

    // Once closed, the session is gone: the arguments were read, the registry answered.
    let unknown = "0e1f2a3b-0000-4000-8000-000000000009";
    let error = invoke(
        &webview,
        "ssh_write",
        json!({ "sessionId": unknown, "data": "ls\r" }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound");
    let error = invoke(
        &webview,
        "ssh_resize",
        json!({ "sessionId": unknown, "cols": 120, "rows": 40 }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound");
    ok(&webview, "session_close", json!({ "sessionId": unknown }));
}

#[test]
fn bad_sizes_and_quick_targets_are_refused_before_anything_starts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    let error = invoke(
        &webview,
        "ssh_resize",
        json!({ "sessionId": SESSION, "cols": 0, "rows": 24 }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "validation");

    let error = invoke(
        &webview,
        "ssh_open",
        json!({
            "sessionId": SESSION,
            "target": { "type": "quick", "host": "bad host!", "port": 22, "username": null },
            "cols": 80,
            "rows": 24,
            "onEvent": "__CHANNEL__:1",
            "onOutput": "__CHANNEL__:2"
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "validation");
}
