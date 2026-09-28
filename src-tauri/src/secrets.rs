//! The keyring (S1, S2, S3, S5, S7, S8, S9). The frontend can write, test presence and delete a
//! secret, never read it: the Rust side reads the keyring itself when connecting (T18).
//!
//! Two backends share the same API (docs/02-decisions.md D05):
//! - `Keyring` talks to the Secret Service through `oo7` on first use, never at startup;
//! - `Memory` keeps the values in-process, used by the tests only.
use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use tokio::sync::{Mutex, OnceCell};
use ts_rs::TS;
use uuid::Uuid;
use zeroize::Zeroizing;

use crate::error::{AppError, AppResult, ErrorKind};

/// Secret Service application id (docs/02-decisions.md D05).
pub const APPLICATION: &str = "io.github.fleorens.TunL";
/// A stored secret may end up on a FreeRDP line (S5), so it is bounded here too.
pub const SECRET_MAX_CHARS: usize = 1024;

/// What kind of secret a connection stores.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum SecretKind {
    Password,
    Passphrase,
}

impl SecretKind {
    /// The string stored in the `"kind"` attribute, and shown in the label.
    pub fn as_str(self) -> &'static str {
        match self {
            SecretKind::Password => "password",
            SecretKind::Passphrase => "passphrase",
        }
    }
}

/// A secret received from the frontend or read from the keyring.
///
/// `Zeroizing<String>` zeroes itself on drop (S3), but its `Debug` prints the value, so this
/// wrapper prints `***` instead.
#[derive(Clone, Deserialize)]
#[serde(transparent)]
pub struct SecretValue(Zeroizing<String>);

impl SecretValue {
    pub fn new(value: impl Into<String>) -> Self {
        SecretValue(Zeroizing::new(value.into()))
    }

    /// The raw value, for the keyring only.
    pub fn expose(&self) -> &str {
        self.0.as_str()
    }
}

// Hand-written: the derived `Debug` of `Zeroizing<String>` would print the value (S3).
impl std::fmt::Debug for SecretValue {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "SecretValue(***)")
    }
}

/// Non-empty, at most `SECRET_MAX_CHARS` characters, no control character (S5: it may end up on a FreeRDP line).
pub fn validate_secret(value: &SecretValue) -> AppResult<()> {
    let text = value.expose();
    if text.is_empty() {
        return Err(AppError::validation("value", "must not be empty"));
    }
    if text.chars().count() > SECRET_MAX_CHARS {
        return Err(AppError::validation("value", "is too long"));
    }
    if text.chars().any(is_control_char) {
        return Err(AppError::validation(
            "value",
            "must not contain control characters",
        ));
    }
    Ok(())
}

/// True for any control character: below U+0020, or between U+007F and U+009F (S5).
fn is_control_char(c: char) -> bool {
    c <= '\u{001f}' || ('\u{007f}'..='\u{009f}').contains(&c)
}

/// Label shown in KWallet / Seahorse: `"TunL — <connection> (<kind>)"`.
pub fn secret_label(connection_name: &str, kind: SecretKind) -> String {
    format!("TunL — {connection_name} ({})", kind.as_str())
}

/// The two search attributes shared by every kind of a connection.
fn connection_attrs(id: &str) -> [(&str, &str); 2] {
    [("application", APPLICATION), ("connection", id)]
}

/// All attributes of a single `(connection, kind)` secret.
fn full_attrs(id: &str, kind: SecretKind) -> [(&str, &str); 3] {
    [
        ("application", APPLICATION),
        ("connection", id),
        ("kind", kind.as_str()),
    ]
}

/// Maps any `oo7` error to a generic, secret-free keyring failure (S7).
fn keyring_op(_error: impl std::fmt::Display) -> AppError {
    AppError::new(ErrorKind::Secret, "keyring operation failed")
}

/// Where secrets live.
pub enum SecretStore {
    /// The Secret Service, opened on first use (never at startup).
    Keyring(OnceCell<oo7::Keyring>),
    /// In-process, for the tests only.
    Memory(Mutex<HashMap<(Uuid, SecretKind), SecretValue>>),
}

impl SecretStore {
    pub fn keyring() -> Self {
        SecretStore::Keyring(OnceCell::new())
    }

    pub fn memory() -> Self {
        SecretStore::Memory(Mutex::new(HashMap::new()))
    }

    /// The opened Secret Service, opening it on first use (never at startup).
    async fn open_keyring(&self) -> AppResult<&oo7::Keyring> {
        match self {
            SecretStore::Keyring(cell) => {
                cell.get_or_try_init(|| async {
                    oo7::Keyring::new().await.map_err(|error| {
                        log::warn!("system keyring unavailable: {error}");
                        AppError::new(ErrorKind::Secret, "system keyring unavailable")
                    })
                })
                .await
            }
            SecretStore::Memory(_) => Err(AppError::new(
                ErrorKind::Internal,
                "system keyring not available in the test store",
            )),
        }
    }

    pub async fn set(
        &self,
        connection: Uuid,
        connection_name: &str,
        kind: SecretKind,
        value: &SecretValue,
    ) -> AppResult<()> {
        match self {
            SecretStore::Memory(map) => {
                map.lock().await.insert((connection, kind), value.clone());
                Ok(())
            }
            SecretStore::Keyring(_) => {
                let id = connection.to_string();
                let keyring = self.open_keyring().await?;
                if keyring.is_locked().await.map_err(keyring_op)? {
                    keyring.unlock().await.map_err(keyring_op)?;
                }
                keyring
                    .create_item(
                        &secret_label(connection_name, kind),
                        &full_attrs(&id, kind),
                        value.expose().as_bytes(),
                        true,
                    )
                    .await
                    .map_err(keyring_op)?;
                log::info!("secret stored for {connection} ({})", kind.as_str());
                Ok(())
            }
        }
    }

    /// Presence test, without unlocking (S2: the frontend never reads the value).
    pub async fn has(&self, connection: Uuid, kind: SecretKind) -> AppResult<bool> {
        match self {
            SecretStore::Memory(map) => Ok(map.lock().await.contains_key(&(connection, kind))),
            SecretStore::Keyring(_) => {
                let id = connection.to_string();
                let keyring = self.open_keyring().await?;
                let attrs = full_attrs(&id, kind);
                Ok(!keyring
                    .search_items(&attrs)
                    .await
                    .map_err(keyring_op)?
                    .is_empty())
            }
        }
    }

    /// Read the value, Rust only (T18). Returns `None` when nothing is stored.
    pub async fn get(&self, connection: Uuid, kind: SecretKind) -> AppResult<Option<SecretValue>> {
        match self {
            SecretStore::Memory(map) => Ok(map.lock().await.get(&(connection, kind)).cloned()),
            SecretStore::Keyring(_) => {
                let id = connection.to_string();
                let keyring = self.open_keyring().await?;
                if keyring.is_locked().await.map_err(keyring_op)? {
                    keyring.unlock().await.map_err(keyring_op)?;
                }
                let items = keyring
                    .search_items(&full_attrs(&id, kind))
                    .await
                    .map_err(keyring_op)?;
                let Some(item) = items.first() else {
                    return Ok(None);
                };
                let bytes = item.secret().await.map_err(keyring_op)?;
                let text = std::str::from_utf8(&bytes).map_err(|_| {
                    AppError::new(ErrorKind::Secret, "stored secret is not valid UTF-8")
                })?;
                Ok(Some(SecretValue::new(text.to_string())))
            }
        }
    }

    /// Delete one kind. An absent secret is not an error.
    pub async fn delete(&self, connection: Uuid, kind: SecretKind) -> AppResult<()> {
        match self {
            SecretStore::Memory(map) => {
                map.lock().await.remove(&(connection, kind));
                Ok(())
            }
            SecretStore::Keyring(_) => {
                let id = connection.to_string();
                let keyring = self.open_keyring().await?;
                keyring
                    .delete(&full_attrs(&id, kind))
                    .await
                    .map_err(keyring_op)?;
                Ok(())
            }
        }
    }

    /// Delete both kinds of a connection.
    pub async fn delete_all(&self, connection: Uuid) -> AppResult<()> {
        match self {
            SecretStore::Memory(map) => {
                map.lock().await.retain(|(id, _), _| *id != connection);
                Ok(())
            }
            SecretStore::Keyring(_) => {
                let id = connection.to_string();
                let keyring = self.open_keyring().await?;
                keyring
                    .delete(&connection_attrs(&id))
                    .await
                    .map_err(keyring_op)?;
                Ok(())
            }
        }
    }
}
