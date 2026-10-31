use std::fs;
use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager, Runtime};

use crate::error::{AppError, AppResult, ErrorKind};

/// Directories owned by TunL (docs/01-architecture.md §9), all kept at mode 0700.
#[derive(Debug, Clone)]
pub struct AppPaths {
    pub config_dir: PathBuf,
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
    /// The private folder for remote-file edits (`<runtime_dir>/tunl/edit`), when a runtime directory
    /// is available (T57). `None` refuses every edit (docs/06-securite.md, S9): never fall back to a
    /// shared temp directory.
    pub edit_dir: Option<PathBuf>,
}

impl AppPaths {
    pub fn resolve<R: Runtime>(app: &AppHandle<R>) -> AppResult<Self> {
        let resolver = app.path();
        let unresolved = |what: &str, error: tauri::Error| {
            AppError::new(
                ErrorKind::Io,
                format!("cannot resolve the {what} directory: {error}"),
            )
        };
        Ok(Self {
            config_dir: resolver
                .app_config_dir()
                .map_err(|e| unresolved("config", e))?,
            data_dir: resolver.app_data_dir().map_err(|e| unresolved("data", e))?,
            log_dir: resolver.app_log_dir().map_err(|e| unresolved("log", e))?,
            edit_dir: edit_dir_in(resolver.runtime_dir().ok()),
        })
    }

    pub fn ensure_created(&self) -> AppResult<()> {
        for dir in [&self.config_dir, &self.data_dir, &self.log_dir] {
            ensure_private_dir(dir)?;
        }
        Ok(())
    }
}

/// TunL's own edit folder inside the user's runtime directory: never the runtime directory itself, which
/// the app clears at start-up (T57).
fn edit_dir_in(runtime_dir: Option<PathBuf>) -> Option<PathBuf> {
    runtime_dir.map(|dir| dir.join("tunl").join("edit"))
}

/// Creates `dir` (and its parents) if needed, then forces mode 0700 on it (docs/06-securite.md, S9).
pub fn ensure_private_dir(dir: &Path) -> AppResult<()> {
    fs::DirBuilder::new()
        .recursive(true)
        .mode(0o700)
        .create(dir)?;
    fs::set_permissions(dir, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mode_of(path: &Path) -> u32 {
        fs::metadata(path).unwrap().permissions().mode() & 0o777
    }

    #[test]
    fn creates_nested_directories_with_mode_0700() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("a/b/c");
        ensure_private_dir(&dir).unwrap();
        assert!(dir.is_dir());
        assert_eq!(mode_of(&dir), 0o700);
    }

    #[test]
    fn the_edit_dir_is_a_subfolder_of_the_runtime_dir() {
        assert_eq!(
            edit_dir_in(Some(PathBuf::from("/run/user/1000"))),
            Some(PathBuf::from("/run/user/1000/tunl/edit"))
        );
        assert_eq!(edit_dir_in(None), None);
    }

    #[test]
    fn tightens_an_existing_directory() {
        let root = tempfile::tempdir().unwrap();
        let dir = root.path().join("loose");
        fs::create_dir(&dir).unwrap();
        fs::set_permissions(&dir, fs::Permissions::from_mode(0o755)).unwrap();
        ensure_private_dir(&dir).unwrap();
        assert_eq!(mode_of(&dir), 0o700);
    }
}
