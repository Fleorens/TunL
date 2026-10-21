//! The title bar the window really has (T35): the setting, unless `TUNL_TITLEBAR=native` imposes the
//! system one, or the window refused to drop its decorations. Pure helpers here; the command and the
//! startup call in `lib.rs` apply them to the real window.
use serde::Serialize;
use ts_rs::TS;
use tauri::{Runtime, WebviewWindow};

use crate::error::AppResult;
use crate::model::TitleBarMode;

/// The environment variable that forces the system title bar, whatever the setting says.
pub const TITLE_BAR_ENV: &str = "TUNL_TITLEBAR";

/// The title bar the window really has.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WindowChrome {
    pub mode: TitleBarMode,
    /// True when the system bar is imposed: `TUNL_TITLEBAR=native`, or the window refused to drop its decorations.
    pub forced: bool,
}

/// The effective title bar: the setting, unless the variable (trimmed, any case) says `native`.
/// Any other value is ignored.
pub fn effective_title_bar(setting: TitleBarMode, env: Option<&str>) -> WindowChrome {
    let forced = env
        .map(|value| value.trim().eq_ignore_ascii_case("native"))
        .unwrap_or(false);
    WindowChrome {
        mode: if forced { TitleBarMode::Native } else { setting },
        forced,
    }
}

/// Applies the effective bar to the window (`set_decorations(mode == Native)`). If `set_decorations(false)`
/// fails: warn, decorations back on, and `WindowChrome { mode: Native, forced: true }`.
pub fn apply_title_bar<R: Runtime>(window: &WebviewWindow<R>, setting: TitleBarMode) -> WindowChrome {
    let effective =
        effective_title_bar(setting, std::env::var(TITLE_BAR_ENV).ok().as_deref());
    match window.set_decorations(effective.mode == TitleBarMode::Native) {
        Ok(()) => effective,
        Err(error) => {
            log::warn!("window refused to drop its decorations: {error}; keeping the system bar");
            let _ = window.set_decorations(true);
            WindowChrome {
                mode: TitleBarMode::Native,
                forced: true,
            }
        }
    }
}

/// The window button commands the TunL title bar drives (T35). Only `window_apply_title_bar` is an IPC
/// command; the three window actions go through `getCurrentWindow()` on the JS side.
#[tauri::command]
pub async fn window_apply_title_bar<R: Runtime>(
    window: WebviewWindow<R>,
    mode: TitleBarMode,
) -> AppResult<WindowChrome> {
    Ok(apply_title_bar(&window, mode))
}
