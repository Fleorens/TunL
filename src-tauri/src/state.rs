use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::RwLock;

use crate::error::{AppError, AppResult};
use crate::model::Settings;
use crate::paths::AppPaths;
use crate::prompts::PromptBroker;
use crate::secrets::SecretStore;
use crate::sessions::SessionRegistry;
use crate::sftp::{SftpRegistry, TransferRegistry};
use crate::ssh::known_hosts::KnownHosts;
use crate::store::{Store, load_settings, load_store, save_settings, save_store};

/// Shared backend state, registered with `app.manage()` during setup.
pub struct AppState {
    pub paths: AppPaths,
    pub started_at_ms: i64,
    /// The in-memory store. Every mutation builds a new value and replaces it here.
    pub store: RwLock<Store>,
    /// Set when `connections.json` could not be loaded (newer TunL, I/O error): every store command
    /// returns it, and nothing is ever written over that file.
    pub store_blocked: Option<AppError>,
    pub settings: RwLock<Settings>,
    /// Files moved aside at startup because they were unreadable (store and settings).
    pub quarantined: Vec<String>,
    /// The keyring: write, presence test and delete a secret, never read it (S2). Shared because a
    /// command holds it across an `.await`, so it cannot be moved out of `state`.
    pub secrets: Arc<SecretStore>,
    /// Poses questions to the user and collects their answers (T17).
    pub prompts: Arc<PromptBroker>,
    /// TunL's known_hosts plus the user OpenSSH file to fall back on (T17).
    pub known_hosts: Arc<KnownHosts>,
    /// Every live session, one per tab id (T19).
    pub sessions: Arc<SessionRegistry>,
    /// The connected SFTP tabs, one per tab id (T24).
    pub sftp: Arc<SftpRegistry>,
    /// The transfers in progress, with the token that cancels each one (T26).
    pub transfers: Arc<TransferRegistry>,
}

impl AppState {
    /// Load the store and settings from disk, quarantining unreadable files. `now_ms` stamps them.
    pub fn from_disk(paths: &AppPaths, now_ms: i64, secrets: SecretStore) -> AppResult<Self> {
        let mut quarantined: Vec<String> = Vec::new();

        let store_loaded = load_store(&paths.config_dir, now_ms);
        let (store, store_blocked) = match store_loaded {
            Ok(loaded) => {
                if let Some(path) = loaded.quarantined {
                    quarantined.push(path.to_string_lossy().into_owned());
                }
                (loaded.value, None)
            }
            Err(error) => {
                // `store_blocked` is set: every store command returns it, nothing is written over the file.
                log::error!("could not load {STORE_FILE}: {error}");
                (Store::default(), Some(error))
            }
        };

        let settings_loaded = load_settings(&paths.config_dir, now_ms);
        let settings = match settings_loaded {
            Ok(loaded) => {
                if let Some(path) = loaded.quarantined {
                    quarantined.push(path.to_string_lossy().into_owned());
                }
                loaded.value
            }
            Err(error) => {
                log::warn!("could not load {SETTINGS_FILE}: {error}; starting with defaults");
                Settings::default()
            }
        };

        Ok(Self {
            paths: paths.clone(),
            started_at_ms: now_ms,
            store: RwLock::new(store),
            store_blocked,
            settings: RwLock::new(settings),
            quarantined,
            secrets: Arc::new(secrets),
            prompts: Arc::new(PromptBroker::new()),
            known_hosts: Arc::new(KnownHosts::for_app(&paths.config_dir)),
            sessions: Arc::new(SessionRegistry::new()),
            sftp: Arc::new(SftpRegistry::default()),
            transfers: Arc::new(TransferRegistry::default()),
        })
    }

    /// The fallback state `lib.rs` builds when the store could not be loaded: a blocked store,
    /// default settings. New fields live here, not in `lib.rs`, so a new field cannot leave `lib.rs`
    /// out of date.
    pub fn blocked(paths: &AppPaths, now_ms: i64, error: AppError, secrets: SecretStore) -> Self {
        Self {
            paths: paths.clone(),
            started_at_ms: now_ms,
            store: RwLock::new(Store::default()),
            store_blocked: Some(error),
            settings: RwLock::new(Settings::default()),
            quarantined: Vec::new(),
            secrets: Arc::new(secrets),
            prompts: Arc::new(PromptBroker::new()),
            known_hosts: Arc::new(KnownHosts::for_app(&paths.config_dir)),
            sessions: Arc::new(SessionRegistry::new()),
            sftp: Arc::new(SftpRegistry::default()),
            transfers: Arc::new(TransferRegistry::default()),
        }
    }

    /// Everything a connection needs besides its target: the shared building blocks, cloned cheaply
    /// so the connection engine can be tested without Tauri (T17b).
    pub fn ssh_context(&self) -> crate::ssh::SshContext {
        crate::ssh::SshContext {
            known_hosts: self.known_hosts.clone(),
            prompts: self.prompts.clone(),
            secrets: self.secrets.clone(),
            agent_socket: std::env::var_os("SSH_AUTH_SOCK").map(PathBuf::from),
        }
    }

    /// Read the current settings without taking the lock out.
    pub async fn get_settings(&self) -> Settings {
        self.settings.read().await.clone()
    }

    /// Read the current store snapshot.
    pub async fn get_store(&self) -> Store {
        self.store.read().await.clone()
    }

    /// Apply `change` to the store, persist, and replace — holding the write lock until the replacement.
    pub async fn mutate<T>(
        &self,
        change: impl FnOnce(&Store) -> AppResult<(Store, T)>,
    ) -> AppResult<T> {
        if let Some(error) = &self.store_blocked {
            return Err(error.clone());
        }
        let mut current = self.store.write().await;
        let (next, output) = change(&current)?;
        save_store(&self.paths.config_dir, &next)?;
        *current = next;
        Ok(output)
    }

    /// Read the current store snapshot, or the blocking error when the store could not be loaded.
    pub async fn read_store(&self) -> AppResult<Store> {
        if let Some(error) = &self.store_blocked {
            return Err(error.clone());
        }
        Ok(self.get_store().await)
    }

    /// Apply `change` to the settings, persist, and replace.
    pub async fn mutate_settings(
        &self,
        change: impl FnOnce(&Settings) -> AppResult<Settings>,
    ) -> AppResult<Settings> {
        let mut current = self.settings.write().await;
        let next = change(&current)?;
        save_settings(&self.paths.config_dir, &next)?;
        *current = next.clone();
        Ok(next)
    }

    /// Sessions (shell, SFTP, RDP), transfers and prompts: everything the page was showing.
    /// Returns how many sessions were open.
    pub fn end_all_sessions(&self) -> usize {
        let count = self.sessions.close_all();
        self.transfers.cancel_all();
        self.prompts.cancel_all();
        count
    }
}

/// File name of the store, mirrored here so the setup logs match (docs/01-architecture.md §9).
const STORE_FILE: &str = crate::store::STORE_FILE;
const SETTINGS_FILE: &str = crate::store::SETTINGS_FILE;
