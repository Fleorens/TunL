use super::ssh_config::{ParsedSshConfig, SshConfigHost, host_pattern_matches, parse_ssh_config};

fn no_include(_: &str) -> Vec<(String, String)> {
    Vec::new()
}

fn parse(text: &str) -> ParsedSshConfig {
    parse_ssh_config(text, &no_include)
}

fn host<'a>(parsed: &'a ParsedSshConfig, alias: &str) -> &'a SshConfigHost {
    parsed
        .hosts
        .iter()
        .find(|host| host.alias == alias)
        .unwrap_or_else(|| panic!("no host {alias}"))
}

fn aliases(parsed: &ParsedSshConfig) -> Vec<&str> {
    parsed
        .hosts
        .iter()
        .map(|host| host.alias.as_str())
        .collect()
}

#[test]
fn reads_the_basic_options() {
    let parsed = parse(
        "Host web\n  HostName 10.0.0.12\n  User deploy\n  Port 2222\n  IdentityFile ~/.ssh/id_web\n",
    );
    let web = host(&parsed, "web");
    assert_eq!(web.host_name.as_deref(), Some("10.0.0.12"));
    assert_eq!(web.user.as_deref(), Some("deploy"));
    assert_eq!(web.port, Some(2222));
    assert_eq!(web.identity_file.as_deref(), Some("~/.ssh/id_web"));
    assert!(web.proxy_jump.is_empty());
    assert!(web.warnings.is_empty());
    assert!(parsed.warnings.is_empty());
}

#[test]
fn keywords_ignore_case_and_accept_equals() {
    let parsed = parse("host a\n  hostname=10.0.0.1\n  USER = root\n  port\t22\n");
    let a = host(&parsed, "a");
    assert_eq!(a.host_name.as_deref(), Some("10.0.0.1"));
    assert_eq!(a.user.as_deref(), Some("root"));
    assert_eq!(a.port, Some(22));
}

#[test]
fn comments_blank_lines_and_quotes() {
    let parsed =
        parse("# my hosts\n\n   # indented comment\nHost a\n  IdentityFile \"~/.ssh/my key\"\n");
    assert_eq!(
        host(&parsed, "a").identity_file.as_deref(),
        Some("~/.ssh/my key")
    );
}

#[test]
fn several_aliases_on_one_line() {
    let parsed = parse("Host a b\n  User x\nHost a\n");
    assert_eq!(aliases(&parsed), ["a", "b"]);
    assert_eq!(host(&parsed, "b").user.as_deref(), Some("x"));
}

#[test]
fn wildcard_blocks_are_not_hosts_but_apply_to_matching_ones() {
    let parsed = parse(
        "Host *.corp\n  User corp\nHost db.corp\n  HostName 10.1.1.1\nHost *\n  User fallback\n  Port 2200\nHost lab\n",
    );
    assert_eq!(aliases(&parsed), ["db.corp", "lab"]);
    let db = host(&parsed, "db.corp");
    assert_eq!(db.user.as_deref(), Some("corp"));
    assert_eq!(db.port, Some(2200));
    assert_eq!(host(&parsed, "lab").user.as_deref(), Some("fallback"));
}

#[test]
fn the_first_value_wins() {
    let parsed = parse("Host a\n  User first\nHost a\n  User second\n  Port 2022\n");
    assert_eq!(parsed.hosts.len(), 1);
    assert_eq!(host(&parsed, "a").user.as_deref(), Some("first"));
    assert_eq!(host(&parsed, "a").port, Some(2022));
}

#[test]
fn options_before_any_host_apply_to_all() {
    let parsed = parse("User everyone\nHost a\nHost b\n  User bee\n");
    assert_eq!(host(&parsed, "a").user.as_deref(), Some("everyone"));
    assert_eq!(host(&parsed, "b").user.as_deref(), Some("everyone"));
}

#[test]
fn host_patterns() {
    let all_but_secret = vec!["*".to_string(), "!secret".to_string()];
    assert!(host_pattern_matches(&all_but_secret, "web"));
    assert!(!host_pattern_matches(&all_but_secret, "secret"));
    assert!(host_pattern_matches(&["web?".to_string()], "web1"));
    assert!(!host_pattern_matches(&["web?".to_string()], "web10"));
    assert!(host_pattern_matches(&["WEB".to_string()], "web"));
    assert!(!host_pattern_matches(&["!web".to_string()], "db"));
}

#[test]
fn proxy_jump_hops_and_none() {
    let parsed = parse("Host a\n  ProxyJump j1, j2\nHost b\n  ProxyJump none\n");
    assert_eq!(host(&parsed, "a").proxy_jump, ["j1", "j2"]);
    assert!(host(&parsed, "b").proxy_jump.is_empty());
}

#[test]
fn hostname_tokens() {
    let parsed = parse(
        "Host a\n  HostName %h.example.com\nHost b\n  HostName %h-%p\nHost c\n  HostName 100%%\n",
    );
    assert_eq!(
        host(&parsed, "a").host_name.as_deref(),
        Some("a.example.com")
    );
    assert!(host(&parsed, "a").warnings.is_empty());
    assert_eq!(host(&parsed, "b").host_name.as_deref(), Some("b-%p"));
    assert_eq!(
        host(&parsed, "b").warnings,
        ["HostName tokens other than %h are not supported"]
    );
    assert_eq!(host(&parsed, "c").host_name.as_deref(), Some("100%"));
}

#[test]
fn ignored_options_are_flagged_once_each() {
    let parsed = parse(
        "Host *\n  LocalCommand echo hi\nHost a\n  ProxyCommand nc %h %p\n  LocalForward 8080 localhost:80\n  LocalForward 8081 localhost:81\n",
    );
    assert_eq!(
        host(&parsed, "a").warnings,
        [
            "LocalCommand is ignored",
            "ProxyCommand is ignored",
            "LocalForward is ignored"
        ]
    );
}

#[test]
fn match_blocks_are_skipped_with_one_warning() {
    let parsed = parse("Match exec \"true\"\n  User evil\nMatch host x\n  User evil2\nHost a\n");
    assert_eq!(host(&parsed, "a").user, None);
    assert_eq!(parsed.warnings, ["Match blocks are ignored"]);
}

#[test]
fn an_invalid_port_is_reported() {
    let parsed = parse("Host a\n  Port 99999\n");
    assert_eq!(host(&parsed, "a").port, None);
    assert_eq!(host(&parsed, "a").warnings, ["invalid Port: 99999"]);
}

#[test]
fn includes_are_inlined_where_they_appear() {
    let include = |arg: &str| {
        if arg == "conf.d/*" {
            vec![(
                "~/.ssh/conf.d/a".to_string(),
                "Host inc\n  User included\n".to_string(),
            )]
        } else {
            Vec::new()
        }
    };
    let parsed = parse_ssh_config("Include conf.d/*\nHost main\n", &include);
    assert_eq!(aliases(&parsed), ["inc", "main"]);
    assert_eq!(host(&parsed, "inc").user.as_deref(), Some("included"));
}

#[test]
fn include_recursion_is_bounded() {
    let include = |_: &str| vec![("loop".to_string(), "Include loop\n".to_string())];
    let parsed = parse_ssh_config("Include loop\nHost a\n", &include);
    assert_eq!(aliases(&parsed), ["a"]);
    assert_eq!(parsed.warnings, ["Include nested too deeply: loop"]);
}
