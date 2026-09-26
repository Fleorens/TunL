use uuid::Uuid;

use super::*;
use crate::error::{AppError, AppResult, ErrorDetail, ErrorKind};

fn ssh_input(name: &str, host: &str) -> ConnectionInput {
    ConnectionInput {
        name: name.into(),
        host: host.into(),
        ..ConnectionInput::template(Protocol::Ssh)
    }
}

fn rdp_input(name: &str, host: &str) -> ConnectionInput {
    ConnectionInput {
        name: name.into(),
        host: host.into(),
        ..ConnectionInput::template(Protocol::Rdp)
    }
}

fn saved(input: ConnectionInput) -> Connection {
    Connection::from_input(Uuid::new_v4(), input, 1_000)
}

fn validate(input: &ConnectionInput) -> AppResult<ConnectionInput> {
    normalize_connection_input(input, None, &[], &[])
}

fn field_of(error: &AppError) -> &str {
    error.message.split(':').next().unwrap_or_default()
}

fn with_ssh(settings: SshSettings) -> ConnectionInput {
    ConnectionInput {
        settings: ProtocolSettings::Ssh(settings),
        ..ssh_input("x", "h")
    }
}

fn with_rdp(settings: RdpSettings) -> ConnectionInput {
    ConnectionInput {
        settings: ProtocolSettings::Rdp(settings),
        ..rdp_input("x", "h")
    }
}

#[test]
fn templates_use_the_protocol_default_ports() {
    assert_eq!(ConnectionInput::template(Protocol::Ssh).port, 22);
    assert_eq!(ConnectionInput::template(Protocol::Rdp).port, 3389);
    assert_eq!(
        ConnectionInput::template(Protocol::Rdp).settings.protocol(),
        Protocol::Rdp
    );
}

#[test]
fn a_connection_serializes_to_the_documented_json_shape() {
    let input = with_ssh(SshSettings {
        auth: SshAuth::Key {
            path: "~/.ssh/id_ed25519".into(),
        },
        ..SshSettings::default()
    });
    let json = serde_json::to_value(saved(input)).unwrap();
    assert_eq!(json["settings"]["protocol"], "ssh");
    assert_eq!(json["settings"]["auth"]["method"], "key");
    assert_eq!(json["settings"]["auth"]["path"], "~/.ssh/id_ed25519");
    assert_eq!(
        json["settings"].get("keepaliveSecs"),
        Some(&serde_json::Value::Null)
    );
    assert_eq!(json.get("jumpHostId"), Some(&serde_json::Value::Null));
    assert_eq!(json.get("lastConnectedAt"), Some(&serde_json::Value::Null));
    assert_eq!(json["createdAt"], 1_000);
}

#[test]
fn rdp_settings_round_trip_through_json() {
    let input = with_rdp(RdpSettings {
        display: RdpDisplay::Fixed {
            width: 1920,
            height: 1080,
        },
        ..RdpSettings::default()
    });
    let json = serde_json::to_value(&input).unwrap();
    assert_eq!(json["settings"]["protocol"], "rdp");
    assert_eq!(json["settings"]["display"]["mode"], "fixed");
    assert_eq!(json["settings"]["certPolicy"], "prompt");
    assert_eq!(json["settings"]["audio"], "local");
    let back: ConnectionInput = serde_json::from_value(json).unwrap();
    assert_eq!(back, input);
}

#[test]
fn rdp_defaults_match_the_data_model() {
    let rdp = RdpSettings::default();
    assert_eq!(rdp.display, RdpDisplay::Fit);
    assert!(!rdp.multimon && rdp.dynamic_resolution && rdp.clipboard && !rdp.share_home);
    assert_eq!(rdp.audio, RdpAudio::Local);
    assert_eq!(rdp.cert_policy, RdpCertPolicy::Prompt);
    assert!(rdp.extra_args.is_empty());
}

#[test]
fn normalization_trims_and_cleans_the_input() {
    let input = ConnectionInput {
        username: Some("  ".into()),
        notes: Some(String::new()),
        tags: vec![" Prod ".into(), "prod".into(), "Web".into()],
        ..ssh_input("  web-01  ", " 10.0.0.12 ")
    };
    let out = validate(&input).unwrap();
    assert_eq!(out.name, "web-01");
    assert_eq!(out.host, "10.0.0.12");
    assert_eq!(out.username, None);
    assert_eq!(out.notes, None);
    assert_eq!(out.tags, vec!["prod".to_string(), "web".to_string()]);
    assert_eq!(
        input.name, "  web-01  ",
        "the input itself is never modified"
    );
}

#[test]
fn accepts_ipv4_ipv6_and_host_names() {
    for host in [
        "10.0.0.12",
        "fe80::1",
        "::1",
        "db.internal",
        "my_host-01.example.com",
        "localhost",
    ] {
        assert!(
            validate(&ssh_input("x", host)).is_ok(),
            "{host} should be valid"
        );
    }
}

#[test]
fn rejects_malformed_hosts() {
    for host in [
        "",
        "   ",
        "bad host",
        "user@host",
        "a/b",
        "-lead.example",
        "trail-.example",
        "a..b",
        "line\nbreak",
        "[::1]",
    ] {
        let error = validate(&ssh_input("x", host)).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Validation, "{host:?}");
        assert_eq!(field_of(&error), "host", "{host:?}");
    }
}

#[test]
fn rejects_port_zero() {
    let input = ConnectionInput {
        port: 0,
        ..ssh_input("x", "h")
    };
    assert_eq!(field_of(&validate(&input).unwrap_err()), "port");
}

#[test]
fn names_are_counted_in_characters() {
    let long = "a".repeat(81);
    for name in ["", "  ", long.as_str(), "tab\there"] {
        assert_eq!(
            field_of(&validate(&ssh_input(name, "h")).unwrap_err()),
            "name",
            "{name:?}"
        );
    }
    assert!(validate(&ssh_input(&"é".repeat(80), "h")).is_ok());
}

#[test]
fn rejects_invalid_or_too_many_tags() {
    let bad = ConnectionInput {
        tags: vec!["no spaces".into()],
        ..ssh_input("x", "h")
    };
    assert_eq!(field_of(&validate(&bad).unwrap_err()), "tags");
    let many = ConnectionInput {
        tags: (0..11).map(|i| format!("t{i}")).collect(),
        ..ssh_input("x", "h")
    };
    assert_eq!(field_of(&validate(&many).unwrap_err()), "tags");
    let repeated = ConnectionInput {
        tags: vec!["prod".into(); 11],
        ..ssh_input("x", "h")
    };
    assert_eq!(validate(&repeated).unwrap().tags, vec!["prod".to_string()]);
}

#[test]
fn key_paths_must_be_absolute_or_home_relative() {
    let with_key = |path: &str| {
        with_ssh(SshSettings {
            auth: SshAuth::Key { path: path.into() },
            ..SshSettings::default()
        })
    };
    assert!(validate(&with_key("~/.ssh/id_ed25519")).is_ok());
    assert!(validate(&with_key("/home/me/.ssh/id_rsa")).is_ok());
    for path in ["", "id_rsa", "./key", "~root/key"] {
        assert_eq!(
            field_of(&validate(&with_key(path)).unwrap_err()),
            "settings.auth.path",
            "{path:?}"
        );
    }
}

#[test]
fn ssh_timeouts_are_bounded() {
    let with = |keepalive_secs: Option<u32>, connect_timeout_secs: Option<u32>| {
        with_ssh(SshSettings {
            keepalive_secs,
            connect_timeout_secs,
            ..SshSettings::default()
        })
    };
    assert!(validate(&with(Some(0), Some(1))).is_ok());
    assert_eq!(
        field_of(&validate(&with(Some(3601), None)).unwrap_err()),
        "settings.keepaliveSecs"
    );
    assert_eq!(
        field_of(&validate(&with(None, Some(0))).unwrap_err()),
        "settings.connectTimeoutSecs"
    );
}

#[test]
fn rdp_extra_args_reject_reserved_and_multiline_values() {
    let with_args = |args: &[&str]| {
        with_rdp(RdpSettings {
            extra_args: args.iter().map(|arg| arg.to_string()).collect(),
            ..RdpSettings::default()
        })
    };
    assert!(validate(&with_args(&["/sound:sys:pulse", "+fonts", "-wallpaper"])).is_ok());
    for arg in [
        "/p:secret",
        "/P:secret",
        "/v:evil",
        "/args-from:file",
        "/cert:ignore",
        "/gateway:g:x",
        "noprefix",
        "/size:1\n/p:x",
        "",
    ] {
        let error = validate(&with_args(&[arg])).unwrap_err();
        assert_eq!(field_of(&error), "settings.extraArgs", "{arg:?}");
        assert!(
            !error.message.contains("secret"),
            "the refused value must not be echoed"
        );
    }
}

#[test]
fn rdp_fixed_display_and_domain_are_bounded() {
    let with = |display: RdpDisplay, domain: Option<&str>| {
        with_rdp(RdpSettings {
            display,
            domain: domain.map(str::to_string),
            ..RdpSettings::default()
        })
    };
    assert!(
        validate(&with(
            RdpDisplay::Fixed {
                width: 1920,
                height: 1080
            },
            Some("CORP")
        ))
        .is_ok()
    );
    let narrow = with(
        RdpDisplay::Fixed {
            width: 639,
            height: 1080,
        },
        None,
    );
    assert_eq!(
        field_of(&validate(&narrow).unwrap_err()),
        "settings.display"
    );
    let injected = with(RdpDisplay::Fit, Some("CO\nRP"));
    assert_eq!(
        field_of(&validate(&injected).unwrap_err()),
        "settings.domain"
    );
}

#[test]
fn normalizes_mac_addresses() {
    assert_eq!(
        normalize_mac("aa-bb-cc-dd-ee-ff").as_deref(),
        Some("AA:BB:CC:DD:EE:FF")
    );
    assert_eq!(
        normalize_mac("aabbccddeeff").as_deref(),
        Some("AA:BB:CC:DD:EE:FF")
    );
    assert_eq!(
        normalize_mac(" 01:23:45:67:89:ab ").as_deref(),
        Some("01:23:45:67:89:AB")
    );
    for bad in [
        "",
        "aa:bb:cc:dd:ee",
        "aa:bb:cc:dd:ee:gg",
        "aa:bb-cc:dd:ee:ff",
        "aabbccddeeff00",
    ] {
        assert_eq!(normalize_mac(bad), None, "{bad:?}");
    }
}

#[test]
fn wol_config_is_validated_and_normalized() {
    let with = |wol: WolConfig| ConnectionInput {
        wol: Some(wol),
        ..ssh_input("x", "h")
    };
    let ok = validate(&with(WolConfig {
        mac: "aa-bb-cc-dd-ee-ff".into(),
        ..WolConfig::default()
    }))
    .unwrap();
    assert_eq!(
        ok.wol.map(|wol| wol.mac).as_deref(),
        Some("AA:BB:CC:DD:EE:FF")
    );
    let mac = || "aabbccddeeff".to_string();
    let cases = [
        (
            WolConfig {
                mac: "nope".into(),
                ..WolConfig::default()
            },
            "wol.mac",
        ),
        (
            WolConfig {
                mac: mac(),
                broadcast: "not-an-ip".into(),
                ..WolConfig::default()
            },
            "wol.broadcast",
        ),
        (
            WolConfig {
                mac: mac(),
                wait_timeout_secs: 5,
                ..WolConfig::default()
            },
            "wol.waitTimeoutSecs",
        ),
        (
            WolConfig {
                mac: mac(),
                port: 0,
                ..WolConfig::default()
            },
            "wol.port",
        ),
    ];
    for (wol, field) in cases {
        assert_eq!(field_of(&validate(&with(wol)).unwrap_err()), field);
    }
}

#[test]
fn referenced_group_and_jump_host_must_exist() {
    let input = ConnectionInput {
        group_id: Some(Uuid::new_v4()),
        ..ssh_input("x", "h")
    };
    assert_eq!(field_of(&validate(&input).unwrap_err()), "groupId");
    let input = ConnectionInput {
        jump_host_id: Some(Uuid::new_v4()),
        ..ssh_input("x", "h")
    };
    assert_eq!(field_of(&validate(&input).unwrap_err()), "jumpHostId");
    let group = Group {
        id: Uuid::new_v4(),
        name: "Prod".into(),
        color: None,
    };
    let input = ConnectionInput {
        group_id: Some(group.id),
        ..ssh_input("x", "h")
    };
    assert!(normalize_connection_input(&input, None, &[group], &[]).is_ok());
}

#[test]
fn jump_host_must_be_another_ssh_connection() {
    let rdp = saved(rdp_input("win", "10.0.0.5"));
    let input = ConnectionInput {
        jump_host_id: Some(rdp.id),
        ..ssh_input("x", "h")
    };
    let error = normalize_connection_input(&input, None, &[], &[rdp]).unwrap_err();
    assert_eq!(field_of(&error), "jumpHostId");

    let me = saved(ssh_input("me", "h"));
    let input = ConnectionInput {
        jump_host_id: Some(me.id),
        ..me.to_input()
    };
    let error = normalize_connection_input(&input, Some(me.id), &[], &[me]).unwrap_err();
    assert_eq!(field_of(&error), "jumpHostId");
}

#[test]
fn jump_chains_cannot_loop() {
    // b jumps through a, c jumps through b. Making a jump through c would loop.
    let a = saved(ssh_input("a", "a.example"));
    let b = saved(ConnectionInput {
        jump_host_id: Some(a.id),
        ..ssh_input("b", "b.example")
    });
    let c = saved(ConnectionInput {
        jump_host_id: Some(b.id),
        ..ssh_input("c", "c.example")
    });
    let all = [a.clone(), b, c.clone()];
    let looping = ConnectionInput {
        jump_host_id: Some(c.id),
        ..a.to_input()
    };
    let error = normalize_connection_input(&looping, Some(a.id), &[], &all).unwrap_err();
    assert_eq!(field_of(&error), "jumpHostId");
    let through_c = ConnectionInput {
        jump_host_id: Some(c.id),
        ..ssh_input("d", "d.example")
    };
    assert!(normalize_connection_input(&through_c, None, &[], &all).is_ok());
}

#[test]
fn jump_chains_are_limited_to_four_bastions() {
    // h2 jumps through h1, h3 through h2… A target behind h4 has 4 bastions, behind h5 it has 5.
    let mut chain: Vec<Connection> = Vec::new();
    for i in 1..=5 {
        let previous = chain.last().map(|hop| hop.id);
        chain.push(saved(ConnectionInput {
            jump_host_id: previous,
            ..ssh_input(&format!("h{i}"), "h.example")
        }));
    }
    let behind = |hop: &Connection| ConnectionInput {
        jump_host_id: Some(hop.id),
        ..ssh_input("t", "t.example")
    };
    assert!(normalize_connection_input(&behind(&chain[3]), None, &[], &chain).is_ok());
    let error = normalize_connection_input(&behind(&chain[4]), None, &[], &chain).unwrap_err();
    assert_eq!(field_of(&error), "jumpHostId");
}

#[test]
fn a_bastion_in_use_cannot_become_rdp() {
    let bastion = saved(ssh_input("bastion-01", "bastion.example"));
    let web = saved(ConnectionInput {
        jump_host_id: Some(bastion.id),
        ..ssh_input("web-01", "10.0.0.12")
    });
    let as_rdp = ConnectionInput {
        settings: ConnectionInput::template(Protocol::Rdp).settings,
        ..bastion.to_input()
    };
    let error = normalize_connection_input(&as_rdp, Some(bastion.id), &[], &[bastion.clone(), web])
        .unwrap_err();
    assert_eq!(error.kind, ErrorKind::InUse);
    assert_eq!(
        error.detail.as_deref(),
        Some(&ErrorDetail::InUse {
            names: vec!["web-01".into()]
        })
    );
}

#[test]
fn updating_a_connection_keeps_its_identity() {
    let original = Connection {
        last_connected_at: Some(5_000),
        ..saved(ssh_input("web", "h"))
    };
    let updated = original.with_input(ssh_input("web-renamed", "h"), 9_000);
    assert_eq!(updated.id, original.id);
    assert_eq!(updated.created_at, 1_000);
    assert_eq!(updated.updated_at, 9_000);
    assert_eq!(updated.last_connected_at, Some(5_000));
    assert_eq!(updated.to_input(), ssh_input("web-renamed", "h"));
}

#[test]
fn group_names_are_trimmed_and_unique() {
    let prod = Group {
        id: Uuid::new_v4(),
        name: "Production".into(),
        color: None,
    };
    let groups = [prod.clone()];
    let lab = GroupInput {
        name: "  Lab ".into(),
        color: Some(AccentColor::Green),
    };
    assert_eq!(
        normalize_group_input(&lab, None, &groups).unwrap().name,
        "Lab"
    );
    let duplicate = GroupInput {
        name: "production".into(),
        color: None,
    };
    assert_eq!(
        field_of(&normalize_group_input(&duplicate, None, &groups).unwrap_err()),
        "name"
    );
    assert!(
        normalize_group_input(&duplicate, Some(prod.id), &groups).is_ok(),
        "renaming itself is fine"
    );
    let blank = GroupInput {
        name: " ".into(),
        color: None,
    };
    assert_eq!(
        field_of(&normalize_group_input(&blank, None, &groups).unwrap_err()),
        "name"
    );
}

#[test]
fn settings_fill_missing_fields_with_defaults() {
    let json = r#"{ "theme": "dark", "terminal": { "fontSize": 15 }, "future": true }"#;
    let settings: Settings = serde_json::from_str(json).unwrap();
    assert_eq!(settings.theme, ThemeMode::Dark);
    assert_eq!(settings.terminal.font_size, 15);
    assert_eq!(settings.terminal.scrollback, 10_000);
    assert_eq!(settings.ssh.connect_timeout_secs, 15);
    assert_eq!(settings.ui.sidebar_width, 272);
    assert_eq!(settings.version, 1);
}

#[test]
fn default_settings_are_valid() {
    let base = Settings::default();
    assert_eq!(normalize_settings(&base).unwrap(), base);
}

#[test]
fn settings_out_of_range_are_rejected_with_their_path() {
    let base = Settings::default();
    let cases = [
        (
            Settings {
                terminal: TerminalSettings {
                    font_size: 7,
                    ..base.terminal.clone()
                },
                ..base.clone()
            },
            "terminal.fontSize",
        ),
        (
            Settings {
                terminal: TerminalSettings {
                    line_height: 2.5,
                    ..base.terminal.clone()
                },
                ..base.clone()
            },
            "terminal.lineHeight",
        ),
        (
            Settings {
                ssh: SshDefaults {
                    connect_timeout_secs: 0,
                    ..base.ssh.clone()
                },
                ..base.clone()
            },
            "ssh.connectTimeoutSecs",
        ),
        (
            Settings {
                reachability: ReachabilitySettings {
                    interval_secs: 5,
                    ..base.reachability.clone()
                },
                ..base.clone()
            },
            "reachability.intervalSecs",
        ),
        (
            Settings {
                ui: UiSettings {
                    sidebar_width: 100,
                    ..base.ui.clone()
                },
                ..base.clone()
            },
            "ui.sidebarWidth",
        ),
        (
            Settings {
                rdp: RdpDefaults {
                    client_path: Some("relative/freerdp".into()),
                },
                ..base.clone()
            },
            "rdp.clientPath",
        ),
    ];
    for (settings, field) in cases {
        assert_eq!(field_of(&normalize_settings(&settings).unwrap_err()), field);
    }
}
