//! SSH building blocks that build and test without a server (T17).
pub mod auth;
pub mod auth_secret;
pub mod connect;
pub mod error;
pub mod handler;
pub mod known_hosts;

#[cfg(test)]
mod auth_tests;
#[cfg(test)]
mod error_tests;
#[cfg(test)]
mod known_hosts_tests;

use std::path::PathBuf;
use std::sync::Arc;

use crate::prompts::PromptBroker;
use crate::secrets::SecretStore;
use crate::ssh::known_hosts::KnownHosts;

/// Everything a connection needs besides its target. Cheap to clone.
#[derive(Clone)]
pub struct SshContext {
    pub known_hosts: Arc<KnownHosts>,
    pub prompts: Arc<PromptBroker>,
    pub secrets: Arc<SecretStore>,     // used from T18
    pub agent_socket: Option<PathBuf>, // SSH_AUTH_SOCK, used from T18
}
