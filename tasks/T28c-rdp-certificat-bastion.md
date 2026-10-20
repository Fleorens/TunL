# T28c — RDP via bastion : un port de tunnel stable et le vrai nom d'hôte, pour que le certificat soit vérifié

| | |
|---|---|
| **Jalon** | M5 — RDP |
| **Dépend de** | T28b |
| **Lire avant** | `docs/01-architecture.md` §8 (dernier point), `docs/06-securite.md` S6 (dernier point) |
| **Livrable** | `tunnel_port` et `bind_tunnel` (`ssh/forward.rs`) ; `build_tunnel_args` (`rdp/args.rs`) ; `run_rdp_session` qui s'en sert ; 2 fichiers de tests |

## Pourquoi

FreeRDP range chaque certificat qu'il a accepté dans `~/.config/freerdp/server/<serveur>_<port>.pem`, et c'est ce
fichier qu'il compare au certificat suivant. Derrière un bastion, TunL le fait se connecter à
`127.0.0.1:<port libre>`, **un port différent à chaque session** : chaque session est donc une « première
connexion », et avec la politique `tofu`, n'importe quel certificat est accepté sans un mot. La vérification
n'a jamais lieu.

Vérifié par l'orchestrateur avec FreeRDP 3.15 (`xfreerdp3 +auth-only`) contre les serveurs xrdp de test :
- `/v:127.0.0.1:40001` puis `/v:127.0.0.1:40002` → deux entrées `127.0.0.1_40001.pem`, `127.0.0.1_40002.pem` ;
- `/server-name:desk` change le nom de l'entrée (`desk_40001.pem`) mais **pas** le port ;
- port stable + `/server-name:desk` : la 2ᵉ session retrouve `desk_61500.pem` ; un autre serveur (autre certificat)
  sur ce même port → « Do you trust the above certificate? », puis « certificate not trusted, aborting » sans
  réponse. C'est le comportement voulu (S6).

Le correctif : un **port de tunnel propre à chaque connexion** (le même à chaque fois), et `/server-name:<hôte réel>`
juste après `/v:`. FreeRDP vérifie alors aussi le nom du certificat contre le vrai hôte, plus contre `127.0.0.1`.

Prototypé par l'orchestrateur : les tests de cette fiche passent, ceux de T27 et T28 n'ont pas bougé.

## À réutiliser (ne pas réécrire)

- `bind_local()` et `forward()` (`ssh/forward.rs`, T23) : `bind_tunnel` retombe sur `bind_local`.
- `build_args` et `no_control` (`rdp/args.rs`, T27) : `build_args` devient un appel à `build_tunnel_args(…, None, …)`.
- `establish_bastion` et `run_rdp_session` (`rdp/session.rs`, T28).

## Contrat

### `src-tauri/src/ssh/forward.rs`

```rust
/// Premier port de la plage des tunnels : au-dessus des ports éphémères de Linux (32768–60999).
pub const TUNNEL_PORT_FIRST: u16 = 61000;
/// Taille de la plage (61000–65535).
pub const TUNNEL_PORT_COUNT: u16 = 4536;

/// Le port de boucle locale que préfère le tunnel d'une connexion : toujours le même pour elle.
pub fn tunnel_port(connection_id: Uuid) -> u16;   // TUNNEL_PORT_FIRST + (id.as_u128() % COUNT)

/// Le port de la connexion s'il est libre ; sinon n'importe quel port libre (`bind_local`).
pub async fn bind_tunnel(connection_id: Uuid) -> AppResult<TcpListener>;
```

- `tunnel_port` : la conversion du reste en `u16` passe par `u16::try_from(…)` (jamais `as` sur un `u128` qui
  pourrait tronquer, jamais `unwrap()` : le reste est toujours `< COUNT`).
- `bind_tunnel` : `TcpListener::bind((Ipv4Addr::LOCALHOST, tunnel_port(id)))` ; en cas d'échec (port pris par un 2ᵉ
  onglet de la même connexion, ou par un autre programme), `log::info!` puis `bind_local()`. Toujours la boucle
  locale (S15).
- Mettre à jour le commentaire d'en-tête du fichier (« le port propre à la connexion, T28c »).

### `src-tauri/src/rdp/args.rs`

```rust
/// Les mêmes arguments, pour un client dirigé vers un tunnel : `/server-name:<hôte>` juste après `/v:`.
pub fn build_tunnel_args(
    endpoint: &RdpEndpoint<'_>,
    server_name: Option<&str>,
    settings: &RdpSettings,
    credentials: &RdpCredentials,
) -> AppResult<RdpArgs>;
```

- Le corps actuel de `build_args` passe dans `build_tunnel_args` ; `build_args(e, s, c)` = `build_tunnel_args(e, None,
  s, c)`. Les tests de T27 ne changent pas.
- `server_name` est contrôlé par `no_control("serverName", …)` **avant** de construire quoi que ce soit (S5, S7 : le
  message ne recopie pas la valeur).
- La ligne `/server-name:<nom>` vient en 2ᵉ position, juste après `/v:`. Sans `server_name`, aucune ligne de plus.

### `src-tauri/src/rdp/session.rs`

- `establish_bastion` : l'étape `Open` appelle `bind_tunnel(target.connection_id)` au lieu de `bind_local()`.
- `run_rdp_session` : **avant** l'établissement du bastion (qui remplace `target.host` par `127.0.0.1`),
  `let server_name = target.via.as_ref().map(|_| target.host.clone());` ; le lancement appelle
  `build_tunnel_args(&endpoint, server_name.as_deref(), &target.settings, &credentials)`.
- `RdpTarget` et `RdpEndpoint` **ne changent pas** (les tests de T28 construisent ces structures).
- `rdp/mod.rs` : `#[cfg(test)] mod tunnel_cert_tests;`.

## Pièges (vus au prototype)

- Ne pas ajouter de champ à `RdpTarget` ni à `RdpEndpoint` : `launch_tests.rs`, `args_tests.rs` et
  `tests/ssh_rdp.rs` (tests du contrat de T27 et T28) les construisent champ par champ et ne compileraient plus.
- `/server-name` ne remplace pas le port dans le nom de l'entrée : sans port stable, il ne sert à rien. Les deux
  vont ensemble.
- Un 2ᵉ onglet RDP de la même connexion prend un port libre quelconque : sa première session est une première
  utilisation (c'est accepté, et rare).
- Avec la politique « Demander » (`Prompt`), FreeRDP pose de toute façon la question dans sa fenêtre : la fiche ne
  change rien pour elle, sinon le nom affiché.

## Tests du contrat

### `src-tauri/src/rdp/tunnel_cert_tests.rs` (nouveau)

```rust
//! T28c: behind a bastion, FreeRDP must find the certificate it trusted last time. It files it under
//! `<server>_<port>`: the server is the real host (`/server-name`), the port the connection's own tunnel port.
use uuid::Uuid;

use crate::model::RdpSettings;
use crate::rdp::args::{RdpCredentials, RdpEndpoint, build_args, build_tunnel_args};
use crate::ssh::forward::{TUNNEL_PORT_COUNT, TUNNEL_PORT_FIRST, bind_tunnel, tunnel_port};

fn tunnel() -> RdpEndpoint<'static> {
    RdpEndpoint {
        name: "desk",
        host: "127.0.0.1",
        port: 61234,
    }
}

#[test]
fn the_tunnel_port_is_the_same_for_a_connection_and_outside_the_ephemeral_range() {
    let id = Uuid::parse_str("6f1c2b4e-8d3a-4f5b-9c7e-0a1b2c3d4e5f").unwrap();
    assert_eq!(tunnel_port(id), tunnel_port(id));
    let last = TUNNEL_PORT_FIRST + (TUNNEL_PORT_COUNT - 1);
    assert_eq!(last, 65535);
    for _ in 0..200 {
        let port = tunnel_port(Uuid::new_v4());
        assert!((61000..=65535).contains(&port), "{port}");
    }
    // Spread over the range, not one port for everyone.
    let ports: std::collections::HashSet<u16> =
        (0..50).map(|_| tunnel_port(Uuid::new_v4())).collect();
    assert!(ports.len() > 40);
}

#[tokio::test]
async fn a_tunnel_takes_its_own_port_and_another_one_when_it_is_busy() {
    let id = Uuid::new_v4();
    let first = bind_tunnel(id).await.unwrap();
    let first_port = first.local_addr().unwrap().port();
    assert_eq!(first_port, tunnel_port(id));
    assert!(first.local_addr().unwrap().ip().is_loopback());

    // A second tab of the same connection: the port is held, any free loopback port will do.
    let second = bind_tunnel(id).await.unwrap();
    assert_ne!(second.local_addr().unwrap().port(), first_port);
    assert!(second.local_addr().unwrap().ip().is_loopback());

    // Freed, it is the connection's again.
    drop(first);
    drop(second);
    let again = bind_tunnel(id).await.unwrap();
    assert_eq!(again.local_addr().unwrap().port(), tunnel_port(id));
}

#[test]
fn behind_a_tunnel_the_real_host_follows_the_address() {
    let args = build_tunnel_args(
        &tunnel(),
        Some("desk.corp.lan"),
        &RdpSettings::default(),
        &RdpCredentials::default(),
    )
    .unwrap();
    let lines: Vec<&str> = args.lines().collect();
    assert_eq!(lines[0], "/v:127.0.0.1:61234");
    assert_eq!(lines[1], "/server-name:desk.corp.lan");
    assert_eq!(
        lines
            .iter()
            .filter(|l| l.starts_with("/server-name:"))
            .count(),
        1
    );
}

#[test]
fn without_a_tunnel_nothing_changes() {
    let settings = RdpSettings::default();
    let credentials = RdpCredentials::default();
    let direct = build_tunnel_args(&tunnel(), None, &settings, &credentials).unwrap();
    let plain = build_args(&tunnel(), &settings, &credentials).unwrap();
    assert_eq!(
        direct.lines().collect::<Vec<_>>(),
        plain.lines().collect::<Vec<_>>()
    );
    assert!(direct.lines().all(|l| !l.starts_with("/server-name:")));
}

#[test]
fn a_server_name_with_a_line_break_is_refused() {
    let error = build_tunnel_args(
        &tunnel(),
        Some("desk\n/p:stolen"),
        &RdpSettings::default(),
        &RdpCredentials::default(),
    )
    .unwrap_err();
    assert_eq!(error.kind, crate::error::ErrorKind::Validation);
    assert!(!error.message.contains("stolen"), "S7: {}", error.message);
}
```

### `src-tauri/tests/ssh_rdp_cert.rs` (nouveau)

```rust
//! T28c against the podman environment of T16: behind a bastion, FreeRDP is pointed at the connection's own
//! tunnel port, every time, and told the real host's name, so the certificate it trusted is found again.
//! A fake client records its arguments (as in `ssh_rdp.rs`). `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use support::{TestEnv, context, respond};
use tokio_util::sync::CancellationToken;
use tunl_lib::model::RdpSettings;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::rdp::args::RdpCredentials;
use tunl_lib::rdp::session::{RdpRun, RdpTarget, run_rdp_session};
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink};
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::forward::tunnel_port;
use tunl_lib::ssh::session::SshTarget;
use uuid::Uuid;

struct Quiet;

impl SessionSink for Quiet {
    fn event(&self, _event: SessionEvent) {}
    fn output(&self, _bytes: Vec<u8>) {}
}

/// A fake FreeRDP: saves its stdin, then exits 0.
fn fake_client(dir: &Path) -> PathBuf {
    let path = dir.join("fake-freerdp");
    let script = format!("#!/bin/bash\ncat > '{}/stdin'\nexit 0\n", dir.display());
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    path
}

async fn run_once(env: &TestEnv, dir: &Path, connection_id: Uuid, bastion_id: Uuid) -> Vec<String> {
    let secrets = SecretStore::memory();
    secrets
        .set(
            bastion_id,
            "bastion",
            SecretKind::Password,
            &SecretValue::new(env.password()),
        )
        .await
        .unwrap();
    let broker = Arc::new(PromptBroker::new());
    respond(&broker, vec![]);
    let ctx = context(env, dir, broker, secrets);
    let run = RdpRun {
        id: Uuid::new_v4(),
        target: RdpTarget {
            connection_id,
            name: "desk".into(),
            host: env.host("hidden"),
            port: env.port("hidden"),
            username: Some("admin".into()),
            settings: RdpSettings::default(),
            via: Some(SshTarget {
                connection_id: Some(bastion_id),
                connection_name: "bastion".into(),
                host: env.host("bastion"),
                port: env.port("bastion"),
                username: env.user(),
                plan: AuthPlan::Password,
                connect_timeout: Duration::from_secs(5),
                keepalive_secs: 15,
                jump_hosts: Vec::new(),
            }),
        },
        credentials: RdpCredentials::default(),
        client: fake_client(dir),
        cancel: CancellationToken::new(),
    };
    tokio::time::timeout(
        Duration::from_secs(20),
        run_rdp_session(ctx, run, Arc::new(Quiet)),
    )
    .await
    .expect("the session ends with the client");
    std::fs::read_to_string(dir.join("stdin"))
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect()
}

#[tokio::test]
async fn two_sessions_of_a_connection_use_the_same_port_and_name_the_real_host() {
    let env = TestEnv::load();
    let (connection_id, bastion_id) = (Uuid::new_v4(), Uuid::new_v4());
    let expected = format!("/v:127.0.0.1:{}", tunnel_port(connection_id));

    for _ in 0..2 {
        let dir = tempfile::tempdir().unwrap();
        let lines = run_once(&env, dir.path(), connection_id, bastion_id).await;
        assert_eq!(lines[0], expected);
        assert_eq!(lines[1], format!("/server-name:{}", env.host("hidden")));
    }
}
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T28c`.
2. `ssh/forward.rs`, `rdp/args.rs`, `rdp/mod.rs` : `cd src-tauri && cargo test --lib rdp::`.
3. `rdp/session.rs` : `npm run test:ssh` (dont `ssh_rdp` et `ssh_rdp_cert`).
4. `npm run format`, `npm run review`, cases, statut, commit
   `fix: stable tunnel port and server name so FreeRDP checks the certificate behind a bastion (T28c)`.

## Critères d'acceptation

- [ ] `npm run review` passe, et `node scripts/contract-tests.mjs T28c --check` affiche `OK` partout.
- [ ] `node scripts/contract-tests.mjs T27 --check` et `T28 --check` affichent toujours `OK`.
- [ ] `grep -n "bind_local()" src-tauri/src/rdp/session.rs` ne trouve rien.
- [ ] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

Avec FreeRDP 3 et un poste RDP derrière un bastion, politique de certificat « Faire confiance au premier » :
1. première session : rien à confirmer ; `ls ~/.config/freerdp/server/` montre `<hôte>_<port entre 61000 et 65535>.pem` ;
2. deuxième session : même fichier, pas de nouvelle entrée ;
3. (facultatif) les anciennes entrées `127.0.0.1_<port>.pem` des sessions précédentes peuvent être supprimées.
