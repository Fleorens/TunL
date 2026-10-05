use serde_json::json;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

use crate::error::{AppError, ErrorKind};
use crate::sessions::{
    CloseReason, SessionEvent, SessionHandle, SessionRegistry, ShellInput, StepKind, StepState,
};

fn handle() -> (SessionHandle, mpsc::UnboundedReceiver<ShellInput>) {
    let (input, receiver) = mpsc::unbounded_channel();
    let handle = SessionHandle {
        cancel: CancellationToken::new(),
        input,
    };
    (handle, receiver)
}

#[test]
fn input_reaches_the_session_task() {
    let registry = SessionRegistry::new();
    let id = Uuid::new_v4();
    let (session, mut receiver) = handle();
    registry.insert(id, session).unwrap();
    assert_eq!(registry.len(), 1);

    registry
        .send(id, ShellInput::Data(b"ls\n".to_vec()))
        .unwrap();
    registry
        .send(
            id,
            ShellInput::Resize {
                cols: 120,
                rows: 40,
            },
        )
        .unwrap();
    assert_eq!(
        receiver.try_recv().unwrap(),
        ShellInput::Data(b"ls\n".to_vec())
    );
    assert_eq!(
        receiver.try_recv().unwrap(),
        ShellInput::Resize {
            cols: 120,
            rows: 40
        }
    );
}

#[test]
fn a_session_id_is_used_once() {
    let registry = SessionRegistry::new();
    let id = Uuid::new_v4();
    registry.insert(id, handle().0).unwrap();
    let error = registry.insert(id, handle().0).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
}

#[test]
fn an_unknown_or_finished_session_is_not_found() {
    let registry = SessionRegistry::new();
    let error = registry
        .send(Uuid::new_v4(), ShellInput::Data(vec![]))
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotFound);

    // The task ended and dropped its receiver: sending fails the same way.
    let id = Uuid::new_v4();
    let (session, receiver) = handle();
    registry.insert(id, session).unwrap();
    drop(receiver);
    assert_eq!(
        registry
            .send(id, ShellInput::Data(vec![]))
            .unwrap_err()
            .kind,
        ErrorKind::NotFound
    );
}

#[test]
fn closing_cancels_and_forgets_the_session() {
    let registry = SessionRegistry::new();
    let id = Uuid::new_v4();
    let (session, _receiver) = handle();
    let token = session.cancel.clone();
    registry.insert(id, session).unwrap();

    assert!(registry.close(id));
    assert!(token.is_cancelled());
    assert!(registry.is_empty());
    assert!(!registry.close(id), "closing twice is harmless");
}

#[test]
fn removing_does_not_cancel() {
    // The task removes its own entry when it ends; nothing left to cancel.
    let registry = SessionRegistry::new();
    let id = Uuid::new_v4();
    let (session, _receiver) = handle();
    let token = session.cancel.clone();
    registry.insert(id, session).unwrap();
    registry.remove(id);
    assert!(registry.is_empty());
    assert!(!token.is_cancelled());
}

#[test]
fn session_events_serialize_for_the_frontend() {
    let step = SessionEvent::Step {
        step: StepKind::HostKey,
        label: "db.internal".into(),
        state: StepState::Started,
    };
    assert_eq!(
        serde_json::to_value(step).unwrap(),
        json!({ "type": "step", "step": "hostKey", "label": "db.internal", "state": "started" })
    );
    assert_eq!(
        serde_json::to_value(SessionEvent::Connected).unwrap(),
        json!({ "type": "connected" })
    );
    assert_eq!(
        serde_json::to_value(SessionEvent::Closed {
            reason: CloseReason::RemoteClosed,
            exit_status: Some(0),
        })
        .unwrap(),
        json!({ "type": "closed", "reason": "remoteClosed", "exitStatus": 0 })
    );
    let error = SessionEvent::Error {
        error: AppError::new(ErrorKind::Auth, "authentication failed"),
    };
    assert_eq!(
        serde_json::to_value(error).unwrap(),
        json!({ "type": "error", "error": { "kind": "auth", "message": "authentication failed", "detail": null } })
    );
}
