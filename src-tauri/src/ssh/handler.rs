//! The russh handler that decides whether to trust the server's host key (T17b).
//!
//! `check_server_key` routes the presented key through `known_hosts`: known → trust, changed → refuse
//! (no « continue anyway », S6), unknown → ask the `PromptBroker` and remember the answer for the
//! session.
use russh::keys::PublicKeyOrCertificate;

use crate::error::{AppError, ErrorDetail, ErrorKind};
use crate::prompts::{PromptAnswer, PromptKind};
use crate::ssh::SshContext;
use crate::ssh::error::SshError;
use crate::ssh::known_hosts::{HostKeyStatus, fingerprint};

/// What a connection asks about its server key: the target, and the session it belongs to (so a
/// prompt can be matched to its tab).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostKeyTarget {
    pub host: String,
    pub port: u16,
    pub session_id: Option<uuid::Uuid>,
}

/// The russh handler for one connection.
pub struct ClientHandler {
    target: HostKeyTarget,
    ctx: SshContext,
}

impl ClientHandler {
    pub fn new(target: HostKeyTarget, ctx: SshContext) -> Self {
        Self { target, ctx }
    }
}

impl russh::client::Handler for ClientHandler {
    type Error = SshError;

    async fn check_server_key(&mut self, key: &PublicKeyOrCertificate) -> Result<bool, SshError> {
        match key {
            // A host certificate is a third party's signature, not the server's own key.
            PublicKeyOrCertificate::Certificate(_) => Err(AppError::new(
                ErrorKind::HostKeyRejected,
                "host certificates are not supported",
            )
            .into()),
            PublicKeyOrCertificate::PublicKey { key, .. } => {
                match self
                    .ctx
                    .known_hosts
                    .check(&self.target.host, self.target.port, key)
                {
                    // Recorded as-is: trust it, no prompt.
                    HostKeyStatus::Known => Ok(true),
                    // The recorded key differs: refuse, no « continue anyway » (S6).
                    HostKeyStatus::Changed {
                        path,
                        line,
                        known_fingerprint,
                        removable,
                    } => Err(AppError::new(ErrorKind::HostKeyChanged, "host key changed")
                        .with_detail(ErrorDetail::HostKeyChanged {
                            host: self.target.host.clone(),
                            port: self.target.port,
                            key_type: key.algorithm().as_str().to_string(),
                            fingerprint: fingerprint(key),
                            known_fingerprint,
                            known_hosts_path: path.to_string_lossy().into_owned(),
                            line: line as u32,
                            removable,
                        })
                        .into()),
                    // Unknown: ask the user, then remember the answer for this session.
                    HostKeyStatus::Unknown => {
                        let answer = self
                            .ctx
                            .prompts
                            .ask(
                                self.target.session_id,
                                PromptKind::HostKeyUnknown {
                                    host: self.target.host.clone(),
                                    port: self.target.port,
                                    key_type: key.algorithm().as_str().to_string(),
                                    fingerprint: fingerprint(key),
                                },
                            )
                            .await?;
                        match answer {
                            PromptAnswer::Accept => {
                                // A write failure is logged, not fatal: the key is still trusted this session.
                                if let Err(error) = self.ctx.known_hosts.learn(
                                    &self.target.host,
                                    self.target.port,
                                    key,
                                ) {
                                    log::warn!("cannot learn host key: {error}");
                                }
                                Ok(true)
                            }
                            // Rejected, cancelled, or any other answer: stop the connection.
                            _ => Err(AppError::new(
                                ErrorKind::HostKeyRejected,
                                "host key rejected",
                            )
                            .into()),
                        }
                    }
                }
            }
        }
    }
}
