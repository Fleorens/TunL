//! Build the FreeRDP arguments for a connection.
//!
//! `build_tunnel_args` is a pure function: it returns the argument lines in the exact
//! order FreeRDP expects them, one per line on stdin. It is fully covered by
//! `args_tests.rs`, and it re-checks every input (defense in depth) even though
//! the settings were already validated when stored. `build_args` is the direct
//! form (no tunnel, no server name); `build_tunnel_args` is used behind a bastion.

use std::fmt;

use crate::error::{AppError, AppResult};
use crate::model::{RdpAudio, RdpCertPolicy, RdpDisplay, RdpSettings, validate_extra_args};
use crate::secrets::SecretValue;
use zeroize::Zeroizing;

/// Credentials for a connection: an optional user, and the password as a secret.
#[derive(Debug, Clone, Default)]
pub struct RdpCredentials {
    pub username: Option<String>,
    pub password: Option<SecretValue>,
}

/// Where to connect, and the window title.
#[derive(Debug, Clone)]
pub struct RdpEndpoint<'a> {
    pub name: &'a str,
    pub host: &'a str,
    pub port: u16,
}

/// The argument lines. `Debug` writes `/p:***` in place of the password (S3).
pub struct RdpArgs(Vec<Zeroizing<String>>);

impl RdpArgs {
    /// The arguments, one per line.
    pub fn lines(&self) -> impl Iterator<Item = &str> {
        self.0.iter().map(|line| line.as_str())
    }

    /// What to write on stdin: every line followed by `\n`, never an empty line.
    pub fn stdin_text(&self) -> Zeroizing<String> {
        let mut text = Zeroizing::new(String::new());
        for line in &self.0 {
            text.push_str(line);
            text.push('\n');
        }
        text
    }
}

impl fmt::Debug for RdpArgs {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let masked: Vec<&str> = self
            .0
            .iter()
            .map(|line| {
                let s = line.as_str();
                if s.starts_with("/p:") { "/p:***" } else { s }
            })
            .collect();
        f.debug_list().entries(masked).finish()
    }
}

/// The arguments, in the order FreeRDP expects them (see `docs/01-architecture.md` §8).
///
/// `server_name` is the real host, passed right after `/v:` behind a bastion so FreeRDP checks the
/// certificate against it (T28c); `None` for a direct connection.
pub fn build_tunnel_args(
    endpoint: &RdpEndpoint<'_>,
    server_name: Option<&str>,
    settings: &RdpSettings,
    credentials: &RdpCredentials,
) -> AppResult<RdpArgs> {
    // Defense in depth: no control character may reach a line (S4, S5). The reason
    // never echoes the offending value (S7).
    no_control("host", endpoint.host)?;
    no_control("name", endpoint.name)?;
    if let Some(server_name) = server_name {
        no_control("serverName", server_name)?;
    }
    if let Some(username) = &credentials.username {
        no_control("username", username)?;
    }
    if let Some(domain) = &settings.domain {
        no_control("settings.domain", domain)?;
    }
    if let Some(password) = &credentials.password {
        no_control("password", password.expose())?;
    }
    let extra = validate_extra_args(&settings.extra_args)?;

    let mut lines: Vec<Zeroizing<String>> = Vec::new();

    // 1. The address. An IPv6 host contains `:`, so it is bracketed.
    let address = if endpoint.host.contains(':') {
        format!("/v:[{}]:{}", endpoint.host, endpoint.port)
    } else {
        format!("/v:{}:{}", endpoint.host, endpoint.port)
    };
    lines.push(Zeroizing::new(address));

    // 2. The real host name, right after the address, so FreeRDP files and checks the certificate
    // against it (T28c). Without a tunnel, no extra line.
    if let Some(server_name) = server_name {
        lines.push(Zeroizing::new(format!("/server-name:{server_name}")));
    }

    // 3-5. Credentials (empty user/domain are omitted, not written as `/u:`).
    if let Some(username) = &credentials.username
        && !username.is_empty()
    {
        lines.push(Zeroizing::new(format!("/u:{username}")));
    }
    if let Some(domain) = &settings.domain
        && !domain.is_empty()
    {
        lines.push(Zeroizing::new(format!("/d:{domain}")));
    }
    if let Some(password) = &credentials.password {
        lines.push(Zeroizing::new(format!("/p:{}", password.expose())));
    }

    // 6. The window title.
    lines.push(Zeroizing::new(format!("/t:{} — TunL", endpoint.name)));

    // 7. Window layout.
    match settings.display {
        RdpDisplay::Fit => {}
        RdpDisplay::Fullscreen => {
            lines.push(Zeroizing::new("/f".to_string()));
            if settings.multimon {
                lines.push(Zeroizing::new("/multimon".to_string()));
            }
        }
        RdpDisplay::Fixed { width, height } => {
            lines.push(Zeroizing::new(format!("/size:{width}x{height}")));
        }
    }

    // 8. Resolution: dynamic, or smart-sizing only when fitting (they conflict).
    if settings.dynamic_resolution {
        lines.push(Zeroizing::new("/dynamic-resolution".to_string()));
    } else if matches!(settings.display, RdpDisplay::Fit) {
        lines.push(Zeroizing::new("/smart-sizing".to_string()));
    }

    // 9. Clipboard.
    let clipboard = if settings.clipboard {
        "+clipboard"
    } else {
        "-clipboard"
    };
    lines.push(Zeroizing::new(clipboard.to_string()));

    // 10. Audio.
    let audio = match settings.audio {
        RdpAudio::Local => "/sound",
        RdpAudio::Remote => "/audio-mode:1",
        RdpAudio::Off => "/audio-mode:2",
    };
    lines.push(Zeroizing::new(audio.to_string()));

    // 11. Home directory.
    if settings.share_home {
        lines.push(Zeroizing::new("+home-drive".to_string()));
    }

    // 12. Certificate policy (Prompt lets FreeRDP ask in its own window).
    if settings.cert_policy == RdpCertPolicy::Tofu {
        lines.push(Zeroizing::new("/cert:tofu".to_string()));
    }

    // 13. Extra arguments, last, so they can override what came before.
    for arg in extra {
        lines.push(Zeroizing::new(arg));
    }

    Ok(RdpArgs(lines))
}

/// The direct form: no tunnel, no server name (`build_tunnel_args` with `None`).
pub fn build_args(
    endpoint: &RdpEndpoint<'_>,
    settings: &RdpSettings,
    credentials: &RdpCredentials,
) -> AppResult<RdpArgs> {
    build_tunnel_args(endpoint, None, settings, credentials)
}

/// Reject any control character in a field, without echoing it (S4, S5, S7).
fn no_control(field: &str, value: &str) -> AppResult<()> {
    if value.chars().any(char::is_control) {
        return Err(AppError::validation(
            field,
            "must not contain control characters",
        ));
    }
    Ok(())
}
