use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::json;
use uuid::Uuid;

use crate::error::ErrorKind;
use crate::prompts::{InteractivePrompt, PromptAnswer, PromptBroker, PromptKind, PromptRequest};

type Seen = Arc<Mutex<Vec<PromptRequest>>>;

fn host_key() -> PromptKind {
    PromptKind::HostKeyUnknown {
        host: "db.internal".into(),
        port: 22,
        key_type: "ssh-ed25519".into(),
        fingerprint: "SHA256:abc".into(),
    }
}

/// A broker whose emitter records every request it is asked to show.
fn recording(timeout: Duration) -> (Arc<PromptBroker>, Seen) {
    let broker = Arc::new(PromptBroker::with_timeout(timeout));
    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    let sink = seen.clone();
    broker.set_emitter(Box::new(move |request| {
        sink.lock().unwrap().push(request.clone())
    }));
    (broker, seen)
}

/// Waits for the `n`-th emitted request (1-based).
async fn nth_request(seen: &Seen, n: usize) -> PromptRequest {
    for _ in 0..400 {
        if let Some(request) = seen.lock().unwrap().get(n - 1).cloned() {
            return request;
        }
        tokio::time::sleep(Duration::from_millis(5)).await;
    }
    panic!("prompt #{n} was never emitted");
}

#[tokio::test]
async fn an_answer_reaches_the_asking_task() {
    let (broker, seen) = recording(Duration::from_secs(5));
    let session = Uuid::new_v4();
    let asking = tokio::spawn({
        let broker = broker.clone();
        async move { broker.ask(Some(session), host_key()).await }
    });

    let request = nth_request(&seen, 1).await;
    assert_eq!(request.session_id, Some(session));
    assert_eq!(request.prompt, host_key());
    assert_eq!(broker.pending_count(), 1);

    broker.answer(request.id, PromptAnswer::Accept).unwrap();
    assert!(matches!(asking.await.unwrap(), Ok(PromptAnswer::Accept)));
    assert_eq!(broker.pending_count(), 0);
}

#[tokio::test]
async fn an_emitter_may_answer_at_once() {
    // `ask` releases its lock before calling the emitter: answering from inside it must not deadlock.
    let broker = Arc::new(PromptBroker::with_timeout(Duration::from_secs(5)));
    let weak = Arc::downgrade(&broker);
    broker.set_emitter(Box::new(move |request| {
        if let Some(broker) = weak.upgrade() {
            broker.answer(request.id, PromptAnswer::Reject).unwrap();
        }
    }));
    let answer = tokio::time::timeout(Duration::from_secs(2), broker.ask(None, host_key()))
        .await
        .expect("ask deadlocked");
    assert!(matches!(answer, Ok(PromptAnswer::Reject)));
}

#[tokio::test]
async fn answering_an_unknown_prompt_is_not_found() {
    let (broker, _) = recording(Duration::from_secs(5));
    let error = broker
        .answer(Uuid::new_v4(), PromptAnswer::Cancel)
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::NotFound);
}

#[tokio::test]
async fn a_prompt_left_unanswered_times_out_as_cancelled() {
    let (broker, _) = recording(Duration::from_millis(50));
    let error = broker.ask(None, host_key()).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::Cancelled);
    assert_eq!(broker.pending_count(), 0);
}

#[tokio::test]
async fn closing_a_session_cancels_its_prompts_only() {
    let (broker, seen) = recording(Duration::from_secs(5));
    let closed = Uuid::new_v4();
    let other = Uuid::new_v4();
    let first = tokio::spawn({
        let broker = broker.clone();
        async move { broker.ask(Some(closed), host_key()).await }
    });
    nth_request(&seen, 1).await;
    let second = tokio::spawn({
        let broker = broker.clone();
        async move { broker.ask(Some(other), host_key()).await }
    });
    let request = nth_request(&seen, 2).await;

    broker.cancel_session(closed);
    assert_eq!(first.await.unwrap().unwrap_err().kind, ErrorKind::Cancelled);
    assert_eq!(broker.pending_count(), 1);

    broker.answer(request.id, PromptAnswer::Reject).unwrap();
    assert!(matches!(second.await.unwrap(), Ok(PromptAnswer::Reject)));
}

#[tokio::test]
async fn a_dropped_ask_leaves_nothing_pending() {
    // A session cancelled while its prompt is open drops the `ask` future: its entry goes with it.
    let (broker, seen) = recording(Duration::from_secs(5));
    let asking = tokio::spawn({
        let broker = broker.clone();
        async move { broker.ask(None, host_key()).await }
    });
    nth_request(&seen, 1).await;
    asking.abort();
    let _ = asking.await;
    assert_eq!(broker.pending_count(), 0);
}

#[tokio::test]
async fn asking_without_an_emitter_is_an_internal_error() {
    let broker = PromptBroker::with_timeout(Duration::from_secs(5));
    let error = broker.ask(None, host_key()).await.unwrap_err();
    assert_eq!(error.kind, ErrorKind::Internal);
    assert_eq!(broker.pending_count(), 0);
}

#[test]
fn requests_serialize_for_the_frontend() {
    let request = PromptRequest {
        id: Uuid::nil(),
        session_id: None,
        prompt: PromptKind::Password {
            connection_name: "web-01".into(),
            username: "deploy".into(),
            host: "10.0.0.12".into(),
            can_save: true,
            retry: false,
        },
    };
    assert_eq!(
        serde_json::to_value(&request).unwrap(),
        json!({
            "id": "00000000-0000-0000-0000-000000000000",
            "sessionId": null,
            "prompt": {
                "kind": "password",
                "connectionName": "web-01",
                "username": "deploy",
                "host": "10.0.0.12",
                "canSave": true,
                "retry": false
            }
        })
    );

    let interactive = PromptKind::KeyboardInteractive {
        connection_name: "web-01".into(),
        name: String::new(),
        instructions: String::new(),
        prompts: vec![InteractivePrompt {
            text: "Code: ".into(),
            echo: true,
        }],
    };
    let value = serde_json::to_value(&interactive).unwrap();
    assert_eq!(value["kind"], "keyboardInteractive");
    assert_eq!(
        value["prompts"],
        json!([{ "text": "Code: ", "echo": true }])
    );

    assert_eq!(
        serde_json::to_value(host_key()).unwrap()["keyType"],
        "ssh-ed25519"
    );
}

#[test]
fn answers_deserialize_from_the_frontend() {
    let secret: PromptAnswer =
        serde_json::from_value(json!({ "kind": "secret", "value": "hunter2", "save": true }))
            .unwrap();
    // The value never shows up in a Debug print (S3).
    assert!(!format!("{secret:?}").contains("hunter2"));
    match secret {
        PromptAnswer::Secret { value, save } => {
            assert_eq!(value.expose(), "hunter2");
            assert!(save);
        }
        other => panic!("unexpected answer: {other:?}"),
    }

    let responses: PromptAnswer =
        serde_json::from_value(json!({ "kind": "responses", "values": ["123456"] })).unwrap();
    assert!(
        matches!(responses, PromptAnswer::Responses { ref values } if values.len() == 1 && values[0].expose() == "123456")
    );

    for (kind, expected) in [
        ("accept", "Accept"),
        ("reject", "Reject"),
        ("cancel", "Cancel"),
    ] {
        let answer: PromptAnswer = serde_json::from_value(json!({ "kind": kind })).unwrap();
        assert_eq!(format!("{answer:?}"), expected);
    }
}
