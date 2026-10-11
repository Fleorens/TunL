//! TunL's `known_hosts` file (docs/01-architecture.md §9, docs/06-securite.md, S6, S9).
//!
//! `check` asks "is this server key known, unknown, changed, or revoked?" against TunL's own file and,
//! as a fallback, the user's OpenSSH file. `learn` records a key; `remove` drops one (TunL's file only,
//! D10). Reading a line like OpenSSH — comments, tabs, hashed names, wildcards, markers — lives in
//! `known_hosts_file`; this file only decides the verdict (T19b).
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use russh::keys::{Algorithm, HashAlg, PublicKey};

use super::known_hosts_file::{HostLine, host_lines};
use crate::error::{AppError, AppResult, ErrorKind};

/// File name of TunL's own known_hosts, in its data directory.
pub const KNOWN_HOSTS_FILE: &str = "known_hosts";

/// The verdict `check` returns for a `(host, port, key)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HostKeyStatus {
    Known,
    Unknown,
    /// A key of the same algorithm is recorded elsewhere: the server's key differs.
    Changed {
        path: PathBuf,
        line: usize,
        known_fingerprint: String,
        removable: bool,
    },
    /// The key is listed as `@revoked`: refused whatever else the files say.
    Revoked {
        path: PathBuf,
        line: usize,
    },
}

/// TunL's known_hosts plus the optional user OpenSSH file to fall back on.
#[derive(Debug, Clone)]
pub struct KnownHosts {
    /// TunL's own file (removable records live here).
    pub own: PathBuf,
    /// The user's `~/.ssh/known_hosts`, if a home directory exists.
    pub user: Option<PathBuf>,
}

impl KnownHosts {
    pub fn new(own: PathBuf, user: Option<PathBuf>) -> Self {
        Self { own, user }
    }

    /// TunL's own file in `config_dir`, the user's file in `~/.ssh` when a home exists.
    pub fn for_app(config_dir: &Path) -> Self {
        let own = config_dir.join(KNOWN_HOSTS_FILE);
        let user = std::env::home_dir().map(|home| home.join(".ssh").join("known_hosts"));
        Self::new(own, user)
    }

    /// Classify `key` for `(host, port)`: TunL's file first, then the user's (T19b).
    pub fn check(&self, host: &str, port: u16, key: &PublicKey) -> HostKeyStatus {
        let own = self.read_file(&self.own, host, port, key, true);

        let user = self
            .user
            .as_ref()
            .map(|path| self.read_file(path, host, port, key, false));

        // A revoked key is refused without a question: TunL's file first, then the user's.
        if own.revoked {
            return HostKeyStatus::Revoked {
                path: self.own.clone(),
                line: own.revoked_line,
            };
        }
        if let Some(user) = &user
            && user.revoked
        {
            return HostKeyStatus::Revoked {
                path: user.path.clone(),
                line: user.revoked_line,
            };
        }
        // An exact match in either file wins over a change recorded in the other.
        if own.matched || user.as_ref().is_some_and(|user| user.matched) {
            return HostKeyStatus::Known;
        }
        // Otherwise a changed key in TunL's own file (removable) beats the user's (not removable).
        own.change
            .or(user.and_then(|user| user.change))
            .unwrap_or(HostKeyStatus::Unknown)
    }

    /// The key types recorded for `(host, port)` in both files (revoked lines aside), own file first,
    /// no duplicates. Used to ask russh for the key types already recorded (T19b).
    pub fn algorithms(&self, host: &str, port: u16) -> Vec<Algorithm> {
        let mut out: Vec<Algorithm> = Vec::new();
        for line in host_lines(&self.own, host, port) {
            if !line.revoked && !out.contains(&line.key.algorithm()) {
                out.push(line.key.algorithm());
            }
        }
        if let Some(user) = &self.user {
            for line in host_lines(user, host, port) {
                if !line.revoked && !out.contains(&line.key.algorithm()) {
                    out.push(line.key.algorithm());
                }
            }
        }
        out
    }

    /// Record `key` for `(host, port)` in TunL's own file, appending an OpenSSH line (T19b).
    pub fn learn(&self, host: &str, port: u16, key: &PublicKey) -> AppResult<()> {
        let pattern = host_pattern(&host.to_lowercase(), port);
        let openssh = key
            .to_openssh()
            .map_err(|error| AppError::internal(format!("cannot encode host key: {error}")))?;
        let mut fields = openssh.split_whitespace();
        let algorithm = fields.next().unwrap_or_default();
        let key_b64 = fields.next().unwrap_or_default();
        let line = format!("{pattern} {algorithm} {key_b64}\n");

        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .mode(0o600)
            .open(&self.own)
            .map_err(|error| write_error(&self.own, error))?;

        // Keep this line on its own even if the file existed without a trailing newline.
        if self.needs_preceding_newline()? {
            file.write_all(b"\n")
                .map_err(|error| write_error(&self.own, error))?;
        }
        file.write_all(line.as_bytes())
            .map_err(|error| write_error(&self.own, error))?;

        // Fix the mode in case the file already existed with looser permissions (S9).
        fs::set_permissions(&self.own, fs::Permissions::from_mode(0o600))
            .map_err(|error| write_error(&self.own, error))?;
        Ok(())
    }

    /// Drop every line of `(host, port)` from TunL's own file (D10). Returns the lines removed.
    pub fn remove(&self, host: &str, port: u16) -> AppResult<usize> {
        let pattern = host_pattern(&host.to_lowercase(), port);
        let text = match fs::read_to_string(&self.own) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(0),
            Err(error) => return Err(write_error(&self.own, error)),
        };

        let kept: Vec<&str> = text
            .lines()
            .filter(|line| !line_comes_from_host(line, &pattern))
            .collect();
        let removed = text.lines().count() - kept.len();
        if removed == 0 {
            return Ok(0);
        }

        let next = if kept.is_empty() {
            String::new()
        } else {
            format!("{}\n", kept.join("\n"))
        };

        // Write through a temporary file renamed over the own file: never a half-written file, and no
        // `.tmp` left behind (S9).
        let tmp = self.own.with_extension("tmp");
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&tmp)
            .map_err(|error| write_error(&self.own, error))?;
        file.write_all(next.as_bytes())
            .map_err(|error| write_error(&self.own, error))?;
        file.sync_all()
            .map_err(|error| write_error(&self.own, error))?;
        fs::rename(&tmp, &self.own).map_err(|error| write_error(&self.own, error))?;
        fs::set_permissions(&self.own, fs::Permissions::from_mode(0o600))
            .map_err(|error| write_error(&self.own, error))?;
        Ok(removed)
    }

    /// Whether the own file exists and is non-empty without a trailing newline.
    fn needs_preceding_newline(&self) -> AppResult<bool> {
        let text = fs::read_to_string(&self.own).ok();
        Ok(
            matches!(text.as_deref(), Some(non_empty) if !non_empty.is_empty() && !non_empty.ends_with('\n')),
        )
    }

    /// The status of `key` in a single file: a revoked line, an exact match, or the first change.
    fn read_file(
        &self,
        path: &Path,
        host: &str,
        port: u16,
        key: &PublicKey,
        removable: bool,
    ) -> ReadStatus {
        let lines = host_lines(path, host, port);
        let key_data = key.key_data();

        // A revoked line that carries this exact key.
        let revoked_line = lines
            .iter()
            .find(|line| line.revoked && line.key.key_data() == key_data)
            .map(|line| line.line)
            .unwrap_or(0);

        // A non-revoked line that carries this exact key.
        let matched = lines
            .iter()
            .any(|line| !line.revoked && line.key.key_data() == key_data);

        let change = first_change(&lines, key, path, removable);

        ReadStatus {
            path: path.to_path_buf(),
            revoked: revoked_line != 0,
            revoked_line,
            matched,
            change,
        }
    }
}

/// The outcome of reading one file for `check`.
struct ReadStatus {
    path: PathBuf,
    revoked: bool,
    /// Physical line of the revoked match, 0 when there is none.
    revoked_line: usize,
    matched: bool,
    change: Option<HostKeyStatus>,
}

/// The first change in a file: the first non-revoked line of the same algorithm as `key`, else the
/// first non-revoked line whatever its algorithm (T19b, the "another type is a change" point).
fn first_change(
    lines: &[HostLine],
    key: &PublicKey,
    path: &Path,
    removable: bool,
) -> Option<HostKeyStatus> {
    let same = lines
        .iter()
        .find(|line| !line.revoked && line.key.algorithm() == key.algorithm());
    let any = same.or_else(|| lines.iter().find(|line| !line.revoked));
    any.map(|line| HostKeyStatus::Changed {
        path: path.to_path_buf(),
        line: line.line,
        known_fingerprint: fingerprint(&line.key),
        removable,
    })
}

/// The OpenSSH host field: the bare host on the default port, `[host]:port` otherwise.
pub fn host_pattern(host: &str, port: u16) -> String {
    if port == 22 {
        host.to_string()
    } else {
        format!("[{host}]:{port}")
    }
}

/// The SHA256 base64 fingerprint, as shown in a prompt (S6).
pub fn fingerprint(key: &PublicKey) -> String {
    key.fingerprint(HashAlg::Sha256).to_string()
}

/// True when the line's first field (a comma-separated host list) lists `pattern`, case-insensitively
/// and tolerant of tabs and repeated spaces (T19b).
fn line_comes_from_host(line: &str, pattern: &str) -> bool {
    line.split_whitespace().next().is_some_and(|hosts| {
        hosts
            .split(',')
            .any(|host| host.eq_ignore_ascii_case(pattern))
    })
}

/// A uniform `Io` error for every write to the own file, naming the path (never a secret).
fn write_error(path: &Path, _error: std::io::Error) -> AppError {
    AppError::new(ErrorKind::Io, format!("cannot write {}", path.display()))
}
