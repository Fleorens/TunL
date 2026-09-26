use uuid::Uuid;

use super::{
    Group, GroupInput, RdpDefaults, ReachabilitySettings, Settings, SshDefaults, TerminalSettings,
    UiSettings,
};
use crate::error::{AppError, AppResult};

/// Returns a NEW, normalized copy of `input`, or the first validation error found.
///
/// `name` is trimmed, 1–80 characters, no control character, and unique ignoring case (except `self_id`).
pub fn normalize_group_input(
    input: &GroupInput,
    self_id: Option<Uuid>,
    groups: &[Group],
) -> AppResult<GroupInput> {
    let name = input.name.trim().to_string();
    if name.chars().count() < 1 {
        return Err(AppError::validation("name", "must not be empty"));
    }
    if name.chars().count() > 80 {
        return Err(AppError::validation(
            "name",
            "must be at most 80 characters",
        ));
    }
    if name.chars().any(char::is_control) {
        return Err(AppError::validation(
            "name",
            "must not contain control characters",
        ));
    }
    for group in groups {
        if self_id == Some(group.id) {
            continue;
        }
        if group.name.eq_ignore_ascii_case(&name) {
            return Err(AppError::validation(
                "name",
                "the group name must be unique",
            ));
        }
    }
    Ok(GroupInput {
        name,
        color: input.color,
    })
}

/// Returns a NEW, normalized copy of `settings`, or the first validation error found.
///
/// All bounds are checked (docs/05-modele-donnees.md §5); a valid default is returned unchanged.
pub fn normalize_settings(settings: &Settings) -> AppResult<Settings> {
    let terminal = normalize_terminal(&settings.terminal)?;
    let ssh = normalize_ssh_defaults(&settings.ssh)?;
    let rdp = normalize_rdp_defaults(&settings.rdp)?;
    let reachability = normalize_reachability(&settings.reachability)?;
    let ui = normalize_ui(&settings.ui)?;
    Ok(Settings {
        version: settings.version,
        language: settings.language,
        theme: settings.theme,
        reduce_motion: settings.reduce_motion,
        terminal,
        ssh,
        rdp,
        reachability,
        ui,
    })
}

fn normalize_terminal(terminal: &TerminalSettings) -> AppResult<TerminalSettings> {
    if !(8..=32).contains(&terminal.font_size) {
        return Err(AppError::validation(
            "terminal.fontSize",
            "must be between 8 and 32",
        ));
    }
    if !terminal.line_height.is_finite() || !(1.0..=2.0).contains(&terminal.line_height) {
        return Err(AppError::validation(
            "terminal.lineHeight",
            "must be between 1.0 and 2.0",
        ));
    }
    if !(1_000..=100_000).contains(&terminal.scrollback) {
        return Err(AppError::validation(
            "terminal.scrollback",
            "must be between 1000 and 100000",
        ));
    }
    let font_family = terminal.font_family.trim();
    if font_family.chars().count() < 1 || font_family.chars().count() > 64 {
        return Err(AppError::validation(
            "terminal.fontFamily",
            "must be between 1 and 64 characters",
        ));
    }
    if font_family.chars().any(char::is_control) {
        return Err(AppError::validation(
            "terminal.fontFamily",
            "must not contain control characters",
        ));
    }
    Ok(TerminalSettings {
        theme: terminal.theme,
        font_family: terminal.font_family.clone(),
        font_size: terminal.font_size,
        line_height: terminal.line_height,
        cursor_style: terminal.cursor_style,
        cursor_blink: terminal.cursor_blink,
        scrollback: terminal.scrollback,
        copy_on_select: terminal.copy_on_select,
        bell: terminal.bell,
    })
}

fn normalize_ssh_defaults(ssh: &SshDefaults) -> AppResult<SshDefaults> {
    if !(1..=120).contains(&ssh.connect_timeout_secs) {
        return Err(AppError::validation(
            "ssh.connectTimeoutSecs",
            "must be between 1 and 120 seconds",
        ));
    }
    if !(0..=3600).contains(&ssh.keepalive_secs) {
        return Err(AppError::validation(
            "ssh.keepaliveSecs",
            "must be between 0 and 3600 seconds",
        ));
    }
    Ok(ssh.clone())
}

fn normalize_rdp_defaults(rdp: &RdpDefaults) -> AppResult<RdpDefaults> {
    if let Some(path) = &rdp.client_path {
        if path.chars().count() < 1 || path.chars().count() > 4096 {
            return Err(AppError::validation(
                "rdp.clientPath",
                "must be between 1 and 4096 characters",
            ));
        }
        if !path.starts_with('/') && !path.starts_with("~/") {
            return Err(AppError::validation(
                "rdp.clientPath",
                "must be an absolute path or start with ~/",
            ));
        }
        if path.chars().any(char::is_control) {
            return Err(AppError::validation(
                "rdp.clientPath",
                "must not contain control characters",
            ));
        }
    }
    Ok(rdp.clone())
}

fn normalize_reachability(reachability: &ReachabilitySettings) -> AppResult<ReachabilitySettings> {
    if !(15..=3600).contains(&reachability.interval_secs) {
        return Err(AppError::validation(
            "reachability.intervalSecs",
            "must be between 15 and 3600 seconds",
        ));
    }
    Ok(reachability.clone())
}

fn normalize_ui(ui: &UiSettings) -> AppResult<UiSettings> {
    if !(220..=400).contains(&ui.sidebar_width) {
        return Err(AppError::validation(
            "ui.sidebarWidth",
            "must be between 220 and 400",
        ));
    }
    if let Some(path) = &ui.download_dir {
        if path.chars().count() < 1 || path.chars().count() > 4096 {
            return Err(AppError::validation(
                "ui.downloadDir",
                "must be between 1 and 4096 characters",
            ));
        }
        if !path.starts_with('/') && !path.starts_with("~/") {
            return Err(AppError::validation(
                "ui.downloadDir",
                "must be an absolute path or start with ~/",
            ));
        }
        if path.chars().any(char::is_control) {
            return Err(AppError::validation(
                "ui.downloadDir",
                "must not contain control characters",
            ));
        }
    }
    Ok(ui.clone())
}
