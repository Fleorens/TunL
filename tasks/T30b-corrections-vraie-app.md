# T30b — Corrections vues dans la vraie app : sondes, rechargement, focus, versions

| | |
|---|---|
| **Jalon** | M6 — Confort |
| **Dépend de** | T30 |
| **Lire avant** | `docs/06-securite.md` S15 |
| **Livrable** | une sonde par adresse (`probe.rs`) ; fin des sessions au rechargement de la page (`on_page_load`, `close_all`, `cancel_all`, `AppState::end_all_sessions`) ; focus du terminal après un dialogue de connexion ; `@tauri-apps/plugin-opener` 2.7 ; 3 fichiers de tests |

## Pourquoi

Quatre défauts vus par Florian dans la vraie app, ou à la revue du lot 5 :

1. **Sondes et pénalités d'OpenSSH.** Depuis OpenSSH 9.8, `sshd` pénalise une source qui ouvre une connexion sans
   s'authentifier (`PerSourcePenalties`, « noauth » : 1 s par connexion). Au-delà de 15 s cumulées, il **refuse**
   la source pendant ce temps. Vu dans les journaux du conteneur de test :
   `srclimit_penalise: ipv4: new 10.89.0.2/32 deferred penalty of 1 seconds for penalty: connections without
   attempting authentication`. Seize connexions vers le même serveur (un utilisateur par compte, par exemple) feraient
   bloquer le poste de l'utilisateur à chaque tour. On sonde donc **une fois par adresse** (hôte sans casse, port).
2. **Recharger la page** (F5, inspecteur, rechargement de Vite en dev) laisse les sessions ouvertes côté Rust : la
   nouvelle page n'a plus d'onglet pour elles, la connexion SSH reste établie jusqu'à la fermeture de l'app.
3. **Focus** : après le dialogue de mot de passe (ou de 2FA), la saisie ne va pas au terminal ; il faut cliquer
   dedans. Le dialogue rend le focus à l'élément qu'il avait trouvé (la ligne de la sidebar double-cliquée).
4. **Versions** : `npm run tauri dev` signale que la crate `tauri-plugin-opener` (2.7) et le paquet npm (2.6) ne
   sont pas alignés.

Prototypé par l'orchestrateur : les tests de cette fiche passent, et échouent sur le code d'avant.

## À réutiliser (ne pas réécrire)

- `probe()` et `ProbeResult` / `ProbeStatus` (T30) ; `PROBE_TIMEOUT`, `MAX_PARALLEL_PROBES`.
- `SessionRegistry`, `TransferRegistry` (`sftp/mod.rs`), `PromptBroker` (et son verrou `lock()`).
- `TerminalView` et `useXterm` (T20) : `term.focus()` existe déjà à l'activation d'un onglet.

## Contrat — Rust

### `probe.rs` : `probe_all` sonde chaque adresse une fois

Même signature, même résultat dans l'ordre de `connections`. Ce qui change :
- les connexions sans bastion sont regroupées par adresse `(host.to_ascii_lowercase(), port)` ; chaque adresse
  distincte a **une** tâche (`JoinSet`, sémaphore de `max_parallel` jetons, comme avant) ;
- chaque connexion reçoit le résultat de son adresse (`Online` + `latency_ms`, ou `Offline`) ;
- une connexion derrière un bastion reste `Skipped`, sans accès réseau.
- Mettre à jour le commentaire de `probe_all`.

### Fin de tout au rechargement

```rust
// sessions.rs
impl SessionRegistry {
    /// Annule et oublie toutes les sessions. Renvoie combien étaient ouvertes.
    pub fn close_all(&self) -> usize;
}
// sftp/mod.rs
impl TransferRegistry {
    /// Annule tous les transferts en cours (chacun s'oublie en finissant).
    pub fn cancel_all(&self);
}
// prompts.rs
impl PromptBroker {
    /// Annule toutes les questions en attente, toutes sessions confondues : chaque `ask` finit en `Cancelled`.
    pub fn cancel_all(&self);
}
// state.rs
impl AppState {
    /// Sessions (shell, SFTP, RDP), transferts et questions : tout ce que la page montrait. Renvoie le nombre de sessions.
    pub fn end_all_sessions(&self) -> usize;
}
```

- `close_all` vide la table sous le verrou (`drain`), puis annule chaque jeton **hors** du verrou. Verrou empoisonné :
  `0`.
- `cancel_all` (prompts) : vider la table suffit (lâcher l'émetteur fait finir `ask` en `Cancelled`).
- `lib.rs`, dans le `Builder`, avant `invoke_handler` :
  `.on_page_load(|webview, payload| …)` : sur `PageLoadEvent::Started`, `webview.try_state::<AppState>()` (au tout
  premier chargement il n'y a encore rien à fermer), `end_all_sessions()`, et un `log::info!` avec le nombre si
  `> 0`.
- `lib.rs` : `#[cfg(test)] mod probe_dedup_tests;` et `#[cfg(test)] mod reload_tests;`.

## Contrat — Frontend

- `TerminalView({ port, active, connected = false })` : nouvelle prop `connected` ; un effet
  `if (term && active && connected) term.focus()` dépendant de `[term, active, connected]`.
- `SessionView` : `<TerminalView … connected={session.status === "connected"} />`.

## Dépendances

- `npm install @tauri-apps/plugin-opener@^2.7.0 @tauri-apps/cli@^2.12.1` (la CLI suit la 2.12 de la crate `tauri`).
- `src-tauri/Cargo.toml` : `tauri-plugin-opener = "2.7"`.
- Aucune autre dépendance.

## Pièges (vus au prototype)

- `PageLoadEvent` est dans `tauri::webview`. `try_state` (pas `state`) : `state` panique si l'état n'est pas encore
  géré.
- Ne pas annuler les jetons sous le verrou de la table : une tâche qui se termine appelle `remove`, qui prend ce même
  verrou.
- Le focus : le dialogue est démonté dès la réponse et rend le focus **avant** que la session soit ouverte ; c'est
  donc le passage à `connected` qui doit reprendre le focus, pas la fermeture du dialogue.
- Le compte des tentatives de mot de passe n'est **pas** dans cette fiche : le backend s'arrête bien à 3 contre
  podman (`three_wrong_passwords_fail_with_an_auth_error`). Ne pas toucher à `auth_secret.rs`.

## Tests du contrat

### `src-tauri/src/probe_dedup_tests.rs` (nouveau)

```rust
use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use tokio::net::TcpListener;
use uuid::Uuid;

use crate::model::{Connection, ConnectionInput, Protocol};
use crate::probe::{ProbeStatus, probe_all};

fn connection(name: &str, host: &str, port: u16) -> Connection {
    Connection::from_input(
        Uuid::new_v4(),
        ConnectionInput {
            name: name.into(),
            host: host.into(),
            port,
            ..ConnectionInput::template(Protocol::Ssh)
        },
        1_000,
    )
}

#[tokio::test]
async fn one_probe_per_address_shared_by_its_connections() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let accepted = Arc::new(AtomicUsize::new(0));
    let counter = accepted.clone();
    tokio::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            counter.fetch_add(1, Ordering::SeqCst);
            drop(socket);
        }
    });

    // Three connections on one server (another user, another name, the host in capitals): one connect.
    let all = vec![
        connection("root", "localhost", port),
        connection("deploy", "LOCALHOST", port),
        connection("backup", "localhost", port),
    ];
    let results = probe_all(&all, Duration::from_millis(500), 16).await;
    assert!(results.iter().all(|r| r.status == ProbeStatus::Online));
    assert!(results.iter().all(|r| r.latency_ms.is_some()));
    assert_eq!(
        results.iter().map(|r| r.connection_id).collect::<Vec<_>>(),
        all.iter().map(|c| c.id).collect::<Vec<_>>()
    );
    tokio::time::sleep(Duration::from_millis(100)).await;
    assert_eq!(accepted.load(Ordering::SeqCst), 1);
}
```

### `src-tauri/src/reload_tests.rs` (nouveau)

```rust
//! T30b: reloading the page ends what the old page was running (sessions, transfers, prompts).
use std::sync::Arc;
use std::time::Duration;

use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::ErrorKind;
use crate::paths::AppPaths;
use crate::prompts::{PromptBroker, PromptKind};
use crate::secrets::SecretStore;
use crate::sessions::{SessionHandle, SessionRegistry};
use crate::sftp::TransferRegistry;
use crate::state::AppState;

fn handle() -> SessionHandle {
    let (input, _receiver) = mpsc::unbounded_channel();
    SessionHandle {
        cancel: CancellationToken::new(),
        input,
    }
}

fn host_key() -> PromptKind {
    PromptKind::HostKeyUnknown {
        host: "db.internal".into(),
        port: 22,
        key_type: "ssh-ed25519".into(),
        fingerprint: "SHA256:abc".into(),
    }
}

#[test]
fn close_all_cancels_and_forgets_every_session() {
    let registry = SessionRegistry::new();
    let (first, second) = (handle(), handle());
    let tokens = [first.cancel.clone(), second.cancel.clone()];
    registry.insert(Uuid::new_v4(), first).unwrap();
    registry.insert(Uuid::new_v4(), second).unwrap();

    assert_eq!(registry.close_all(), 2);
    assert!(registry.is_empty());
    assert!(tokens.iter().all(CancellationToken::is_cancelled));
    assert_eq!(registry.close_all(), 0);
}

#[test]
fn cancel_all_cancels_every_transfer() {
    let transfers = TransferRegistry::default();
    let tokens = [CancellationToken::new(), CancellationToken::new()];
    for token in &tokens {
        transfers.insert(Uuid::new_v4(), token.clone()).unwrap();
    }
    transfers.cancel_all();
    assert!(tokens.iter().all(CancellationToken::is_cancelled));
}

#[tokio::test]
async fn cancel_all_ends_every_pending_prompt_as_cancelled() {
    let broker = Arc::new(PromptBroker::with_timeout(Duration::from_secs(5)));
    broker.set_emitter(Box::new(|_| {}));
    let asks: Vec<_> = [Some(Uuid::new_v4()), None]
        .into_iter()
        .map(|session| {
            let broker = broker.clone();
            tokio::spawn(async move { broker.ask(session, host_key()).await })
        })
        .collect();
    for _ in 0..400 {
        if broker.pending_count() == 2 {
            break;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    assert_eq!(broker.pending_count(), 2);

    broker.cancel_all();
    for ask in asks {
        assert_eq!(ask.await.unwrap().unwrap_err().kind, ErrorKind::Cancelled);
    }
    assert_eq!(broker.pending_count(), 0);
}

#[test]
fn end_all_sessions_reports_how_many_were_open() {
    let dir = tempfile::tempdir().unwrap();
    let paths = AppPaths {
        config_dir: dir.path().join("config"),
        data_dir: dir.path().join("data"),
        log_dir: dir.path().join("logs"),
    };
    paths.ensure_created().unwrap();
    let state = AppState::from_disk(&paths, 1_000, SecretStore::memory()).unwrap();
    let session = handle();
    let token = session.cancel.clone();
    state.sessions.insert(Uuid::new_v4(), session).unwrap();

    assert_eq!(state.end_all_sessions(), 1);
    assert!(token.is_cancelled());
    assert_eq!(state.end_all_sessions(), 0);
}
```

### `e2e/focus-after-prompt.spec.ts` (nouveau)

```ts
// T30b: once a password or 2FA dialog is answered and the session opens, the keyboard goes to the terminal.
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function terminal(page: Page, title: string) {
  return page.getByRole("region", { name: title, exact: true });
}

test("after the password dialog, typing goes to the terminal", async ({ page }) => {
  await page
    .getByRole("button", { name: /^router/ })
    .first()
    .dblclick();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password", { exact: true }).fill("right");
  await dialog.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByRole("tab", { selected: true })).toContainText("router");
  await expect(terminal(page, "router").locator(".xterm-helper-textarea")).toBeFocused();
});

test("after the 2FA dialog, typing goes to the terminal", async ({ page }) => {
  await page
    .getByRole("button", { name: /^media-server/ })
    .first()
    .dblclick();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Password:").fill("secret");
  await dialog.getByLabel("Verification code:").fill("123456");
  await dialog.getByRole("button", { name: "Continue" }).click();

  await expect(terminal(page, "media-server").locator(".xterm-helper-textarea")).toBeFocused();
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T30b`.
2. `probe.rs`, `lib.rs` : `cd src-tauri && cargo test --lib probe`.
3. `sessions.rs`, `sftp/mod.rs`, `prompts.rs`, `state.rs`, `lib.rs` (`on_page_load`) : `cargo test --lib reload`.
4. Dépendances (npm, `Cargo.toml`) : `cd src-tauri && cargo check`.
5. `TerminalView.tsx`, `SessionView.tsx` : `npx playwright test e2e/focus-after-prompt.spec.ts e2e/prompts.spec.ts`.
6. `npm run format`, `npm run review`, cases, statut, commit
   `fix: one probe per address, end sessions on reload, focus the terminal after a prompt (T30b)`.

## Critères d'acceptation

- [x] `npm run review` passe, et `node scripts/contract-tests.mjs T30b --check` affiche `OK` partout.
- [x] `grep -n "on_page_load" src-tauri/src/lib.rs` trouve le crochet.
- [x] `node -p "require('@tauri-apps/plugin-opener/package.json').version"` commence par `2.7` (la commande renvoie
  `ERR_PACKAGE_PATH_NOT_EXPORTED` car le champ `exports` du paquet cache `./package.json` en 2.7.x ; la version
  installée est `2.7.2`, lue directement dans `node_modules/@tauri-apps/plugin-opener/package.json`).
- [x] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

`npm run tauri dev` :
- une connexion à mot de passe : après « Se connecter », tape directement, sans cliquer dans le terminal ;
- ouvre une session SSH, puis recharge la page (clic droit → Recharger, ou F5 avec l'inspecteur) : sur le serveur,
  `who` ne montre plus la session au bout de quelques secondes ;
- `npm run tauri dev` n'affiche plus d'avertissement de version pour `tauri-plugin-opener`.
