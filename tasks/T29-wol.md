# T29 — Wake-on-LAN : paquet magique, « Réveiller », réveil avant connexion

| | |
|---|---|
| **Jalon** | M3 — Bastions et tunnels |
| **Dépend de** | T22 |
| **Lire avant** | `docs/01-architecture.md` §5 (étape 1, **Wake**), `docs/06-securite.md` S8 et S15, `docs/05-modele-donnees.md` §2 (`WolConfig`) |
| **Livrable** | `src-tauri/src/wol.rs`, commande `wol_wake` + `ipc.wolWake` + mock ; étape `Wake` avant une session SSH ; « Réveiller » du menu contextuel branché ; 4 fichiers de tests |

## Pourquoi

Une connexion peut porter une configuration Wake-on-LAN (T11), mais rien ne s'en sert : « Réveiller » affiche
« bientôt disponible ». Cette fiche :
1. envoie le **paquet magique** (UDP, diffusion) depuis le menu contextuel ;
2. pour une connexion marquée « Réveiller avant de se connecter », ajoute une étape **Wake** en tête de session :
   le paquet, puis l'attente que le port de l'hôte réponde (au plus `wol.waitTimeoutSecs`).

Prototypé par l'orchestrateur, par-dessus le prototype de T22 : les tests de cette fiche passent.

## À réutiliser (ne pas réécrire)

- T06 : `WolConfig` (MAC déjà normalisée `AA:BB:CC:DD:EE:FF`, `broadcast` IPv4, `port`, `wake_before_connect`,
  `wait_timeout_secs`), validée à l'enregistrement.
- T17b : `ssh::connect::tcp_connect(host, port, timeout)` pour essayer le port.
- T19 : `ssh::session::connect_step` (une étape : `Started`, le travail, `Done` ou `Failed` + `Error`, annulation →
  `Closed { UserClosed }`). Elle est privée : la passer en `pub(crate)`, **ne pas la recopier**.
- `SessionSink`, `StepKind::Wake` (existe déjà), `StepState` (`sessions.rs`).
- Frontend : la clé `sessions.steps.wake` (« Waking up {{label}} ») existe ; `notifyError` ; `toast` + `i18n.t`
  (comme `features/shell/coming-soon.ts`).

## Contrat — Rust

### `src-tauri/src/wol.rs` (nouveau ; `lib.rs` : `pub mod wol;` et `#[cfg(test)] mod wol_tests;`)

```rust
pub const WAKE_POLL_INTERVAL: Duration = Duration::from_secs(2);

/// 6 × 0xFF, puis la MAC 16 fois : 102 octets. `mac` est la forme stockée `AA:BB:CC:DD:EE:FF`.
pub fn magic_packet(mac: &str) -> AppResult<[u8; 102]>;
/// Le paquet de `config`, en UDP, vers `broadcast:port`.
pub async fn send_magic_packet(config: &WolConfig) -> AppResult<()>;
/// Essaie `host:port` toutes les `every`, pendant `total` au plus.
pub async fn wait_for_port(host: &str, port: u16, total: Duration, every: Duration) -> AppResult<()>;
/// Le paquet, puis l'attente (`config.wait_timeout_secs`).
pub async fn wake_and_wait(config: &WolConfig, host: &str, port: u16, every: Duration) -> AppResult<()>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WakeTarget { pub name: String, pub host: String, pub port: u16, pub config: WolConfig }
pub fn wake_target(connection: &Connection) -> Option<WakeTarget>;
pub async fn run_wake_step(wake: &WakeTarget, every: Duration, cancel: CancellationToken, sink: &dyn SessionSink) -> bool;
```

| Fonction | Comportement |
|---|---|
| `magic_packet` | MAC mal formée (pas 6 octets hexadécimaux séparés par `:`) → `validation("wol.mac", …)` |
| `send_magic_packet` | `UdpSocket::bind((Ipv4Addr::UNSPECIFIED, 0))`, `set_broadcast(true)`, `send_to(paquet, (broadcast, port))`. `broadcast` illisible → `validation("wol.broadcast", …)`. Erreur d'E/S → `ErrorKind::Wol`, message fixe (`"cannot open a UDP socket"`, `"cannot enable broadcast"`, `"cannot send the magic packet"`), et l'erreur du système dans un `log::warn!`. Succès : `log::info!` avec la MAC, l'adresse et le port (ni l'une ni l'autre ne sont des secrets, S8) |
| `wait_for_port` | boucle : temps restant nul → `ErrorKind::Timeout`, message `"<host>:<port> did not wake up within <n> s"` ; sinon un essai `tcp_connect` borné par `min(every, restant)` ; réussi → `Ok` ; raté → attendre la fin du tour (un refus revient tout de suite : sans cette attente, la boucle tourne à vide) |
| `wake_target` | `Some` **seulement** si `wol` est présent, `wake_before_connect` vrai **et** pas de `jump_host_id` (une diffusion depuis ce poste n'atteint pas le réseau d'un hôte derrière un bastion) |
| `run_wake_step` | `connect_step(cancel, sink, StepKind::Wake, &wake.name, || wake_and_wait(…))`, puis `.is_ok()` |

### `src-tauri/src/commands/ssh.rs`

Dans `ssh_open`, avant `spawn` : pour une cible `Saved`, `wake_target(connexion)` (via le store déjà lu). Dans la
tâche : si une `WakeTarget` existe, `run_wake_step(&wake, WAKE_POLL_INTERVAL, cancel.clone(), &*sink)` ; **seulement**
s'il renvoie `true`, `run_ssh_session(…)`. Le `sink` devient un `Arc<dyn SessionSink>` créé avant les deux appels.
La fin de la tâche (`sessions.remove`, `prompts.cancel_session`) a lieu dans tous les cas.

`run_ssh_session` et `ShellSession` **ne changent pas** : les tests de T19 et T22 restent intacts.

### `src-tauri/src/commands/wol.rs` (nouveau)

```rust
#[tauri::command]
pub async fn wol_wake(state: State<'_, AppState>, id: Uuid) -> AppResult<()>
```

Connexion introuvable → `not_found`. Sans `wol` → `AppError::validation("wol", "is not configured")`. Sinon
`send_magic_packet` (pas d'attente : l'utilisateur voit la pastille passer au vert). `commands/mod.rs` :
`pub mod wol;` et `#[cfg(test)] mod ipc_wol_tests;`. `lib.rs` : la commande dans `invoke_handler()`.

## Contrat — Frontend

- `src/lib/ipc.ts` : `wolWake: (id: string) => call<void>("wol_wake", { id }),` (section
  `// Wake-on-LAN (T29): …`).
- `src/lib/mock/wol.ts` (nouveau) : `wolHandlers` avec `wol_wake` : connexion inconnue → `notFound` ; sans `wol` →
  `{ kind: "validation", message: "wol: is not configured", detail: null }` ; sinon `result: null`.
  `ipc-mock.ts` : `...wolHandlers`.
- `src/lib/mock/sessions.ts` : `ResolvedTarget` gagne `wake: boolean` (`wol?.wakeBeforeConnect === true` et pas de
  `jumpHostId` ; `false` pour une cible rapide). En tête de `runSession`, si `wake` : `wake started` puis
  `wake done`, libellé = le nom de la connexion (l'hôte du mock se réveille aussitôt).
- `src/features/connections/wake.ts` (nouveau) : `wakeConnection(connection)` : `ipc.wolWake` dans un `try/catch`,
  succès → `toast(i18n.t("connectionMenu.wakeSent", { name }))`, échec → `notifyError`.
- `ConnectionContextMenu.tsx` : « Réveiller » appelle `wakeConnection(connection)` au lieu de `notifyComingSoon`.
- i18n : `connectionMenu.wakeSent` = `"Magic packet sent to {{name}}"` / `"Paquet magique envoyé à {{name}}"`.

## Pièges (vus au prototype)

- **`session.rs` est au plafond de 400 lignes** depuis T22. On n'y ajoute **rien** d'autre que `pub(crate)` devant
  `connect_step` : `WakeTarget` et l'étape vivent dans `wol.rs`. Si `session.rs` dépasse quand même 400 lignes après
  `npm run format`, déplace des fonctions privées du parcours des bastions (`dial`, `connect_hop`…) dans
  `ssh/chain.rs` (ce qu'a fait le prototype).
- Clippy (Rust 1.99) refuse `chunks_exact_mut(6)` avec une taille constante : `as_chunks_mut::<6>().0`.
- **Ne lance jamais `npm run test:ssh` pendant qu'un autre clone l'utilise** : chaque clone a ses propres clés de test
  (`scripts/test-env/.state`, non versionné), et `up.sh` recrée les conteneurs avec les siennes. L'autre voit alors
  « host key changed » partout.
- `wait_timeout_secs` est en secondes entières, au moins 10 dans une connexion validée. Les tests appellent
  `run_wake_step` directement, avec 1 s.
- Le paquet part même si l'hôte est déjà réveillé : c'est sans effet sur lui, et plus simple qu'une sonde avant.

## Tests du contrat

### `src-tauri/src/wol_tests.rs` (nouveau)

```rust
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tokio::net::{TcpListener, UdpSocket};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::ErrorKind;
use crate::model::{Connection, ConnectionInput, Protocol, WolConfig};
use crate::sessions::{CloseReason, SessionEvent, SessionSink, StepKind, StepState};
use crate::wol::{
    WakeTarget, magic_packet, run_wake_step, send_magic_packet, wait_for_port, wake_target,
};

const EVERY: Duration = Duration::from_millis(100);

#[derive(Default)]
struct Recorder(Mutex<Vec<SessionEvent>>);

impl SessionSink for Recorder {
    fn event(&self, event: SessionEvent) {
        self.0.lock().unwrap().push(event);
    }
    fn output(&self, _bytes: Vec<u8>) {}
}

impl Recorder {
    fn events(&self) -> Vec<SessionEvent> {
        self.0.lock().unwrap().clone()
    }
}

fn wake(label: StepState) -> SessionEvent {
    SessionEvent::Step {
        step: StepKind::Wake,
        label: "nas".into(),
        state: label,
    }
}

/// A WoL config that sends its packet to a local UDP socket instead of the LAN broadcast.
fn local_config(udp_port: u16, wait_timeout_secs: u32) -> WolConfig {
    WolConfig {
        mac: "52:54:00:12:34:56".into(),
        broadcast: "127.0.0.1".into(),
        port: udp_port,
        wake_before_connect: true,
        wait_timeout_secs,
    }
}

async fn udp_sink() -> (UdpSocket, u16) {
    let socket = UdpSocket::bind("127.0.0.1:0").await.unwrap();
    let port = socket.local_addr().unwrap().port();
    (socket, port)
}

fn connection(wol: Option<WolConfig>, jump: Option<Uuid>) -> Connection {
    Connection::from_input(
        Uuid::new_v4(),
        ConnectionInput {
            name: "nas".into(),
            host: "192.168.1.10".into(),
            port: 22,
            wol,
            jump_host_id: jump,
            ..ConnectionInput::template(Protocol::Ssh)
        },
        1_000,
    )
}

#[test]
fn the_magic_packet_is_six_ff_then_sixteen_macs() {
    let packet = magic_packet("52:54:00:12:34:56").unwrap();
    assert_eq!(packet.len(), 102);
    assert_eq!(packet[..6], [0xFF; 6]);
    for i in 0..16 {
        let start = 6 + i * 6;
        assert_eq!(
            packet[start..start + 6],
            [0x52, 0x54, 0x00, 0x12, 0x34, 0x56]
        );
    }
}

#[test]
fn a_malformed_mac_is_refused() {
    for mac in [
        "",
        "52:54:00:12:34",
        "52:54:00:12:34:56:78",
        "zz:54:00:12:34:56",
    ] {
        let error = magic_packet(mac).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Validation, "{mac}");
    }
}

#[tokio::test]
async fn the_packet_goes_to_the_broadcast_address_and_port() {
    let (socket, port) = udp_sink().await;
    send_magic_packet(&local_config(port, 10)).await.unwrap();
    let mut buffer = [0u8; 256];
    let (len, _) = tokio::time::timeout(Duration::from_secs(2), socket.recv_from(&mut buffer))
        .await
        .expect("the packet arrives")
        .unwrap();
    assert_eq!(buffer[..len], magic_packet("52:54:00:12:34:56").unwrap());
}

#[tokio::test]
async fn the_wait_ends_as_soon_as_the_port_answers() {
    let probe = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = probe.local_addr().unwrap().port();
    drop(probe);
    // The host "boots": its port opens after 300 ms.
    let server = tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(300)).await;
        let listener = TcpListener::bind(("127.0.0.1", port)).await.unwrap();
        let _ = listener.accept().await;
    });
    let started = Instant::now();
    wait_for_port("127.0.0.1", port, Duration::from_secs(5), EVERY)
        .await
        .unwrap();
    assert!(
        started.elapsed() < Duration::from_secs(2),
        "{:?}",
        started.elapsed()
    );
    server.abort();
}

#[tokio::test]
async fn a_host_that_never_wakes_is_a_timeout_on_time() {
    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let started = Instant::now();
    let error = wait_for_port("127.0.0.1", port, Duration::from_millis(500), EVERY)
        .await
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::Timeout);
    assert!(
        error.message.contains("did not wake up"),
        "{}",
        error.message
    );
    let elapsed = started.elapsed();
    assert!(elapsed >= Duration::from_millis(450), "{elapsed:?}");
    assert!(elapsed < Duration::from_millis(1500), "{elapsed:?}");
}

#[test]
fn only_a_direct_connection_that_asks_for_it_is_woken() {
    let config = local_config(9, 120);
    assert_eq!(wake_target(&connection(None, None)), None);

    let not_asked = WolConfig {
        wake_before_connect: false,
        ..config.clone()
    };
    assert_eq!(wake_target(&connection(Some(not_asked), None)), None);

    // Behind a bastion, a broadcast from here would not reach the host's network.
    let behind = connection(Some(config.clone()), Some(Uuid::new_v4()));
    assert_eq!(wake_target(&behind), None);

    let direct = connection(Some(config.clone()), None);
    assert_eq!(
        wake_target(&direct),
        Some(WakeTarget {
            name: "nas".into(),
            host: "192.168.1.10".into(),
            port: 22,
            config,
        })
    );
}

#[tokio::test]
async fn the_wake_step_sends_waits_and_reports() {
    let (_socket, udp) = udp_sink().await;
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = WakeTarget {
        name: "nas".into(),
        host: "127.0.0.1".into(),
        port: listener.local_addr().unwrap().port(),
        config: local_config(udp, 5),
    };
    let recorder = Recorder::default();
    assert!(run_wake_step(&target, EVERY, CancellationToken::new(), &recorder).await);
    assert_eq!(
        recorder.events(),
        [wake(StepState::Started), wake(StepState::Done)]
    );
}

#[tokio::test]
async fn a_failed_wake_stops_the_session_with_an_error() {
    let (_socket, udp) = udp_sink().await;
    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let target = WakeTarget {
        name: "nas".into(),
        host: "127.0.0.1".into(),
        port,
        // wait_timeout_secs is whole seconds: 1 s is the shortest wait.
        config: local_config(udp, 1),
    };
    let recorder = Recorder::default();
    assert!(!run_wake_step(&target, EVERY, CancellationToken::new(), &recorder).await);
    let events = recorder.events();
    assert_eq!(
        events[..2],
        [wake(StepState::Started), wake(StepState::Failed)]
    );
    assert!(matches!(
        &events[2],
        SessionEvent::Error { error } if error.kind == ErrorKind::Timeout
    ));
    assert_eq!(events.len(), 3);
}

#[tokio::test]
async fn closing_the_tab_during_the_wait_ends_quietly() {
    let (_socket, udp) = udp_sink().await;
    let closed = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = closed.local_addr().unwrap().port();
    drop(closed);
    let target = WakeTarget {
        name: "nas".into(),
        host: "127.0.0.1".into(),
        port,
        config: local_config(udp, 60),
    };
    let cancel = CancellationToken::new();
    let later = cancel.clone();
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(200)).await;
        later.cancel();
    });
    let recorder = Recorder::default();
    let started = Instant::now();
    assert!(!run_wake_step(&target, EVERY, cancel, &recorder).await);
    assert!(started.elapsed() < Duration::from_secs(2));
    assert_eq!(
        recorder.events(),
        [
            wake(StepState::Started),
            SessionEvent::Closed {
                reason: CloseReason::UserClosed,
                exit_status: None,
            },
        ]
    );
}
```

### `src-tauri/src/commands/ipc_wol_tests.rs` (nouveau)

```rust
use std::net::UdpSocket;
use std::time::Duration;

use serde_json::json;

use super::ipc_tests::{create_connection, invoke, mock_app, ok};

#[test]
fn wol_wake_accepts_the_id_sent_by_ipc_ts() {
    let dir = tempfile::tempdir().unwrap();
    let (_app, webview) = mock_app(dir.path());

    // Without Wake-on-LAN: refused, with the field to blame.
    let plain = create_connection(&webview, "plain");
    let error = invoke(&webview, "wol_wake", json!({ "id": plain["id"] })).unwrap_err();
    assert_eq!(error["kind"], "validation");
    assert!(
        error["message"].as_str().unwrap().starts_with("wol"),
        "{error}"
    );

    // With Wake-on-LAN aimed at a local UDP socket: the packet arrives.
    let socket = UdpSocket::bind("127.0.0.1:0").unwrap();
    socket
        .set_read_timeout(Some(Duration::from_secs(2)))
        .unwrap();
    let port = socket.local_addr().unwrap().port();
    let templates = ok(&webview, "connection_templates", json!({}));
    let mut input = templates["ssh"].clone();
    input["name"] = json!("sleepy");
    input["host"] = json!("10.0.0.2");
    input["wol"] = json!({
        "mac": "52:54:00:12:34:56",
        "broadcast": "127.0.0.1",
        "port": port,
        "wakeBeforeConnect": false,
        "waitTimeoutSecs": 120
    });
    let sleepy = ok(&webview, "connection_create", json!({ "input": input }));
    ok(&webview, "wol_wake", json!({ "id": sleepy["id"] }));

    let mut buffer = [0u8; 256];
    let (len, _) = socket.recv_from(&mut buffer).expect("the magic packet");
    assert_eq!(len, 102);
}
```

### `src/lib/mock/wol.test.ts` (nouveau)

```ts
// T29: the mock's Wake-on-LAN, and the Wake step of a session.
import { beforeEach, describe, expect, test } from "vitest";
import type { SessionEvent } from "@/bindings/SessionEvent";
import { toInput } from "@/features/connections/to-input";
import { toAppError } from "@/lib/errors";
import { ipc } from "@/lib/ipc";
import { resetMockBackend } from "@/lib/ipc-mock";
import { MOCK_IDS } from "@/lib/mock/data";

beforeEach(() => {
  resetMockBackend();
});

async function rejection(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return toAppError(error);
  }
  throw new Error("expected a rejection");
}

/** Open a session on `connectionId` and collect its events until it is connected. */
async function stepsOf(connectionId: string): Promise<SessionEvent[]> {
  const events: SessionEvent[] = [];
  await new Promise<void>((resolve) => {
    void ipc.sshOpen(
      crypto.randomUUID(),
      { type: "saved", connectionId },
      { cols: 80, rows: 24 },
      {
        onEvent: (event) => {
          events.push(event);
          if (event.type === "connected") resolve();
        },
        onOutput: () => {},
      },
    );
  });
  return events;
}

describe("mock wol_wake", () => {
  test("a connection with Wake-on-LAN is woken", async () => {
    await expect(ipc.wolWake(MOCK_IDS.winDesktop)).resolves.toBeNull();
  });

  test("a connection without Wake-on-LAN is refused on the wol field", async () => {
    const error = await rejection(ipc.wolWake(MOCK_IDS.nas));
    expect(error.kind).toBe("validation");
    expect(error.message.startsWith("wol")).toBe(true);
  });
});

describe("the Wake step", () => {
  test("comes first for a direct connection that asks for it", async () => {
    const { connections } = await ipc.storeLoad();
    const nas = connections.find((c) => c.id === MOCK_IDS.nas);
    if (!nas) throw new Error("nas is in the demo data");
    await ipc.connectionUpdate(nas.id, {
      ...toInput(nas),
      wol: {
        mac: "AA:BB:CC:DD:EE:FF",
        broadcast: "255.255.255.255",
        port: 9,
        wakeBeforeConnect: true,
        waitTimeoutSecs: 120,
      },
    });
    const steps = (await stepsOf(nas.id)).filter((e) => e.type === "step");
    expect(steps.slice(0, 2)).toEqual([
      { type: "step", step: "wake", label: "nas", state: "started" },
      { type: "step", step: "wake", label: "nas", state: "done" },
    ]);
    expect(steps[2]).toMatchObject({ step: "target" });
  });

  test("is absent without wakeBeforeConnect", async () => {
    const steps = await stepsOf(MOCK_IDS.nas);
    expect(steps.some((e) => e.type === "step" && e.step === "wake")).toBe(false);
  });
});
```

### `e2e/wake.spec.ts` (nouveau)

```ts
// T29: Wake-on-LAN from the menu, and before connecting (mock: win-desktop has Wake-on-LAN).
import { expect, type Page, test } from "./support/test.ts";

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

function editor(page: Page) {
  return page.getByRole("dialog");
}

function row(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^${name}`) }).first();
}

test("the menu's Wake up sends the magic packet and says so", async ({ page }) => {
  await row(page, "win-desktop").click({ button: "right" });
  await page.getByRole("menu").getByText("Wake up", { exact: true }).click();
  await expect(page.getByText("Magic packet sent to win-desktop")).toBeVisible();
});

test("a connection set to wake before connecting shows the Wake step first", async ({ page }) => {
  await row(page, "nas").click({ button: "right" });
  await page.getByRole("menu").getByText("Edit", { exact: true }).click();
  await editor(page).getByRole("tab", { name: "Network" }).click();
  await editor(page).getByRole("switch", { name: "Wake-on-LAN" }).click();
  await editor(page).getByLabel("MAC address", { exact: true }).fill("aa:bb:cc:dd:ee:ff");
  await editor(page).getByRole("switch", { name: "Wake before connecting" }).click();
  await editor(page).getByRole("button", { name: "Save", exact: true }).click();
  await expect(editor(page)).toHaveCount(0);

  await row(page, "nas").dblclick();
  const view = page.getByRole("region", { name: "nas", exact: true });
  await expect(view.getByRole("status")).toContainText("Waking up nas");
  await expect(view.locator(".xterm-rows")).toContainText("Welcome to nas");
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T29`.
2. `wol.rs` (paquet, envoi, attente), `lib.rs`, `connect_step` en `pub(crate)` :
   `cd src-tauri && cargo test --lib wol` jusqu'au vert.
3. `commands/wol.rs`, `commands/mod.rs`, `lib.rs` (`invoke_handler`), `commands/ssh.rs` :
   `cargo test --lib commands::ipc_wol`, puis `cargo clippy --all-targets --all-features -- -D warnings`.
4. Frontend : `ipc.ts`, `lib/mock/wol.ts`, `ipc-mock.ts`, `lib/mock/sessions.ts`, `connections/wake.ts`,
   `ConnectionContextMenu.tsx`, `en.json`, `fr.json` : `npx vitest run src/lib/mock`, puis
   `npx playwright test e2e/wake.spec.ts e2e/editor-network.spec.ts e2e/sessions.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, ligne « Works today » du `README.md`, commit
   `feat: Wake-on-LAN from the menu and before connecting (T29)`.

## Critères d'acceptation

- [ ] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T29 --check` affiche `OK`
      partout.
- [ ] `grep -n "notifyComingSoon" src/features/shell/sidebar/ConnectionContextMenu.tsx` ne montre plus l'élément
      « Réveiller » (SFTP peut encore l'utiliser).
- [ ] `wc -l src-tauri/src/ssh/session.rs` : 400 lignes au plus.
- [ ] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

Sur une machine de ton réseau qui sait se réveiller : configure son WoL (onglet Réseau), éteins-la, puis
« Réveiller » dans le menu. Avec « Réveiller avant de se connecter », un double-clic montre « Waking up … » jusqu'à
ce que son port réponde (2 minutes au plus par défaut).
