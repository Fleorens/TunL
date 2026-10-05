//! Shared by the `ssh_*` integration tests (feature `test-env`): the podman environment of T16, contexts, and a
//! prompt responder. Each test crate uses part of it only.
#![allow(dead_code)]

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use russh::client::Handle;
use serde_json::Value;
use tunl_lib::error::AppResult;
use tunl_lib::prompts::{PromptAnswer, PromptBroker, PromptRequest};
use tunl_lib::secrets::SecretStore;
use tunl_lib::ssh::SshContext;
use tunl_lib::ssh::connect::{client_config, handshake, tcp_connect};
use tunl_lib::ssh::handler::{ClientHandler, HostKeyTarget};
use tunl_lib::ssh::known_hosts::KnownHosts;

/// `scripts/test-env/.state/env.json`, written by `npm run test-env:up`.
pub struct TestEnv {
    raw: Value,
}

impl TestEnv {
    pub fn load() -> Self {
        let path =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../scripts/test-env/.state/env.json");
        let text = std::fs::read_to_string(&path).unwrap_or_else(|_| {
            panic!(
                "{} is missing: run `npm run test-env:up` first",
                path.display()
            )
        });
        Self {
            raw: serde_json::from_str(&text).unwrap(),
        }
    }

    fn text(&self, pointer: &str) -> String {
        self.raw
            .pointer(pointer)
            .and_then(Value::as_str)
            .unwrap_or_else(|| panic!("env.json has no {pointer}"))
            .to_string()
    }

    pub fn user(&self) -> String {
        self.text("/user")
    }
    pub fn password(&self) -> String {
        self.text("/password")
    }
    pub fn passphrase(&self) -> String {
        self.text("/passphrase")
    }
    /// `which` = "target" | "bastion" | "hidden".
    pub fn host(&self, which: &str) -> String {
        self.text(&format!("/{which}/host"))
    }
    pub fn port(&self, which: &str) -> u16 {
        self.raw
            .pointer(&format!("/{which}/port"))
            .and_then(Value::as_u64)
            .and_then(|port| u16::try_from(port).ok())
            .unwrap_or_else(|| panic!("env.json has no /{which}/port"))
    }
    /// `which` = "ed25519" | "ed25519Passphrase" | "rsa".
    pub fn key(&self, which: &str) -> String {
        self.text(&format!("/keys/{which}"))
    }
    pub fn known_hosts(&self) -> PathBuf {
        PathBuf::from(self.text("/knownHosts"))
    }
    /// `SHA256:…` of a server's host key.
    pub fn host_key(&self, which: &str) -> String {
        self.text(&format!("/hostKeys/{which}"))
    }
}

/// A context whose own known_hosts lives in `own_dir` (empty at first) and whose user file is the environment's
/// `known_hosts`: the three servers are trusted.
pub fn context(
    env: &TestEnv,
    own_dir: &Path,
    prompts: Arc<PromptBroker>,
    secrets: SecretStore,
) -> SshContext {
    SshContext {
        known_hosts: Arc::new(KnownHosts::new(
            own_dir.join("known_hosts"),
            Some(env.known_hosts()),
        )),
        prompts,
        secrets: Arc::new(secrets),
        agent_socket: None,
    }
}

/// Same, without a user file: every server is unknown until it is learned in `own_dir`.
pub fn blank_context(
    own_dir: &Path,
    prompts: Arc<PromptBroker>,
    secrets: SecretStore,
) -> SshContext {
    SshContext {
        known_hosts: Arc::new(KnownHosts::new(own_dir.join("known_hosts"), None)),
        prompts,
        secrets: Arc::new(secrets),
        agent_socket: None,
    }
}

pub type Asked = Arc<Mutex<Vec<PromptRequest>>>;

/// Answers each prompt, at once, with the next answer of `script` (`Cancel` once it runs out), and records every
/// request. Installs itself as the broker's emitter.
pub fn respond(broker: &Arc<PromptBroker>, script: Vec<PromptAnswer>) -> Asked {
    let asked: Asked = Arc::new(Mutex::new(Vec::new()));
    let record = asked.clone();
    let answers = Arc::new(Mutex::new(script.into_iter()));
    let weak = Arc::downgrade(broker);
    broker.set_emitter(Box::new(move |request| {
        record.lock().unwrap().push(request.clone());
        let answer = answers
            .lock()
            .unwrap()
            .next()
            .unwrap_or(PromptAnswer::Cancel);
        if let Some(broker) = weak.upgrade() {
            broker.answer(request.id, answer).unwrap();
        }
    }));
    asked
}

pub fn host_key_target(env: &TestEnv, which: &str) -> HostKeyTarget {
    HostKeyTarget {
        host: env.host(which),
        port: env.port(which),
        session_id: None,
    }
}

/// TCP, then the SSH handshake with `which`'s host key checked against `ctx`. Not authenticated yet.
pub async fn connect(
    env: &TestEnv,
    ctx: &SshContext,
    which: &str,
) -> AppResult<Handle<ClientHandler>> {
    let stream = tcp_connect(&env.host(which), env.port(which), Duration::from_secs(5)).await?;
    handshake(stream, host_key_target(env, which), client_config(15), ctx).await
}
