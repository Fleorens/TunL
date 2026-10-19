use russh_sftp::client::error::Error as SftpError;
use russh_sftp::client::fs::Metadata;
use russh_sftp::protocol::{FileAttributes, Status, StatusCode};

use super::EntryKind;
use super::ops::{entry_from, join, map_sftp_error, valid_name, validate_remote_path};
use crate::error::ErrorKind;

fn attrs(mode: u32, size: u64, mtime: u32) -> Metadata {
    FileAttributes {
        size: Some(size),
        permissions: Some(mode),
        mtime: Some(mtime),
        ..FileAttributes::empty()
    }
}

fn status(code: StatusCode, server_text: &str) -> SftpError {
    SftpError::Status(Status {
        id: 1,
        status_code: code,
        error_message: server_text.into(),
        language_tag: "en".into(),
    })
}

#[test]
fn names_that_could_escape_a_directory_are_invalid() {
    for bad in ["", ".", "..", "a/b", "/etc", "x\0y"] {
        assert!(!valid_name(bad), "{bad:?}");
    }
    for good in ["index.html", ".bashrc", "...", "a b", "été", "-rf"] {
        assert!(valid_name(good), "{good:?}");
    }
}

#[test]
fn remote_paths_are_absolute_and_without_nul() {
    assert!(validate_remote_path("path", "/var/www").is_ok());
    assert!(validate_remote_path("path", "/").is_ok());
    for bad in ["", "var/www", "~/x", "/var\0/www"] {
        let error = validate_remote_path("path", bad).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Validation, "{bad:?}");
        assert!(error.message.starts_with("path"), "{}", error.message);
    }
}

#[test]
fn join_does_not_double_the_root_slash() {
    assert_eq!(join("/", "etc"), "/etc");
    assert_eq!(join("/var/www", "html"), "/var/www/html");
    assert_eq!(join("/var/www/", "html"), "/var/www/html");
}

#[test]
fn an_entry_keeps_its_kind_mode_size_and_date() {
    let file = entry_from("/srv", "notes.txt", &attrs(0o100644, 4200, 1_700_000_000));
    assert_eq!(file.name, "notes.txt");
    assert_eq!(file.path, "/srv/notes.txt");
    assert_eq!(file.kind, EntryKind::File);
    assert_eq!(file.size, 4200);
    assert_eq!(file.permissions, Some(0o644), "type bits are dropped");
    assert_eq!(file.modified_at, Some(1_700_000_000_000));
    assert!(!file.hidden);

    let dir = entry_from("/", ".config", &attrs(0o040700, 4096, 0));
    assert_eq!(dir.kind, EntryKind::Dir);
    assert_eq!(dir.path, "/.config");
    assert!(dir.hidden);

    let link = entry_from("/srv", "current", &attrs(0o120777, 9, 0));
    assert_eq!(
        link.kind,
        EntryKind::Symlink,
        "a link is shown as one, never followed"
    );

    let fifo = entry_from("/srv", "pipe", &attrs(0o010600, 0, 0));
    assert_eq!(fifo.kind, EntryKind::Other);

    let bare = entry_from("/srv", "x", &FileAttributes::empty());
    assert_eq!(bare.size, 0);
    assert_eq!(bare.modified_at, None);
    assert_eq!(bare.permissions, None);
}

#[test]
fn sftp_errors_are_reworded_without_the_server_text() {
    let missing = map_sftp_error(
        "list",
        "/nope",
        &status(StatusCode::NoSuchFile, "SECRET-TEXT"),
    );
    assert_eq!(missing.kind, ErrorKind::NotFound);

    let denied = map_sftp_error(
        "remove",
        "/root",
        &status(StatusCode::PermissionDenied, "SECRET-TEXT"),
    );
    assert_eq!(denied.kind, ErrorKind::Sftp);
    assert!(
        denied.message.contains("permission denied"),
        "{}",
        denied.message
    );
    assert!(denied.message.contains("/root"));

    let failed = map_sftp_error(
        "mkdir",
        "/srv/x",
        &status(StatusCode::Failure, "SECRET-TEXT"),
    );
    assert_eq!(failed.kind, ErrorKind::Sftp);

    let timeout = map_sftp_error("list", "/srv", &SftpError::Timeout);
    assert_eq!(timeout.kind, ErrorKind::Timeout);

    let closed = map_sftp_error(
        "list",
        "/srv",
        &SftpError::IO("broken pipe SECRET-TEXT".into()),
    );
    assert_eq!(closed.kind, ErrorKind::Network);

    for error in [missing, denied, failed, timeout, closed] {
        assert!(
            !error.message.contains("SECRET-TEXT"),
            "S7: {}",
            error.message
        );
    }
}
