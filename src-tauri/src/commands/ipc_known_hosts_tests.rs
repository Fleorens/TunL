use serde_json::json;

use super::ipc_tests::{mock_app, ok};

#[test]
fn known_hosts_list_takes_no_argument_and_starts_empty() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    assert_eq!(ok(&webview, "known_hosts_list", json!({})), json!([]));
}
