pub mod clock;
pub mod commands;
pub mod error;
pub mod paths;
pub mod state;

use tauri::Manager;

use crate::paths::AppPaths;
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
            app.manage(AppState {
                paths,
                started_at_ms: clock::now_ms(),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::app::app_info])
        .run(tauri::generate_context!())
        .expect("error while running TunL");
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
