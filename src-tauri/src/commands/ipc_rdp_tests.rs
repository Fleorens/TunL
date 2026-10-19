use serde_json::json;

use super::ipc_tests::{create_connection, invoke, mock_app};

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

#[test]
fn rdp_open_accepts_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    // An SSH connection: the arguments were read, then the connection was refused as not RDP, before any client
    // is looked for.
    let web = create_connection(&webview, "web");
    let error = invoke(
        &webview,
        "rdp_open",
        json!({
            "sessionId": "5b6f2d3e-0000-4000-8000-000000000061",
            "connectionId": web["id"],
            "onEvent": "__CHANNEL__:1"
        }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "validation", "{error}");
}
