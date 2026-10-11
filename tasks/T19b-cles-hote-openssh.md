# T19b — Clés d'hôte : lecture de `known_hosts` comme OpenSSH, type de clé changé, clés révoquées

| | |
|---|---|
| **Jalon** | M2 — SSH |
| **Dépend de** | T19 |
| **Lire avant** | `docs/06-securite.md` S6 et S9, `docs/02-decisions.md` D10 |
| **Livrable** | `ssh/known_hosts_file.rs`, `ssh/known_hosts.rs` et `ssh/connect.rs` révisés, `HostKeyStatus::Revoked` ; règle `no-panic-in-app-code` élargie ; `up.sh` corrigé ; 4 fichiers de tests (dont 3 contre podman) |

## Pourquoi

La revue du lot 4 a trouvé des trous dans la confiance accordée aux clés d'hôte (T17, T17b). Tous vont dans le
mauvais sens : ils transforment un refus (S6) en simple question à l'utilisateur.

1. **Type de clé changé.** Un serveur enregistré en `ecdsa` qui présente une clé `ed25519` est classé *inconnu* :
   l'utilisateur voit « hôte inconnu, faire confiance ? » pour un hôte qu'il connaît déjà. Un attaquant au milieu n'a
   qu'à présenter un autre type de clé. OpenSSH l'évite en demandant d'abord les types déjà enregistrés.
2. **Lecture par russh** (`known_host_keys_path`) :
   - les lignes `@revoked` sont ignorées : une clé révoquée devient « inconnue » et peut être acceptée ;
   - une ligne illisible qui nomme l'hôte fait ignorer **tout** le fichier, donc aussi un changement de clé ;
   - les commentaires ne sont pas comptés dans les numéros de ligne : la « ligne N » affichée est fausse ;
   - pas de jokers (`*.lan`), pas de négation (`!`), pas de tabulation, et la casse des noms compte.
3. **Deux `unreachable!`** dans le code de l'app (`ssh/auth_secret.rs`, `ssh/session.rs`) : la règle
   `no-panic-in-app-code` ne les voyait pas.
4. **`scripts/test-env/up.sh`** : avec un umask `0002`, le dossier monté dans `/etc/ssh/tunl` est inscriptible par
   le groupe, et sshd (`StrictModes`) refuse alors toute authentification par clé.

Tout a été prototypé par l'orchestrateur contre les conteneurs de T16 : les tests de cette fiche passent.

## À réutiliser (ne pas réécrire)

- T17 : `KnownHosts` (`new`, `for_app`, `learn`), `host_pattern`, `fingerprint`, `write_error`, `HostKeyStatus`.
- T17b : `ClientHandler::check_server_key`, `client_config`, `handshake` ; `tests/support/mod.rs` (`TestEnv`,
  `blank_context`, `connect`, `respond`).
- russh : `russh::keys::ssh_key::known_hosts::{Entry, HostPatterns, Marker}` analyse **une** ligne (marqueur, motifs
  d'hôtes, clé). `russh::Preferred` (`Preferred::default().key` = l'ordre des types de clé de russh).
  `russh::keys::Algorithm`.

## Contrat — Rust

### Dépendances (`src-tauri/Cargo.toml`, section `[dependencies]`)

```toml
hmac = "0.13"
sha1 = "0.11"
```

Ce sont les versions que russh utilise déjà (`Cargo.lock`) : rien de neuf n'est téléchargé. Elles servent à
reconnaître les noms d'hôte hachés (`|1|sel|hash`, HMAC-SHA1), que Debian et Ubuntu écrivent par défaut
(`HashKnownHosts yes`). Aucune autre dépendance.

### `src-tauri/src/ssh/mod.rs`

Ajouter `pub mod known_hosts_file;`, et dans les modules de test `connect_tests` et `known_hosts_format_tests`
(`#[cfg(test)] mod …;`).

### `src-tauri/src/ssh/known_hosts_file.rs` (nouveau) : lire un fichier comme OpenSSH

```rust
/// One line of a file that names `(host, port)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostLine {
    pub line: usize,      // physical, 1-based: comments and blank lines count
    pub revoked: bool,    // `@revoked` marker
    pub key: PublicKey,
}

/// Every line naming `(host, port)`. A missing file gives nothing; an unreadable file logs and gives nothing.
pub fn host_lines(path: &Path, host: &str, port: u16) -> Vec<HostLine>;

/// OpenSSH matching of one line's host field against `(host, port)`.
pub fn matches_host(patterns: &HostPatterns, host: &str, port: u16) -> bool;
```

Comportement de `host_lines`, ligne par ligne (`text.lines().enumerate()`, numéro = index + 1) :
- ligne vide ou commençant par `#` (après `trim`) → ignorée, **mais comptée** ;
- sinon, réduire chaque suite d'espaces ou de tabulations à une seule espace, puis `parse::<Entry>()` ;
- ligne illisible → `log::warn!("{path}:{line}: unreadable line skipped")` et **seule cette ligne** est ignorée ;
- marqueur `@cert-authority` → ignorée (les certificats d'hôte restent refusés, T17b) ;
- marqueur `@revoked` → `revoked: true` ;
- garder la ligne si `matches_host(entry.host_patterns(), host, port)`.

Comportement de `matches_host` : le nom cherché est `host_pattern(&host.to_lowercase(), port)` (donc
`db.internal` ou `[db.internal]:2222`).
- `HostPatterns::HashedName { salt, hash }` : HMAC-SHA1 de ce nom avec la clé `salt`, comparé à `hash`.
- `HostPatterns::Patterns(list)` : chaque motif passe en minuscules ; `*` = n'importe quelle suite (même vide),
  `?` = un caractère. Si un motif `!motif` correspond → `false`, quoi que disent les autres. Sinon, `true` si au moins
  un motif positif correspond. Le motif porte sur le nom entier, crochets et port compris (`[10.0.0.?]:2222`).

### `src-tauri/src/ssh/known_hosts.rs` (révisé)

```rust
pub enum HostKeyStatus {
    Known,
    Unknown,
    Changed { path: PathBuf, line: usize, known_fingerprint: String, removable: bool },
    /// The key is listed as `@revoked`: refused whatever else the files say.
    Revoked { path: PathBuf, line: usize },
}

impl KnownHosts {
    pub fn check(&self, host: &str, port: u16, key: &PublicKey) -> HostKeyStatus;   // nouvelle règle, ci-dessous
    /// The key types recorded for `(host, port)` in both files (revoked lines aside), own file first, no duplicates.
    pub fn algorithms(&self, host: &str, port: u16) -> Vec<Algorithm>;
    pub fn learn(&self, host: &str, port: u16, key: &PublicKey) -> AppResult<()>;   // nom d'hôte en minuscules
    pub fn remove(&self, host: &str, port: u16) -> AppResult<usize>;                 // atomique, voir ci-dessous
}
```

`check` lit les deux fichiers avec `host_lines` (plus de `known_host_keys_path` de russh). Pour chaque fichier :
- **révoquée** : une ligne `revoked` porte la clé présentée ;
- **reconnue** : une ligne non révoquée porte la clé présentée ;
- **changement** : sinon, la première ligne non révoquée **du même type** que la clé présentée, et à défaut **la
  première ligne non révoquée, quel que soit son type** (c'est le point 1 du « Pourquoi »).

Puis, dans cet ordre : révoquée dans le fichier de TunL, puis dans celui de l'utilisateur → `Revoked` ; reconnue
dans l'un des deux → `Known` ; changement dans le fichier de TunL (`removable: true`), puis dans celui de
l'utilisateur (`removable: false`) → `Changed` ; sinon `Unknown`.

`learn` écrit `host_pattern(&host.to_lowercase(), port)`, comme OpenSSH. Le reste ne change pas.

`remove` reconnaît la ligne par son premier champ (`split_whitespace`), comparé sans tenir compte de la casse à
`host_pattern(&host.to_lowercase(), port)`. Le fichier est réécrit par un fichier temporaire `<own>.tmp`
(`create_new`, mode `0600`, `sync_all`) puis `rename` sur le fichier de TunL : jamais de fichier à moitié écrit, et
aucun `.tmp` laissé derrière.

`known_hosts.rs` doit rester sous 400 lignes : la lecture va dans `known_hosts_file.rs`.

### `src-tauri/src/ssh/handler.rs`

`HostKeyStatus::Revoked { .. }` → `Err(AppError::new(ErrorKind::HostKeyRejected, "host key is revoked"))`, sans
question à l'utilisateur. Les autres cas ne changent pas.

### `src-tauri/src/ssh/connect.rs`

```rust
/// Unchanged signature: `client_config_for(keepalive_secs, &[])`.
pub fn client_config(keepalive_secs: u32) -> Arc<Config>;
/// Same config, asking first for the key types already recorded for the host (OpenSSH does the same).
pub fn client_config_for(keepalive_secs: u32, known: &[Algorithm]) -> Arc<Config>;
/// russh's host key algorithms, those of the families in `known` first, each group in russh's own order.
pub fn host_key_order(known: &[Algorithm]) -> Vec<Algorithm>;
```

- `client_config_for` = la config actuelle, avec
  `preferred: Preferred { key: Cow::Owned(host_key_order(known)), ..Preferred::default() }`.
- Dans `host_key_order`, une « famille » : tous les `Algorithm::Rsa { .. }` vont ensemble (une clé `ssh-rsa`
  enregistrée signe en `rsa-sha2-512`, `rsa-sha2-256` ou `ssh-rsa`) ; pour les autres types, égalité stricte (la
  courbe ECDSA compte). Même longueur que la liste de russh, sans doublon.
- `ssh/session.rs` (`run_ssh_session`) appelle
  `client_config_for(target.keepalive_secs, &ctx.known_hosts.algorithms(&target.host, target.port))`.

Sans cet ordre, la règle « autre type = changement » refuserait à tort un serveur qui a les deux types de clé et
dont seule la clé `ecdsa` est enregistrée : russh négocierait `ed25519` en premier.

### Les deux `unreachable!`

- `scripts/project-rules.mjs`, règle `no-panic-in-app-code` : motif
  `/\.unwrap\(\)|\.expect\(|\b(panic|unreachable|todo|unimplemented|println|dbg)!/`, message
  `"return an AppError instead (unwrap/expect/panic!/unreachable!/todo!/println! only in tests)"`.
- `ssh/auth_secret.rs` (`authenticate_key`) : la boucle des passphrases se termine par
  `Err(AppError::new(ErrorKind::Auth, "authentication failed"))` **après** le `for`, et une passphrase fausse fait
  juste passer au tour suivant (`if let Ok(key) = load_secret_key(…) { …; return Ok(()); }`).
- `ssh/session.rs` (`resolve_target`) : `let ProtocolSettings::Ssh(settings) = &connection.settings else { return
  Err(AppError::validation("protocol", "is not SSH")); };` remplace le test de protocole **et** le `match` qui
  contenait `unreachable!`. Ce test reste avant celui du bastion.

### `scripts/test-env/up.sh`

Dans la boucle qui copie `authorized_keys` vers `$STATE/hosts/$host`, ajouter après le `chmod 0644` :

```bash
  # sshd (StrictModes) refuses a group-writable directory, which a umask of 0002 would create.
  chmod 0755 "$STATE/hosts/$host"
```

## Pièges (vus au prototype)

- `Entry::from_str` coupe sur **une** espace : sans la normalisation des espaces, une tabulation rend la ligne
  illisible.
- `PublicKey` compare aussi le **commentaire** de la clé (`root@db`) : comparer `recorded.key_data() == key.key_data()`,
  jamais `recorded == key`.
- `russh::client::Config` n'implémente pas `Clone` : on ne peut pas modifier une config déjà construite, d'où
  `client_config_for`.
- `hmac` 0.13 : `use hmac::{Hmac, KeyInit, Mac};`, puis `Hmac::<Sha1>::new_from_slice(salt)`, `update`,
  `verify_slice(hash)`.
- clippy `single_match` refuse un `match` dont le bras `Err(_) => {}` est vide : écrire `if let Ok(…)`.
- `ssh-keygen -H` garde les commentaires `#` de `ssh-keyscan` : c'est voulu (le test podman les accepte).
- `known_hosts_tests.rs` vient de T17 : cette fiche en donne la nouvelle version, où **un** test s'inverse
  (`a_key_of_another_type_is_changed_not_unknown`). C'est voulu : `contract-tests.mjs --all` retient la version de
  la fiche la plus récente.
- Après un échec d'authentification par clé, regarder `podman logs tunl-test-target` : « bad ownership or modes »
  désigne le point 4 du « Pourquoi », pas ton code.

## Tests du contrat

### `src-tauri/src/ssh/known_hosts_tests.rs` (remplace la version de T17)

```rust
use std::os::unix::fs::PermissionsExt;

use russh::keys::{PublicKey, parse_public_key_base64};

use super::known_hosts::{HostKeyStatus, KnownHosts, fingerprint, host_pattern};

// Fixed test keys (public halves only), generated once with `ssh-keygen`.
const KEY_A: &str = "AAAAC3NzaC1lZDI1NTE5AAAAINaLEe/SaLSsJfe8JpeWmS3B21Uw+eO2V8colcGPyFu7";
const FP_A: &str = "SHA256:9nFwX3ZbD2Afu2zLS84SR45AYIjQN+xcUO69FYBIWrM";
const KEY_B: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIJ9JkVFSefDuVr/cYSAh/f1rWdn5C+BjFEYycTOLh8+l";
const FP_B: &str = "SHA256:K65as0l6lNg1myP2r9czzcwbzLSZhdI6QVPLB/Nx2QI";
const KEY_EC: &str = "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBG+hjIUfFDzc5XLJ/LvCqK1FO7u10XSVbfBvwNlHcqltQv5LGg8ZQxugdmnnA5I3KdTvCB+Z9mfjxKRpooFj+Sk=";

fn key(base64: &str) -> PublicKey {
    parse_public_key_base64(base64).unwrap()
}

/// The own file and the user file, with the given contents ("" = the file does not exist).
fn files(own: &str, user: &str) -> (tempfile::TempDir, KnownHosts) {
    let dir = tempfile::tempdir().unwrap();
    let own_path = dir.path().join("own_known_hosts");
    let user_path = dir.path().join("user_known_hosts");
    if !own.is_empty() {
        std::fs::write(&own_path, own).unwrap();
    }
    if !user.is_empty() {
        std::fs::write(&user_path, user).unwrap();
    }
    (dir, KnownHosts::new(own_path, Some(user_path)))
}

#[test]
fn host_patterns_follow_openssh() {
    assert_eq!(host_pattern("db.internal", 22), "db.internal");
    assert_eq!(host_pattern("127.0.0.1", 2222), "[127.0.0.1]:2222");
}

#[test]
fn fingerprints_are_sha256_base64() {
    assert_eq!(fingerprint(&key(KEY_A)), FP_A);
    assert_eq!(fingerprint(&key(KEY_B)), FP_B);
}

#[test]
fn for_app_keeps_its_own_file_in_the_config_dir() {
    let dir = tempfile::tempdir().unwrap();
    let known = KnownHosts::for_app(dir.path());
    assert_eq!(known.own, dir.path().join("known_hosts"));
    if let Some(user) = &known.user {
        assert!(user.ends_with(".ssh/known_hosts"));
    }
}

#[test]
fn a_host_in_neither_file_is_unknown() {
    let (_dir, known) = files("", "");
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
}

#[test]
fn the_user_file_is_trusted() {
    let (_dir, known) = files("", &format!("db.internal ssh-ed25519 {KEY_A}\n"));
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
}

#[test]
fn a_non_default_port_uses_brackets() {
    let (_dir, known) = files(&format!("[db.internal]:2222 ssh-ed25519 {KEY_A}\n"), "");
    assert_eq!(
        known.check("db.internal", 2222, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
}

#[test]
fn a_different_key_of_the_same_type_is_changed() {
    let (_dir, known) = files(&format!("db.internal ssh-ed25519 {KEY_B}\n"), "");
    match known.check("db.internal", 22, &key(KEY_A)) {
        HostKeyStatus::Changed {
            path,
            line,
            known_fingerprint,
            removable,
        } => {
            assert_eq!(path, known.own);
            assert_eq!(line, 1);
            assert_eq!(known_fingerprint, FP_B);
            assert!(removable);
        }
        other => panic!("expected Changed, got {other:?}"),
    }
}

#[test]
fn a_changed_key_in_the_user_file_is_not_removable() {
    let (_dir, known) = files("", &format!("db.internal ssh-ed25519 {KEY_B}\n"));
    assert!(matches!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Changed {
            removable: false,
            ..
        }
    ));
}

#[test]
fn a_key_of_another_type_is_changed_not_unknown() {
    // A server that only shows another type must not get a fresh « unknown host » prompt (T19b).
    let (_dir, known) = files(&format!("db.internal ecdsa-sha2-nistp256 {KEY_EC}\n"), "");
    match known.check("db.internal", 22, &key(KEY_A)) {
        HostKeyStatus::Changed {
            line,
            known_fingerprint,
            removable,
            ..
        } => {
            assert_eq!(line, 1);
            assert_eq!(known_fingerprint, fingerprint(&key(KEY_EC)));
            assert!(removable);
        }
        other => panic!("expected Changed, got {other:?}"),
    }
}

#[test]
fn a_change_of_the_same_type_is_reported_first() {
    let (_dir, known) = files(
        &format!("db.internal ecdsa-sha2-nistp256 {KEY_EC}\ndb.internal ssh-ed25519 {KEY_B}\n"),
        "",
    );
    assert!(matches!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Changed { line: 2, .. }
    ));
}

#[test]
fn a_match_in_either_file_wins_over_a_change_in_the_other() {
    let (_dir, known) = files(
        &format!("db.internal ssh-ed25519 {KEY_B}\n"),
        &format!("db.internal ssh-ed25519 {KEY_A}\n"),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
}

#[test]
fn an_unreadable_file_is_skipped_not_fatal() {
    // A line whose key does not parse is skipped; the other file still counts.
    let (_dir, known) = files(
        "db.internal ssh-ed25519 not-base64!\n",
        &format!("db.internal ssh-ed25519 {KEY_A}\n"),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
}

#[test]
fn learning_appends_to_the_own_file_only_with_mode_0600() {
    let (_dir, known) = files("", "");
    known.learn("127.0.0.1", 2222, &key(KEY_A)).unwrap();
    known.learn("db.internal", 22, &key(KEY_B)).unwrap();

    assert_eq!(
        known.check("127.0.0.1", 2222, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_B)),
        HostKeyStatus::Known
    );
    let mode = std::fs::metadata(&known.own).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    assert!(!known.user.as_ref().unwrap().exists());

    let text = std::fs::read_to_string(&known.own).unwrap();
    assert_eq!(text.lines().count(), 2);
    assert!(text.lines().all(|line| !line.starts_with('#')));
}

#[test]
fn removing_drops_every_line_of_that_host_from_the_own_file() {
    let own = format!(
        "[db.internal]:2222 ssh-ed25519 {KEY_A}\nother.host ssh-ed25519 {KEY_B}\n[db.internal]:2222 ecdsa-sha2-nistp256 {KEY_EC}\n"
    );
    let user = format!("[db.internal]:2222 ssh-ed25519 {KEY_A}\n");
    let (_dir, known) = files(&own, &user);

    assert_eq!(known.remove("db.internal", 2222).unwrap(), 2);
    assert_eq!(
        std::fs::read_to_string(&known.own).unwrap(),
        format!("other.host ssh-ed25519 {KEY_B}\n")
    );
    // The user's OpenSSH file is never modified (D10).
    assert_eq!(
        std::fs::read_to_string(known.user.as_ref().unwrap()).unwrap(),
        user
    );
    assert_eq!(known.remove("db.internal", 2222).unwrap(), 0);
}

#[test]
fn removing_from_a_missing_file_removes_nothing() {
    let (_dir, known) = files("", "");
    assert_eq!(known.remove("db.internal", 22).unwrap(), 0);
    assert!(!known.own.exists());
}
```

### `src-tauri/src/ssh/known_hosts_format_tests.rs` (nouveau)

```rust
//! T19b: known_hosts read like OpenSSH (comments, tabs, case, wildcards, hashed names, markers).
use std::os::unix::fs::PermissionsExt;

use russh::keys::{Algorithm, EcdsaCurve, PublicKey, parse_public_key_base64};

use super::known_hosts::{HostKeyStatus, KnownHosts};

// The fixed test keys of known_hosts_tests.rs.
const KEY_A: &str = "AAAAC3NzaC1lZDI1NTE5AAAAINaLEe/SaLSsJfe8JpeWmS3B21Uw+eO2V8colcGPyFu7";
const KEY_B: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIJ9JkVFSefDuVr/cYSAh/f1rWdn5C+BjFEYycTOLh8+l";
const KEY_EC: &str = "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBG+hjIUfFDzc5XLJ/LvCqK1FO7u10XSVbfBvwNlHcqltQv5LGg8ZQxugdmnnA5I3KdTvCB+Z9mfjxKRpooFj+Sk=";
// `db.internal` and `[db.internal]:2222` with KEY_A, hashed by `ssh-keygen -H` (HashKnownHosts yes).
const HASHED_22: &str = "|1|lxCjQXgLAd7CpBkib76/uVAp1Qk=|4DrVRStkFoJkufm2tUOiO30dPu8=";
const HASHED_2222: &str = "|1|JZSGYE93K+A+MGX8O2jzRd2Jz7U=|A0044/uBCxh2kNoXQ3deYfvWZrE=";

fn key(base64: &str) -> PublicKey {
    parse_public_key_base64(base64).unwrap()
}

/// The own file and the user file, with the given contents ("" = the file does not exist).
fn files(own: &str, user: &str) -> (tempfile::TempDir, KnownHosts) {
    let dir = tempfile::tempdir().unwrap();
    let own_path = dir.path().join("own_known_hosts");
    let user_path = dir.path().join("user_known_hosts");
    if !own.is_empty() {
        std::fs::write(&own_path, own).unwrap();
    }
    if !user.is_empty() {
        std::fs::write(&user_path, user).unwrap();
    }
    (dir, KnownHosts::new(own_path, Some(user_path)))
}

#[test]
fn an_unreadable_line_is_skipped_not_the_whole_file() {
    let (_dir, known) = files(
        &format!("db.internal ssh-ed25519 not-base64!\ndb.internal ssh-ed25519 {KEY_B}\n"),
        "",
    );
    assert!(matches!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Changed { line: 2, .. }
    ));
}

#[test]
fn line_numbers_count_comments_and_blank_lines() {
    let (_dir, known) = files(
        "",
        &format!(
            "# managed by hand\n\nother.host ssh-ed25519 {KEY_A}\n  # db\ndb.internal ssh-ed25519 {KEY_B}\n"
        ),
    );
    match known.check("db.internal", 22, &key(KEY_A)) {
        HostKeyStatus::Changed { path, line, .. } => {
            assert_eq!(&path, known.user.as_ref().unwrap());
            assert_eq!(line, 5);
        }
        other => panic!("expected Changed, got {other:?}"),
    }
}

#[test]
fn tabs_repeated_spaces_and_key_comments_are_read() {
    let (_dir, known) = files(
        "",
        &format!("db.internal\tssh-ed25519   {KEY_A}  root@db \n"),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
}

#[test]
fn host_names_ignore_case() {
    let (_dir, known) = files("", &format!("DB.Internal ssh-ed25519 {KEY_A}\n"));
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("DB.INTERNAL", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
}

#[test]
fn hashed_host_names_are_matched() {
    let (_dir, known) = files(
        "",
        &format!("{HASHED_22} ssh-ed25519 {KEY_A}\n{HASHED_2222} ssh-ed25519 {KEY_A}\n"),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("db.internal", 2222, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("other.host", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
    assert!(matches!(
        known.check("db.internal", 22, &key(KEY_B)),
        HostKeyStatus::Changed { line: 1, .. }
    ));
}

#[test]
fn wildcards_and_negations_follow_openssh() {
    let (_dir, known) = files(
        "",
        &format!(
            "*.internal,!secret.internal ssh-ed25519 {KEY_A}\n[10.0.0.?]:2222 ssh-ed25519 {KEY_A}\n"
        ),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("secret.internal", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
    assert_eq!(
        known.check("10.0.0.7", 2222, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("10.0.0.17", 2222, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
}

#[test]
fn a_revoked_key_is_refused_even_when_recorded_elsewhere() {
    let (_dir, known) = files(
        &format!("db.internal ssh-ed25519 {KEY_A}\n"),
        &format!("# revoked\n@revoked * ssh-ed25519 {KEY_A}\n"),
    );
    match known.check("db.internal", 22, &key(KEY_A)) {
        HostKeyStatus::Revoked { path, line } => {
            assert_eq!(&path, known.user.as_ref().unwrap());
            assert_eq!(line, 2);
        }
        other => panic!("expected Revoked, got {other:?}"),
    }
}

#[test]
fn a_revoked_line_is_not_a_record_of_the_host() {
    let (_dir, known) = files(&format!("@revoked db.internal ssh-ed25519 {KEY_B}\n"), "");
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
}

#[test]
fn cert_authority_lines_are_ignored() {
    let (_dir, known) = files(
        "",
        &format!("@cert-authority *.internal ssh-ed25519 {KEY_A}\n"),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
}

#[test]
fn algorithms_lists_the_recorded_key_types_own_file_first() {
    let (_dir, known) = files(
        &format!(
            "db.internal ecdsa-sha2-nistp256 {KEY_EC}\n@revoked db.internal ssh-ed25519 {KEY_B}\n"
        ),
        &format!("db.internal ssh-ed25519 {KEY_A}\ndb.internal ecdsa-sha2-nistp256 {KEY_EC}\n"),
    );
    assert_eq!(
        known.algorithms("db.internal", 22),
        vec![
            Algorithm::Ecdsa {
                curve: EcdsaCurve::NistP256
            },
            Algorithm::Ed25519
        ]
    );
    assert!(known.algorithms("other.host", 22).is_empty());
}

#[test]
fn learning_writes_the_host_in_lower_case() {
    let (_dir, known) = files("", "");
    known.learn("DB.Internal", 22, &key(KEY_A)).unwrap();
    let text = std::fs::read_to_string(&known.own).unwrap();
    assert_eq!(text, format!("db.internal ssh-ed25519 {KEY_A}\n"));
}

#[test]
fn removing_matches_tabs_and_case_and_keeps_mode_0600() {
    let (dir, known) = files(
        &format!("DB.internal\tssh-ed25519 {KEY_A}\nother.host ssh-ed25519 {KEY_B}\n"),
        "",
    );
    std::fs::set_permissions(&known.own, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(known.remove("db.internal", 22).unwrap(), 1);
    assert_eq!(
        std::fs::read_to_string(&known.own).unwrap(),
        format!("other.host ssh-ed25519 {KEY_B}\n")
    );
    let mode = std::fs::metadata(&known.own).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    // Written through a temporary file renamed over the own file: nothing is left behind.
    let names: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(names, vec![std::ffi::OsString::from("own_known_hosts")]);
}
```

### `src-tauri/src/ssh/connect_tests.rs` (nouveau)

```rust
use russh::Preferred;
use russh::keys::{Algorithm, EcdsaCurve, HashAlg};

use super::connect::{client_config, client_config_for, host_key_order};

#[test]
fn with_nothing_recorded_russh_keeps_its_own_order() {
    assert_eq!(host_key_order(&[]), Preferred::default().key.into_owned());
    assert_eq!(
        client_config(15).preferred.key.as_ref(),
        Preferred::default().key.as_ref()
    );
}

#[test]
fn a_recorded_rsa_key_brings_every_rsa_signature_first() {
    let order = host_key_order(&[Algorithm::Rsa { hash: None }]);
    assert_eq!(
        order[..3],
        [
            Algorithm::Rsa {
                hash: Some(HashAlg::Sha512)
            },
            Algorithm::Rsa {
                hash: Some(HashAlg::Sha256)
            },
            Algorithm::Rsa { hash: None },
        ]
    );
    assert_eq!(order[3], Algorithm::Ed25519);
    assert_eq!(order.len(), Preferred::default().key.len());
}

#[test]
fn an_ecdsa_key_keeps_its_curve() {
    let p384 = Algorithm::Ecdsa {
        curve: EcdsaCurve::NistP384,
    };
    let config = client_config_for(15, std::slice::from_ref(&p384));
    assert_eq!(config.preferred.key[0], p384);
    assert_eq!(config.preferred.key[1], Algorithm::Ed25519);
}

#[test]
fn the_rest_of_the_config_is_unchanged() {
    let config = client_config_for(15, &[Algorithm::Ed25519]);
    assert_eq!(config.inactivity_timeout, None);
    assert_eq!(
        config.keepalive_interval,
        Some(std::time::Duration::from_secs(15))
    );
    assert_eq!(config.keepalive_max, 3);
    assert_eq!(
        config.preferred.kex.as_ref(),
        Preferred::default().kex.as_ref()
    );
}
```

### `src-tauri/tests/ssh_hostkey_hardened.rs` (contre podman : `npm run test:ssh`)

```rust
//! T19b against the podman servers of T16: a key of another type, a revoked key, a hashed user file.
#![cfg(feature = "test-env")]

mod support;

use std::path::Path;
use std::sync::Arc;

use russh::keys::parse_public_key_base64;
use support::{TestEnv, blank_context, connect, respond};
use tunl_lib::error::{ErrorDetail, ErrorKind};
use tunl_lib::prompts::{PromptAnswer, PromptBroker};
use tunl_lib::secrets::SecretStore;
use tunl_lib::ssh::SshContext;
use tunl_lib::ssh::known_hosts::{KnownHosts, fingerprint};

// An ECDSA key that none of the servers has.
const KEY_EC: &str = "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBG+hjIUfFDzc5XLJ/LvCqK1FO7u10XSVbfBvwNlHcqltQv5LGg8ZQxugdmnnA5I3KdTvCB+Z9mfjxKRpooFj+Sk=";

/// The target's line of the environment's known_hosts (`[host]:port ssh-ed25519 …`).
fn target_line(env: &TestEnv) -> String {
    let prefix = format!("[{}]:{} ", env.host("target"), env.port("target"));
    std::fs::read_to_string(env.known_hosts())
        .unwrap()
        .lines()
        .find(|line| line.starts_with(&prefix))
        .unwrap()
        .to_string()
}

#[tokio::test]
async fn a_host_recorded_with_another_key_type_is_refused_without_a_prompt() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let own = dir.path().join("known_hosts");
    std::fs::write(
        &own,
        format!(
            "[{}]:{} ecdsa-sha2-nistp256 {KEY_EC}\n",
            env.host("target"),
            env.port("target")
        ),
    )
    .unwrap();

    let broker = Arc::new(PromptBroker::new());
    let asked = respond(&broker, vec![PromptAnswer::Accept]);
    let ctx = blank_context(dir.path(), broker, SecretStore::memory());

    let error = connect(&env, &ctx, "target").await.err().unwrap();
    assert_eq!(error.kind, ErrorKind::HostKeyChanged);
    assert_eq!(
        error.detail.as_deref(),
        Some(&ErrorDetail::HostKeyChanged {
            host: env.host("target"),
            port: env.port("target"),
            key_type: "ssh-ed25519".into(),
            fingerprint: env.host_key("target"),
            known_fingerprint: fingerprint(&parse_public_key_base64(KEY_EC).unwrap()),
            known_hosts_path: own.to_string_lossy().into_owned(),
            line: 1,
            removable: true,
        })
    );
    assert!(
        asked.lock().unwrap().is_empty(),
        "no « unknown host » prompt"
    );
}

#[tokio::test]
async fn a_revoked_host_key_is_refused_without_a_prompt() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(
        dir.path().join("known_hosts"),
        format!("@revoked {}\n", target_line(&env)),
    )
    .unwrap();

    let broker = Arc::new(PromptBroker::new());
    let asked = respond(&broker, vec![PromptAnswer::Accept]);
    let ctx = blank_context(dir.path(), broker, SecretStore::memory());

    let error = connect(&env, &ctx, "target").await.err().unwrap();
    assert_eq!(error.kind, ErrorKind::HostKeyRejected);
    assert!(
        asked.lock().unwrap().is_empty(),
        "no prompt for a revoked key"
    );
}

/// A user file hashed by `ssh-keygen -H`, as Debian and Ubuntu write it (HashKnownHosts yes).
fn hashed_copy(env: &TestEnv, dir: &Path) -> std::path::PathBuf {
    let path = dir.join("user_known_hosts");
    std::fs::copy(env.known_hosts(), &path).unwrap();
    let status = std::process::Command::new("ssh-keygen")
        .arg("-H")
        .arg("-f")
        .arg(&path)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .unwrap();
    assert!(status.success());
    let text = std::fs::read_to_string(&path).unwrap();
    // Every host is hashed; ssh-keyscan's `#` comments stay as they are.
    assert!(
        text.lines()
            .all(|line| line.starts_with("|1|") || line.starts_with('#'))
    );
    path
}

#[tokio::test]
async fn a_hashed_user_file_is_trusted_without_a_prompt() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let user = hashed_copy(&env, dir.path());

    let broker = Arc::new(PromptBroker::new());
    let asked = respond(&broker, vec![]);
    let ctx = SshContext {
        known_hosts: Arc::new(KnownHosts::new(dir.path().join("known_hosts"), Some(user))),
        prompts: broker,
        secrets: Arc::new(SecretStore::memory()),
        agent_socket: None,
    };

    let handle = connect(&env, &ctx, "target").await.unwrap();
    assert!(!handle.is_closed());
    assert!(asked.lock().unwrap().is_empty());
}
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T19b`.
2. `Cargo.toml` (`hmac`, `sha1`), `ssh/mod.rs`, puis `ssh/known_hosts_file.rs`.
3. `ssh/known_hosts.rs` (`check`, `algorithms`, `learn`, `remove`), `ssh/handler.rs`, puis
   `cd src-tauri && cargo test --lib ssh::known_hosts` jusqu'au vert.
4. `ssh/connect.rs`, `ssh/session.rs`, puis `cargo test --lib ssh::connect`.
5. `scripts/project-rules.mjs`, puis les deux `unreachable!` (`auth_secret.rs`, `session.rs`) : `npm run rules`.
6. `scripts/test-env/up.sh`, puis `npm run test:ssh` jusqu'au vert (les 29 tests des quatre fichiers `ssh_*`).
7. `npm run format`, `npm run review`, cases, statut, commit `fix: harden host key trust like OpenSSH (T19b)`.

## Critères d'acceptation

- [ ] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T19b --check` affiche `OK`
      partout.
- [ ] `known_host_keys_path` n'apparaît plus dans `src-tauri/src/`.
- [ ] `grep -rnE "unreachable!|todo!|unimplemented!" src-tauri/src` ne trouve rien hors des fichiers de test.
- [ ] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

Rien de neuf à l'écran : une clé révoquée apparaîtra comme un refus de clé d'hôte, et une clé d'un autre type comme
une clé changée (dialogue de T21b).
Dans la vraie app, un `~/.ssh/known_hosts` haché (Debian / Ubuntu) doit maintenant être reconnu sans question
(`npm run tauri dev`, connexion à un hôte déjà connu d'OpenSSH).
