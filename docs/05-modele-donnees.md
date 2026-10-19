# 05 — Modèle de données

Source de vérité : les types Rust de `src-tauri/src/model/`. Les types TypeScript en sont **générés** par ts-rs
(`src/bindings/`). Ce document fixe leur forme. Une fiche qui a besoin d'un changement de forme le dit explicitement.

## 1. Conventions serde (à appliquer partout)

```rust
// Structs
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]

// Enums sans données (sérialisés en chaîne : "system", "dark"…)
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]

// Enums avec données (union discriminée côté TS)
#[serde(tag = "<discriminant>", rename_all = "camelCase", rename_all_fields = "camelCase")]
```

- `Uuid` → `string`. `i64` (millisecondes Unix) → `number` (réglage `TS_RS_LARGE_INT=number`).
- `Option<T>` → `T | null`. **Toujours** `null` côté JSON, jamais de champ absent (pas de `skip_serializing_if`).
- Les valeurs par défaut vivent dans des `impl Default` et des constructeurs Rust. Le frontend ne les invente pas :
  il appelle les constantes exportées ou se sert de la réponse du backend.

## 2. Connexions

```rust
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
    pub jump_host_id: Option<Uuid>,     // bastion = une autre connexion SSH
    pub wol: Option<WolConfig>,
    pub settings: ProtocolSettings,
    pub created_at: i64,
    pub updated_at: i64,
    pub last_connected_at: Option<i64>,
}

/// Tout ce que l'utilisateur saisit (création / modification). Le backend ajoute id + horodatages.
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

#[serde(tag = "protocol", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ProtocolSettings {
    Ssh(SshSettings),
    Rdp(RdpSettings),
}

pub struct SshSettings {
    pub auth: SshAuth,
    pub keepalive_secs: Option<u32>,        // None = réglage global
    pub connect_timeout_secs: Option<u32>,  // None = réglage global
}

#[serde(tag = "method", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SshAuth {
    Password,              // secret "password" du trousseau, sinon prompt ; keyboard-interactive en repli
    Key { path: String },  // passphrase "passphrase" du trousseau si la clé est chiffrée, sinon prompt
    Agent,                 // SSH_AUTH_SOCK
}

pub struct RdpSettings {
    pub domain: Option<String>,
    pub display: RdpDisplay,
    pub multimon: bool,             // défaut false
    pub dynamic_resolution: bool,   // défaut true
    pub clipboard: bool,            // défaut true
    pub audio: RdpAudio,            // défaut Local
    pub share_home: bool,           // défaut false
    pub cert_policy: RdpCertPolicy, // défaut Prompt
    pub extra_args: Vec<String>,    // validés (§6)
}

#[serde(tag = "mode", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum RdpDisplay { Fit, Fullscreen, Fixed { width: u16, height: u16 } }

pub enum RdpAudio { Local, Remote, Off }
pub enum RdpCertPolicy { Prompt, Tofu }

pub struct WolConfig {
    pub mac: String,               // normalisée "AA:BB:CC:DD:EE:FF"
    pub broadcast: String,         // IPv4, défaut "255.255.255.255"
    pub port: u16,                 // défaut 9
    pub wake_before_connect: bool, // défaut false
    pub wait_timeout_secs: u32,    // défaut 120
}

pub enum AccentColor { Slate, Red, Orange, Amber, Green, Teal, Cyan, Blue, Violet, Pink }
```

Exemple JSON d'une connexion SSH via bastion :

```json
{
  "id": "6f1c…", "name": "db-prod", "host": "db.internal", "port": 22, "username": "root",
  "groupId": "a2e0…", "tags": ["prod", "pg"], "favorite": false, "color": null, "notes": null,
  "jumpHostId": "9b7d…", "wol": null,
  "settings": { "protocol": "ssh", "auth": { "method": "key", "path": "~/.ssh/id_ed25519" },
                "keepaliveSecs": null, "connectTimeoutSecs": null },
  "createdAt": 1790000000000, "updatedAt": 1790000000000, "lastConnectedAt": null
}
```

Rendu des `AccentColor` : `src/lib/colors.ts` associe chaque valeur à des classes de la palette Tailwind intégrée
(`bg-red-500 dark:bg-red-400`, etc.). C'est la **seule** exception à la règle « pas de couleur hors tokens ».

## 3. Groupes

```rust
pub struct Group { pub id: Uuid, pub name: String, pub color: Option<AccentColor> }
pub struct GroupInput { pub name: String, pub color: Option<AccentColor> }
```

L'ordre des groupes est l'ordre du tableau dans le fichier. `group_reorder(ids)` le réécrit.
Supprimer un groupe **ne supprime pas** ses connexions : elles passent « sans groupe ».

## 4. Fichier `connections.json`

```rust
pub struct StoreFile { pub version: u32, pub groups: Vec<Group>, pub connections: Vec<Connection> }
pub const STORE_VERSION: u32 = 1;
```

Migrations : `store/migrate.rs` lit d'abord le JSON en `serde_json::Value`, regarde `version`, applique les étapes
`vN → vN+1` jusqu'à `STORE_VERSION`, puis désérialise. Une version **supérieure** à celle connue →
`AppError::new(ErrorKind::Store, "created by a newer TunL")`, sans rien écraser.

Ce que renvoie `store_load` au frontend : `StoreSnapshot { groups, connections, quarantined }`, c'est-à-dire la même
forme sans `version`, plus la liste des fichiers mis en quarantaine au démarrage (T08). Un `connections.json` écrit
par une version plus récente bloque toutes les commandes du store, pour qu'il ne soit jamais écrasé.

## 5. Réglages (`settings.json`)

```rust
pub struct Settings {
    pub version: u32,                 // 1
    pub language: Language,           // System | En | Fr
    pub theme: ThemeMode,             // System | Dark | Light
    pub reduce_motion: ReduceMotion,  // System | On | Off
    pub terminal: TerminalSettings,
    pub ssh: SshDefaults,
    pub rdp: RdpDefaults,
    pub reachability: ReachabilitySettings,
    pub ui: UiSettings,
}
pub struct TerminalSettings {
    pub theme: TerminalTheme,         // Auto | TunlNight | TunlDay   (Auto = suit le thème de l'app)
    pub font_family: String,          // "Geist Mono Variable"
    pub font_size: u8,                // 13   (8..=32)
    pub line_height: f32,             // 1.25 (1.0..=2.0)
    pub cursor_style: CursorStyle,    // Block | Bar | Underline  (défaut Bar)
    pub cursor_blink: bool,           // true
    pub scrollback: u32,              // 10_000 (1_000..=100_000)
    pub copy_on_select: bool,         // false
    pub bell: bool,                   // false
}
pub struct SshDefaults { pub connect_timeout_secs: u32 /* 15, 1..=120 */, pub keepalive_secs: u32 /* 30, 0..=3600 */ }
pub struct RdpDefaults { pub client_path: Option<String> }
pub struct ReachabilitySettings { pub enabled: bool /* true */, pub interval_secs: u32 /* 60, 15..=3600 */ }
pub struct UiSettings {
    pub sidebar_width: u16,                     // 272 (220..=400)
    pub sidebar_collapsed: bool,                // false
    pub confirm_close_active_session: bool,     // true
    pub download_dir: Option<String>,           // None = dossier Téléchargements du système
}
```

Un `settings.json` absent, illisible **ou hors bornes** donne les valeurs par défaut (et la même procédure « .corrupt » que le store).
Un champ inconnu est ignoré. Un champ manquant prend sa valeur par défaut : `#[serde(default)]` au niveau de chaque
struct de réglages.

## 6. Validation (Rust `model/validate.rs`, reproduite en zod côté UI pour le confort)

| Champ | Règle |
|---|---|
| `name` | après `trim` : 1–80 caractères, aucun caractère de contrôle |
| `host` | après `trim` : 1–253 caractères. IPv4, **ou** IPv6 sans crochets, **ou** nom d'hôte : étiquettes `[A-Za-z0-9_-]{1,63}` séparées par `.`, ni début ni fin par `-`. Aucun espace, `@`, `/` ou caractère de contrôle |
| `port` | 1–65535 |
| `username` | optionnel. Après `trim` : 1–128 caractères, aucun caractère de contrôle. Chaîne vide → `None` |
| `tags` | chacune : `trim` + minuscules, 1–24 caractères, `[a-z0-9._-]`. Au plus 10, dédoublonnées |
| `notes` | ≤ 2000 caractères. Vide → `None` |
| `group_id` | doit exister |
| `jump_host_id` | doit exister, être SSH et ≠ soi-même. La chaîne complète ne boucle pas et compte ≤ 4 bastions |
| `SshAuth::Key.path` | 1–4096, absolu ou commençant par `~/`, aucun caractère de contrôle |
| `keepalive_secs` / `connect_timeout_secs` | 0–3600 / 1–120 |
| `rdp.domain` | ≤ 64, aucun caractère de contrôle |
| `RdpDisplay::Fixed` | largeur 640–8192, hauteur 480–8192 |
| `rdp.extra_args` | ≤ 20 éléments. Chacun : 1–200 caractères, commence par `/`, `+` ou `-`, **aucun caractère de contrôle (dont `\n` et `\r`)**. Refus (insensible à la casse) de ceux qui commencent par `/p:`, `/password`, `/u:`, `/d:`, `/v:`, `/port:`, `/args-from`, `/from-stdin`, `/gateway`, `/gp:`, `/gu:`, `/gd:`, `/cert:` |
| `wol.mac` | 6 octets hexadécimaux séparés par `:` ou `-`, ou 12 chiffres hexa collés. Normalisée en `AA:BB:CC:DD:EE:FF` |
| `wol.broadcast` | IPv4 |
| `wol.wait_timeout_secs` | 10–600 |

Pourquoi refuser `\n` : les arguments FreeRDP passent **ligne par ligne** sur stdin. Un retour à la ligne permettrait
d'injecter un argument. La même règle vaut donc pour **tout** champ qui finit dans les arguments FreeRDP : hôte,
utilisateur, domaine, mot de passe.

Une erreur de validation → `AppError::validation("<chemin>", "<raison>")`, soit le message « <chemin>: <raison> »
en anglais. Le chemin est celui du champ dans le JSON, en camelCase (`host`, `settings.auth.path`, `wol.mac`…),
pour que l'UI puisse attacher l'erreur au bon champ. La raison ne recopie jamais la valeur refusée (S7).
Changer en RDP une connexion qui sert de bastion → `ErrorKind::InUse` avec `ErrorDetail::InUse { names }`.

Groupes : nom après `trim` de 1 à 80 caractères, sans caractère de contrôle, **unique sans tenir compte de la casse**.

## 7. Secrets (trousseau via oo7)

- Attributs : `{ "application": "io.github.fleorens.TunL", "connection": "<uuid>", "kind": "password" | "passphrase" }`.
- Libellé visible dans KWallet / Seahorse : `TunL — <nom de la connexion> (<kind>)`.
- `SecretKind { Password, Passphrase }` (enum sans données).
- Supprimer une connexion supprime ses secrets. Dupliquer une connexion **ne copie pas** ses secrets.

## 8. Types d'échange (IPC)

```rust
// Erreur renvoyée par toutes les commandes (src-tauri/src/error.rs, T05)
pub struct AppError { pub kind: ErrorKind, pub message: String, pub detail: Option<Box<ErrorDetail>> }
// Box : garde Result<T, AppError> petit (clippy::result_large_err). Côté TS : detail: ErrorDetail | null
pub enum ErrorKind { NotFound, Validation, Io, Store, Secret, Network, Timeout, Auth,
                     HostKeyRejected, HostKeyChanged, Cancelled, Sftp, RdpClientMissing, Rdp, Wol, InUse, Internal }
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ErrorDetail {
    HostKeyChanged { host: String, port: u16, key_type: String, fingerprint: String, known_fingerprint: String,
                     known_hosts_path: String, line: u32, removable: bool },   // removable: in TunL's own file (T17)
    InUse { names: Vec<String> },   // ex. supprimer un bastion encore utilisé
}

// Store (T08)
pub enum Protocol { Ssh, Rdp }
pub struct StoreSnapshot { pub groups: Vec<Group>, pub connections: Vec<Connection>, pub quarantined: Vec<String> }
pub struct ConnectionTemplates { pub ssh: ConnectionInput, pub rdp: ConnectionInput, pub wol: WolConfig }

// Prompts
pub struct PromptRequest { pub id: Uuid, pub session_id: Option<Uuid>, pub prompt: PromptKind }
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PromptKind {
    HostKeyUnknown { host: String, port: u16, key_type: String, fingerprint: String },
    Password { connection_name: String, username: String, host: String, can_save: bool, retry: bool },
    Passphrase { connection_name: String, key_path: String, can_save: bool, retry: bool },
    KeyboardInteractive { connection_name: String, name: String, instructions: String, prompts: Vec<InteractivePrompt> },
}
pub struct InteractivePrompt { pub text: String, pub echo: bool }
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PromptAnswer { Accept, Reject, Secret { value: SecretValue, save: bool }, Responses { values: Vec<SecretValue> }, Cancel }
// SecretValue: Zeroizing<String> whose Debug prints *** (S3); "string" côté TS

// Sessions
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SessionTarget { Saved { connection_id: Uuid }, Quick { host: String, port: u16, username: Option<String> } }  // ssh_open (T19)
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum SessionEvent {
    Step { step: StepKind, label: String, state: StepState },
    Connected,
    Log { line: String },                                   // RDP uniquement, déjà filtré
    Closed { reason: CloseReason, exit_status: Option<i32> },
    Error { error: AppError },
}
pub enum StepKind { Wake, Hop, Target, HostKey, Auth, Open, Launch }
pub enum StepState { Started, Done, Failed }
pub enum CloseReason { UserClosed, RemoteClosed, ProcessExited, Error }

// Transferts SFTP
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum TransferEvent {
    Progress { transferred: u64, total: Option<u64>, bytes_per_sec: u64 },
    Done { path: String },   // où le fichier a fini : local (téléchargement) ou distant (envoi) — T26
    Failed { error: AppError },
    Cancelled,
}
pub struct RemoteEntry { pub name: String, pub path: String, pub kind: EntryKind, pub size: u64,
                         pub modified_at: Option<i64>, pub permissions: Option<u32>, pub hidden: bool }
pub enum EntryKind { File, Dir, Symlink, Other }
```

`u64` → `number` côté TS. Au-delà de 2^53 octets (9 Po), on accepte la perte de précision.
