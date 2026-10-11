use std::os::unix::fs::PermissionsExt;

use russh::keys::{PublicKey, parse_public_key_base64};

use super::known_hosts::{HostKeyStatus, KnownHosts, fingerprint, host_pattern};

// Fixed test keys (public halves only), generated once with `ssh-keygen`.
const KEY_A: &str = "AAAAC3NzaC1lZDI1NTE5AAAAINaLEe/SaLSsJfe8JpeWmS3B21Uw+eO2V8colcGPyFu7";
const FP_A: &str = "SHA256:9nFwX3ZbD2Afu2zLS84SR45AYIjQN+xcUO69FYBIWrM";
const KEY_B: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIJ9JkVFSefDuVr/cYSAh/f1rWdn5C+BjFEYycTOLh8+l";
const FP_B: &str = "SHA256:K65as0l6lNg1myP2r9czzcwbzLSZhdI6QVPLB/Nx2QI";
const KEY_EC: &str = "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBG+hjIUfFDzc5XLJ/LvCqK1FO7u10XSVbfBvwNlHcqltQv5LGg8ZQxugdmnnA5I3KdTvCB+Z9mfjxKRpooFj+Sk=";

fn key(base64: &str) -> PublicKey {
    parse_public_key_base64(base64).unwrap()
}

/// The own file and the user file, with the given contents ("" = the file does not exist).
fn files(own: &str, user: &str) -> (tempfile::TempDir, KnownHosts) {
    let dir = tempfile::tempdir().unwrap();
    let own_path = dir.path().join("own_known_hosts");
    let user_path = dir.path().join("user_known_hosts");
    if !own.is_empty() {
        std::fs::write(&own_path, own).unwrap();
    }
    if !user.is_empty() {
        std::fs::write(&user_path, user).unwrap();
    }
    (dir, KnownHosts::new(own_path, Some(user_path)))
}

#[test]
fn host_patterns_follow_openssh() {
    assert_eq!(host_pattern("db.internal", 22), "db.internal");
    assert_eq!(host_pattern("127.0.0.1", 2222), "[127.0.0.1]:2222");
}

#[test]
fn fingerprints_are_sha256_base64() {
    assert_eq!(fingerprint(&key(KEY_A)), FP_A);
    assert_eq!(fingerprint(&key(KEY_B)), FP_B);
}

#[test]
fn for_app_keeps_its_own_file_in_the_config_dir() {
    let dir = tempfile::tempdir().unwrap();
    let known = KnownHosts::for_app(dir.path());
    assert_eq!(known.own, dir.path().join("known_hosts"));
    if let Some(user) = &known.user {
        assert!(user.ends_with(".ssh/known_hosts"));
    }
}

#[test]
fn a_host_in_neither_file_is_unknown() {
    let (_dir, known) = files("", "");
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
}

#[test]
fn the_user_file_is_trusted() {
    let (_dir, known) = files("", &format!("db.internal ssh-ed25519 {KEY_A}\n"));
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
}

#[test]
fn a_non_default_port_uses_brackets() {
    let (_dir, known) = files(&format!("[db.internal]:2222 ssh-ed25519 {KEY_A}\n"), "");
    assert_eq!(
        known.check("db.internal", 2222, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
}

#[test]
fn a_different_key_of_the_same_type_is_changed() {
    let (_dir, known) = files(&format!("db.internal ssh-ed25519 {KEY_B}\n"), "");
    match known.check("db.internal", 22, &key(KEY_A)) {
        HostKeyStatus::Changed {
            path,
            line,
            known_fingerprint,
            removable,
        } => {
            assert_eq!(path, known.own);
            assert_eq!(line, 1);
            assert_eq!(known_fingerprint, FP_B);
            assert!(removable);
        }
        other => panic!("expected Changed, got {other:?}"),
    }
}

#[test]
fn a_changed_key_in_the_user_file_is_not_removable() {
    let (_dir, known) = files("", &format!("db.internal ssh-ed25519 {KEY_B}\n"));
    assert!(matches!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Changed {
            removable: false,
            ..
        }
    ));
}

#[test]
fn a_key_of_another_type_is_changed_not_unknown() {
    // A server that only shows another type must not get a fresh « unknown host » prompt (T19b).
    let (_dir, known) = files(&format!("db.internal ecdsa-sha2-nistp256 {KEY_EC}\n"), "");
    match known.check("db.internal", 22, &key(KEY_A)) {
        HostKeyStatus::Changed {
            line,
            known_fingerprint,
            removable,
            ..
        } => {
            assert_eq!(line, 1);
            assert_eq!(known_fingerprint, fingerprint(&key(KEY_EC)));
            assert!(removable);
        }
        other => panic!("expected Changed, got {other:?}"),
    }
}

#[test]
fn a_change_of_the_same_type_is_reported_first() {
    let (_dir, known) = files(
        &format!("db.internal ecdsa-sha2-nistp256 {KEY_EC}\ndb.internal ssh-ed25519 {KEY_B}\n"),
        "",
    );
    assert!(matches!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Changed { line: 2, .. }
    ));
}

#[test]
fn a_match_in_either_file_wins_over_a_change_in_the_other() {
    let (_dir, known) = files(
        &format!("db.internal ssh-ed25519 {KEY_B}\n"),
        &format!("db.internal ssh-ed25519 {KEY_A}\n"),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
}

#[test]
fn an_unreadable_file_is_skipped_not_fatal() {
    // A line whose key does not parse is skipped; the other file still counts.
    let (_dir, known) = files(
        "db.internal ssh-ed25519 not-base64!\n",
        &format!("db.internal ssh-ed25519 {KEY_A}\n"),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
}

#[test]
fn learning_appends_to_the_own_file_only_with_mode_0600() {
    let (_dir, known) = files("", "");
    known.learn("127.0.0.1", 2222, &key(KEY_A)).unwrap();
    known.learn("db.internal", 22, &key(KEY_B)).unwrap();

    assert_eq!(
        known.check("127.0.0.1", 2222, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_B)),
        HostKeyStatus::Known
    );
    let mode = std::fs::metadata(&known.own).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    assert!(!known.user.as_ref().unwrap().exists());

    let text = std::fs::read_to_string(&known.own).unwrap();
    assert_eq!(text.lines().count(), 2);
    assert!(text.lines().all(|line| !line.starts_with('#')));
}

#[test]
fn removing_drops_every_line_of_that_host_from_the_own_file() {
    let own = format!(
        "[db.internal]:2222 ssh-ed25519 {KEY_A}\nother.host ssh-ed25519 {KEY_B}\n[db.internal]:2222 ecdsa-sha2-nistp256 {KEY_EC}\n"
    );
    let user = format!("[db.internal]:2222 ssh-ed25519 {KEY_A}\n");
    let (_dir, known) = files(&own, &user);

    assert_eq!(known.remove("db.internal", 2222).unwrap(), 2);
    assert_eq!(
        std::fs::read_to_string(&known.own).unwrap(),
        format!("other.host ssh-ed25519 {KEY_B}\n")
    );
    // The user's OpenSSH file is never modified (D10).
    assert_eq!(
        std::fs::read_to_string(known.user.as_ref().unwrap()).unwrap(),
        user
    );
    assert_eq!(known.remove("db.internal", 2222).unwrap(), 0);
}

#[test]
fn removing_from_a_missing_file_removes_nothing() {
    let (_dir, known) = files("", "");
    assert_eq!(known.remove("db.internal", 22).unwrap(), 0);
    assert!(!known.own.exists());
}
