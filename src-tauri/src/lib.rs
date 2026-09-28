pub mod clock;
pub mod commands;
pub mod error;
pub mod model;
pub mod paths;
pub mod secrets;
pub mod state;
pub mod store;

#[cfg(test)]
mod secrets_tests;

use tauri::Manager;

use crate::paths::AppPaths;
use crate::secrets::SecretStore;
use crate::state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let log_level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };

    tauri::Builder::default()
        // Must stay the first plugin: a second launch focuses the running window instead.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }))
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log_level)
                .build(),
        )
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .setup(|app| {
            let paths = AppPaths::resolve(app.handle())?;
            paths.ensure_created()?;
            log::info!(
                "TunL {} starting (config: {})",
                app.package_info().version,
                paths.config_dir.display()
            );
            let now_ms = clock::now_ms();
            match AppState::from_disk(&paths, now_ms, SecretStore::keyring()) {
                Ok(state) => {
                    app.manage(state);
                }
                Err(error) => {
                    // `from_disk` already logged why; surface it so a broken launch is not silent.
                    log::error!("TunL could not start its backend: {error}");
                    app.manage(AppState {
                        paths,
                        started_at_ms: now_ms,
                        store: tokio::sync::RwLock::new(crate::store::Store::default()),
                        store_blocked: Some(error),
                        settings: tokio::sync::RwLock::new(crate::model::Settings::default()),
                        quarantined: Vec::new(),
                        secrets: SecretStore::keyring(),
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(invoke_handler())
        .run(tauri::generate_context!())
        // project-rules: allow no-panic-in-app-code — run() has no caller to hand an error to
        .expect("error while running TunL");
}

/// Every command of the app. Generic over the runtime so `commands/ipc_tests.rs` can drive it with `MockRuntime`.
pub fn invoke_handler<R: tauri::Runtime>()
-> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        commands::app::app_info,
        commands::store::store_load,
        commands::store::connection_templates,
        commands::connections::connection_create,
        commands::connections::connection_update,
        commands::connections::connection_duplicate,
        commands::connections::connection_delete,
        commands::connections::connection_set_favorite,
        commands::connections::connection_touch,
        commands::groups::group_create,
        commands::groups::group_update,
        commands::groups::group_delete,
        commands::groups::group_reorder,
        commands::settings::settings_get,
        commands::settings::settings_update,
        commands::secrets::secret_set,
        commands::secrets::secret_has,
        commands::secrets::secret_delete,
    ]
}

fn focus_main_window(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        log::warn!("second launch: main window not found");
        return;
    };
    if let Err(error) = window.unminimize() {
        log::warn!("cannot unminimize the main window: {error}");
    }
    if let Err(error) = window.set_focus() {
        log::warn!("cannot focus the main window: {error}");
    }
}
