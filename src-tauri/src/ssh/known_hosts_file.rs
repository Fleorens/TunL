//! Read a `known_hosts` file like OpenSSH (T19b, docs/06-securite.md S6).
//!
//! `host_lines` returns every line naming `(host, port)`, counting comments and blank lines in the
//! physical line number, skipping an unreadable line without failing the file, and honouring the
//! `@revoked` and `@cert-authority` markers. `matches_host` is OpenSSH matching of one line's host
//! field, including hashed names (`HashKnownHosts yes`), wildcards and negations.
use std::path::Path;

use hmac::{Hmac, KeyInit, Mac};
use russh::keys::PublicKey;
use russh::keys::ssh_key::known_hosts::{Entry, HostPatterns, Marker};
use serde::Serialize;
use sha1::Sha1;
use ts_rs::TS;

use super::known_hosts::{fingerprint, host_pattern};

/// One host of TunL's own known_hosts, as the Settings tab lists it (T31b).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct KnownHostEntry {
    pub host: String,
    pub port: u16,
    pub key_type: String,
    pub fingerprint: String,
}

/// One line of a file that names `(host, port)`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostLine {
    /// Physical, 1-based line number: comments and blank lines count.
    pub line: usize,
    /// The `@revoked` marker was on this line.
    pub revoked: bool,
    /// The key recorded on this line.
    pub key: PublicKey,
}

/// Every line naming `(host, port)`. A missing file gives nothing; an unreadable file logs and gives nothing.
pub fn host_lines(path: &Path, host: &str, port: u16) -> Vec<HostLine> {
    match std::fs::read_to_string(path) {
        Ok(text) => text
            .lines()
            .enumerate()
            .filter_map(|(i, raw)| parse_line(raw, i + 1, host, port))
            .collect(),
        // A missing file (first run) gives nothing silently; an unreadable one logs and gives nothing.
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => {
            log::warn!("{path:?}: cannot read, skipped: {error}");
            Vec::new()
        }
        Err(_) => Vec::new(),
    }
}

/// Parse one raw line into a [`HostLine`] naming `(host, port)`, or skip it.
fn parse_line(raw: &str, line: usize, host: &str, port: u16) -> Option<HostLine> {
    // A blank line or a comment counts for the number but carries no key.
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    // `Entry::from_str` cuts on one space: a tab or repeated spaces would make the line unreadable.
    let normalized = raw.split_whitespace().collect::<Vec<_>>().join(" ");
    let Ok(entry): Result<Entry, _> = normalized.parse() else {
        log::warn!("{line}: unreadable line skipped");
        return None;
    };
    // A host certificate is a third party's key, still refused (T17b).
    if matches!(entry.marker(), Some(Marker::CertAuthority)) {
        return None;
    }
    if !matches_host(entry.host_patterns(), host, port) {
        return None;
    }
    Some(HostLine {
        line,
        revoked: matches!(entry.marker(), Some(Marker::Revoked)),
        key: entry.public_key().clone(),
    })
}

/// OpenSSH matching of one line's host field against `(host, port)`.
pub fn matches_host(patterns: &HostPatterns, host: &str, port: u16) -> bool {
    // The name OpenSSH matches against: the bare host on the default port, `[host]:port` otherwise,
    // lowercased (host names are case-insensitive).
    let name = host_pattern(&host.to_lowercase(), port);
    match patterns {
        // A hashed name (`|1|salt|hash`): HMAC-SHA1 of the name with the salt, compared to the hash.
        HostPatterns::HashedName { salt, hash } => {
            let Ok(mut mac) = Hmac::<Sha1>::new_from_slice(salt) else {
                return false;
            };
            mac.update(name.as_bytes());
            mac.verify_slice(hash).is_ok()
        }
        // A comma-separated list of patterns: a matching negation wins, else any positive match.
        HostPatterns::Patterns(list) => {
            let mut positive = false;
            for pattern in list {
                let (negated, pattern) = match pattern.strip_prefix('!') {
                    Some(pattern) => (true, pattern),
                    None => (false, pattern.as_str()),
                };
                // Host names are case-insensitive: match both sides lowercased.
                if glob_match(pattern.to_ascii_lowercase().as_str(), &name) {
                    if negated {
                        return false;
                    }
                    positive = true;
                }
            }
            positive
        }
    }
}

/// Glob match with `*` (any run of characters, empty included) and `?` (one character), over the
/// full name including brackets and port.
fn glob_match(pattern: &str, text: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let text: Vec<char> = text.chars().collect();
    let (mut pi, mut ti) = (0usize, 0usize);
    let (mut star, mut mark) = (None, 0usize);
    while ti < text.len() {
        if pi < pattern.len() && (pattern[pi] == '?' || pattern[pi] == text[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < pattern.len() && pattern[pi] == '*' {
            star = Some(pi);
            mark = ti;
            pi += 1;
        } else if let Some(start) = star {
            pi = start + 1;
            mark += 1;
            ti = mark;
        } else {
            return false;
        }
    }
    while pi < pattern.len() && pattern[pi] == '*' {
        pi += 1;
    }
    pi == pattern.len()
}

/// Every host of TunL's own known_hosts file, as the Settings tab lists them (T31b): one entry per host
/// of each line, sorted by host then port, skipping the blank, commented, unreadable, hashed, wildcard,
/// negated and marked lines. A missing or unreadable file gives nothing.
pub fn own_entries(path: &Path) -> Vec<KnownHostEntry> {
    let Ok(text) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut entries: Vec<KnownHostEntry> = text.lines().filter_map(own_line).flatten().collect();
    entries.sort_by(|a, b| a.host.cmp(&b.host).then_with(|| a.port.cmp(&b.port)));
    entries
}

/// The hosts of one raw line, or none for a blank, commented, unreadable, hashed or marked line.
fn own_line(raw: &str) -> Option<Vec<KnownHostEntry>> {
    let trimmed = raw.trim();
    // A blank line or a comment carries no host.
    if trimmed.is_empty() || trimmed.starts_with('#') {
        return None;
    }
    // `Entry::from_str` cuts on one space: a tab or repeated spaces would make the line unreadable.
    let normalized = trimmed.split_whitespace().collect::<Vec<_>>().join(" ");
    let Ok(entry): Result<Entry, _> = normalized.parse() else {
        return None;
    };
    // A `@revoked` or `@cert-authority` marker is skipped.
    if matches!(
        entry.marker(),
        Some(Marker::Revoked) | Some(Marker::CertAuthority)
    ) {
        return None;
    }
    let key = entry.public_key().clone();
    let key_type = key.algorithm().to_string();
    let fingerprint = fingerprint(&key);
    match entry.host_patterns() {
        // A hashed name is not a host we can list.
        HostPatterns::HashedName { .. } => None,
        // One entry per host of the line; a pattern with `*`, `?` or `!` is skipped, the others kept.
        // « Forget » (`KnownHosts::remove`) drops the whole line: on a line `a.lan,[a.lan]:2200`, forgetting
        // one host forgets the other too. TunL writes one host per line, so only a hand-edited file shows it.
        HostPatterns::Patterns(list) => {
            let mut entries = Vec::new();
            for pattern in list {
                if pattern.contains('*') || pattern.contains('?') || pattern.contains('!') {
                    continue;
                }
                if let Some((host, port)) = parse_pattern(pattern) {
                    entries.push(KnownHostEntry {
                        host,
                        port,
                        key_type: key_type.clone(),
                        fingerprint: fingerprint.clone(),
                    });
                }
            }
            Some(entries)
        }
    }
}

/// The (host, port) of one host pattern: the bare host on the default port, `[host]:port` otherwise.
/// The port is unreadable → none.
fn parse_pattern(pattern: &str) -> Option<(String, u16)> {
    if let Some(rest) = pattern.strip_prefix('[') {
        let (host, port) = rest.split_once(']')?;
        let port = port.strip_prefix(':')?.parse().ok()?;
        return Some((host.to_string(), port));
    }
    Some((pattern.to_string(), 22))
}
