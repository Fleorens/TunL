# T27 — FreeRDP 3 : détection du client et construction des arguments

| | |
|---|---|
| **Jalon** | M5 — RDP |
| **Dépend de** | T08 |
| **Lire avant** | `docs/01-architecture.md` §2 (« Outils système ») et §8, `docs/02-decisions.md` D04, `docs/06-securite.md` S3, S4, S5 et S7, `docs/05-modele-donnees.md` §6 (lignes `rdp.*`) |
| **Livrable** | module `src-tauri/src/rdp/` (`detect.rs`, `args.rs`), commande `rdp_detect` + `ipc.rdpDetect` + mock ; 4 fichiers de tests |

## Pourquoi

T28 lancera FreeRDP. Il lui faut deux briques testables sans client installé :
1. **trouver le client** : le chemin forcé dans les réglages, sinon le premier binaire connu du `PATH` qui répond une
   version 3 ;
2. **construire ses arguments** : une fonction **pure**, testée option par option, qui ne laisse passer aucun
   caractère de contrôle (les arguments partent ligne par ligne sur stdin, S4 et S5).

Pas d'interface dans cette fiche : la carte RDP vient avec T28, l'état « client introuvable » des Paramètres avec T31.

Prototypé par l'orchestrateur : les tests de cette fiche passent (FreeRDP **n'est pas** installé sur la devbox :
les tests de détection créent de faux clients, des scripts shell, dans un dossier temporaire).

## À réutiliser (ne pas réécrire)

- T06 : `validate_extra_args` de `model/validate_args.rs` (la validation des arguments supplémentaires, liste des
  arguments réservés comprise). Elle est `pub(crate)` dans un module privé : la réexporter depuis `model/mod.rs`
  (`pub(crate) use validate_args::validate_extra_args;`), **ne pas la recopier**.
- T06 : `RdpSettings`, `RdpDisplay`, `RdpAudio`, `RdpCertPolicy` (`model/connection.rs`), `RdpDefaults.client_path`.
- T12 : `SecretValue` (`secrets.rs`) : `expose()` et un `Debug` qui affiche `***`.
- `zeroize::Zeroizing` (déjà une dépendance).
- T08 : `AppState::get_settings()`. T05 : `commands/ipc_tests.rs` (`mock_app`, `invoke`).

## Ce que FreeRDP 3 attend (vérifié dans ses sources, `client/common/cmdline.c` de la 3.10)

- `/args-from:stdin` doit être le **seul** argument de la ligne de commande. FreeRDP lit ensuite **un argument par
  ligne** sur stdin, et retire les `\n` / `\r` de fin.
- **Une ligne vide arrête la lecture** : tout ce qui suit est ignoré. Aucune ligne produite ne doit être vide.
- `/v:<hôte>:<port>` : FreeRDP coupe au **premier** `:`. Une IPv6 s'écrit donc entre crochets : `/v:[fd00::5]:3389`.
- Le titre de fenêtre : `/t:<titre>`.
- `/dynamic-resolution` (la session suit la taille de la fenêtre) et `/smart-sizing` (l'image est mise à l'échelle)
  ne vont pas ensemble.

## Contrat — Rust

### `src-tauri/Cargo.toml`

Ajouter `"process"` à la liste des fonctionnalités de `tokio` (pour `tokio::process::Command`). Aucune autre
dépendance.

### Modules

- `src-tauri/src/rdp/mod.rs` : `pub mod args; pub mod detect;` + `#[cfg(test)] mod args_tests;` et
  `#[cfg(test)] mod detect_tests;`.
- `lib.rs` : `pub mod rdp;`, et `commands::rdp::rdp_detect` dans `invoke_handler()`.
- `commands/mod.rs` : `pub mod rdp;` et `#[cfg(test)] mod ipc_rdp_tests;`.

### `src-tauri/src/rdp/detect.rs`

```rust
/// Les binaires connus, préférés d'abord : SDL, puis X11, puis Wayland ; les noms Debian (`…3`) avant Fedora.
pub const CLIENT_NAMES: [&str; 6] =
    ["sdl-freerdp3", "sdl-freerdp", "xfreerdp3", "xfreerdp", "wlfreerdp3", "wlfreerdp"];
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(5);

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)] #[serde(rename_all = "camelCase")] #[ts(export)]
pub enum RdpFlavor { Sdl, X11, Wayland }

#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)] #[serde(rename_all = "camelCase")] #[ts(export)]
pub struct RdpClient { pub path: String, pub version: String, pub flavor: RdpFlavor }

pub fn flavor_of(path: &Path) -> Option<RdpFlavor>;
pub fn parse_version(output: &str) -> Option<String>;
pub fn candidates(path_var: &OsStr) -> Vec<PathBuf>;
pub async fn client_version(path: &Path, timeout: Duration) -> Option<String>;
pub async fn detect(forced: Option<&str>, path_var: &OsStr, timeout: Duration) -> AppResult<RdpClient>;
```

| Fonction | Comportement |
|---|---|
| `flavor_of` | d'après le **nom de fichier**, `3` final retiré : `sdl-freerdp` → `Sdl`, `xfreerdp` → `X11`, `wlfreerdp` → `Wayland`, autre → `None` |
| `parse_version` | cherche `FreeRDP version `, puis lit chiffres et points : `"3.10.3"`. `Some` seulement si la majeure vaut **exactement** `3` et qu'une mineure suit (`2.11.7`, `30.1.0`, `3` → `None`). La bannière peut être précédée d'autres lignes |
| `candidates` | pour chaque nom de `CLIENT_NAMES` dans l'ordre, chaque dossier de `path_var` (`std::env::split_paths`) dans l'ordre : garde les **fichiers exécutables** (un bit `x`) |
| `client_version` | `tokio::process::Command::new(path).arg("--version")`, stdin `null`, stdout et stderr capturés, `kill_on_drop(true)` ; lancé par `spawn_retrying`, puis `wait_with_output`, le tout sous `tokio::time::timeout`. Lit stdout **et** stderr, puis `parse_version`. Échec, délai dépassé, ou pas une 3.x → `None` |
| `spawn_retrying` | `pub(crate) async fn spawn_retrying(command: &mut Command) -> std::io::Result<Child>` : `command.spawn()`, réessayé 5 fois au plus, à 20 ms d'intervalle, **tant que** l'erreur est `std::io::ErrorKind::ExecutableFileBusy` ; toute autre issue est rendue telle quelle. T28 s'en sert aussi |
| `detect` | `forced` présent : **seul** ce chemin est essayé (exécutable et 3.x, sinon `RdpClientMissing` avec un message qui nomme le chemin), saveur d'après le nom, `Sdl` si le nom est inconnu (un script maison). Sinon : le premier de `candidates(path_var)` qui donne une version 3.x. Aucun → `AppError::new(ErrorKind::RdpClientMissing, "no FreeRDP 3 client found")` |

Un candidat refusé laisse une ligne `log::info!` (son chemin, rien d'autre).

### `src-tauri/src/rdp/args.rs`

```rust
#[derive(Debug, Clone, Default)]
pub struct RdpCredentials { pub username: Option<String>, pub password: Option<SecretValue> }

/// Le titre, et où se connecter : l'hôte lui-même, ou l'entrée locale d'un tunnel (T28).
#[derive(Debug, Clone)]
pub struct RdpEndpoint<'a> { pub name: &'a str, pub host: &'a str, pub port: u16 }

/// Les lignes d'arguments. `Debug` écrit `/p:***` à la place du mot de passe (S3).
pub struct RdpArgs(Vec<Zeroizing<String>>);
impl RdpArgs {
    pub fn lines(&self) -> impl Iterator<Item = &str>;
    /// Ce qu'on écrira sur stdin : chaque ligne suivie de `\n`.
    pub fn stdin_text(&self) -> Zeroizing<String>;
}

pub fn build_args(endpoint: &RdpEndpoint<'_>, settings: &RdpSettings, credentials: &RdpCredentials)
    -> AppResult<RdpArgs>;
```

`build_args`, lignes **dans cet ordre** :

| # | Ligne(s) | Quand |
|---|---|---|
| 1 | `/v:<host>:<port>`, ou `/v:[<host>]:<port>` si `host` contient `:` | toujours |
| 2 | `/u:<username>` | `username` présent et non vide |
| 3 | `/d:<domain>` | `settings.domain` présent et non vide |
| 4 | `/p:<password>` | `password` présent |
| 5 | `/t:<name> — TunL` (tiret cadratin, espaces autour) | toujours |
| 6 | `Fit` : rien · `Fullscreen` : `/f`, puis `/multimon` si `multimon` · `Fixed` : `/size:<w>x<h>` | selon `display` ; `multimon` hors plein écran ne produit rien |
| 7 | `/dynamic-resolution` si `dynamic_resolution` ; sinon `/smart-sizing`, **en `Fit` seulement** | |
| 8 | `+clipboard` ou `-clipboard` | toujours |
| 9 | `Local` : `/sound` · `Remote` : `/audio-mode:1` · `Off` : `/audio-mode:2` | toujours |
| 10 | `+home-drive` | `share_home` |
| 11 | `/cert:tofu` | `cert_policy == Tofu` (`Prompt` : rien, FreeRDP demande dans sa fenêtre) |
| 12 | les `extra_args`, dans leur ordre | **en dernier**, pour pouvoir surcharger ce qui précède |

Contrôles, **même si** le store a déjà validé (défense en profondeur) :
- `host`, `name`, `username`, `settings.domain`, mot de passe : aucun caractère de contrôle (`char::is_control`),
  sinon `AppError::validation("<champ>", "must not contain control characters")` avec le champ `host`, `name`,
  `username`, `settings.domain` ou `password`. Le message ne recopie **jamais** la valeur (S7) ;
- `extra_args` : repassés par `validate_extra_args`.

### `src-tauri/src/commands/rdp.rs` (nouveau)

```rust
#[tauri::command]
pub async fn rdp_detect(state: State<'_, AppState>) -> AppResult<RdpClient>
```

`detect(settings.rdp.client_path, la variable PATH du processus (vide si absente), VERSION_TIMEOUT)`.

## Contrat — Frontend

- `npm run bindings` : `src/bindings/RdpClient.ts` et `RdpFlavor.ts`.
- `src/lib/ipc.ts`, à la fin de l'objet `ipc` : `rdpDetect: () => call<RdpClient>("rdp_detect"),` (commentaire de
  section `// RDP (T27): …`).
- `src/lib/mock/rdp.ts` (nouveau) : `export const MOCK_RDP_CLIENT: RdpClient` (`/usr/bin/sdl-freerdp3`, `3.10.3`,
  `sdl`) et `export const rdpHandlers: Record<string, Handler>` avec `rdp_detect` :
  - pas de `settings.rdp.clientPath` → `MOCK_RDP_CLIENT` ;
  - un chemin qui contient `freerdp` → ce chemin, version `3.10.3`, saveur d'après le nom (`wlfreerdp` → `wayland`,
    `xfreerdp` → `x11`, sinon `sdl`) ;
  - un autre chemin → rejet `{ kind: "rdpClientMissing", message: "<chemin> is not a FreeRDP 3 client", detail: null }`.
- `src/lib/ipc-mock.ts` : `...rdpHandlers` dans `HANDLERS`.

## Pièges (vus au prototype)

- **Ne jamais produire une ligne vide** : FreeRDP s'arrête à la première, et ignore tout le reste (le mot de passe ou
  le certificat, par exemple). Un `username` ou un `domain` vide est **omis**, pas écrit `/u:`.
- Le mot de passe ne passe **que** par `/p:` sur stdin : jamais dans un `log::`, jamais dans un message d'erreur,
  jamais dans un `Debug`. `RdpArgs` n'a donc **pas** de `#[derive(Debug)]` : il en a un écrit à la main.
- `client_version` doit lire **stdout et stderr** : selon la version et la saveur, la bannière sort sur l'un ou
  l'autre.
- Sans `kill_on_drop(true)`, un client qui ne répond pas reste en vie après le délai dépassé.
- **« Text file busy » (ETXTBSY)** : un fichier qu'on vient d'écrire peut rester « occupé » un instant si un autre
  fil de TunL lance un processus au même moment (il hérite brièvement du descripteur ouvert). Les tests écrivent
  leurs faux clients puis les lancent, en parallèle d'autres tests qui lancent des processus : sans `spawn_retrying`,
  un test échoue au hasard (vu au prototype, 1 fois sur une vingtaine de passages complets).
- `std::os::unix::fs::PermissionsExt` (`mode() & 0o111`) pour le bit exécutable : un fichier présent mais non
  exécutable n'est pas un candidat.

## Tests du contrat

### `src-tauri/src/rdp/args_tests.rs` (nouveau)

```rust
use super::args::{RdpCredentials, RdpEndpoint, build_args};
use crate::error::ErrorKind;
use crate::model::{RdpAudio, RdpCertPolicy, RdpDisplay, RdpSettings};
use crate::secrets::SecretValue;

fn endpoint() -> RdpEndpoint<'static> {
    RdpEndpoint {
        name: "ad-01",
        host: "10.0.0.5",
        port: 3389,
    }
}

fn lines(settings: &RdpSettings, credentials: &RdpCredentials) -> Vec<String> {
    build_args(&endpoint(), settings, credentials)
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect()
}

fn defaults() -> Vec<String> {
    lines(&RdpSettings::default(), &RdpCredentials::default())
}

fn admin() -> RdpCredentials {
    RdpCredentials {
        username: Some("admin".into()),
        password: Some(SecretValue::new("s3cret pass")),
    }
}

#[test]
fn the_defaults_give_the_address_title_and_default_options_in_order() {
    assert_eq!(
        defaults(),
        [
            "/v:10.0.0.5:3389",
            "/t:ad-01 — TunL",
            "/dynamic-resolution",
            "+clipboard",
            "/sound",
        ]
    );
}

#[test]
fn credentials_and_domain_come_right_after_the_address() {
    let settings = RdpSettings {
        domain: Some("CORP".into()),
        ..RdpSettings::default()
    };
    let args = lines(&settings, &admin());
    assert_eq!(
        args[..5],
        [
            "/v:10.0.0.5:3389",
            "/u:admin",
            "/d:CORP",
            "/p:s3cret pass",
            "/t:ad-01 — TunL"
        ]
    );
}

#[test]
fn empty_user_and_domain_are_left_out() {
    let settings = RdpSettings {
        domain: Some(String::new()),
        ..RdpSettings::default()
    };
    let credentials = RdpCredentials {
        username: Some(String::new()),
        password: None,
    };
    let args = lines(&settings, &credentials);
    assert!(
        !args
            .iter()
            .any(|a| a.starts_with("/u:") || a.starts_with("/d:"))
    );
    assert!(!args.iter().any(|a| a.starts_with("/p:")));
}

#[test]
fn an_ipv6_address_is_bracketed() {
    let endpoint = RdpEndpoint {
        host: "fd00::5",
        ..endpoint()
    };
    let args = build_args(
        &endpoint,
        &RdpSettings::default(),
        &RdpCredentials::default(),
    )
    .unwrap();
    assert_eq!(args.lines().next(), Some("/v:[fd00::5]:3389"));
}

#[test]
fn a_tunnel_endpoint_is_used_as_given() {
    let endpoint = RdpEndpoint {
        host: "127.0.0.1",
        port: 40123,
        ..endpoint()
    };
    let args = build_args(
        &endpoint,
        &RdpSettings::default(),
        &RdpCredentials::default(),
    )
    .unwrap();
    assert_eq!(args.lines().next(), Some("/v:127.0.0.1:40123"));
}

#[test]
fn display_modes() {
    let fit_static = RdpSettings {
        dynamic_resolution: false,
        ..RdpSettings::default()
    };
    let args = lines(&fit_static, &RdpCredentials::default());
    assert!(args.contains(&"/smart-sizing".to_string()));
    assert!(!args.contains(&"/dynamic-resolution".to_string()));

    let fullscreen = RdpSettings {
        display: RdpDisplay::Fullscreen,
        dynamic_resolution: false,
        ..RdpSettings::default()
    };
    let args = lines(&fullscreen, &RdpCredentials::default());
    assert!(args.contains(&"/f".to_string()));
    assert!(!args.contains(&"/multimon".to_string()));
    assert!(!args.contains(&"/smart-sizing".to_string()));

    let fixed = RdpSettings {
        display: RdpDisplay::Fixed {
            width: 1920,
            height: 1080,
        },
        ..RdpSettings::default()
    };
    let args = lines(&fixed, &RdpCredentials::default());
    assert!(args.contains(&"/size:1920x1080".to_string()));
    assert!(args.contains(&"/dynamic-resolution".to_string()));
    assert!(!args.contains(&"/f".to_string()));
}

#[test]
fn multimon_only_goes_with_fullscreen() {
    let fullscreen = RdpSettings {
        display: RdpDisplay::Fullscreen,
        multimon: true,
        ..RdpSettings::default()
    };
    let args = lines(&fullscreen, &RdpCredentials::default());
    let f = args.iter().position(|a| a == "/f").unwrap();
    assert_eq!(args[f + 1], "/multimon");

    let windowed = RdpSettings {
        multimon: true,
        ..RdpSettings::default()
    };
    assert!(!lines(&windowed, &RdpCredentials::default()).contains(&"/multimon".to_string()));
}

#[test]
fn clipboard_audio_home_and_certificate() {
    let settings = RdpSettings {
        clipboard: false,
        audio: RdpAudio::Remote,
        share_home: true,
        cert_policy: RdpCertPolicy::Tofu,
        ..RdpSettings::default()
    };
    let args = lines(&settings, &RdpCredentials::default());
    assert!(args.contains(&"-clipboard".to_string()));
    assert!(!args.contains(&"+clipboard".to_string()));
    assert!(args.contains(&"/audio-mode:1".to_string()));
    assert!(!args.contains(&"/sound".to_string()));
    assert!(args.contains(&"+home-drive".to_string()));
    assert!(args.contains(&"/cert:tofu".to_string()));

    let off = RdpSettings {
        audio: RdpAudio::Off,
        ..RdpSettings::default()
    };
    assert!(lines(&off, &RdpCredentials::default()).contains(&"/audio-mode:2".to_string()));
    // The default certificate policy lets FreeRDP ask in its own window: no /cert at all.
    assert!(!defaults().iter().any(|a| a.starts_with("/cert")));
    assert!(!defaults().contains(&"+home-drive".to_string()));
}

#[test]
fn extra_arguments_come_last_in_their_order() {
    let settings = RdpSettings {
        extra_args: vec!["/scale:140".into(), "-wallpaper".into()],
        ..RdpSettings::default()
    };
    let args = lines(&settings, &admin());
    assert_eq!(args[args.len() - 2..], ["/scale:140", "-wallpaper"]);
}

#[test]
fn no_line_is_ever_empty() {
    let settings = RdpSettings {
        display: RdpDisplay::Fullscreen,
        multimon: true,
        share_home: true,
        cert_policy: RdpCertPolicy::Tofu,
        domain: Some("CORP".into()),
        extra_args: vec!["+fonts".into()],
        ..RdpSettings::default()
    };
    let args = build_args(&endpoint(), &settings, &admin()).unwrap();
    assert!(args.lines().all(|line| !line.is_empty()));
    let text = args.stdin_text();
    assert!(text.ends_with('\n'));
    assert!(
        !text.contains("\n\n"),
        "an empty line stops FreeRDP's reading"
    );
    assert_eq!(text.lines().count(), args.lines().count());
}

#[test]
fn a_control_character_anywhere_is_refused_without_echoing_it() {
    let line_break = RdpCredentials {
        username: Some("admin".into()),
        password: Some(SecretValue::new("pw\n/v:evil.example")),
    };
    let error = build_args(&endpoint(), &RdpSettings::default(), &line_break).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert!(error.message.starts_with("password"), "{}", error.message);
    assert!(!error.message.contains("evil"), "S7: {}", error.message);

    let user = RdpCredentials {
        username: Some("ad\rmin".into()),
        password: None,
    };
    assert!(build_args(&endpoint(), &RdpSettings::default(), &user).is_err());

    let domain = RdpSettings {
        domain: Some("CO\tRP".into()),
        ..RdpSettings::default()
    };
    assert!(build_args(&endpoint(), &domain, &RdpCredentials::default()).is_err());

    let host = RdpEndpoint {
        host: "10.0.0.5\n/p:x",
        ..endpoint()
    };
    assert!(build_args(&host, &RdpSettings::default(), &RdpCredentials::default()).is_err());

    let name = RdpEndpoint {
        name: "ad\u{7}01",
        ..endpoint()
    };
    assert!(build_args(&name, &RdpSettings::default(), &RdpCredentials::default()).is_err());
}

#[test]
fn reserved_extra_arguments_are_refused_again() {
    for reserved in [
        "/p:other",
        "/V:evil:3389",
        "/args-from:stdin",
        "/cert:ignore",
    ] {
        let settings = RdpSettings {
            extra_args: vec![reserved.into()],
            ..RdpSettings::default()
        };
        let error = build_args(&endpoint(), &settings, &RdpCredentials::default()).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Validation, "{reserved}");
    }
}

#[test]
fn debug_never_shows_the_password() {
    let args = build_args(&endpoint(), &RdpSettings::default(), &admin()).unwrap();
    let shown = format!("{args:?}");
    assert!(!shown.contains("s3cret"), "{shown}");
    assert!(shown.contains("/p:***"), "{shown}");
    assert!(shown.contains("/u:admin"), "{shown}");
}
```

### `src-tauri/src/rdp/detect_tests.rs` (nouveau)

```rust
use std::ffi::OsString;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::time::Duration;

use super::detect::{RdpFlavor, candidates, detect, flavor_of, parse_version};
use crate::error::ErrorKind;

const QUICK: Duration = Duration::from_secs(5);

/// A fake client in `dir` that prints `output` for `--version`.
fn fake(dir: &Path, name: &str, output: &str) -> PathBuf {
    let path = dir.join(name);
    std::fs::write(&path, format!("#!/bin/sh\necho '{output}'\n")).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

fn v3(dir: &Path, name: &str) -> PathBuf {
    fake(dir, name, "This is FreeRDP version 3.10.3 (3.10.3)")
}

fn path_of(dirs: &[&Path]) -> OsString {
    std::env::join_paths(dirs).unwrap()
}

#[test]
fn versions_are_read_from_the_usual_banner_and_only_3_x_is_kept() {
    assert_eq!(
        parse_version("This is FreeRDP version 3.10.3 (3.10.3)").as_deref(),
        Some("3.10.3")
    );
    assert_eq!(
        parse_version("[12:00] warn\nThis is FreeRDP version 3.5.1 (git abc)\n").as_deref(),
        Some("3.5.1")
    );
    assert_eq!(
        parse_version("This is FreeRDP version 2.11.7 (2.11.7)"),
        None
    );
    assert_eq!(parse_version("This is FreeRDP version 30.1.0"), None);
    assert_eq!(parse_version("This is FreeRDP version 3"), None);
    assert_eq!(parse_version("rdesktop 1.9"), None);
    assert_eq!(parse_version(""), None);
}

#[test]
fn the_flavor_comes_from_the_file_name() {
    assert_eq!(
        flavor_of(Path::new("/usr/bin/sdl-freerdp3")),
        Some(RdpFlavor::Sdl)
    );
    assert_eq!(
        flavor_of(Path::new("/usr/bin/sdl-freerdp")),
        Some(RdpFlavor::Sdl)
    );
    assert_eq!(
        flavor_of(Path::new("/usr/bin/xfreerdp3")),
        Some(RdpFlavor::X11)
    );
    assert_eq!(
        flavor_of(Path::new("/usr/bin/wlfreerdp")),
        Some(RdpFlavor::Wayland)
    );
    assert_eq!(flavor_of(Path::new("/opt/rdp/my-wrapper")), None);
}

#[test]
fn candidates_follow_the_name_order_then_the_path_order() {
    let a = tempfile::tempdir().unwrap();
    let b = tempfile::tempdir().unwrap();
    let x_in_a = v3(a.path(), "xfreerdp3");
    let sdl_in_b = v3(b.path(), "sdl-freerdp");
    let sdl3_in_b = v3(b.path(), "sdl-freerdp3");
    let sdl3_in_a = v3(a.path(), "sdl-freerdp3");
    // Not executable: skipped.
    let wl = a.path().join("wlfreerdp3");
    std::fs::write(&wl, "#!/bin/sh\n").unwrap();
    std::fs::set_permissions(&wl, std::fs::Permissions::from_mode(0o644)).unwrap();

    assert_eq!(
        candidates(&path_of(&[a.path(), b.path()])),
        [sdl3_in_a, sdl3_in_b, sdl_in_b, x_in_a]
    );
}

#[tokio::test]
async fn the_first_3_x_client_wins_and_older_ones_are_skipped() {
    let dir = tempfile::tempdir().unwrap();
    fake(
        dir.path(),
        "sdl-freerdp3",
        "This is FreeRDP version 2.11.7 (2.11.7)",
    );
    let x = v3(dir.path(), "xfreerdp3");
    v3(dir.path(), "wlfreerdp3");

    let client = detect(None, &path_of(&[dir.path()]), QUICK).await.unwrap();
    assert_eq!(client.path, x.to_string_lossy());
    assert_eq!(client.version, "3.10.3");
    assert_eq!(client.flavor, RdpFlavor::X11);
}

#[tokio::test]
async fn nothing_on_the_path_is_a_missing_client() {
    let empty = tempfile::tempdir().unwrap();
    let error = detect(None, &path_of(&[empty.path()]), QUICK)
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::RdpClientMissing);

    let error = detect(None, &OsString::new(), QUICK).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::RdpClientMissing);
}

#[tokio::test]
async fn a_forced_path_is_the_only_one_tried() {
    let dir = tempfile::tempdir().unwrap();
    v3(dir.path(), "sdl-freerdp3");
    let wrapper = v3(dir.path(), "my-rdp");

    let client = detect(
        Some(&wrapper.to_string_lossy()),
        &path_of(&[dir.path()]),
        QUICK,
    )
    .await
    .unwrap();
    assert_eq!(client.path, wrapper.to_string_lossy());
    // An unknown name is taken for an SDL client.
    assert_eq!(client.flavor, RdpFlavor::Sdl);
}

#[tokio::test]
async fn a_forced_path_that_is_not_a_3_x_client_is_refused_even_with_one_on_the_path() {
    let dir = tempfile::tempdir().unwrap();
    v3(dir.path(), "sdl-freerdp3");
    let old = fake(
        dir.path(),
        "xfreerdp",
        "This is FreeRDP version 2.11.7 (2.11.7)",
    );
    let path = path_of(&[dir.path()]);

    let error = detect(Some(&old.to_string_lossy()), &path, QUICK)
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::RdpClientMissing);

    let missing = dir.path().join("nope");
    let error = detect(Some(&missing.to_string_lossy()), &path, QUICK)
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::RdpClientMissing);
}

#[tokio::test]
async fn a_client_that_hangs_is_given_up_on() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("sdl-freerdp3");
    std::fs::write(&path, "#!/bin/sh\nsleep 30\n").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    let x = v3(dir.path(), "xfreerdp3");

    let started = std::time::Instant::now();
    let client = detect(None, &path_of(&[dir.path()]), Duration::from_millis(300))
        .await
        .unwrap();
    assert_eq!(client.path, x.to_string_lossy());
    assert!(
        started.elapsed() < Duration::from_secs(5),
        "{:?}",
        started.elapsed()
    );
}
```

### `src-tauri/src/commands/ipc_rdp_tests.rs` (nouveau)

```rust
use serde_json::json;

use super::ipc_tests::{invoke, mock_app};

#[test]
fn rdp_detect_takes_no_argument() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    // Either a client is installed on this machine, or none is: the arguments were read either way.
    match invoke(&webview, "rdp_detect", json!({})) {
        Ok(client) => assert!(client["version"].as_str().unwrap().starts_with("3.")),
        Err(error) => assert_eq!(error["kind"], "rdpClientMissing"),
    }
}
```

### `src/lib/mock/rdp.test.ts` (nouveau)

```ts
// T27: the mock's FreeRDP client, as the UI of T28 and T31 will see it in the browser.
import { beforeEach, describe, expect, test } from "vitest";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";

beforeEach(() => {
  resetMockBackend();
});

async function forceClientPath(clientPath: string | null) {
  const settings = await ipc.settingsGet();
  await ipc.settingsUpdate({ ...settings, rdp: { ...settings.rdp, clientPath } });
}

describe("mock rdp_detect", () => {
  test("a FreeRDP 3 SDL client is installed by default", async () => {
    expect(await ipc.rdpDetect()).toEqual({
      path: "/usr/bin/sdl-freerdp3",
      version: "3.10.3",
      flavor: "sdl",
    });
  });

  test("a forced FreeRDP path is used as is", async () => {
    await forceClientPath("/opt/freerdp/bin/xfreerdp3");
    expect(await ipc.rdpDetect()).toEqual({
      path: "/opt/freerdp/bin/xfreerdp3",
      version: "3.10.3",
      flavor: "x11",
    });
  });

  test("a forced path that is not FreeRDP is a missing client", async () => {
    await forceClientPath("/usr/bin/rdesktop");
    try {
      await ipc.rdpDetect();
    } catch (error) {
      expect(toAppError(error).kind).toBe("rdpClientMissing");
      return;
    }
    throw new Error("expected rdpClientMissing");
  });
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T27`.
2. `Cargo.toml` (`process`), `model/mod.rs` (réexport), `rdp/mod.rs`, `rdp/detect.rs` :
   `cd src-tauri && cargo test --lib rdp::detect` jusqu'au vert.
3. `rdp/args.rs` : `cargo test --lib rdp::args` jusqu'au vert.
4. `commands/rdp.rs`, `commands/mod.rs`, `lib.rs` : `cargo test --lib commands::ipc_rdp`, puis `npm run bindings`.
5. `ipc.ts`, `lib/mock/rdp.ts`, `ipc-mock.ts` : `npx vitest run src/lib`.
6. `npm run format`, `npm run review`, cases, statut, commit
   `feat: FreeRDP 3 client detection and argument builder (T27)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T27 --check` affiche `OK` partout.
- [ ] `grep -n '"/gateway"\|"/args-from"' src-tauri/src/rdp/args.rs` ne trouve rien (la liste des arguments
      réservés reste dans `model/validate_args.rs`).
- [ ] `grep -rn "derive(.*Debug" src-tauri/src/rdp/args.rs` ne montre pas `RdpArgs`.
- [ ] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

Rien à l'écran. Si FreeRDP est installé sur ta machine (`sdl-freerdp3 --version`), la vraie app saura le trouver
dès T28.
