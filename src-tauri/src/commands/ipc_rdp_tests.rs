use serde_json::json;

use super::ipc_tests::{invoke, mock_app};

#[test]
fn rdp_detect_takes_no_argument() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    // Either a client is installed on this machine, or none is: the arguments were read either way.
    match invoke(&webview, "rdp_detect", json!({})) {
        Ok(client) => assert!(client["version"].as_str().unwrap().starts_with("3.")),
        Err(error) => assert_eq!(error["kind"], "rdpClientMissing"),
    }
}
