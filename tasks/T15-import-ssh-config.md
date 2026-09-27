# T15 — Import `~/.ssh/config` : parseur, aperçu et application (backend + mock)

| | |
|---|---|
| **Jalon** | M1 — Connexions |
| **Dépend de** | T12 (réutilise les helpers de `commands/ipc_tests.rs`) |
| **Lire avant** | `docs/04-ecrans.md` §11, `docs/06-securite.md` S12, `docs/05-modele-donnees.md` §2 |
| **Livrable** | Module `import/` (parseur pur + plan d'import), 2 commandes, `ipc.ts` et mock ; 15 + 11 tests Rust, 3 tests IPC, 5 tests TS verts. Le dialogue vient en T15b |

## Pourquoi

Presque tout utilisateur de SSH a déjà un `~/.ssh/config`. L'importer évite de ressaisir ses machines, bastions compris.
Deux règles de sécurité : on **n'exécute rien** (S12) et on ne fait pas confiance à ce que renvoie l'interface :
l'application relit et réanalyse le fichier elle-même.

## Contrat — Rust

Module `src-tauri/src/import/` (`pub mod import;` dans `lib.rs`) : `mod.rs` déclare `pub mod ssh_config;` et
`pub mod plan;`, plus `#[cfg(test)] mod ssh_config_tests;` et `#[cfg(test)] mod plan_tests;`.

### `import/ssh_config.rs` — parseur pur (aucun accès disque)

```rust
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SshConfigHost {
    pub alias: String,                 // a concrete name from a `Host` line
    pub host_name: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>, // as written, `~` kept
    pub proxy_jump: Vec<String>,       // hops as written; `none` → empty
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedSshConfig {
    pub hosts: Vec<SshConfigHost>,
    pub warnings: Vec<String>,         // file-level warnings
}

/// `include` gets an `Include` argument as written and returns the matching files, as (path, text).
pub fn parse_ssh_config(text: &str, include: &dyn Fn(&str) -> Vec<(String, String)>) -> ParsedSshConfig;
/// OpenSSH host pattern list: `*` and `?` wildcards, `!` negation, ASCII case-insensitive.
/// False as soon as a negated pattern matches; otherwise true if a positive pattern matches.
pub fn host_pattern_matches(patterns: &[String], alias: &str) -> bool;
```

Règles (celles d'OpenSSH, simplifiées) :
- Ligne vide ou qui commence par `#` (après les espaces) : ignorée. Mot-clé insensible à la casse, séparé de sa valeur
  par des espaces et/ou un `=`. Une valeur entre guillemets `"…"` perd ses guillemets.
- `Host p1 p2 …` ouvre un bloc. Les **alias** sont les motifs sans `*`, `?` ni `!`, dans l'ordre de première
  apparition, sans doublon. Les options écrites avant le premier `Host` / `Match` s'appliquent à tous.
- `Match …` ouvre un bloc qu'on n'évalue pas : ses options sont ignorées, avec **un** avertissement de fichier
  `"Match blocks are ignored"`.
- Pour chaque alias : on parcourt tous les blocs dans l'ordre du fichier ; ceux dont les motifs correspondent
  (`host_pattern_matches`) s'appliquent ; pour chaque option, **la première valeur rencontrée gagne**.
- Options lues : `HostName`, `User`, `Port`, `IdentityFile` (la première), `ProxyJump` (virgules, espaces retirés).
  - `HostName` : `%h` → l'alias, `%%` → `%`. Tout autre `%x` reste tel quel, avec l'avertissement d'hôte
    `"HostName tokens other than %h are not supported"`.
  - `Port` invalide (hors 1–65535) : `None`, avertissement `"invalid Port: <valeur>"`.
- Options signalées, jamais appliquées (S12) : `ProxyCommand`, `LocalCommand`, `RemoteCommand`, `KnownHostsCommand`,
  `LocalForward`, `RemoteForward`, `DynamicForward`. Avertissement d'hôte `"<Mot-clé> is ignored"`, écrit avec la casse
  de cette liste, **une fois** par hôte, dans l'ordre de première rencontre. Tout autre mot-clé est ignoré en silence.
- `Include arg…` : chaque argument passe à `include`, et le texte des fichiers renvoyés est traité **à cet endroit**,
  comme s'il y était écrit. Profondeur maximale 8 : au-delà, avertissement de fichier
  `"Include nested too deeply: <arg>"` et on n'inclut pas.

### `import/plan.rs` — aperçu et application (purs)

```rust
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(tag = "type", rename_all = "camelCase", rename_all_fields = "camelCase")]
#[ts(export)]
pub enum ImportJump {
    Candidate { alias: String },          // another host of the same file
    Existing { id: Uuid, name: String },  // a TunL connection that already exists
    Unresolved { hop: String },
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportCandidate {
    pub alias: String,
    pub host: String,              // host_name, or the alias
    pub port: u16,                 // or 22
    pub username: Option<String>,
    pub key_path: Option<String>,
    pub jump: Option<ImportJump>,
    pub duplicate_of: Option<Uuid>,
    pub warnings: Vec<String>,
    pub error: Option<String>,     // not importable; the UI never lets it be selected
}

#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct ImportPreview { pub path: String, pub candidates: Vec<ImportCandidate>, pub warnings: Vec<String> }

pub fn build_candidates(parsed: &ParsedSshConfig, store: &Store) -> Vec<ImportCandidate>;
pub fn apply_import(
    store: &Store, candidates: &[ImportCandidate], selected: &[String],
    group_id: Option<Uuid>, now_ms: i64, new_id: impl FnMut() -> Uuid,
) -> AppResult<(Store, Vec<Connection>)>;
```

`build_candidates`, un candidat par hôte, dans l'ordre :
- `warnings` commence par ceux de l'hôte.
- `duplicate_of` : une connexion existante de même `host` (sans tenir compte de la casse), même `port`, même `username`.
- `error` : le `ConnectionInput` que l'import créerait (voir plus bas, sans bastion ni groupe) passé à
  `normalize_connection_input` ; en cas d'échec, son `message` (par exemple `"host: …"`).
- `jump` : seulement le **dernier** saut de `proxy_jump`. S'il y en a plusieurs : avertissement
  `"only the last ProxyJump hop is used"`. Le saut `[user@]hôte[:port]` se résout ainsi :
  1. sans `user@` ni `:port`, égal à l'alias d'un **autre** candidat → `Candidate`, ou `Existing` si ce candidat a un
     `duplicate_of` (nom = celui de la connexion existante) ;
  2. une connexion **SSH** existante dont le `name`, ou le `host` (et le port, s'il est donné), est égal au saut →
     `Existing` ;
  3. sinon `Unresolved`, et l'avertissement `"jump host <saut> not found"`.

`apply_import` :
- ne crée que les alias de `selected` qui existent et n'ont pas d'`error` (les autres sont ignorés en silence) ;
- `ConnectionInput::template(Protocol::Ssh)` avec `name` = alias, `host`, `port`, `username`, `group_id`, et
  `SshAuth::Key { path }` si `key_path`, sinon `SshAuth::Agent` ;
- bastion : `Existing` → son id ; `Candidate` → l'id de la connexion créée pour ce candidat s'il est sélectionné,
  sinon aucun ; `Unresolved` → aucun ;
- un bastion est **créé avant** les connexions qui passent par lui. Un cycle entre candidats (a par b, b par a) :
  l'arête qui fermerait le cycle est abandonnée, la connexion est créée sans bastion ;
- chaque création passe par `Store::create_connection` (T08), donc par la validation ; le store d'origine n'est
  jamais modifié.

### Commandes : `src-tauri/src/commands/import.rs`

| Commande | Arguments (JS) | Retour |
|---|---|---|
| `import_ssh_config_preview` | `{ path }` (`string \| null`) | `ImportPreview` |
| `import_ssh_config_apply` | `{ path, aliases, groupId }` | `StoreSnapshot` |

- `path: Option<String>` : `None` → `~/.ssh/config` (`std::env::home_dir()`). Un chemin donné doit être absolu, sinon
  `AppError::validation("path", "must be absolute")`. L'interface passe toujours `null` ; les tests passent un fichier
  temporaire.
- Fichier absent → `AppError::not_found("ssh config <chemin>")`. Plus de 1 Mio → `validation("path", "file is too large")`.
- `include` : un argument relatif part de `~/.ssh/` ; `~/` est développé ; `*` et `?` sont permis **dans le dernier
  composant seulement** ; fichiers triés par nom, chacun limité à 1 Mio, les illisibles ignorés.
- `ImportPreview.path` : le chemin lu, avec le dossier personnel remplacé par `~`.
- `apply` relit et réanalyse le fichier, reconstruit les candidats avec le store courant, puis
  `state.mutate(|store| apply_import(…))`. `log::info!` du nombre créé, jamais le contenu du fichier.
- Les deux commandes rejoignent `invoke_handler()`.

## Contrat — TypeScript

- `ipc.ts` : `importSshConfigPreview(path: string | null)`, `importSshConfigApply(path: string | null, aliases: string[], groupId: string | null)`.
- Mock `src/lib/mock/import.ts`, branché dans `HANDLERS`. L'aperçu est **fixe** (`path: "~/.ssh/config"`, `warnings: []`) :

| alias | host | port | username | keyPath | jump | duplicateOf | warnings | error |
|---|---|---|---|---|---|---|---|---|
| staging | 10.2.0.10 | 22 | deploy | ~/.ssh/id_ed25519 | candidate `jump-box` | — | — | — |
| jump-box | 203.0.113.7 | 2222 | ops | — | — | — | — | — |
| web-01 | 10.0.0.12 | 22 | deploy | — | — | `MOCK_IDS.web01` | — | — |
| legacy | legacy.internal | 22 | root | — | — | — | `ProxyCommand is ignored` | — |
| broken | under_score! | 22 | — | — | — | — | — | `host: must be a valid IPv4, IPv6 address or host name` |

  L'application du mock suit les règles d'`apply_import` : ids neufs, bastion `Candidate` relié seulement s'il est
  sélectionné, `broken` jamais créé. Elle renvoie le snapshot.

### Pièges

- `&dyn Fn(&str) -> Vec<(String, String)>` : dans les tests, une fermeture `|arg: &str| …` s'y convertit toute seule.
- Aucun `unwrap()` sur une ligne du fichier : un `~/.ssh/config` étrange ne doit jamais faire paniquer TunL.
- Le texte du fichier ne va jamais dans un log ni dans un message d'erreur (S7, S8).

## Tests du contrat

### `src-tauri/src/import/ssh_config_tests.rs`

```rust
use super::ssh_config::{ParsedSshConfig, SshConfigHost, host_pattern_matches, parse_ssh_config};

fn no_include(_: &str) -> Vec<(String, String)> {
    Vec::new()
}

fn parse(text: &str) -> ParsedSshConfig {
    parse_ssh_config(text, &no_include)
}

fn host<'a>(parsed: &'a ParsedSshConfig, alias: &str) -> &'a SshConfigHost {
    parsed
        .hosts
        .iter()
        .find(|host| host.alias == alias)
        .unwrap_or_else(|| panic!("no host {alias}"))
}

fn aliases(parsed: &ParsedSshConfig) -> Vec<&str> {
    parsed.hosts.iter().map(|host| host.alias.as_str()).collect()
}

#[test]
fn reads_the_basic_options() {
    let parsed = parse("Host web\n  HostName 10.0.0.12\n  User deploy\n  Port 2222\n  IdentityFile ~/.ssh/id_web\n");
    let web = host(&parsed, "web");
    assert_eq!(web.host_name.as_deref(), Some("10.0.0.12"));
    assert_eq!(web.user.as_deref(), Some("deploy"));
    assert_eq!(web.port, Some(2222));
    assert_eq!(web.identity_file.as_deref(), Some("~/.ssh/id_web"));
    assert!(web.proxy_jump.is_empty());
    assert!(web.warnings.is_empty());
    assert!(parsed.warnings.is_empty());
}

#[test]
fn keywords_ignore_case_and_accept_equals() {
    let parsed = parse("host a\n  hostname=10.0.0.1\n  USER = root\n  port\t22\n");
    let a = host(&parsed, "a");
    assert_eq!(a.host_name.as_deref(), Some("10.0.0.1"));
    assert_eq!(a.user.as_deref(), Some("root"));
    assert_eq!(a.port, Some(22));
}

#[test]
fn comments_blank_lines_and_quotes() {
    let parsed = parse("# my hosts\n\n   # indented comment\nHost a\n  IdentityFile \"~/.ssh/my key\"\n");
    assert_eq!(host(&parsed, "a").identity_file.as_deref(), Some("~/.ssh/my key"));
}

#[test]
fn several_aliases_on_one_line() {
    let parsed = parse("Host a b\n  User x\nHost a\n");
    assert_eq!(aliases(&parsed), ["a", "b"]);
    assert_eq!(host(&parsed, "b").user.as_deref(), Some("x"));
}

#[test]
fn wildcard_blocks_are_not_hosts_but_apply_to_matching_ones() {
    let parsed = parse(
        "Host *.corp\n  User corp\nHost db.corp\n  HostName 10.1.1.1\nHost *\n  User fallback\n  Port 2200\nHost lab\n",
    );
    assert_eq!(aliases(&parsed), ["db.corp", "lab"]);
    let db = host(&parsed, "db.corp");
    assert_eq!(db.user.as_deref(), Some("corp"));
    assert_eq!(db.port, Some(2200));
    assert_eq!(host(&parsed, "lab").user.as_deref(), Some("fallback"));
}

#[test]
fn the_first_value_wins() {
    let parsed = parse("Host a\n  User first\nHost a\n  User second\n  Port 2022\n");
    assert_eq!(parsed.hosts.len(), 1);
    assert_eq!(host(&parsed, "a").user.as_deref(), Some("first"));
    assert_eq!(host(&parsed, "a").port, Some(2022));
}

#[test]
fn options_before_any_host_apply_to_all() {
    let parsed = parse("User everyone\nHost a\nHost b\n  User bee\n");
    assert_eq!(host(&parsed, "a").user.as_deref(), Some("everyone"));
    assert_eq!(host(&parsed, "b").user.as_deref(), Some("everyone"));
}

#[test]
fn host_patterns() {
    let all_but_secret = vec!["*".to_string(), "!secret".to_string()];
    assert!(host_pattern_matches(&all_but_secret, "web"));
    assert!(!host_pattern_matches(&all_but_secret, "secret"));
    assert!(host_pattern_matches(&["web?".to_string()], "web1"));
    assert!(!host_pattern_matches(&["web?".to_string()], "web10"));
    assert!(host_pattern_matches(&["WEB".to_string()], "web"));
    assert!(!host_pattern_matches(&["!web".to_string()], "db"));
}

#[test]
fn proxy_jump_hops_and_none() {
    let parsed = parse("Host a\n  ProxyJump j1, j2\nHost b\n  ProxyJump none\n");
    assert_eq!(host(&parsed, "a").proxy_jump, ["j1", "j2"]);
    assert!(host(&parsed, "b").proxy_jump.is_empty());
}

#[test]
fn hostname_tokens() {
    let parsed = parse("Host a\n  HostName %h.example.com\nHost b\n  HostName %h-%p\nHost c\n  HostName 100%%\n");
    assert_eq!(host(&parsed, "a").host_name.as_deref(), Some("a.example.com"));
    assert!(host(&parsed, "a").warnings.is_empty());
    assert_eq!(host(&parsed, "b").host_name.as_deref(), Some("b-%p"));
    assert_eq!(host(&parsed, "b").warnings, ["HostName tokens other than %h are not supported"]);
    assert_eq!(host(&parsed, "c").host_name.as_deref(), Some("100%"));
}

#[test]
fn ignored_options_are_flagged_once_each() {
    let parsed = parse(
        "Host *\n  LocalCommand echo hi\nHost a\n  ProxyCommand nc %h %p\n  LocalForward 8080 localhost:80\n  LocalForward 8081 localhost:81\n",
    );
    assert_eq!(
        host(&parsed, "a").warnings,
        ["LocalCommand is ignored", "ProxyCommand is ignored", "LocalForward is ignored"]
    );
}

#[test]
fn match_blocks_are_skipped_with_one_warning() {
    let parsed = parse("Match exec \"true\"\n  User evil\nMatch host x\n  User evil2\nHost a\n");
    assert_eq!(host(&parsed, "a").user, None);
    assert_eq!(parsed.warnings, ["Match blocks are ignored"]);
}

#[test]
fn an_invalid_port_is_reported() {
    let parsed = parse("Host a\n  Port 99999\n");
    assert_eq!(host(&parsed, "a").port, None);
    assert_eq!(host(&parsed, "a").warnings, ["invalid Port: 99999"]);
}

#[test]
fn includes_are_inlined_where_they_appear() {
    let include = |arg: &str| {
        if arg == "conf.d/*" {
            vec![("~/.ssh/conf.d/a".to_string(), "Host inc\n  User included\n".to_string())]
        } else {
            Vec::new()
        }
    };
    let parsed = parse_ssh_config("Include conf.d/*\nHost main\n", &include);
    assert_eq!(aliases(&parsed), ["inc", "main"]);
    assert_eq!(host(&parsed, "inc").user.as_deref(), Some("included"));
}

#[test]
fn include_recursion_is_bounded() {
    let include = |_: &str| vec![("loop".to_string(), "Include loop\n".to_string())];
    let parsed = parse_ssh_config("Include loop\nHost a\n", &include);
    assert_eq!(aliases(&parsed), ["a"]);
    assert_eq!(parsed.warnings, ["Include nested too deeply: loop"]);
}
```

### `src-tauri/src/import/plan_tests.rs`

```rust
use uuid::Uuid;

use super::plan::{ImportJump, apply_import, build_candidates};
use super::ssh_config::{ParsedSshConfig, parse_ssh_config};
use crate::model::{ConnectionInput, GroupInput, Protocol, ProtocolSettings, SshAuth};
use crate::store::Store;

fn parsed(text: &str) -> ParsedSshConfig {
    parse_ssh_config(text, &|_: &str| Vec::new())
}

fn with_existing(store: &Store, name: &str, host: &str, username: Option<&str>) -> (Store, Uuid) {
    let id = Uuid::new_v4();
    let input = ConnectionInput {
        name: name.into(),
        host: host.into(),
        username: username.map(Into::into),
        ..ConnectionInput::template(Protocol::Ssh)
    };
    let (next, _) = store.create_connection(&input, id, 1).unwrap();
    (next, id)
}

fn selected(aliases: &[&str]) -> Vec<String> {
    aliases.iter().map(|alias| alias.to_string()).collect()
}

fn ssh_auth(settings: &ProtocolSettings) -> &SshAuth {
    match settings {
        ProtocolSettings::Ssh(ssh) => &ssh.auth,
        ProtocolSettings::Rdp(_) => panic!("expected SSH"),
    }
}

#[test]
fn candidates_take_defaults_and_keep_the_file_order() {
    let candidates = build_candidates(&parsed("Host b\n  HostName 10.0.0.2\nHost a\n"), &Store::default());
    let names: Vec<&str> = candidates.iter().map(|c| c.alias.as_str()).collect();
    assert_eq!(names, ["b", "a"]);
    let a = &candidates[1];
    assert_eq!((a.host.as_str(), a.port), ("a", 22));
    assert_eq!((a.username.clone(), a.key_path.clone()), (None, None));
    assert_eq!((a.jump.clone(), a.duplicate_of, a.error.clone()), (None, None, None));
}

#[test]
fn a_known_host_is_a_duplicate() {
    let (store, id) = with_existing(&Store::default(), "web", "Web.Example.com", Some("deploy"));
    let candidates = build_candidates(
        &parsed("Host w\n  HostName web.example.com\n  User deploy\nHost w2\n  HostName web.example.com\n  User other\n"),
        &store,
    );
    assert_eq!(candidates[0].duplicate_of, Some(id));
    assert_eq!(candidates[1].duplicate_of, None);
}

#[test]
fn jumps_resolve_to_candidates_then_existing_connections() {
    let (store, id) = with_existing(&Store::default(), "bastion-prod", "203.0.113.1", None);
    let candidates = build_candidates(
        &parsed(
            "Host jump\n  HostName 10.0.0.1\nHost a\n  ProxyJump jump\nHost b\n  ProxyJump bastion-prod\nHost c\n  ProxyJump ops@203.0.113.1:22\nHost d\n  ProxyJump nowhere\n",
        ),
        &store,
    );
    let existing = ImportJump::Existing { id, name: "bastion-prod".into() };
    assert_eq!(candidates[1].jump, Some(ImportJump::Candidate { alias: "jump".into() }));
    assert_eq!(candidates[2].jump, Some(existing.clone()));
    assert_eq!(candidates[3].jump, Some(existing));
    assert_eq!(candidates[4].jump, Some(ImportJump::Unresolved { hop: "nowhere".into() }));
    assert_eq!(candidates[4].warnings, ["jump host nowhere not found"]);
}

#[test]
fn a_jump_through_a_duplicate_uses_the_existing_connection() {
    let (store, id) = with_existing(&Store::default(), "bastion", "10.0.0.1", None);
    let candidates = build_candidates(&parsed("Host jb\n  HostName 10.0.0.1\nHost app\n  ProxyJump jb\n"), &store);
    assert_eq!(candidates[0].duplicate_of, Some(id));
    assert_eq!(candidates[1].jump, Some(ImportJump::Existing { id, name: "bastion".into() }));
}

#[test]
fn only_the_last_hop_is_kept() {
    let candidates = build_candidates(&parsed("Host j1\nHost j2\nHost app\n  ProxyJump j1,j2\n"), &Store::default());
    assert_eq!(candidates[2].jump, Some(ImportJump::Candidate { alias: "j2".into() }));
    assert!(candidates[2].warnings.contains(&"only the last ProxyJump hop is used".to_string()));
}

#[test]
fn invalid_hosts_get_an_error_and_are_never_imported() {
    let candidates = build_candidates(
        &parsed("Host ok\n  HostName 10.0.0.1\nHost bad\n  HostName under_score!\n"),
        &Store::default(),
    );
    assert_eq!(candidates[0].error, None);
    assert!(candidates[1].error.as_deref().unwrap().starts_with("host:"));
    let (store, created) =
        apply_import(&Store::default(), &candidates, &selected(&["ok", "bad"]), None, 5, Uuid::new_v4).unwrap();
    assert_eq!(created.len(), 1);
    assert_eq!(store.connections.len(), 1);
}

#[test]
fn apply_creates_jump_hosts_first_and_links_them() {
    let config = "Host app\n  HostName 10.0.0.2\n  User deploy\n  IdentityFile ~/.ssh/id_app\n  ProxyJump jump\nHost jump\n  HostName 10.0.0.1\n";
    let candidates = build_candidates(&parsed(config), &Store::default());
    let original = Store::default();
    let (store, created) =
        apply_import(&original, &candidates, &selected(&["app", "jump"]), None, 5, Uuid::new_v4).unwrap();
    assert!(original.connections.is_empty());
    assert_eq!(store.connections.len(), 2);
    assert_eq!(created[0].name, "jump");
    let app = &created[1];
    assert_eq!(app.name, "app");
    assert_eq!(app.jump_host_id, Some(created[0].id));
    assert_eq!(app.username.as_deref(), Some("deploy"));
    assert_eq!(app.created_at, 5);
    assert_eq!(ssh_auth(&app.settings), &SshAuth::Key { path: "~/.ssh/id_app".into() });
    assert_eq!(ssh_auth(&created[0].settings), &SshAuth::Agent);
}

#[test]
fn apply_drops_a_jump_to_an_unselected_candidate() {
    let candidates = build_candidates(&parsed("Host app\n  ProxyJump jump\nHost jump\n"), &Store::default());
    let (_, created) = apply_import(&Store::default(), &candidates, &selected(&["app"]), None, 5, Uuid::new_v4).unwrap();
    assert_eq!(created.len(), 1);
    assert_eq!(created[0].jump_host_id, None);
}

#[test]
fn apply_puts_everything_in_the_chosen_group() {
    let group_id = Uuid::new_v4();
    let (store, _) = Store::default()
        .create_group(&GroupInput { name: "Imported".into(), color: None }, group_id)
        .unwrap();
    let candidates = build_candidates(&parsed("Host a\nHost b\n"), &store);
    let (_, created) = apply_import(&store, &candidates, &selected(&["a", "b"]), Some(group_id), 5, Uuid::new_v4).unwrap();
    assert!(created.iter().all(|connection| connection.group_id == Some(group_id)));
}

#[test]
fn apply_breaks_a_jump_cycle() {
    let candidates = build_candidates(&parsed("Host a\n  ProxyJump b\nHost b\n  ProxyJump a\n"), &Store::default());
    let (_, created) = apply_import(&Store::default(), &candidates, &selected(&["a", "b"]), None, 5, Uuid::new_v4).unwrap();
    assert_eq!(created.len(), 2);
    let with_jump = created.iter().filter(|connection| connection.jump_host_id.is_some()).count();
    assert_eq!(with_jump, 1);
}

#[test]
fn apply_ignores_unknown_aliases() {
    let candidates = build_candidates(&parsed("Host a\n"), &Store::default());
    let (store, created) = apply_import(&Store::default(), &candidates, &selected(&["ghost"]), None, 5, Uuid::new_v4).unwrap();
    assert!(created.is_empty());
    assert!(store.connections.is_empty());
}
```

### `src-tauri/src/commands/ipc_import_tests.rs` (déclaré dans `commands/mod.rs` par `#[cfg(test)] mod ipc_import_tests;`)

```rust
use serde_json::json;

use super::ipc_tests::{invoke, mock_app, ok};

const CONFIG: &str = "Host bastion\n  HostName 10.0.0.1\n  User ops\nHost app\n  HostName 10.0.0.2\n  ProxyJump bastion\n";

#[test]
fn import_commands_accept_the_arguments_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let config = dir.path().join("ssh_config");
    std::fs::write(&config, CONFIG).unwrap();
    let path = config.to_str().unwrap();

    let preview = ok(&webview, "import_ssh_config_preview", json!({ "path": path }));
    assert_eq!(preview["candidates"].as_array().unwrap().len(), 2);
    assert_eq!(preview["candidates"][1]["jump"], json!({ "type": "candidate", "alias": "bastion" }));

    let snapshot = ok(
        &webview,
        "import_ssh_config_apply",
        json!({ "path": path, "aliases": ["bastion", "app"], "groupId": null }),
    );
    let connections = snapshot["connections"].as_array().unwrap();
    assert_eq!(connections.len(), 2);
    let bastion = connections.iter().find(|c| c["name"] == "bastion").unwrap();
    let app = connections.iter().find(|c| c["name"] == "app").unwrap();
    assert_eq!(app["jumpHostId"], bastion["id"]);
}

#[test]
fn a_missing_config_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let path = dir.path().join("absent");
    let error = invoke(&webview, "import_ssh_config_preview", json!({ "path": path })).unwrap_err();
    assert_eq!(error["kind"], "notFound");
}

#[test]
fn a_relative_path_is_refused() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());
    let error = invoke(&webview, "import_ssh_config_preview", json!({ "path": "ssh_config" })).unwrap_err();
    assert_eq!(error["kind"], "validation");
}
```

### `src/lib/mock/import.test.ts`

```ts
import { beforeEach, expect, test } from "vitest";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { failNextCall, resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";

beforeEach(() => {
  resetMockBackend();
});

test("the preview lists the canned candidates", async () => {
  const preview = await ipc.importSshConfigPreview(null);
  expect(preview.path).toBe("~/.ssh/config");
  expect(preview.candidates.map((c) => c.alias)).toEqual(["staging", "jump-box", "web-01", "legacy", "broken"]);
  expect(preview.candidates.find((c) => c.alias === "web-01")?.duplicateOf).toBe(MOCK_IDS.web01);
  expect(preview.candidates.find((c) => c.alias === "staging")?.jump).toEqual({ type: "candidate", alias: "jump-box" });
});

test("apply creates the selected connections and links the jump host", async () => {
  const snapshot = await ipc.importSshConfigApply(null, ["staging", "jump-box"], MOCK_IDS.homelab);
  const staging = snapshot.connections.find((c) => c.name === "staging");
  const jump = snapshot.connections.find((c) => c.name === "jump-box");
  expect(staging?.jumpHostId).toBe(jump?.id);
  expect(staging?.groupId).toBe(MOCK_IDS.homelab);
  expect(jump?.port).toBe(2222);
  expect(staging?.settings).toMatchObject({ protocol: "ssh", auth: { method: "key", path: "~/.ssh/id_ed25519" } });
  expect(jump?.settings).toMatchObject({ protocol: "ssh", auth: { method: "agent" } });
});

test("a jump to an unselected candidate is dropped", async () => {
  const snapshot = await ipc.importSshConfigApply(null, ["staging"], null);
  expect(snapshot.connections.find((c) => c.name === "staging")?.jumpHostId).toBeNull();
});

test("a candidate with an error is never created", async () => {
  const before = (await ipc.storeLoad()).connections.length;
  const snapshot = await ipc.importSshConfigApply(null, ["broken"], null);
  expect(snapshot.connections.length).toBe(before);
});

test("a missing file can be simulated", async () => {
  failNextCall("import_ssh_config_preview", {
    kind: "notFound",
    message: "ssh config ~/.ssh/config not found",
    detail: null,
  });
  await expect(ipc.importSshConfigPreview(null).catch(toAppError)).resolves.toMatchObject({ kind: "notFound" });
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T15`.
2. `import/ssh_config.rs`, puis `cargo test import::ssh_config` jusqu'au vert.
3. `import/plan.rs`, puis `cargo test import::plan`.
4. `commands/import.rs`, `invoke_handler()`, `npm run bindings`, `npm run verify:rust`.
5. `ipc.ts` et le mock, puis `npx vitest run src/lib`.
6. `npm run format`, `npm run review`, cases, statut, commit `feat: import ~/.ssh/config, parser and commands (T15)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T15 --check` affiche `OK` partout.
- [ ] `grep -rn "Command::new\|std::process" src-tauri/src/import src-tauri/src/commands/import.rs` ne trouve rien (S12).
- [ ] Aucun fichier de `import/` ne dépasse 400 lignes.

## À regarder par Florian

Rien à l'écran : le dialogue d'import arrive en T15b, qui lira ton vrai `~/.ssh/config`.
