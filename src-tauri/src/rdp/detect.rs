//! Find a FreeRDP 3 client on the system, and read its version.
//!
//! The client is either the path forced in the settings, or the first known
//! binary on the `PATH` that answers a version 3. Everything here is testable
//! without a real client installed (see `detect_tests.rs`).

use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use tokio::process::{Child, Command};
use ts_rs::TS;

use crate::error::{AppError, AppResult, ErrorKind};

/// Known binaries, preferred first: SDL, then X11, then Wayland; Debian names (`…3`) before Fedora.
pub const CLIENT_NAMES: [&str; 6] = [
    "sdl-freerdp3",
    "sdl-freerdp",
    "xfreerdp3",
    "xfreerdp",
    "wlfreerdp3",
    "wlfreerdp",
];

/// How long a single client is given to answer `--version`.
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(5);

/// Which FreeRDP build a binary is, from its file name.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RdpFlavor {
    Sdl,
    X11,
    Wayland,
}

/// A FreeRDP 3 client found on the system.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RdpClient {
    pub path: String,
    pub version: String,
    pub flavor: RdpFlavor,
}

/// The flavor, from the file name with a trailing `3` removed.
pub fn flavor_of(path: &Path) -> Option<RdpFlavor> {
    let name = path.file_name()?.to_str()?;
    let name = name.strip_suffix('3').unwrap_or(name);
    if name.ends_with("sdl-freerdp") {
        Some(RdpFlavor::Sdl)
    } else if name.ends_with("xfreerdp") {
        Some(RdpFlavor::X11)
    } else if name.ends_with("wlfreerdp") {
        Some(RdpFlavor::Wayland)
    } else {
        None
    }
}

/// The version from a `--version` banner, or `None` unless it is a 3.x (a minor must follow).
pub fn parse_version(output: &str) -> Option<String> {
    let start = output.find("FreeRDP version ")? + "FreeRDP version ".len();
    let tail = &output[start..];
    let version: String = tail
        .chars()
        .take_while(|c: &char| c.is_ascii_digit() || *c == '.')
        .collect();
    let mut parts = version.split('.');
    let major = parts.next()?;
    let minor = parts.next()?;
    if major == "3" && !minor.is_empty() {
        Some(version)
    } else {
        None
    }
}

/// True when the file exists and carries an executable bit.
fn is_executable(path: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    match path.metadata() {
        Ok(meta) => meta.permissions().mode() & 0o111 != 0,
        Err(_) => false,
    }
}

/// Every known client on the `PATH`, in client-name order then directory order, executables only.
pub fn candidates(path_var: &OsStr) -> Vec<PathBuf> {
    let mut out = Vec::new();
    for name in CLIENT_NAMES {
        for dir in std::env::split_paths(path_var) {
            let candidate = dir.join(name);
            if is_executable(&candidate) {
                out.push(candidate);
            }
        }
    }
    out
}

/// Spawn `command` again while it is still busy (`ETXTBSY`), up to five times at 20 ms apart.
///
/// Any other spawn error is returned as-is (T28 reuses this when launching the client).
pub(crate) async fn spawn_retrying(command: &mut Command) -> std::io::Result<Child> {
    let mut error = match command.spawn() {
        Ok(child) => return Ok(child),
        Err(error) => error,
    };
    for _ in 0..5 {
        if error.kind() != std::io::ErrorKind::ExecutableFileBusy {
            return Err(error);
        }
        tokio::time::sleep(Duration::from_millis(20)).await;
        error = match command.spawn() {
            Ok(child) => return Ok(child),
            Err(error) => error,
        };
    }
    Err(error)
}

/// The version string of the client at `path`, or `None` on failure, timeout, or a non-3.x banner.
///
/// Reads both stdout and stderr (the banner goes to one or the other depending on the build), and
/// kills the child on timeout so a client that hangs does not outlive the call.
pub async fn client_version(path: &Path, timeout: Duration) -> Option<String> {
    let mut command = Command::new(path);
    command
        .arg("--version")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);

    let result = tokio::time::timeout(timeout, async {
        let child = spawn_retrying(&mut command).await?;
        child.wait_with_output().await
    })
    .await;

    match result {
        Ok(Ok(output)) => {
            let mut text = String::from_utf8_lossy(&output.stdout).into_owned();
            text.push_str(&String::from_utf8_lossy(&output.stderr));
            parse_version(&text)
        }
        _ => None,
    }
}

/// The FreeRDP 3 client to use: `forced` alone, else the first 3.x client on the `PATH`.
pub async fn detect(
    forced: Option<&str>,
    path_var: &OsStr,
    timeout: Duration,
) -> AppResult<RdpClient> {
    match forced {
        Some(path) => {
            let path = Path::new(path);
            match client_version(path, timeout).await {
                Some(version) => Ok(RdpClient {
                    path: path.to_string_lossy().into_owned(),
                    version,
                    flavor: flavor_of(path).unwrap_or(RdpFlavor::Sdl),
                }),
                None => {
                    let display = path.to_string_lossy();
                    log::info!("forced FreeRDP client is not a usable 3.x binary: {display}");
                    Err(AppError::new(
                        ErrorKind::RdpClientMissing,
                        format!("{display} is not a FreeRDP 3 client"),
                    ))
                }
            }
        }
        None => {
            for candidate in candidates(path_var) {
                match client_version(&candidate, timeout).await {
                    Some(version) => {
                        return Ok(RdpClient {
                            path: candidate.to_string_lossy().into_owned(),
                            version,
                            flavor: flavor_of(&candidate).unwrap_or(RdpFlavor::Sdl),
                        });
                    }
                    None => log::info!("skipping non-3.x FreeRDP client: {}", candidate.display()),
                }
            }
            Err(AppError::new(
                ErrorKind::RdpClientMissing,
                "no FreeRDP 3 client found",
            ))
        }
    }
}
