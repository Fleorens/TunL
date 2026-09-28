use serde_json::json;

use super::ipc_tests::{invoke, mock_app, ok};

const CONFIG: &str = "Host bastion\n  HostName 10.0.0.1\n  User ops\nHost app\n  HostName 10.0.0.2\n  ProxyJump bastion\n";

#[test]
fn import_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let config = dir.path().join("ssh_config");
    std::fs::write(&config, CONFIG).unwrap();
    let path = config.to_str().unwrap();

    let preview = ok(
        &webview,
        "import_ssh_config_preview",
        json!({ "path": path }),
    );
    assert_eq!(preview["candidates"].as_array().unwrap().len(), 2);
    assert_eq!(
        preview["candidates"][1]["jump"],
        json!({ "type": "candidate", "alias": "bastion" })
    );

    let snapshot = ok(
        &webview,
        "import_ssh_config_apply",
        json!({ "path": path, "aliases": ["bastion", "app"], "groupId": null }),
    );
    let connections = snapshot["connections"].as_array().unwrap();
    assert_eq!(connections.len(), 2);
    let bastion = connections.iter().find(|c| c["name"] == "bastion").unwrap();
    let app = connections.iter().find(|c| c["name"] == "app").unwrap();
    assert_eq!(app["jumpHostId"], bastion["id"]);
}

#[test]
fn a_missing_config_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let path = dir.path().join("absent");
    let error = invoke(
        &webview,
        "import_ssh_config_preview",
        json!({ "path": path }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound");
}

#[test]
fn a_relative_path_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let error = invoke(
        &webview,
        "import_ssh_config_preview",
        json!({ "path": "ssh_config" }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "validation");
}
