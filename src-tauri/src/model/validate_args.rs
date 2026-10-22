//! SSH and RDP settings validation, plus extra-argument checks.
//!
//! Each helper returns a NEW, normalized copy of the settings (or the first
//! validation error found). The input itself is never mutated.

use super::{RdpDisplay, RdpSettings, SshAuth, SshSettings};
use crate::error::{AppError, AppResult};

/// Returns a NEW, normalized copy of an SSH settings block, or the first error.
pub(crate) fn normalize_ssh_settings(settings: &SshSettings) -> AppResult<SshSettings> {
    let auth = match &settings.auth {
        SshAuth::Key { path } => SshAuth::Key {
            path: validate_path("settings.auth.path", path)?,
        },
        other => other.clone(),
    };
    if let Some(value) = settings.keepalive_secs
        && !(0..=3600).contains(&value)
    {
        return Err(AppError::validation(
            "settings.keepaliveSecs",
            "must be between 0 and 3600 seconds",
        ));
    }
    if let Some(value) = settings.connect_timeout_secs
        && !(1..=120).contains(&value)
    {
        return Err(AppError::validation(
            "settings.connectTimeoutSecs",
            "must be between 1 and 120 seconds",
        ));
    }
    Ok(SshSettings {
        auth,
        keepalive_secs: settings.keepalive_secs,
        connect_timeout_secs: settings.connect_timeout_secs,
    })
}

/// Returns a NEW, normalized copy of an RDP settings block, or the first error.
pub(crate) fn normalize_rdp_settings(settings: &RdpSettings) -> AppResult<RdpSettings> {
    let domain = normalize_domain("settings.domain", settings.domain.as_deref())?;

    let display = match &settings.display {
        RdpDisplay::Fixed { width, height } => {
            if !(640..=8192).contains(width) {
                return Err(AppError::validation(
                    "settings.display",
                    "width must be between 640 and 8192",
                ));
            }
            if !(480..=8192).contains(height) {
                return Err(AppError::validation(
                    "settings.display",
                    "height must be between 480 and 8192",
                ));
            }
            RdpDisplay::Fixed {
                width: *width,
                height: *height,
            }
        }
        other => other.clone(),
    };

    let extra_args = validate_extra_args(&settings.extra_args)?;

    Ok(RdpSettings {
        domain,
        display,
        multimon: settings.multimon,
        dynamic_resolution: settings.dynamic_resolution,
        clipboard: settings.clipboard,
        audio: settings.audio,
        cert_policy: settings.cert_policy,
        share_home: settings.share_home,
        extra_args,
    })
}

/// Trimmed optional domain: empty after trim becomes `None`, at most 64 characters, no control character.
pub(crate) fn normalize_domain(field: &str, raw: Option<&str>) -> AppResult<Option<String>> {
    match raw {
        None => Ok(None),
        Some(value) => {
            let trimmed = value.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            if trimmed.chars().count() > 64 {
                return Err(AppError::validation(field, "must be at most 64 characters"));
            }
            if trimmed.chars().any(char::is_control) {
                return Err(AppError::validation(
                    field,
                    "must not contain control characters",
                ));
            }
            Ok(Some(trimmed.to_string()))
        }
    }
}

/// Each argument 1–200 characters, starting with `/`, `+` or `-`, no control character, and not a reserved FreeRDP flag.
pub(crate) fn validate_extra_args(args: &[String]) -> AppResult<Vec<String>> {
    if args.len() > 20 {
        return Err(AppError::validation(
            "settings.extraArgs",
            "at most 20 extra arguments are allowed",
        ));
    }
    let reserved = [
        "/p:",
        "/password",
        "/u:",
        "/d:",
        "/v:",
        "/port:",
        "/args-from",
        "/from-stdin",
        "/gateway",
        "/gp:",
        "/gu:",
        "/gd:",
        "/cert:",
        "/server-name",
    ];
    let mut out = Vec::with_capacity(args.len());
    for arg in args {
        if arg.chars().count() < 1 || arg.chars().count() > 200 {
            return Err(AppError::validation(
                "settings.extraArgs",
                "each argument must be between 1 and 200 characters",
            ));
        }
        if let Some(first) = arg.chars().next()
            && first != '/'
            && first != '+'
            && first != '-'
        {
            return Err(AppError::validation(
                "settings.extraArgs",
                "each argument must start with '/', '+' or '-'",
            ));
        }
        if arg.chars().any(char::is_control) {
            return Err(AppError::validation(
                "settings.extraArgs",
                "each argument must not contain control characters",
            ));
        }
        let lower = arg.to_ascii_lowercase();
        if reserved.iter().any(|r| lower.starts_with(r)) {
            return Err(AppError::validation(
                "settings.extraArgs",
                "is a reserved FreeRDP argument",
            ));
        }
        out.push(arg.clone());
    }
    Ok(out)
}

/// 1–4096 characters, starting with `/` or `~/`, no control character.
pub(crate) fn validate_path(field: &str, raw: &str) -> AppResult<String> {
    if raw.chars().count() < 1 || raw.chars().count() > 4096 {
        return Err(AppError::validation(
            field,
            "must be between 1 and 4096 characters",
        ));
    }
    if !raw.starts_with('/') && !raw.starts_with("~/") {
        return Err(AppError::validation(
            field,
            "must be an absolute path or start with ~/",
        ));
    }
    if raw.chars().any(char::is_control) {
        return Err(AppError::validation(
            field,
            "must not contain control characters",
        ));
    }
    Ok(raw.to_string())
}
