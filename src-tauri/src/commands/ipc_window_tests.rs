//! `window_apply_title_bar` (T35) through Tauri's real IPC layer, with the argument key sent by `ipc.ts`.
use serde_json::json;

use super::ipc_tests::{mock_app, ok};

#[test]
fn window_apply_title_bar_accepts_the_mode_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let chrome = ok(
        &webview,
        "window_apply_title_bar",
        json!({ "mode": "native" }),
    );
    assert_eq!(chrome["mode"], "native");
}
