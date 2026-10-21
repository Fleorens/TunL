use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// UI and backend language.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Language {
    #[default]
    System,
    En,
    Fr,
}

/// Which theme to apply.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ThemeMode {
    System,
    #[default]
    Dark,
    Light,
}

/// Whether animations follow the system preference.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ReduceMotion {
    #[default]
    System,
    On,
    Off,
}

/// Terminal theme. `Auto` follows the app theme.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum TerminalTheme {
    #[default]
    Auto,
    TunlNight,
    TunlDay,
}

/// Terminal cursor shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum CursorStyle {
    Block,
    #[default]
    Bar,
    Underline,
}

/// Terminal appearance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[ts(export)]
pub struct TerminalSettings {
    pub theme: TerminalTheme,
    pub font_family: String,
    /// Font size in pixels (8..=32).
    pub font_size: u8,
    /// Line height (1.0..=2.0). `f32`, so no `Eq`.
    pub line_height: f32,
    pub cursor_style: CursorStyle,
    pub cursor_blink: bool,
    /// Scrollback lines (1_000..=100_000).
    pub scrollback: u32,
    pub copy_on_select: bool,
    pub bell: bool,
}

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            theme: TerminalTheme::default(),
            font_family: "Geist Mono Variable".into(),
            font_size: 13,
            line_height: 1.25,
            cursor_style: CursorStyle::default(),
            cursor_blink: true,
            scrollback: 10_000,
            copy_on_select: false,
            bell: false,
        }
    }
}

/// Default SSH connection settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[ts(export)]
pub struct SshDefaults {
    /// Connection timeout in seconds (1..=120).
    pub connect_timeout_secs: u32,
    /// Keepalive interval in seconds (0..=3600).
    pub keepalive_secs: u32,
}

impl Default for SshDefaults {
    fn default() -> Self {
        Self {
            connect_timeout_secs: 15,
            keepalive_secs: 30,
        }
    }
}

/// Default RDP connection settings.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[ts(export)]
pub struct RdpDefaults {
    /// FreeRDP client path. `None` uses the one found on the system.
    pub client_path: Option<String>,
}

/// Reachability probe settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[ts(export)]
pub struct ReachabilitySettings {
    pub enabled: bool,
    /// Probe interval in seconds (15..=3600).
    pub interval_secs: u32,
}

impl Default for ReachabilitySettings {
    fn default() -> Self {
        Self {
            enabled: true,
            interval_secs: 60,
        }
    }
}

/// Which title bar to draw: the system one, or TunL's own (which makes the top bar the title bar).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export)]
pub enum TitleBarMode {
    #[default]
    Native,
    Custom,
}

/// UI layout settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[ts(export)]
pub struct UiSettings {
    /// Sidebar width in pixels (220..=400).
    pub sidebar_width: u16,
    pub sidebar_collapsed: bool,
    pub confirm_close_active_session: bool,
    /// Local download folder. `None` is the system Downloads folder.
    pub download_dir: Option<String>,
    /// Which title bar to draw (T35). A `settings.json` written before T35 falls back to the system bar.
    pub title_bar: TitleBarMode,
}

impl Default for UiSettings {
    fn default() -> Self {
        Self {
            sidebar_width: 272,
            sidebar_collapsed: false,
            confirm_close_active_session: true,
            download_dir: None,
            title_bar: TitleBarMode::default(),
        }
    }
}

/// The whole `settings.json` document. `version` starts at 1.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
#[ts(export)]
pub struct Settings {
    pub version: u32,
    pub language: Language,
    pub theme: ThemeMode,
    pub reduce_motion: ReduceMotion,
    pub terminal: TerminalSettings,
    pub ssh: SshDefaults,
    pub rdp: RdpDefaults,
    pub reachability: ReachabilitySettings,
    pub ui: UiSettings,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            language: Language::default(),
            theme: ThemeMode::default(),
            reduce_motion: ReduceMotion::default(),
            terminal: TerminalSettings::default(),
            ssh: SshDefaults::default(),
            rdp: RdpDefaults::default(),
            reachability: ReachabilitySettings::default(),
            ui: UiSettings::default(),
        }
    }
}
