use super::error::{SshError, map_russh_error};
use crate::error::{AppError, ErrorKind};

#[test]
fn russh_errors_map_to_app_error_kinds() {
    let cases = [
        (russh::Error::UnknownKey, ErrorKind::HostKeyRejected),
        (russh::Error::WrongServerSig, ErrorKind::HostKeyRejected),
        (
            russh::Error::KeyChanged { line: 3 },
            ErrorKind::HostKeyChanged,
        ),
        (russh::Error::ConnectionTimeout, ErrorKind::Timeout),
        (russh::Error::KeepaliveTimeout, ErrorKind::Timeout),
        (russh::Error::InactivityTimeout, ErrorKind::Timeout),
        (russh::Error::NoAuthMethod, ErrorKind::Auth),
        (russh::Error::NotAuthenticated, ErrorKind::Auth),
        (russh::Error::Disconnect, ErrorKind::Network),
        (russh::Error::HUP, ErrorKind::Network),
        (russh::Error::KexInit, ErrorKind::Network),
        (russh::Error::SendError, ErrorKind::Network),
    ];
    for (error, kind) in cases {
        assert_eq!(map_russh_error(&error).kind, kind, "{error:?}");
    }
}

#[test]
fn russh_text_is_never_copied_into_the_message() {
    // S7: russh errors are reworded; what the server or the OS sent is not repeated.
    let error = map_russh_error(&russh::Error::IO(std::io::Error::other(
        "remote said: s3cr3t",
    )));
    assert_eq!(error.kind, ErrorKind::Network);
    assert!(!error.message.contains("s3cr3t"));
}

#[test]
fn app_errors_pass_through_unchanged() {
    let original = AppError::new(ErrorKind::Cancelled, "prompt cancelled");
    let back: AppError = SshError::App(original.clone()).into();
    assert_eq!(back, original);

    let from_russh: AppError = SshError::Russh(russh::Error::UnknownKey).into();
    assert_eq!(from_russh.kind, ErrorKind::HostKeyRejected);
}
