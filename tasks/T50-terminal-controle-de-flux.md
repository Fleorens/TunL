# T50 — Terminal : contrôle de flux des gros affichages, copie à la sélection groupée

| | |
|---|---|
| **Jalon** | M9 — Revue globale (lot 7) |
| **Dépend de** | T49 |
| **Lire avant** | `docs/01-architecture.md` § 6 (sessions, canaux) ; `docs/06-securite.md` S10 |
| **Livrable** | `ssh/shell.rs`, `sessions.rs`, `commands/ssh.rs`, `lib.rs`, `commands/ipc_tests.rs`, `ipc.ts`, `ipc-mock.ts`, `terminal/port.ts`, `terminal/use-xterm.ts`, `sessions/session-ports.ts` ; `src-tauri/tests/ssh_flow_control.rs`, `src/features/terminal/port-ack.test.ts` |

## Pourquoi

Revue globale du 2026-10-27, **supposé (lecture du code, à mesurer dans la vraie app)** : le shell envoie sa sortie au
terminal aussi vite que le réseau la livre (blocs de 64 Kio, S10), sans jamais attendre qu'xterm l'ait affichée.
`cat` d'un gros journal, `yes`, un `find /` : la file d'attente d'xterm grossit plus vite qu'il ne l'analyse. Au-delà
de 50 Mo en attente, xterm **jette** les données (« write data discarded, use flow control to avoid losing data »,
vérifié dans `node_modules/@xterm/xterm`). Avant d'en arriver là, la fenêtre se fige, et Ctrl+C met des secondes à
passer.

Remède classique (documenté par xterm.js) : accuser réception de ce que le terminal a analysé, et suspendre la lecture
du canal SSH au-delà d'un seuil. Le serveur est alors freiné par le contrôle de flux de SSH lui-même.

Au passage, **copie à la sélection** (lecture) : `onSelectionChange` écrit dans le presse-papiers à chaque
mouvement de souris pendant le glisser (un appel IPC par événement).

## À réutiliser (ne pas réécrire)

- `ShellInput`, `SessionRegistry::send`, `pump`, `emit_output`, `OUTPUT_CHUNK` (Rust) ; `createTerminalPort`,
  `registerSessionPort`, `handlePortError` (le `notFound` d'une session finie est ignoré, comme pour `sshWrite`).

## Contrat — Rust

- `ShellInput::Ack(usize)` : des octets de sortie que l'interface a fini d'afficher.
- Dans `shell.rs` : `pub const ACK_HIGH_WATER: usize = 4 * 1024 * 1024;` et
  `pub const ACK_LOW_WATER: usize = 1024 * 1024;`.
- `pump` compte les octets envoyés au `sink` et pas encore acquittés (`unacked`, soustraction saturée à chaque
  `Ack`). Quand `unacked >= ACK_HIGH_WATER`, il **cesse de lire le canal** (`read.wait()` n'est plus interrogé), mais
  continue de traiter les frappes, les redimensionnements, les `Ack` et l'annulation. Il reprend la lecture quand
  `unacked <= ACK_LOW_WATER`.
- Nouvelle commande `ssh_ack(session_id: Uuid, bytes: u32) -> AppResult<()>`, qui envoie `ShellInput::Ack`. Une
  session inconnue est `notFound`. Elle est ajoutée à `invoke_handler()` et appelée dans `commands/ipc_tests.rs`
  avec les clés `{ sessionId, bytes }`.

## Contrat — Frontend

- `ipc.sshAck(sessionId, bytes)` (et son pendant dans `ipc-mock.ts`, qui ne fait rien).
- `port.ts` : `PortSender` gagne `ack?(bytes: number): void` (optionnel : les tests de T20 construisent un sender
  sans). `TerminalPort` gagne `ack(bytes: number): void`, qui le relaie. Une sortie que le port jette faute
  d'abonné (au-delà de `limit`) est acquittée aussitôt.
- `use-xterm.ts` : chaque bloc est écrit avec `term.write(bytes, callback)`, et le callback acquitte sa taille via
  `port.ack`.
- `session-ports.ts` : les acquittements d'un onglet sont regroupés, puis envoyés à la tentative en cours
  (`ipc.sshAck(runId, n)`) dès qu'ils dépassent 256 Kio, ou 100 ms après le dernier. Rien n'est envoyé si la session
  n'est plus vivante.
- Copie à la sélection : le presse-papiers est écrit une fois la sélection finie (au relâchement de la souris, ou
  150 ms après le dernier changement), pas à chaque changement.

## Pièges

- `tokio::select!` accepte une précondition par branche : `message = read.wait(), if !paused => …`.
- Chaque octet poussé dans le port est acquitté **exactement une fois** : quand xterm l'a analysé, ou quand le port
  le jette. Sinon la session reste suspendue pour toujours (un onglet caché reste abonné : pas de souci là).
- Une reconnexion repart de zéro côté Rust (nouvelle tâche) : remettre le cumul de l'onglet à zéro sur `runId`
  nouveau.
- Rien de ce qui passe n'est journalisé (S8).

## Tests du contrat

### `src-tauri/tests/ssh_flow_control.rs` (nouveau)

```rust
//! T50 against the podman target: without acks the shell stops being read at the high water mark, and an ack
//! resumes it. `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::Arc;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

use support::{TestEnv, context, respond};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tunl_lib::prompts::PromptBroker;
use tunl_lib::secrets::{SecretKind, SecretStore, SecretValue};
use tunl_lib::sessions::{SessionEvent, SessionSink, ShellInput};
use tunl_lib::ssh::auth::AuthPlan;
use tunl_lib::ssh::link::establish;
use tunl_lib::ssh::session::SshTarget;
use tunl_lib::ssh::shell::{ACK_HIGH_WATER, OUTPUT_CHUNK, open_shell, pump};
use uuid::Uuid;

#[derive(Default)]
struct Counter(AtomicUsize);

impl SessionSink for Counter {
    fn event(&self, _event: SessionEvent) {}
    fn output(&self, bytes: Vec<u8>) {
        self.0.fetch_add(bytes.len(), Ordering::SeqCst);
    }
}

impl Counter {
    fn total(&self) -> usize {
        self.0.load(Ordering::SeqCst)
    }
}

#[tokio::test]
async fn without_acks_the_shell_pauses_and_an_ack_resumes_it() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let target = SshTarget {
        connection_id: Some(Uuid::new_v4()),
        connection_name: "target".into(),
        host: env.host("target"),
        port: env.port("target"),
        username: env.user(),
        plan: AuthPlan::Password,
        connect_timeout: Duration::from_secs(5),
        keepalive_secs: 15,
        jump_hosts: Vec::new(),
    };
    let secrets = SecretStore::memory();
    secrets
        .set(
            target.connection_id.unwrap(),
            "target",
            SecretKind::Password,
            &SecretValue::new(env.password()),
        )
        .await
        .unwrap();
    let broker = Arc::new(PromptBroker::new());
    respond(&broker, vec![]);
    let ctx = context(&env, dir.path(), broker, secrets);
    let quiet = Counter::default();
    let link = establish(&ctx, &target, Uuid::new_v4(), CancellationToken::new(), &quiet)
        .await
        .expect("a link to the target");
    let channel = open_shell(&link.target, 80, 24).await.unwrap();

    let (input, receiver) = mpsc::unbounded_channel::<ShellInput>();
    let sink = Arc::new(Counter::default());
    let cancel = CancellationToken::new();
    let task = tokio::spawn({
        let sink = sink.clone();
        let cancel = cancel.clone();
        async move { pump(channel, receiver, cancel, &*sink).await }
    });

    input
        .send(ShellInput::Data(b"yes 0123456789 | head -c 40000000\n".to_vec()))
        .unwrap();
    tokio::time::sleep(Duration::from_secs(3)).await;
    let paused_at = sink.total();
    assert!(paused_at >= ACK_HIGH_WATER / 2, "output flows at first ({paused_at} bytes)");
    assert!(
        paused_at <= ACK_HIGH_WATER + 2 * OUTPUT_CHUNK,
        "without acks the shell is not read past the high water mark ({paused_at} bytes)"
    );
    tokio::time::sleep(Duration::from_millis(500)).await;
    assert_eq!(sink.total(), paused_at, "still paused");

    input.send(ShellInput::Ack(paused_at)).unwrap();
    tokio::time::sleep(Duration::from_secs(2)).await;
    assert!(sink.total() > paused_at, "an ack resumes the output");

    cancel.cancel();
    let _ = task.await;
    link.disconnect().await;
}
```

### `src/features/terminal/port-ack.test.ts` (nouveau)

```ts
// T50: every byte pushed into a port is acked once: by the terminal once parsed, or by the port when it drops it.
import { describe, expect, test, vi } from "vitest";
import { createTerminalPort } from "./port";

function sender() {
  return {
    write: vi.fn<(data: string) => void>(),
    resize: vi.fn<(cols: number, rows: number) => void>(),
    ack: vi.fn<(bytes: number) => void>(),
  };
}

describe("acks", () => {
  test("output dropped while nobody listens is acked at once", () => {
    const out = sender();
    const { push } = createTerminalPort(out, 10);
    push(new Uint8Array(6));
    expect(out.ack).not.toHaveBeenCalled();
    push(new Uint8Array(6));
    expect(out.ack).toHaveBeenCalledExactlyOnceWith(6);
  });

  test("the terminal acks what it parsed through its port", () => {
    const out = sender();
    const { port } = createTerminalPort(out);
    port.ack(1234);
    expect(out.ack).toHaveBeenCalledExactlyOnceWith(1234);
  });

  test("a sender without ack still works", () => {
    const { port, push } = createTerminalPort({ write: vi.fn(), resize: vi.fn() }, 4);
    push(new Uint8Array(6));
    expect(() => port.ack(6)).not.toThrow();
  });
});
```

## Étapes

1. Les tests : `node scripts/contract-tests.mjs T50`.
2. `sessions.rs` (`Ack`), `shell.rs` (seuils, `pump`), `commands/ssh.rs` (`ssh_ack`), `lib.rs`, `ipc_tests.rs` :
   `cd src-tauri && cargo test --lib`, puis `npm run test:ssh` (pas pendant un job `dev`).
3. `ipc.ts`, `ipc-mock.ts`, `port.ts` : `npx vitest run src/features/terminal`.
4. `use-xterm.ts` (écriture avec callback, copie à la sélection), `session-ports.ts` (regroupement) :
   `npx playwright test e2e/terminal.spec.ts e2e/sessions.spec.ts`.
5. `npm run format`, `npm run review`, cases, statut, commit
   `perf: flow control between the terminal and the shell, batched copy on select (T50)`.

## Critères d'acceptation

- [ ] `npm run review` passe (avec `test:ssh`), et `node scripts/contract-tests.mjs T50 --check` affiche `OK` partout.
- [ ] `grep -n "ssh_ack" src-tauri/src/lib.rs src-tauri/src/commands/ipc_tests.rs` trouve la commande aux deux endroits.
- [x] Aucune nouvelle exception `project-rules: allow`.

## À regarder par Florian

`npm run tauri dev`, une session SSH : `yes | head -c 300000000`, ou un `cat` d'un gros journal. La fenêtre reste
fluide, Ctrl+C arrête aussitôt, et rien ne manque à la fin (`seq 1 2000000` : la dernière ligne est `2000000`).
