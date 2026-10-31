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
        edit_dir: None,
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
