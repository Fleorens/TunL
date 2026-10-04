//! The SSH handler's error type and the russh → `AppError` mapping (docs/06-securite.md, S7).
use crate::error::{AppError, ErrorKind};

/// The error type of the SSH handler (T17b): russh's protocol error, or TunL's own.
#[derive(Debug)]
pub enum SshError {
    Russh(russh::Error),
    App(AppError),
}

impl From<russh::Error> for SshError {
    fn from(error: russh::Error) -> Self {
        SshError::Russh(error)
    }
}

impl From<AppError> for SshError {
    fn from(error: AppError) -> Self {
        SshError::App(error)
    }
}

impl From<SshError> for AppError {
    fn from(error: SshError) -> Self {
        match error {
            // TunL's own error comes back unchanged.
            SshError::App(e) => e,
            // russh's is reworded so nothing the server sent leaks into the message (S7).
            SshError::Russh(e) => map_russh_error(&e),
        }
    }
}

/// Reword a russh error into a TunL `AppError` (docs/06-securite.md, S7).
///
/// The message is technical English and never copies what the server or the OS sent; the original
/// detail is only worth a debug log, and these are protocol errors, so no secret is at risk.
pub fn map_russh_error(error: &russh::Error) -> AppError {
    match error {
        russh::Error::UnknownKey | russh::Error::WrongServerSig => {
            AppError::new(ErrorKind::HostKeyRejected, "host key rejected")
        }
        russh::Error::KeyChanged { .. } => {
            AppError::new(ErrorKind::HostKeyChanged, "host key changed")
        }
        russh::Error::ConnectionTimeout
        | russh::Error::KeepaliveTimeout
        | russh::Error::InactivityTimeout
        | russh::Error::Elapsed(_) => {
            AppError::new(ErrorKind::Timeout, "the server stopped answering")
        }
        russh::Error::NoAuthMethod
        | russh::Error::NotAuthenticated
        | russh::Error::UnsupportedAuthMethod => {
            AppError::new(ErrorKind::Auth, "authentication failed")
        }
        russh::Error::ChannelOpenFailure(_) => {
            AppError::new(ErrorKind::Network, "the server refused to open a channel")
        }
        russh::Error::Disconnect
        | russh::Error::HUP
        | russh::Error::IO(_)
        | russh::Error::SendError
        | russh::Error::RecvError => AppError::new(ErrorKind::Network, "connection closed"),
        _ => AppError::new(ErrorKind::Network, "ssh protocol error"),
    }
}
