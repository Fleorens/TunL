use serde_json::json;

use super::ipc_tests::{create_connection, mock_app, ok};

#[test]
fn probe_check_accepts_the_ids_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let web = create_connection(&webview, "web");

    // Probes off: nothing touches the network, every known connection is skipped.
    let mut settings = ok(&webview, "settings_get", json!({}));
    settings["reachability"]["enabled"] = json!(false);
    ok(&webview, "settings_update", json!({ "settings": settings }));

    let unknown = "5b6f2d3e-0000-4000-8000-000000000009";
    let results = ok(
        &webview,
        "probe_check",
        json!({ "ids": [web["id"], unknown] }),
    );
    assert_eq!(
        results,
        json!([{ "connectionId": web["id"], "status": "skipped", "latencyMs": null }])
    );
}
