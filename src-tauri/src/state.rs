use crate::paths::AppPaths;

/// Shared backend state, registered with `app.manage()` during setup.
pub struct AppState {
    pub paths: AppPaths,
    pub started_at_ms: i64,
}
