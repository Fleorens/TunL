//! T19b: known_hosts read like OpenSSH (comments, tabs, case, wildcards, hashed names, markers).
use std::os::unix::fs::PermissionsExt;

use russh::keys::{Algorithm, EcdsaCurve, PublicKey, parse_public_key_base64};

use super::known_hosts::{HostKeyStatus, KnownHosts};

// The fixed test keys of known_hosts_tests.rs.
const KEY_A: &str = "AAAAC3NzaC1lZDI1NTE5AAAAINaLEe/SaLSsJfe8JpeWmS3B21Uw+eO2V8colcGPyFu7";
const KEY_B: &str = "AAAAC3NzaC1lZDI1NTE5AAAAIJ9JkVFSefDuVr/cYSAh/f1rWdn5C+BjFEYycTOLh8+l";
const KEY_EC: &str = "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBG+hjIUfFDzc5XLJ/LvCqK1FO7u10XSVbfBvwNlHcqltQv5LGg8ZQxugdmnnA5I3KdTvCB+Z9mfjxKRpooFj+Sk=";
// `db.internal` and `[db.internal]:2222` with KEY_A, hashed by `ssh-keygen -H` (HashKnownHosts yes).
const HASHED_22: &str = "|1|lxCjQXgLAd7CpBkib76/uVAp1Qk=|4DrVRStkFoJkufm2tUOiO30dPu8=";
const HASHED_2222: &str = "|1|JZSGYE93K+A+MGX8O2jzRd2Jz7U=|A0044/uBCxh2kNoXQ3deYfvWZrE=";

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
fn an_unreadable_line_is_skipped_not_the_whole_file() {
    let (_dir, known) = files(
        &format!("db.internal ssh-ed25519 not-base64!\ndb.internal ssh-ed25519 {KEY_B}\n"),
        "",
    );
    assert!(matches!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Changed { line: 2, .. }
    ));
}

#[test]
fn line_numbers_count_comments_and_blank_lines() {
    let (_dir, known) = files(
        "",
        &format!(
            "# managed by hand\n\nother.host ssh-ed25519 {KEY_A}\n  # db\ndb.internal ssh-ed25519 {KEY_B}\n"
        ),
    );
    match known.check("db.internal", 22, &key(KEY_A)) {
        HostKeyStatus::Changed { path, line, .. } => {
            assert_eq!(&path, known.user.as_ref().unwrap());
            assert_eq!(line, 5);
        }
        other => panic!("expected Changed, got {other:?}"),
    }
}

#[test]
fn tabs_repeated_spaces_and_key_comments_are_read() {
    let (_dir, known) = files(
        "",
        &format!("db.internal\tssh-ed25519   {KEY_A}  root@db \n"),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
}

#[test]
fn host_names_ignore_case() {
    let (_dir, known) = files("", &format!("DB.Internal ssh-ed25519 {KEY_A}\n"));
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("DB.INTERNAL", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
}

#[test]
fn hashed_host_names_are_matched() {
    let (_dir, known) = files(
        "",
        &format!("{HASHED_22} ssh-ed25519 {KEY_A}\n{HASHED_2222} ssh-ed25519 {KEY_A}\n"),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("db.internal", 2222, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("other.host", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
    assert!(matches!(
        known.check("db.internal", 22, &key(KEY_B)),
        HostKeyStatus::Changed { line: 1, .. }
    ));
}

#[test]
fn wildcards_and_negations_follow_openssh() {
    let (_dir, known) = files(
        "",
        &format!(
            "*.internal,!secret.internal ssh-ed25519 {KEY_A}\n[10.0.0.?]:2222 ssh-ed25519 {KEY_A}\n"
        ),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("secret.internal", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
    assert_eq!(
        known.check("10.0.0.7", 2222, &key(KEY_A)),
        HostKeyStatus::Known
    );
    assert_eq!(
        known.check("10.0.0.17", 2222, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
}

#[test]
fn a_revoked_key_is_refused_even_when_recorded_elsewhere() {
    let (_dir, known) = files(
        &format!("db.internal ssh-ed25519 {KEY_A}\n"),
        &format!("# revoked\n@revoked * ssh-ed25519 {KEY_A}\n"),
    );
    match known.check("db.internal", 22, &key(KEY_A)) {
        HostKeyStatus::Revoked { path, line } => {
            assert_eq!(&path, known.user.as_ref().unwrap());
            assert_eq!(line, 2);
        }
        other => panic!("expected Revoked, got {other:?}"),
    }
}

#[test]
fn a_revoked_line_is_not_a_record_of_the_host() {
    let (_dir, known) = files(&format!("@revoked db.internal ssh-ed25519 {KEY_B}\n"), "");
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
}

#[test]
fn cert_authority_lines_are_ignored() {
    let (_dir, known) = files(
        "",
        &format!("@cert-authority *.internal ssh-ed25519 {KEY_A}\n"),
    );
    assert_eq!(
        known.check("db.internal", 22, &key(KEY_A)),
        HostKeyStatus::Unknown
    );
}

#[test]
fn algorithms_lists_the_recorded_key_types_own_file_first() {
    let (_dir, known) = files(
        &format!(
            "db.internal ecdsa-sha2-nistp256 {KEY_EC}\n@revoked db.internal ssh-ed25519 {KEY_B}\n"
        ),
        &format!("db.internal ssh-ed25519 {KEY_A}\ndb.internal ecdsa-sha2-nistp256 {KEY_EC}\n"),
    );
    assert_eq!(
        known.algorithms("db.internal", 22),
        vec![
            Algorithm::Ecdsa {
                curve: EcdsaCurve::NistP256
            },
            Algorithm::Ed25519
        ]
    );
    assert!(known.algorithms("other.host", 22).is_empty());
}

#[test]
fn learning_writes_the_host_in_lower_case() {
    let (_dir, known) = files("", "");
    known.learn("DB.Internal", 22, &key(KEY_A)).unwrap();
    let text = std::fs::read_to_string(&known.own).unwrap();
    assert_eq!(text, format!("db.internal ssh-ed25519 {KEY_A}\n"));
}

#[test]
fn removing_matches_tabs_and_case_and_keeps_mode_0600() {
    let (dir, known) = files(
        &format!("DB.internal\tssh-ed25519 {KEY_A}\nother.host ssh-ed25519 {KEY_B}\n"),
        "",
    );
    std::fs::set_permissions(&known.own, std::fs::Permissions::from_mode(0o644)).unwrap();
    assert_eq!(known.remove("db.internal", 22).unwrap(), 1);
    assert_eq!(
        std::fs::read_to_string(&known.own).unwrap(),
        format!("other.host ssh-ed25519 {KEY_B}\n")
    );
    let mode = std::fs::metadata(&known.own).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o600);
    // Written through a temporary file renamed over the own file: nothing is left behind.
    let names: Vec<_> = std::fs::read_dir(dir.path())
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect();
    assert_eq!(names, vec![std::ffi::OsString::from("own_known_hosts")]);
}
