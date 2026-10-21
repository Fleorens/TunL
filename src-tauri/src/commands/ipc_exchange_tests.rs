use std::os::unix::fs::PermissionsExt;

use serde_json::json;

use super::ipc_tests::{create_connection, invoke, mock_app, ok};

#[test]
fn export_then_import_through_the_ipc_with_the_paths_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    create_connection(&webview, "web");
    create_connection(&webview, "db");

    let path = dir.path().join("export.json");
    let written = ok(
        &webview,
        "store_export",
        json!({ "path": path.to_str().unwrap() }),
    );
    assert_eq!(written, json!(2));
    let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600, "S9: the export is private");
    let text = std::fs::read_to_string(&path).unwrap();
    assert!(text.contains("\"format\": \"tunl-connections\""));

    // The same connections again: nothing added.
    let report = ok(
        &webview,
        "store_import",
        json!({ "path": path.to_str().unwrap() }),
    );
    assert_eq!(
        report,
        json!({ "added": 0, "skipped": 2, "invalid": 0, "groupsCreated": 0 })
    );
}

#[test]
fn a_relative_path_or_a_file_that_is_not_an_export_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    let error = invoke(&webview, "store_export", json!({ "path": "export.json" })).unwrap_err();
    assert_eq!(error["kind"], "validation");

    let other = dir.path().join("other.json");
    std::fs::write(&other, "{\"secret\": \"do-not-echo\"}").unwrap();
    let error = invoke(
        &webview,
        "store_import",
        json!({ "path": other.to_str().unwrap() }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "validation");
    assert!(
        !error["message"].as_str().unwrap().contains("do-not-echo"),
        "S7"
    );
}
