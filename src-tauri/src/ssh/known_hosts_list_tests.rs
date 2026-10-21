//! T31b: the hosts of TunL's own known_hosts, as the Settings tab lists them.
use russh::keys::parse_public_key_base64;

use super::known_hosts::{KnownHosts, fingerprint};

// The fixed test keys of known_hosts_tests.rs.
const KEY_A: &str = "AAAAC3NzaC1lZDI1NTE5AAAAINaLEe/SaLSsJfe8JpeWmS3B21Uw+eO2V8colcGPyFu7";
const KEY_EC: &str = "AAAAE2VjZHNhLXNoYTItbmlzdHAyNTYAAAAIbmlzdHAyNTYAAABBBG+hjIUfFDzc5XLJ/LvCqK1FO7u10XSVbfBvwNlHcqltQv5LGg8ZQxugdmnnA5I3KdTvCB+Z9mfjxKRpooFj+Sk=";

fn own(text: &str) -> (tempfile::TempDir, KnownHosts) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("known_hosts");
    std::fs::write(&path, text).unwrap();
    let user = dir.path().join("user_known_hosts");
    std::fs::write(&user, format!("user-only.lan ssh-ed25519 {KEY_A}\n")).unwrap();
    (dir, KnownHosts::new(path, Some(user)))
}

#[test]
fn lists_each_plain_host_of_the_own_file_sorted() {
    let (_dir, hosts) = own(&format!(
        "# written by TunL\n\
         web.lan ssh-ed25519 {KEY_A}\n\
         [db.internal]:2222\tecdsa-sha2-nistp256  {KEY_EC}\n\
         \n\
         alpha.lan,[alpha.lan]:2200 ssh-ed25519 {KEY_A} a comment\n"
    ));
    let listed: Vec<(String, u16, String)> = hosts
        .list_own()
        .into_iter()
        .map(|e| (e.host, e.port, e.key_type))
        .collect();
    assert_eq!(
        listed,
        [
            ("alpha.lan".to_string(), 22, "ssh-ed25519".to_string()),
            ("alpha.lan".to_string(), 2200, "ssh-ed25519".to_string()),
            (
                "db.internal".to_string(),
                2222,
                "ecdsa-sha2-nistp256".to_string()
            ),
            ("web.lan".to_string(), 22, "ssh-ed25519".to_string()),
        ]
    );
}

#[test]
fn the_fingerprint_is_the_one_the_prompt_shows() {
    let (_dir, hosts) = own(&format!("web.lan ssh-ed25519 {KEY_A}\n"));
    let entry = &hosts.list_own()[0];
    let key = parse_public_key_base64(KEY_A).unwrap();
    assert_eq!(entry.fingerprint, fingerprint(&key));
    assert!(entry.fingerprint.starts_with("SHA256:"));
}

#[test]
fn hashed_wildcard_negated_marked_and_unreadable_lines_are_not_listed() {
    let (_dir, hosts) = own(&format!(
        "|1|lxCjQXgLAd7CpBkib76/uVAp1Qk=|4DrVRStkFoJkufm2tUOiO30dPu8= ssh-ed25519 {KEY_A}\n\
         *.lan ssh-ed25519 {KEY_A}\n\
         !bad.lan,ok.lan ssh-ed25519 {KEY_A}\n\
         @revoked gone.lan ssh-ed25519 {KEY_A}\n\
         broken line\n"
    ));
    let listed: Vec<String> = hosts.list_own().into_iter().map(|e| e.host).collect();
    assert_eq!(listed, ["ok.lan"]);
}

#[test]
fn no_own_file_lists_nothing_and_the_user_file_is_never_listed() {
    let dir = tempfile::tempdir().unwrap();
    let user = dir.path().join("user_known_hosts");
    std::fs::write(&user, format!("user-only.lan ssh-ed25519 {KEY_A}\n")).unwrap();
    let hosts = KnownHosts::new(dir.path().join("missing"), Some(user));
    assert!(hosts.list_own().is_empty());
}

#[test]
fn a_learned_host_is_listed_then_gone_once_removed() {
    let (_dir, hosts) = own("");
    let key = parse_public_key_base64(KEY_A).unwrap();
    hosts.learn("Router.LAN", 2222, &key).unwrap();
    let listed = hosts.list_own();
    assert_eq!(listed.len(), 1);
    assert_eq!(
        (listed[0].host.as_str(), listed[0].port),
        ("router.lan", 2222)
    );
    hosts.remove("router.lan", 2222).unwrap();
    assert!(hosts.list_own().is_empty());
}
