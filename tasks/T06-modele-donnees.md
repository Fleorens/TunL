# T06 — Modèle de données Rust, validation, bindings

| | |
|---|---|
| **Jalon** | M1 — Connexions |
| **Dépend de** | T05b |
| **Lire avant** | `AGENTS.md` (« Fiches contrat »), `docs/05-modele-donnees.md` (tout), `docs/06-securite.md` (S5, S7) |
| **Livrable** | `src-tauri/src/model/` : types, valeurs par défaut, validation, 26 tests Rust verts, bindings TS générés |

## Pourquoi

Tout le reste (store, commandes, éditeur, SSH, RDP) repose sur ces types. La validation Rust fait autorité :
l'UI la reproduira pour le confort (T10), mais c'est ici qu'on refuse une connexion invalide, en particulier tout
ce qui pourrait injecter un argument dans FreeRDP (S5).

Aucune commande Tauri dans cette fiche : c'est du Rust pur, testé unitairement.

## Contrat

### Fichiers

```
src-tauri/src/model/
├── mod.rs          déclare les sous-modules et RÉEXPORTE tout (`pub use connection::*;` etc.) + `#[cfg(test)] mod tests;`
├── connection.rs   Protocol, Connection, ConnectionInput, ProtocolSettings, SshSettings, SshAuth, RdpSettings,
│                   RdpDisplay, RdpAudio, RdpCertPolicy, WolConfig, AccentColor
├── group.rs        Group, GroupInput
├── settings.rs     Settings et ses sous-structures, Language, ThemeMode, ReduceMotion, TerminalTheme, CursorStyle
├── validate.rs     normalize_connection_input, normalize_mac, champs simples
├── validate_settings.rs   normalize_group_input, normalize_settings   (ou autre découpage : ≤ 400 lignes par fichier)
└── tests.rs        ⚠ fourni ci-dessous, à l'identique
```

Dans `lib.rs` : `pub mod model;`.

### Types

La forme est **exactement** celle de `docs/05-modele-donnees.md` §2, §3 et §5, avec les conventions serde du §1
(dérivés, `rename_all`, `tag`). Précisions :

- Structs : `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]`. Ajouter `Eq` partout où c'est
  possible. `Settings` et `TerminalSettings` ne peuvent pas avoir `Eq`, à cause du champ `f32`.
- Enums sans données : ajouter `Copy, Eq`. Enums avec données : `Debug, Clone, PartialEq, Eq`.
- **Tous** les types portent `#[ts(export)]` : ils finissent dans `src/bindings/`.
- Nouveau type, pas encore dans le document :

  ```rust
  pub enum Protocol { Ssh, Rdp }                 // "ssh" | "rdp"
  impl ProtocolSettings { pub fn protocol(&self) -> Protocol }
  ```
- Chaque struct de réglages (`Settings`, `TerminalSettings`, `SshDefaults`, `RdpDefaults`, `ReachabilitySettings`,
  `UiSettings`) porte `#[serde(default)]` et un `impl Default` avec les valeurs du §5. `Settings::default().version`
  vaut `1`.

Prototype fait par l'orchestrateur le 2026-09-26 : avec ts-rs 12, `ProtocolSettings` (une étiquette interne sur des
variantes newtype) génère bien
`{ "protocol": "ssh" } & SshSettings | { "protocol": "rdp" } & RdpSettings`. Aucune annotation `#[ts(...)]`
supplémentaire n'est nécessaire.

### Valeurs par défaut et constructeurs

```rust
impl ConnectionInput {
    /// Empty name and host; port 22 (SSH) or 3389 (RDP); everything else at its default.
    pub fn template(protocol: Protocol) -> ConnectionInput;
}
impl Connection {
    pub fn from_input(id: Uuid, input: ConnectionInput, now_ms: i64) -> Connection;   // created_at = updated_at = now_ms
    pub fn with_input(&self, input: ConnectionInput, now_ms: i64) -> Connection;      // keeps id, created_at, last_connected_at
    pub fn to_input(&self) -> ConnectionInput;
}
```

| Type | Défaut |
|---|---|
| `SshSettings` | `auth: SshAuth::Password`, `keepalive_secs: None`, `connect_timeout_secs: None` |
| `RdpSettings` | voir le §2 du document : `Fit`, `multimon` false, `dynamic_resolution` true, `clipboard` true, `Local`, `share_home` false, `Prompt`, `extra_args` vide, `domain` None |
| `WolConfig` | `mac: ""`, `broadcast: "255.255.255.255"`, `port: 9`, `wake_before_connect: false`, `wait_timeout_secs: 120` |

`WolConfig::default()` n'est pas valide (MAC vide) : c'est un modèle de formulaire, pas une valeur à enregistrer.

### Validation

```rust
/// Returns a NEW, normalized copy of `input`, or the first validation error found.
/// `self_id` is Some when updating an existing connection. `groups` / `connections` are the current store.
pub fn normalize_connection_input(
    input: &ConnectionInput,
    self_id: Option<Uuid>,
    groups: &[Group],
    connections: &[Connection],
) -> AppResult<ConnectionInput>;

pub fn normalize_group_input(input: &GroupInput, self_id: Option<Uuid>, groups: &[Group]) -> AppResult<GroupInput>;
pub fn normalize_settings(settings: &Settings) -> AppResult<Settings>;
pub fn normalize_mac(raw: &str) -> Option<String>;   // "AA:BB:CC:DD:EE:FF" or None
```

Règles : tableau du §6 de `docs/05-modele-donnees.md`, plus ce qui suit.

- **Erreur** : `AppError::validation(champ, raison)`. `champ` est le **chemin camelCase** du champ dans le JSON :
  `name`, `host`, `port`, `username`, `tags`, `notes`, `groupId`, `jumpHostId`, `settings.auth.path`,
  `settings.keepaliveSecs`, `settings.connectTimeoutSecs`, `settings.domain`, `settings.display`,
  `settings.extraArgs`, `wol.mac`, `wol.broadcast`, `wol.port`, `wol.waitTimeoutSecs`. Pour les réglages :
  `terminal.fontSize`, `terminal.lineHeight`, `terminal.scrollback`, `terminal.fontFamily`,
  `ssh.connectTimeoutSecs`, `ssh.keepaliveSecs`, `rdp.clientPath`, `reachability.intervalSecs`, `ui.sidebarWidth`,
  `ui.downloadDir`.
- La **raison** est une courte phrase anglaise. Elle ne recopie **jamais** la valeur refusée : un argument
  `/p:motdepasse` refusé ne doit pas se retrouver dans le message (S7).
- **Longueurs** en caractères (`chars().count()`), pas en octets : un nom de 80 « é » est valide.
- **Normalisation** :
  - `name`, `host`, `username`, `domain` : `trim` ;
  - `username`, `notes` et `domain` : vides après `trim` → `None` ;
  - `tags` : `trim` + minuscules, puis dédoublonnage en gardant le premier, puis contrôle du nombre (≤ 10) ;
  - `wol.mac` : `normalize_mac`.
- **MAC** : `trim`, puis soit 12 chiffres hexadécimaux collés, soit 6 paires séparées par **un seul** type de
  séparateur (`:` partout, ou `-` partout). Sortie en majuscules avec `:`.
- **Chemins** (`settings.auth.path`, `rdp.clientPath`, `ui.downloadDir`) : 1–4096 caractères, commencent par `/` ou
  par `~/`, aucun caractère de contrôle.
- **Bastion** (`jumpHostId`) : on suit la chaîne `jump_host_id` depuis le bastion choisi, **en remplaçant la
  connexion `self_id` par l'entrée en cours de validation**. L'erreur porte sur `jumpHostId` si :
  - un maillon n'existe pas ;
  - un maillon n'est pas SSH ;
  - la chaîne repasse par `self_id` ou par un maillon déjà vu (cycle) ;
  - la chaîne compte plus de `MAX_JUMP_HOSTS = 4` bastions.
- **Bastion utilisé** : si l'entrée est RDP alors que `self_id` sert de bastion à d'autres connexions, l'erreur est
  `ErrorKind::InUse`, message `"protocol: used as a jump host"`, avec le détail
  `ErrorDetail::InUse { names }`. `names` liste ces connexions, triées par nom.
- **Groupe** : nom `trim`, 1–80 caractères, aucun caractère de contrôle, **unique sans tenir compte de la casse**
  (sauf pour le groupe `self_id` lui-même). Erreur sur `name`.
- **Réglages** : bornes du §5. `terminal.fontFamily` : 1–64 caractères après `trim`, aucun caractère de contrôle.
  Le nombre `f32` `line_height` doit être fini et compris dans 1.0–2.0.

### Pièges

- Adresse IPv4 et IPv6 : `str::parse::<std::net::Ipv4Addr>()` et `str::parse::<std::net::Ipv6Addr>()`. Aucune
  expression régulière, aucune dépendance à ajouter.
- `char::is_control()` couvre `\n`, `\r`, `\t` et `\0`.
- Refuser `/P:` comme `/p:` : comparer en minuscules (`to_ascii_lowercase`).
- `clippy -D warnings` s'applique aussi aux tests : le fichier fourni n'a aucun import inutilisé. Ne réexporte pas
  moins que ce qu'il utilise.

## Tests du contrat — `src-tauri/src/model/tests.rs` (à l'identique)

```rust
use uuid::Uuid;

use super::*;
use crate::error::{AppError, AppResult, ErrorDetail, ErrorKind};

fn ssh_input(name: &str, host: &str) -> ConnectionInput {
    ConnectionInput {
        name: name.into(),
        host: host.into(),
        ..ConnectionInput::template(Protocol::Ssh)
    }
}

fn rdp_input(name: &str, host: &str) -> ConnectionInput {
    ConnectionInput {
        name: name.into(),
        host: host.into(),
        ..ConnectionInput::template(Protocol::Rdp)
    }
}

fn saved(input: ConnectionInput) -> Connection {
    Connection::from_input(Uuid::new_v4(), input, 1_000)
}

fn validate(input: &ConnectionInput) -> AppResult<ConnectionInput> {
    normalize_connection_input(input, None, &[], &[])
}

fn field_of(error: &AppError) -> &str {
    error.message.split(':').next().unwrap_or_default()
}

fn with_ssh(settings: SshSettings) -> ConnectionInput {
    ConnectionInput {
        settings: ProtocolSettings::Ssh(settings),
        ..ssh_input("x", "h")
    }
}

fn with_rdp(settings: RdpSettings) -> ConnectionInput {
    ConnectionInput {
        settings: ProtocolSettings::Rdp(settings),
        ..rdp_input("x", "h")
    }
}

#[test]
fn templates_use_the_protocol_default_ports() {
    assert_eq!(ConnectionInput::template(Protocol::Ssh).port, 22);
    assert_eq!(ConnectionInput::template(Protocol::Rdp).port, 3389);
    assert_eq!(ConnectionInput::template(Protocol::Rdp).settings.protocol(), Protocol::Rdp);
}

#[test]
fn a_connection_serializes_to_the_documented_json_shape() {
    let input = with_ssh(SshSettings {
        auth: SshAuth::Key { path: "~/.ssh/id_ed25519".into() },
        ..SshSettings::default()
    });
    let json = serde_json::to_value(saved(input)).unwrap();
    assert_eq!(json["settings"]["protocol"], "ssh");
    assert_eq!(json["settings"]["auth"]["method"], "key");
    assert_eq!(json["settings"]["auth"]["path"], "~/.ssh/id_ed25519");
    assert_eq!(json["settings"].get("keepaliveSecs"), Some(&serde_json::Value::Null));
    assert_eq!(json.get("jumpHostId"), Some(&serde_json::Value::Null));
    assert_eq!(json.get("lastConnectedAt"), Some(&serde_json::Value::Null));
    assert_eq!(json["createdAt"], 1_000);
}

#[test]
fn rdp_settings_round_trip_through_json() {
    let input = with_rdp(RdpSettings {
        display: RdpDisplay::Fixed { width: 1920, height: 1080 },
        ..RdpSettings::default()
    });
    let json = serde_json::to_value(&input).unwrap();
    assert_eq!(json["settings"]["protocol"], "rdp");
    assert_eq!(json["settings"]["display"]["mode"], "fixed");
    assert_eq!(json["settings"]["certPolicy"], "prompt");
    assert_eq!(json["settings"]["audio"], "local");
    let back: ConnectionInput = serde_json::from_value(json).unwrap();
    assert_eq!(back, input);
}

#[test]
fn rdp_defaults_match_the_data_model() {
    let rdp = RdpSettings::default();
    assert_eq!(rdp.display, RdpDisplay::Fit);
    assert!(!rdp.multimon && rdp.dynamic_resolution && rdp.clipboard && !rdp.share_home);
    assert_eq!(rdp.audio, RdpAudio::Local);
    assert_eq!(rdp.cert_policy, RdpCertPolicy::Prompt);
    assert!(rdp.extra_args.is_empty());
}

#[test]
fn normalization_trims_and_cleans_the_input() {
    let input = ConnectionInput {
        username: Some("  ".into()),
        notes: Some(String::new()),
        tags: vec![" Prod ".into(), "prod".into(), "Web".into()],
        ..ssh_input("  web-01  ", " 10.0.0.12 ")
    };
    let out = validate(&input).unwrap();
    assert_eq!(out.name, "web-01");
    assert_eq!(out.host, "10.0.0.12");
    assert_eq!(out.username, None);
    assert_eq!(out.notes, None);
    assert_eq!(out.tags, vec!["prod".to_string(), "web".to_string()]);
    assert_eq!(input.name, "  web-01  ", "the input itself is never modified");
}

#[test]
fn accepts_ipv4_ipv6_and_host_names() {
    for host in ["10.0.0.12", "fe80::1", "::1", "db.internal", "my_host-01.example.com", "localhost"] {
        assert!(validate(&ssh_input("x", host)).is_ok(), "{host} should be valid");
    }
}

#[test]
fn rejects_malformed_hosts() {
    for host in [
        "", "   ", "bad host", "user@host", "a/b", "-lead.example", "trail-.example", "a..b", "line\nbreak",
        "[::1]",
    ] {
        let error = validate(&ssh_input("x", host)).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Validation, "{host:?}");
        assert_eq!(field_of(&error), "host", "{host:?}");
    }
}

#[test]
fn rejects_port_zero() {
    let input = ConnectionInput { port: 0, ..ssh_input("x", "h") };
    assert_eq!(field_of(&validate(&input).unwrap_err()), "port");
}

#[test]
fn names_are_counted_in_characters() {
    let long = "a".repeat(81);
    for name in ["", "  ", long.as_str(), "tab\there"] {
        assert_eq!(field_of(&validate(&ssh_input(name, "h")).unwrap_err()), "name", "{name:?}");
    }
    assert!(validate(&ssh_input(&"é".repeat(80), "h")).is_ok());
}

#[test]
fn rejects_invalid_or_too_many_tags() {
    let bad = ConnectionInput { tags: vec!["no spaces".into()], ..ssh_input("x", "h") };
    assert_eq!(field_of(&validate(&bad).unwrap_err()), "tags");
    let many = ConnectionInput { tags: (0..11).map(|i| format!("t{i}")).collect(), ..ssh_input("x", "h") };
    assert_eq!(field_of(&validate(&many).unwrap_err()), "tags");
    let repeated = ConnectionInput { tags: vec!["prod".into(); 11], ..ssh_input("x", "h") };
    assert_eq!(validate(&repeated).unwrap().tags, vec!["prod".to_string()]);
}

#[test]
fn key_paths_must_be_absolute_or_home_relative() {
    let with_key = |path: &str| {
        with_ssh(SshSettings { auth: SshAuth::Key { path: path.into() }, ..SshSettings::default() })
    };
    assert!(validate(&with_key("~/.ssh/id_ed25519")).is_ok());
    assert!(validate(&with_key("/home/me/.ssh/id_rsa")).is_ok());
    for path in ["", "id_rsa", "./key", "~root/key"] {
        assert_eq!(field_of(&validate(&with_key(path)).unwrap_err()), "settings.auth.path", "{path:?}");
    }
}

#[test]
fn ssh_timeouts_are_bounded() {
    let with = |keepalive_secs: Option<u32>, connect_timeout_secs: Option<u32>| {
        with_ssh(SshSettings { keepalive_secs, connect_timeout_secs, ..SshSettings::default() })
    };
    assert!(validate(&with(Some(0), Some(1))).is_ok());
    assert_eq!(field_of(&validate(&with(Some(3601), None)).unwrap_err()), "settings.keepaliveSecs");
    assert_eq!(field_of(&validate(&with(None, Some(0))).unwrap_err()), "settings.connectTimeoutSecs");
}

#[test]
fn rdp_extra_args_reject_reserved_and_multiline_values() {
    let with_args = |args: &[&str]| {
        with_rdp(RdpSettings {
            extra_args: args.iter().map(|arg| arg.to_string()).collect(),
            ..RdpSettings::default()
        })
    };
    assert!(validate(&with_args(&["/sound:sys:pulse", "+fonts", "-wallpaper"])).is_ok());
    for arg in [
        "/p:secret", "/P:secret", "/v:evil", "/args-from:file", "/cert:ignore", "/gateway:g:x", "noprefix",
        "/size:1\n/p:x", "",
    ] {
        let error = validate(&with_args(&[arg])).unwrap_err();
        assert_eq!(field_of(&error), "settings.extraArgs", "{arg:?}");
        assert!(!error.message.contains("secret"), "the refused value must not be echoed");
    }
}

#[test]
fn rdp_fixed_display_and_domain_are_bounded() {
    let with = |display: RdpDisplay, domain: Option<&str>| {
        with_rdp(RdpSettings { display, domain: domain.map(str::to_string), ..RdpSettings::default() })
    };
    assert!(validate(&with(RdpDisplay::Fixed { width: 1920, height: 1080 }, Some("CORP"))).is_ok());
    let narrow = with(RdpDisplay::Fixed { width: 639, height: 1080 }, None);
    assert_eq!(field_of(&validate(&narrow).unwrap_err()), "settings.display");
    let injected = with(RdpDisplay::Fit, Some("CO\nRP"));
    assert_eq!(field_of(&validate(&injected).unwrap_err()), "settings.domain");
}

#[test]
fn normalizes_mac_addresses() {
    assert_eq!(normalize_mac("aa-bb-cc-dd-ee-ff").as_deref(), Some("AA:BB:CC:DD:EE:FF"));
    assert_eq!(normalize_mac("aabbccddeeff").as_deref(), Some("AA:BB:CC:DD:EE:FF"));
    assert_eq!(normalize_mac(" 01:23:45:67:89:ab ").as_deref(), Some("01:23:45:67:89:AB"));
    for bad in ["", "aa:bb:cc:dd:ee", "aa:bb:cc:dd:ee:gg", "aa:bb-cc:dd:ee:ff", "aabbccddeeff00"] {
        assert_eq!(normalize_mac(bad), None, "{bad:?}");
    }
}

#[test]
fn wol_config_is_validated_and_normalized() {
    let with = |wol: WolConfig| ConnectionInput { wol: Some(wol), ..ssh_input("x", "h") };
    let ok = validate(&with(WolConfig { mac: "aa-bb-cc-dd-ee-ff".into(), ..WolConfig::default() })).unwrap();
    assert_eq!(ok.wol.map(|wol| wol.mac).as_deref(), Some("AA:BB:CC:DD:EE:FF"));
    let mac = || "aabbccddeeff".to_string();
    let cases = [
        (WolConfig { mac: "nope".into(), ..WolConfig::default() }, "wol.mac"),
        (WolConfig { mac: mac(), broadcast: "not-an-ip".into(), ..WolConfig::default() }, "wol.broadcast"),
        (WolConfig { mac: mac(), wait_timeout_secs: 5, ..WolConfig::default() }, "wol.waitTimeoutSecs"),
        (WolConfig { mac: mac(), port: 0, ..WolConfig::default() }, "wol.port"),
    ];
    for (wol, field) in cases {
        assert_eq!(field_of(&validate(&with(wol)).unwrap_err()), field);
    }
}

#[test]
fn referenced_group_and_jump_host_must_exist() {
    let input = ConnectionInput { group_id: Some(Uuid::new_v4()), ..ssh_input("x", "h") };
    assert_eq!(field_of(&validate(&input).unwrap_err()), "groupId");
    let input = ConnectionInput { jump_host_id: Some(Uuid::new_v4()), ..ssh_input("x", "h") };
    assert_eq!(field_of(&validate(&input).unwrap_err()), "jumpHostId");
    let group = Group { id: Uuid::new_v4(), name: "Prod".into(), color: None };
    let input = ConnectionInput { group_id: Some(group.id), ..ssh_input("x", "h") };
    assert!(normalize_connection_input(&input, None, &[group], &[]).is_ok());
}

#[test]
fn jump_host_must_be_another_ssh_connection() {
    let rdp = saved(rdp_input("win", "10.0.0.5"));
    let input = ConnectionInput { jump_host_id: Some(rdp.id), ..ssh_input("x", "h") };
    let error = normalize_connection_input(&input, None, &[], &[rdp]).unwrap_err();
    assert_eq!(field_of(&error), "jumpHostId");

    let me = saved(ssh_input("me", "h"));
    let input = ConnectionInput { jump_host_id: Some(me.id), ..me.to_input() };
    let error = normalize_connection_input(&input, Some(me.id), &[], &[me.clone()]).unwrap_err();
    assert_eq!(field_of(&error), "jumpHostId");
}

#[test]
fn jump_chains_cannot_loop() {
    // b jumps through a, c jumps through b. Making a jump through c would loop.
    let a = saved(ssh_input("a", "a.example"));
    let b = saved(ConnectionInput { jump_host_id: Some(a.id), ..ssh_input("b", "b.example") });
    let c = saved(ConnectionInput { jump_host_id: Some(b.id), ..ssh_input("c", "c.example") });
    let all = [a.clone(), b, c.clone()];
    let looping = ConnectionInput { jump_host_id: Some(c.id), ..a.to_input() };
    let error = normalize_connection_input(&looping, Some(a.id), &[], &all).unwrap_err();
    assert_eq!(field_of(&error), "jumpHostId");
    let through_c = ConnectionInput { jump_host_id: Some(c.id), ..ssh_input("d", "d.example") };
    assert!(normalize_connection_input(&through_c, None, &[], &all).is_ok());
}

#[test]
fn jump_chains_are_limited_to_four_bastions() {
    // h2 jumps through h1, h3 through h2… A target behind h4 has 4 bastions, behind h5 it has 5.
    let mut chain: Vec<Connection> = Vec::new();
    for i in 1..=5 {
        let previous = chain.last().map(|hop| hop.id);
        chain.push(saved(ConnectionInput { jump_host_id: previous, ..ssh_input(&format!("h{i}"), "h.example") }));
    }
    let behind = |hop: &Connection| ConnectionInput { jump_host_id: Some(hop.id), ..ssh_input("t", "t.example") };
    assert!(normalize_connection_input(&behind(&chain[3]), None, &[], &chain).is_ok());
    let error = normalize_connection_input(&behind(&chain[4]), None, &[], &chain).unwrap_err();
    assert_eq!(field_of(&error), "jumpHostId");
}

#[test]
fn a_bastion_in_use_cannot_become_rdp() {
    let bastion = saved(ssh_input("bastion-01", "bastion.example"));
    let web = saved(ConnectionInput { jump_host_id: Some(bastion.id), ..ssh_input("web-01", "10.0.0.12") });
    let as_rdp = ConnectionInput {
        settings: ConnectionInput::template(Protocol::Rdp).settings,
        ..bastion.to_input()
    };
    let error = normalize_connection_input(&as_rdp, Some(bastion.id), &[], &[bastion.clone(), web]).unwrap_err();
    assert_eq!(error.kind, ErrorKind::InUse);
    assert_eq!(error.detail.as_deref(), Some(&ErrorDetail::InUse { names: vec!["web-01".into()] }));
}

#[test]
fn updating_a_connection_keeps_its_identity() {
    let original = Connection { last_connected_at: Some(5_000), ..saved(ssh_input("web", "h")) };
    let updated = original.with_input(ssh_input("web-renamed", "h"), 9_000);
    assert_eq!(updated.id, original.id);
    assert_eq!(updated.created_at, 1_000);
    assert_eq!(updated.updated_at, 9_000);
    assert_eq!(updated.last_connected_at, Some(5_000));
    assert_eq!(updated.to_input(), ssh_input("web-renamed", "h"));
}

#[test]
fn group_names_are_trimmed_and_unique() {
    let prod = Group { id: Uuid::new_v4(), name: "Production".into(), color: None };
    let groups = [prod.clone()];
    let lab = GroupInput { name: "  Lab ".into(), color: Some(AccentColor::Green) };
    assert_eq!(normalize_group_input(&lab, None, &groups).unwrap().name, "Lab");
    let duplicate = GroupInput { name: "production".into(), color: None };
    assert_eq!(field_of(&normalize_group_input(&duplicate, None, &groups).unwrap_err()), "name");
    assert!(normalize_group_input(&duplicate, Some(prod.id), &groups).is_ok(), "renaming itself is fine");
    let blank = GroupInput { name: " ".into(), color: None };
    assert_eq!(field_of(&normalize_group_input(&blank, None, &groups).unwrap_err()), "name");
}

#[test]
fn settings_fill_missing_fields_with_defaults() {
    let json = r#"{ "theme": "dark", "terminal": { "fontSize": 15 }, "future": true }"#;
    let settings: Settings = serde_json::from_str(json).unwrap();
    assert_eq!(settings.theme, ThemeMode::Dark);
    assert_eq!(settings.terminal.font_size, 15);
    assert_eq!(settings.terminal.scrollback, 10_000);
    assert_eq!(settings.ssh.connect_timeout_secs, 15);
    assert_eq!(settings.ui.sidebar_width, 272);
    assert_eq!(settings.version, 1);
}

#[test]
fn default_settings_are_valid() {
    let base = Settings::default();
    assert_eq!(normalize_settings(&base).unwrap(), base);
}

#[test]
fn settings_out_of_range_are_rejected_with_their_path() {
    let base = Settings::default();
    let cases = [
        (Settings { terminal: TerminalSettings { font_size: 7, ..base.terminal.clone() }, ..base.clone() }, "terminal.fontSize"),
        (Settings { terminal: TerminalSettings { line_height: 2.5, ..base.terminal.clone() }, ..base.clone() }, "terminal.lineHeight"),
        (Settings { ssh: SshDefaults { connect_timeout_secs: 0, ..base.ssh.clone() }, ..base.clone() }, "ssh.connectTimeoutSecs"),
        (Settings { reachability: ReachabilitySettings { interval_secs: 5, ..base.reachability.clone() }, ..base.clone() }, "reachability.intervalSecs"),
        (Settings { ui: UiSettings { sidebar_width: 100, ..base.ui.clone() }, ..base.clone() }, "ui.sidebarWidth"),
        (Settings { rdp: RdpDefaults { client_path: Some("relative/freerdp".into()) }, ..base.clone() }, "rdp.clientPath"),
    ];
    for (settings, field) in cases {
        assert_eq!(field_of(&normalize_settings(&settings).unwrap_err()), field);
    }
}
```

`cargo fmt` reformate ce fichier : c'est normal et autorisé (formatage seulement, pas de changement de contenu).

## Étapes

1. Créer `model/tests.rs` (ci-dessus), puis les types, puis la validation.
2. `npm run bindings`, puis vérifier que `src/bindings/` contient au moins `Connection.ts`, `ConnectionInput.ts`,
   `ProtocolSettings.ts`, `SshAuth.ts`, `RdpDisplay.ts`, `WolConfig.ts`, `Group.ts`, `Settings.ts`, `Protocol.ts`.
3. Remplacer le type local de `src/lib/colors.ts` par le binding : `import type { AccentColor } from "@/bindings/AccentColor";`
   et le réexporter (`export type { AccentColor }`), pour que les imports existants continuent de marcher.
4. Même chose dans `src/lib/theme.ts` pour `ThemeMode`, qui devient le binding généré, réexporté.
5. `npm run format`, `npm run review`, cases, statut, commit `feat: data model, validation and TS bindings (T06)`.

## Critères d'acceptation

- [ ] `npm run review` passe, avec les 26 tests de `model/tests.rs`.
- [ ] `model/tests.rs` est identique à la fiche (au formatage `cargo fmt` près).
- [ ] Les bindings listés à l'étape 2 existent, et `ProtocolSettings.ts` est une union discriminée par `"protocol"`.
- [ ] Aucun fichier de `model/` ne dépasse 400 lignes.
- [ ] `grep -rn "unwrap()\|expect(" src-tauri/src/model --include=*.rs | grep -v tests.rs` est vide.

## À regarder par Florian

Rien à l'écran : l'app ne change pas visuellement.
