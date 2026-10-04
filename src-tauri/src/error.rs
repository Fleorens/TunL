use serde::Serialize;
use ts_rs::TS;

/// Machine-readable error category. The UI translates it via `errors.kind.<kind>`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub enum ErrorKind {
    NotFound,
    Validation,
    Io,
    Store,
    Secret,
    Network,
    Timeout,
    Auth,
    HostKeyRejected,
    HostKeyChanged,
    Cancelled,
    Sftp,
    RdpClientMissing,
    Rdp,
    Wol,
    InUse,
    Internal,
}

/// Structured context for the errors the UI renders specially.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[ts(export)]
pub enum ErrorDetail {
    HostKeyChanged {
        host: String,
        port: u16,
        key_type: String,
        fingerprint: String,
        /// The key recorded in `known_hosts` (the one that changed).
        known_fingerprint: String,
        known_hosts_path: String,
        line: u32,
        /// True when the record is in TunL's own file (removable via `known_host_remove`).
        removable: bool,
    },
    InUse {
        names: Vec<String>,
    },
}

/// The error returned by every command.
///
/// `message` is English and technical. It must NEVER contain a secret (docs/06-securite.md, S7).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS, thiserror::Error)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
#[error("{kind:?}: {message}")]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
    /// Boxed to keep `Result<T, AppError>` small (clippy::result_large_err).
    pub detail: Option<Box<ErrorDetail>>,
}

pub type AppResult<T> = Result<T, AppError>;

impl AppError {
    pub fn new(kind: ErrorKind, message: impl Into<String>) -> Self {
        Self {
            kind,
            message: message.into(),
            detail: None,
        }
    }

    pub fn with_detail(self, detail: ErrorDetail) -> Self {
        Self {
            detail: Some(Box::new(detail)),
            ..self
        }
    }

    pub fn not_found(what: impl Into<String>) -> Self {
        Self::new(ErrorKind::NotFound, what)
    }

    /// `field` is the camelCase name of the offending field, so the UI can attach the message to it.
    pub fn validation(field: &str, reason: &str) -> Self {
        Self::new(ErrorKind::Validation, format!("{field}: {reason}"))
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorKind::Internal, message)
    }
}

impl From<std::io::Error> for AppError {
    fn from(error: std::io::Error) -> Self {
        Self::new(ErrorKind::Io, error.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        Self::new(ErrorKind::Store, error.to_string())
    }
}

impl From<tauri::Error> for AppError {
    fn from(error: tauri::Error) -> Self {
        Self::internal(error.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn serializes_to_the_ipc_shape() {
        let value =
            serde_json::to_value(AppError::validation("host", "must not be empty")).unwrap();
        assert_eq!(
            value,
            json!({ "kind": "validation", "message": "host: must not be empty", "detail": null })
        );
    }

    #[test]
    fn serializes_details_with_camel_case_fields() {
        let error =
            AppError::new(ErrorKind::InUse, "used as jump host").with_detail(ErrorDetail::InUse {
                names: vec!["db-prod".into()],
            });
        let value = serde_json::to_value(error).unwrap();
        assert_eq!(value["kind"], "inUse");
        assert_eq!(
            value["detail"],
            json!({ "type": "inUse", "names": ["db-prod"] })
        );

        let changed = ErrorDetail::HostKeyChanged {
            host: "db.internal".into(),
            port: 22,
            key_type: "ssh-ed25519".into(),
            fingerprint: "SHA256:new".into(),
            known_fingerprint: "SHA256:old".into(),
            known_hosts_path: "/tmp/known_hosts".into(),
            line: 3,
            removable: true,
        };
        let value = serde_json::to_value(changed).unwrap();
        assert_eq!(value["type"], "hostKeyChanged");
        assert_eq!(value["keyType"], "ssh-ed25519");
        assert_eq!(value["knownHostsPath"], "/tmp/known_hosts");
    }

    #[test]
    fn io_errors_map_to_the_io_kind() {
        let error: AppError = std::io::Error::new(std::io::ErrorKind::NotFound, "gone").into();
        assert_eq!(error.kind, ErrorKind::Io);
        assert_eq!(error.message, "gone");
    }
}
