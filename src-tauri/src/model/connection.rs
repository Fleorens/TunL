use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

/// The connection protocol, used as both the stored kind and the form template selector.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum Protocol {
    Ssh,
    Rdp,
}

/// Protocol-scoped settings: an internally tagged union discriminated by `"protocol"`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "protocol",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum ProtocolSettings {
    Ssh(SshSettings),
    Rdp(RdpSettings),
}

impl ProtocolSettings {
    /// The protocol this settings block belongs to.
    pub fn protocol(&self) -> Protocol {
        match self {
            ProtocolSettings::Ssh(_) => Protocol::Ssh,
            ProtocolSettings::Rdp(_) => Protocol::Rdp,
        }
    }
}

/// SSH connection settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct SshSettings {
    pub auth: SshAuth,
    /// Seconds between keepalives. `None` defers to the global setting.
    pub keepalive_secs: Option<u32>,
    /// Connection timeout in seconds. `None` defers to the global setting.
    pub connect_timeout_secs: Option<u32>,
}

impl Default for SshSettings {
    fn default() -> Self {
        Self {
            auth: SshAuth::Password,
            keepalive_secs: None,
            connect_timeout_secs: None,
        }
    }
}

/// SSH authentication method. The secret (password / passphrase) lives in the vault, not here.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "method",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum SshAuth {
    /// Vault password, else prompt; keyboard-interactive as a fallback.
    Password,
    /// Private key at `path`; vault passphrase if the key is encrypted, else prompt.
    Key { path: String },
    /// Authentication agent (`SSH_AUTH_SOCK`).
    Agent,
}

/// Remote desktop settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct RdpSettings {
    pub domain: Option<String>,
    pub display: RdpDisplay,
    /// Multi-monitor support (default false).
    pub multimon: bool,
    /// Resize the session to the window (default true).
    pub dynamic_resolution: bool,
    /// Clipboard redirection (default true).
    pub clipboard: bool,
    pub audio: RdpAudio,
    /// Share the home directory (default false).
    pub share_home: bool,
    pub cert_policy: RdpCertPolicy,
    /// Extra FreeRDP arguments, validated (see docs/05-modele-donnees.md §6).
    pub extra_args: Vec<String>,
}

impl Default for RdpSettings {
    fn default() -> Self {
        Self {
            domain: None,
            display: RdpDisplay::Fit,
            multimon: false,
            dynamic_resolution: true,
            clipboard: true,
            audio: RdpAudio::Local,
            share_home: false,
            cert_policy: RdpCertPolicy::Prompt,
            extra_args: Vec::new(),
        }
    }
}

/// Remote desktop window layout.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum RdpDisplay {
    Fit,
    Fullscreen,
    Fixed { width: u16, height: u16 },
}

/// Where the remote audio plays.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RdpAudio {
    Local,
    Remote,
    Off,
}

/// Remote desktop certificate trust.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum RdpCertPolicy {
    /// Prompt on an unknown certificate.
    Prompt,
    /// Trust on first use, then remember.
    Tofu,
}

/// Wake-on-LAN configuration. A form model: `WolConfig::default()` (empty MAC) is not a valid stored value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct WolConfig {
    /// Normalized as `AA:BB:CC:DD:EE:FF`.
    pub mac: String,
    pub broadcast: String,
    pub port: u16,
    pub wake_before_connect: bool,
    pub wait_timeout_secs: u32,
}

impl Default for WolConfig {
    fn default() -> Self {
        Self {
            mac: String::new(),
            broadcast: "255.255.255.255".into(),
            port: 9,
            wake_before_connect: false,
            wait_timeout_secs: 120,
        }
    }
}

/// A stored connection. The backend adds `id` and the timestamps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Connection {
    pub id: Uuid,
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub group_id: Option<Uuid>,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub color: Option<AccentColor>,
    pub notes: Option<String>,
    /// A jump host is another SSH connection.
    pub jump_host_id: Option<Uuid>,
    pub wol: Option<WolConfig>,
    pub settings: ProtocolSettings,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_connected_at: Option<i64>,
}

impl Connection {
    /// Build a fresh connection from validated input. `created_at` and `updated_at` are both `now_ms`.
    pub fn from_input(id: Uuid, input: ConnectionInput, now_ms: i64) -> Connection {
        Connection {
            id,
            name: input.name,
            host: input.host,
            port: input.port,
            username: input.username,
            group_id: input.group_id,
            tags: input.tags,
            favorite: input.favorite,
            color: input.color,
            notes: input.notes,
            jump_host_id: input.jump_host_id,
            wol: input.wol,
            settings: input.settings,
            created_at: now_ms,
            updated_at: now_ms,
            last_connected_at: None,
        }
    }

    /// Apply validated input to an existing connection, keeping its identity and history.
    pub fn with_input(&self, input: ConnectionInput, now_ms: i64) -> Connection {
        Connection {
            id: self.id,
            name: input.name,
            host: input.host,
            port: input.port,
            username: input.username,
            group_id: input.group_id,
            tags: input.tags,
            favorite: input.favorite,
            color: input.color,
            notes: input.notes,
            jump_host_id: input.jump_host_id,
            wol: input.wol,
            settings: input.settings,
            created_at: self.created_at,
            updated_at: now_ms,
            last_connected_at: self.last_connected_at,
        }
    }

    /// Rebuild the editable input from a stored connection.
    pub fn to_input(&self) -> ConnectionInput {
        ConnectionInput {
            name: self.name.clone(),
            host: self.host.clone(),
            port: self.port,
            username: self.username.clone(),
            group_id: self.group_id,
            tags: self.tags.clone(),
            favorite: self.favorite,
            color: self.color,
            notes: self.notes.clone(),
            jump_host_id: self.jump_host_id,
            wol: self.wol.clone(),
            settings: self.settings.clone(),
        }
    }
}

/// Everything the user enters (create / edit). The backend adds `id` and the timestamps.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ConnectionInput {
    pub name: String,
    pub host: String,
    pub port: u16,
    pub username: Option<String>,
    pub group_id: Option<Uuid>,
    pub tags: Vec<String>,
    pub favorite: bool,
    pub color: Option<AccentColor>,
    pub notes: Option<String>,
    pub jump_host_id: Option<Uuid>,
    pub wol: Option<WolConfig>,
    pub settings: ProtocolSettings,
}

impl ConnectionInput {
    /// An empty name and host, the default port for `protocol` (22 for SSH, 3389 for RDP),
    /// and everything else at its default.
    pub fn template(protocol: Protocol) -> ConnectionInput {
        let settings = match protocol {
            Protocol::Ssh => ProtocolSettings::Ssh(SshSettings::default()),
            Protocol::Rdp => ProtocolSettings::Rdp(RdpSettings::default()),
        };
        ConnectionInput {
            name: String::new(),
            host: String::new(),
            port: match protocol {
                Protocol::Ssh => 22,
                Protocol::Rdp => 3389,
            },
            username: None,
            group_id: None,
            tags: Vec::new(),
            favorite: false,
            color: None,
            notes: None,
            jump_host_id: None,
            wol: None,
            settings,
        }
    }
}

/// The accent color of a dot or badge. The only place the Tailwind built-in palette is used
/// (docs/05-modele-donnees.md §2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum AccentColor {
    Slate,
    Red,
    Orange,
    Amber,
    Green,
    Teal,
    Cyan,
    Blue,
    Violet,
    Pink,
}
