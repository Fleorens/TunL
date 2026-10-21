pub mod clock;
pub mod commands;
pub mod error;
pub mod import;
pub mod model;
pub mod paths;
pub mod probe;
pub mod prompts;
pub mod rdp;
pub mod secrets;
pub mod sessions;
pub mod sftp;
pub mod ssh;
pub mod state;
pub mod store;
pub mod wol;

#[cfg(test)]
mod probe_dedup_tests;
#[cfg(test)]
mod probe_tests;
#[cfg(test)]
mod prompts_tests;
#[cfg(test)]
mod reload_tests;
#[cfg(test)]
mod secrets_tests;
#[cfg(test)]
mod sessions_tests;
#[cfg(test)]
mod wol_tests;

use tauri::{Emitter, Manager, webview::PageLoadEvent};

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
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let paths = AppPaths::resolve(app.handle())?;
            paths.ensure_created()?;
            log::info!(
                "TunL {} starting (config: {})",
                app.package_info().version,
                paths.config_dir.display()
            );
            let now_ms = clock::now_ms();
            let state = match AppState::from_disk(&paths, now_ms, SecretStore::keyring()) {
                Ok(state) => state,
                Err(error) => {
                    // `from_disk` already logged why; surface it so a broken launch is not silent.
                    log::error!("TunL could not start its backend: {error}");
                    AppState::blocked(&paths, now_ms, error, SecretStore::keyring())
                }
            };
            // The prompt emitter forwards each request to the UI as a global event. A clone is kept
            // before `manage` consumes `state`, and the handle is 'static so the emitter outlives setup.
            let prompts = state.prompts.clone();
            let handle = app.handle().clone();
            prompts.set_emitter(Box::new(move |request| {
                if let Err(error) = handle.emit(crate::prompts::PROMPT_EVENT, request) {
                    log::warn!("cannot emit prompt event: {error}");
                }
            }));
            app.manage(state);
            Ok(())
        })
        // On reload (F5, inspecteur, Vite dev), end what the old page was running so nothing lingers.
        .on_page_load(|webview, payload| {
            if let PageLoadEvent::Started = payload.event() {
                // The very first load has no state yet; `try_state` returns `None` and we skip.
                if let Some(state) = webview.try_state::<AppState>() {
                    let count = state.end_all_sessions();
                    if count > 0 {
                        log::info!("page reloaded, ended {count} session(s)");
                    }
                }
            }
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
        commands::import::import_ssh_config_preview,
        commands::import::import_ssh_config_apply,
        commands::prompts::prompt_answer,
        commands::prompts::known_host_remove,
        commands::probe::probe_check,
        commands::ssh::ssh_open,
        commands::ssh::ssh_write,
        commands::ssh::ssh_resize,
        commands::ssh::session_close,
        commands::sftp::sftp_open,
        commands::sftp::sftp_realpath,
        commands::sftp::sftp_list,
        commands::sftp::sftp_mkdir,
        commands::sftp::sftp_rename,
        commands::sftp::sftp_count,
        commands::sftp::sftp_remove,
        commands::sftp::sftp_chmod,
        commands::transfer::sftp_download,
        commands::transfer::sftp_upload,
        commands::transfer::transfer_cancel,
        commands::secrets::secret_set,
        commands::secrets::secret_has,
        commands::secrets::secret_delete,
        commands::rdp::rdp_detect,
        commands::rdp::rdp_open,
        commands::wol::wol_wake,
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
