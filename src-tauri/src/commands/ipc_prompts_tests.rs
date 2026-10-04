use serde_json::json;

use super::ipc_tests::{invoke, mock_app, ok};

#[test]
fn prompt_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    // Nothing is waiting for this id: the arguments were read, the broker answered "not found".
    let error = invoke(
        &webview,
        "prompt_answer",
        json!({
            "id": "5b6f2d3e-0000-4000-8000-000000000001",
            "answer": { "kind": "secret", "value": "x", "save": false }
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound");

    // TunL's own known_hosts is empty in a fresh config dir.
    let removed = ok(
        &webview,
        "known_host_remove",
        json!({ "host": "db.internal", "port": 2222 }),
    );
    assert_eq!(removed, json!(0));
}
