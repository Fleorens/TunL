//! Drives every command through Tauri's real IPC layer (`tauri::test`, `MockRuntime`), with **exactly** the
//! argument objects that `src/lib/ipc.ts` sends. The browser mock cannot catch a mismatch between a JS key and
//! a Rust parameter name: this test does. Any command added to `ipc.ts` gets a line here, or in an
//! `ipc_<domain>_tests.rs` beside this file that reuses these `pub(crate)` helpers.
use std::path::Path;

use serde_json::{Value, json};
use tauri::ipc::{CallbackFn, InvokeBody};
use tauri::test::{
    INVOKE_KEY, MockRuntime, get_ipc_response, mock_builder, mock_context, noop_assets,
};
use tauri::webview::InvokeRequest;
use tauri::{Manager, WebviewWindow, WebviewWindowBuilder};

use crate::paths::AppPaths;
use crate::secrets::SecretStore;
use crate::state::AppState;

pub(crate) fn mock_app(dir: &Path) -> (tauri::App<MockRuntime>, WebviewWindow<MockRuntime>) {
    let paths = AppPaths {
        config_dir: dir.join("config"),
        data_dir: dir.join("data"),
        log_dir: dir.join("logs"),
    };
    paths.ensure_created().unwrap();
    let state = AppState::from_disk(&paths, 1_700_000_000_000, SecretStore::memory()).unwrap();
    let app = mock_builder()
        .invoke_handler(crate::invoke_handler())
        .build(mock_context(noop_assets()))
        .unwrap();
    app.manage(state);
    let webview = WebviewWindowBuilder::new(&app, "main", Default::default())
        .build()
        .unwrap();
    (app, webview)
}

/// `invoke(cmd, args)` as the frontend does it; the error is the serialized `AppError` (or Tauri's own message).
pub(crate) fn invoke(
    webview: &WebviewWindow<MockRuntime>,
    cmd: &str,
    args: Value,
) -> Result<Value, Value> {
    get_ipc_response(
        webview,
        InvokeRequest {
            cmd: cmd.into(),
            callback: CallbackFn(0),
            error: CallbackFn(1),
            url: "tauri://localhost".parse().unwrap(),
            body: InvokeBody::Json(args),
            headers: Default::default(),
            invoke_key: INVOKE_KEY.to_string(),
        },
    )
    .map(|body| body.deserialize::<Value>().unwrap())
}

pub(crate) fn ok(webview: &WebviewWindow<MockRuntime>, cmd: &str, args: Value) -> Value {
    invoke(webview, cmd, args).unwrap_or_else(|error| panic!("{cmd} failed: {error}"))
}

pub(crate) fn create_connection(webview: &WebviewWindow<MockRuntime>, name: &str) -> Value {
    let templates = ok(webview, "connection_templates", json!({}));
    let mut input = templates["ssh"].clone();
    input["name"] = json!(name);
    input["host"] = json!("10.0.0.1");
    ok(webview, "connection_create", json!({ "input": input }))
}

#[test]
fn every_command_accepts_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    ok(&webview, "app_info", json!({}));
    ok(&webview, "store_load", json!({}));
    let templates = ok(&webview, "connection_templates", json!({}));

    let mut input = templates["ssh"].clone();
    input["name"] = json!("web-01");
    input["host"] = json!("10.0.0.1");
    let created = ok(&webview, "connection_create", json!({ "input": input }));
    let id = created["id"].clone();

    input["name"] = json!("web-01b");
    let updated = ok(
        &webview,
        "connection_update",
        json!({ "id": id, "input": input }),
    );
    assert_eq!(updated["name"], "web-01b");
    ok(
        &webview,
        "connection_set_favorite",
        json!({ "id": id, "favorite": true }),
    );
    ok(&webview, "connection_touch", json!({ "id": id }));
    let copy = ok(&webview, "connection_duplicate", json!({ "id": id }));
    ok(&webview, "connection_delete", json!({ "id": copy["id"] }));

    let group = ok(
        &webview,
        "group_create",
        json!({ "input": { "name": "Prod", "color": null } }),
    );
    let group_id = group["id"].clone();
    ok(
        &webview,
        "group_update",
        json!({ "id": group_id, "input": { "name": "Production", "color": "teal" } }),
    );
    ok(&webview, "group_reorder", json!({ "ids": [group_id] }));
    ok(&webview, "group_delete", json!({ "id": group_id }));

    let settings = ok(&webview, "settings_get", json!({}));
    ok(&webview, "settings_update", json!({ "settings": settings }));

    ok(
        &webview,
        "window_apply_title_bar",
        json!({ "mode": "custom" }),
    );

    ok(
        &webview,
        "secret_set",
        json!({ "connectionId": id, "kind": "password", "value": "hunter2" }),
    );
    assert_eq!(
        ok(
            &webview,
            "secret_has",
            json!({ "connectionId": id, "kind": "password" })
        ),
        json!(true)
    );
    ok(
        &webview,
        "secret_delete",
        json!({ "connectionId": id, "kind": "password" }),
    );
    assert_eq!(
        ok(
            &webview,
            "secret_has",
            json!({ "connectionId": id, "kind": "password" })
        ),
        json!(false)
    );

    let snapshot = ok(&webview, "store_load", json!({}));
    assert_eq!(snapshot["connections"].as_array().unwrap().len(), 1);
}

#[test]
fn a_backend_error_reaches_the_frontend_as_an_app_error() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let error = invoke(
        &webview,
        "connection_delete",
        json!({ "id": uuid::Uuid::new_v4() }),
    )
    .unwrap_err();
    assert_eq!(error["kind"], "notFound");
}

#[test]
fn secrets_follow_their_connection_and_never_reach_the_store() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let id = create_connection(&webview, "db")["id"].clone();

    let unknown = uuid::Uuid::new_v4();
    let missing = invoke(
        &webview,
        "secret_set",
        json!({ "connectionId": unknown, "kind": "password", "value": "x" }),
    );
    assert_eq!(missing.unwrap_err()["kind"], "notFound");
    let empty = invoke(
        &webview,
        "secret_set",
        json!({ "connectionId": id, "kind": "password", "value": "" }),
    );
    assert_eq!(empty.unwrap_err()["kind"], "validation");

    ok(
        &webview,
        "secret_set",
        json!({ "connectionId": id, "kind": "passphrase", "value": "hunter2" }),
    );
    let copy = ok(&webview, "connection_duplicate", json!({ "id": id }));
    assert_eq!(
        ok(
            &webview,
            "secret_has",
            json!({ "connectionId": copy["id"], "kind": "passphrase" })
        ),
        json!(false)
    );

    let on_disk =
        std::fs::read_to_string(dir.path().join("config").join("connections.json")).unwrap();
    assert!(!on_disk.contains("hunter2"));
    assert!(
        !ok(&webview, "store_load", json!({}))
            .to_string()
            .contains("hunter2")
    );

    ok(&webview, "connection_delete", json!({ "id": id }));
    assert_eq!(
        ok(
            &webview,
            "secret_has",
            json!({ "connectionId": id, "kind": "passphrase" })
        ),
        json!(false)
    );
}
