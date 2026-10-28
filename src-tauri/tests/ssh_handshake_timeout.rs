//! T49 against the podman target: the handshake delay never covers the time spent on the host key question.
//! `npm run test:ssh`.
#![cfg(feature = "test-env")]

mod support;

use std::sync::Arc;
use std::time::Duration;

use support::{TestEnv, blank_context, host_key_target};
use tunl_lib::prompts::{PromptAnswer, PromptBroker};
use tunl_lib::secrets::SecretStore;
use tunl_lib::ssh::connect::{client_config, handshake_timed, tcp_connect};

#[tokio::test]
async fn a_slow_answer_to_the_host_key_question_is_not_a_timeout() {
    let env = TestEnv::load();
    let dir = tempfile::tempdir().unwrap();
    let broker = Arc::new(PromptBroker::new());
    let weak = Arc::downgrade(&broker);
    // Answer "trust" 1.5 s after the question, three times longer than the delay below.
    broker.set_emitter(Box::new(move |request| {
        let id = request.id;
        let weak = weak.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(1500));
            if let Some(broker) = weak.upgrade() {
                broker.answer(id, PromptAnswer::Accept).unwrap();
            }
        });
    }));
    let ctx = blank_context(dir.path(), broker, SecretStore::memory());

    let stream = tcp_connect(
        &env.host("target"),
        env.port("target"),
        Duration::from_secs(5),
    )
    .await
    .unwrap();
    let handle = handshake_timed(
        stream,
        host_key_target(&env, "target"),
        client_config(15),
        &ctx,
        Duration::from_millis(500),
    )
    .await;
    assert!(handle.is_ok(), "the delay stops once the host key is shown");
}
