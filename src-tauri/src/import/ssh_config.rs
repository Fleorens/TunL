//! A pure parser for OpenSSH's `~/.ssh/config` (rules simplified from the man page).
//!
//! It never touches the disk: `include` is a caller-supplied closure that turns an `Include`
//! argument into the `(path, text)` of the files it matches. Nothing is executed (S12): the
//! flagged forwarding / command options are recorded as warnings, not applied.
//!
//! docs/06-securite.md §S12.

use std::collections::HashSet;

/// One host from a `Host` line. `alias` is a concrete name (no `*`, `?` or `!`).
#[derive(Debug, Clone, PartialEq, Default)]
pub struct SshConfigHost {
    pub alias: String,
    pub host_name: Option<String>,
    pub user: Option<String>,
    pub port: Option<u16>,
    pub identity_file: Option<String>,
    pub proxy_jump: Vec<String>,
    pub warnings: Vec<String>,
}

/// The whole file: its hosts (in first-seen order) and file-level warnings.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct ParsedSshConfig {
    pub hosts: Vec<SshConfigHost>,
    pub warnings: Vec<String>,
}

/// Parse `text`. `include(arg)` returns the `(path, text)` of every file `arg` matches.
pub fn parse_ssh_config(
    text: &str,
    include: &dyn Fn(&str) -> Vec<(String, String)>,
) -> ParsedSshConfig {
    let mut warnings: Vec<String> = Vec::new();
    let blocks = parse_blocks(text.lines(), include, 0, &mut warnings);

    // Aliases: concrete `Host` patterns, in first-occurrence order, without duplicates.
    let mut hosts: Vec<SshConfigHost> = Vec::new();
    for block in &blocks {
        if let Block::Host { patterns, .. } = block {
            for pattern in patterns {
                if is_alias_pattern(pattern) && !hosts.iter().any(|h| h.alias == *pattern) {
                    hosts.push(SshConfigHost {
                        alias: pattern.clone(),
                        ..Default::default()
                    });
                }
            }
        }
    }

    // Resolve every option for every host: first matching block wins, per option.
    for host in &mut hosts {
        for block in &blocks {
            let applies = match block {
                Block::Global(_) => true,
                Block::Host { patterns, .. } => host_pattern_matches(patterns, &host.alias),
                Block::Match(_) => false,
            };
            if !applies {
                continue;
            }
            apply_block(host, block_options(block), &mut HashSet::new());
        }
    }

    ParsedSshConfig { hosts, warnings }
}

/// OpenSSH host patterns: `*` and `?` wildcards, `!` negation, ASCII case-insensitive.
///
/// False as soon as a negated pattern matches; otherwise true when a positive pattern matches.
pub fn host_pattern_matches(patterns: &[String], alias: &str) -> bool {
    let alias = alias.to_ascii_lowercase();
    let mut matched_positive = false;
    for pattern in patterns {
        let pattern = pattern.to_ascii_lowercase();
        if let Some(negated) = pattern.strip_prefix('!') {
            if wildcard_match(negated, &alias) {
                return false;
            }
        } else if wildcard_match(&pattern, &alias) {
            matched_positive = true;
        }
    }
    matched_positive
}

/// `*` matches any run, `?` matches one character, the rest is an exact (already lowercased) match.
pub(crate) fn wildcard_match(pattern: &str, text: &str) -> bool {
    let pattern: Vec<char> = pattern.chars().collect();
    let text: Vec<char> = text.chars().collect();
    let mut pi = 0usize;
    let mut ti = 0usize;
    let mut star_pi: Option<usize> = None;
    let mut star_ti = 0usize;
    while ti < text.len() {
        if pi < pattern.len() && (pattern[pi] == '?' || pattern[pi] == text[ti]) {
            pi += 1;
            ti += 1;
        } else if pi < pattern.len() && pattern[pi] == '*' {
            star_pi = Some(pi);
            star_ti = ti;
            pi += 1;
        } else if let Some(prev_pi) = star_pi {
            pi = prev_pi + 1;
            star_ti += 1;
            ti = star_ti;
        } else {
            return false;
        }
    }
    while pi < pattern.len() && pattern[pi] == '*' {
        pi += 1;
    }
    pi == pattern.len()
}

fn is_alias_pattern(pattern: &str) -> bool {
    !pattern.contains('*') && !pattern.contains('?') && !pattern.contains('!')
}

// --- The block grammar, parsed top to bottom with `include` inlined at its place. ---

enum Block {
    /// Options before the first `Host` / `Match`; they apply to every host.
    Global(Vec<Opt>),
    Host {
        patterns: Vec<String>,
        options: Vec<Opt>,
    },
    Match(Vec<Opt>),
}

/// A directive inside a block. Ignored options keep their canonical spelling for the warning.
enum Opt {
    HostName(String),
    User(String),
    Port(String),
    IdentityFile(String),
    ProxyJump(String),
    Ignored(&'static str),
    Other,
}

fn block_options(block: &Block) -> &[Opt] {
    match block {
        Block::Global(options) | Block::Host { options, .. } | Block::Match(options) => options,
    }
}

fn parse_blocks<'a>(
    lines: impl Iterator<Item = &'a str>,
    include: &dyn Fn(&str) -> Vec<(String, String)>,
    depth: usize,
    warnings: &mut Vec<String>,
) -> Vec<Block> {
    let mut blocks: Vec<Block> = Vec::new();
    let mut global: Vec<Opt> = Vec::new();
    let mut global_used = false;
    let mut match_seen = false;

    // The block currently being filled. `None` means no block is open.
    let mut current: Option<Cur> = None;
    let mut current_options: Vec<Opt> = Vec::new();

    enum Cur {
        Host { patterns: Vec<String> },
        Match,
    }

    let flush =
        |blocks: &mut Vec<Block>, current: &mut Option<Cur>, current_options: &mut Vec<Opt>| {
            if let Some(cur) = current.take() {
                let options = std::mem::take(current_options);
                match cur {
                    Cur::Host { patterns } => blocks.push(Block::Host { patterns, options }),
                    Cur::Match => blocks.push(Block::Match(options)),
                }
            }
        };

    for line in lines {
        let trimmed = line.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let (keyword, value) = split_line(trimmed);
        let keyword = keyword.to_ascii_lowercase();

        match keyword.as_str() {
            "host" => {
                flush(&mut blocks, &mut current, &mut current_options);
                let patterns: Vec<String> = value.split_whitespace().map(str::to_string).collect();
                current = Some(Cur::Host { patterns });
            }
            "match" => {
                flush(&mut blocks, &mut current, &mut current_options);
                if !match_seen {
                    warnings.push("Match blocks are ignored".to_string());
                    match_seen = true;
                }
                current = Some(Cur::Match);
            }
            "include" => {
                flush(&mut blocks, &mut current, &mut current_options);
                for arg in value.split_whitespace() {
                    if depth >= 8 {
                        warnings.push(format!("Include nested too deeply: {arg}"));
                    } else {
                        for (_path, text) in include(arg) {
                            blocks.extend(parse_blocks(text.lines(), include, depth + 1, warnings));
                        }
                    }
                }
            }
            _ => {
                let opt = make_opt(&keyword, value);
                match &mut current {
                    Some(_) => current_options.push(opt),
                    None => {
                        global.push(opt);
                        global_used = true;
                    }
                }
            }
        }
    }
    flush(&mut blocks, &mut current, &mut current_options);

    if global_used {
        blocks.insert(0, Block::Global(global));
    }
    blocks
}

fn split_line(trimmed: &str) -> (&str, &str) {
    let keyword_end = trimmed
        .find(|c| [' ', '\t', '='].contains(&c))
        .unwrap_or(trimmed.len());
    let keyword = &trimmed[..keyword_end];
    (keyword, extract_value(&trimmed[keyword_end..]))
}

fn extract_value(rest: &str) -> &str {
    let bytes = rest.as_bytes();
    let mut i = 0;
    while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
    }
    if i < bytes.len() && bytes[i] == b'=' {
        i += 1;
    }
    while i < bytes.len() && (bytes[i] == b' ' || bytes[i] == b'\t') {
        i += 1;
    }
    &rest[i..]
}

fn make_opt(keyword: &str, value: &str) -> Opt {
    let value = strip_quotes(value.trim());
    match keyword {
        "hostname" => Opt::HostName(value.to_string()),
        "user" => Opt::User(value.to_string()),
        "port" => Opt::Port(value.to_string()),
        "identityfile" => Opt::IdentityFile(value.to_string()),
        "proxyjump" => Opt::ProxyJump(value.to_string()),
        "proxycommand" => Opt::Ignored("ProxyCommand"),
        "localcommand" => Opt::Ignored("LocalCommand"),
        "remotecommand" => Opt::Ignored("RemoteCommand"),
        "knownhostscommand" => Opt::Ignored("KnownHostsCommand"),
        "localforward" => Opt::Ignored("LocalForward"),
        "remoteforward" => Opt::Ignored("RemoteForward"),
        "dynamicforward" => Opt::Ignored("DynamicForward"),
        _ => Opt::Other,
    }
}

fn strip_quotes(value: &str) -> &str {
    if value.len() >= 2 && value.starts_with('"') && value.ends_with('"') {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

fn apply_block(host: &mut SshConfigHost, options: &[Opt], seen: &mut HashSet<String>) {
    for option in options {
        match option {
            Opt::HostName(raw) => {
                if host.host_name.is_none() {
                    let (value, bad_token) = substitute_hostname(raw, &host.alias);
                    host.host_name = Some(value);
                    push_warn(
                        &mut host.warnings,
                        "HostName tokens other than %h are not supported",
                        bad_token,
                        seen,
                    );
                }
            }
            Opt::User(value) => {
                if host.user.is_none() {
                    host.user = Some(value.clone());
                }
            }
            Opt::Port(raw) => {
                if host.port.is_none() {
                    match raw.trim().parse::<u32>() {
                        Ok(port) if (1..=65535).contains(&port) => host.port = Some(port as u16),
                        _ => push_warn(
                            &mut host.warnings,
                            &format!("invalid Port: {raw}"),
                            true,
                            seen,
                        ),
                    }
                }
            }
            Opt::IdentityFile(value) => {
                if host.identity_file.is_none() {
                    host.identity_file = Some(value.clone());
                }
            }
            Opt::ProxyJump(value) => {
                if host.proxy_jump.is_empty() {
                    host.proxy_jump = parse_proxy_jump(value);
                }
            }
            Opt::Ignored(canonical) => {
                push_warn(
                    &mut host.warnings,
                    &format!("{canonical} is ignored"),
                    true,
                    seen,
                );
            }
            Opt::Other => {}
        }
    }
}

fn push_warn(warnings: &mut Vec<String>, message: &str, flag: bool, seen: &mut HashSet<String>) {
    if flag && seen.insert(message.to_string()) {
        warnings.push(message.to_string());
    }
}

fn substitute_hostname(raw: &str, alias: &str) -> (String, bool) {
    let chars: Vec<char> = raw.chars().collect();
    let mut out = String::with_capacity(chars.len());
    let mut bad_token = false;
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '%' && i + 1 < chars.len() {
            match chars[i + 1] {
                'h' => out.push_str(alias),
                '%' => out.push('%'),
                other => {
                    out.push('%');
                    out.push(other);
                    bad_token = true;
                }
            }
            i += 2;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    (out, bad_token)
}

fn parse_proxy_jump(value: &str) -> Vec<String> {
    let mut hops: Vec<String> = value
        .split(',')
        .map(str::trim)
        .filter(|hop| !hop.is_empty())
        .map(str::to_string)
        .collect();
    if hops == vec!["none".to_string()] {
        hops.clear();
    }
    hops
}
