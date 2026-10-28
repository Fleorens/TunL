//! SSH building blocks that build and test without a server (T17).
pub mod auth;
pub mod auth_secret;
pub mod chain;
pub mod connect;
pub mod error;
pub mod forward;
pub mod handler;
pub mod known_hosts;
pub mod known_hosts_file;
pub mod link;
pub mod session;
pub mod shell;

#[cfg(test)]
mod auth_tests;
#[cfg(test)]
mod chain_tests;
#[cfg(test)]
mod connect_tests;
#[cfg(test)]
mod error_tests;
#[cfg(test)]
mod handshake_timeout_tests;
#[cfg(test)]
mod known_hosts_format_tests;
#[cfg(test)]
mod known_hosts_list_tests;
#[cfg(test)]
mod known_hosts_tests;
#[cfg(test)]
mod session_tests;

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
