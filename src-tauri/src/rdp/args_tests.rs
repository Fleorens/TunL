use super::args::{RdpCredentials, RdpEndpoint, build_args};
use crate::error::ErrorKind;
use crate::model::{RdpAudio, RdpCertPolicy, RdpDisplay, RdpSettings};
use crate::secrets::SecretValue;

fn endpoint() -> RdpEndpoint<'static> {
    RdpEndpoint {
        name: "ad-01",
        host: "10.0.0.5",
        port: 3389,
    }
}

fn lines(settings: &RdpSettings, credentials: &RdpCredentials) -> Vec<String> {
    build_args(&endpoint(), settings, credentials)
        .unwrap()
        .lines()
        .map(str::to_string)
        .collect()
}

fn defaults() -> Vec<String> {
    lines(&RdpSettings::default(), &RdpCredentials::default())
}

fn admin() -> RdpCredentials {
    RdpCredentials {
        username: Some("admin".into()),
        password: Some(SecretValue::new("s3cret pass")),
    }
}

#[test]
fn the_defaults_give_the_address_title_and_default_options_in_order() {
    assert_eq!(
        defaults(),
        [
            "/v:10.0.0.5:3389",
            "/t:ad-01 — TunL",
            "/dynamic-resolution",
            "+clipboard",
            "/sound",
        ]
    );
}

#[test]
fn credentials_and_domain_come_right_after_the_address() {
    let settings = RdpSettings {
        domain: Some("CORP".into()),
        ..RdpSettings::default()
    };
    let args = lines(&settings, &admin());
    assert_eq!(
        args[..5],
        [
            "/v:10.0.0.5:3389",
            "/u:admin",
            "/d:CORP",
            "/p:s3cret pass",
            "/t:ad-01 — TunL"
        ]
    );
}

#[test]
fn empty_user_and_domain_are_left_out() {
    let settings = RdpSettings {
        domain: Some(String::new()),
        ..RdpSettings::default()
    };
    let credentials = RdpCredentials {
        username: Some(String::new()),
        password: None,
    };
    let args = lines(&settings, &credentials);
    assert!(
        !args
            .iter()
            .any(|a| a.starts_with("/u:") || a.starts_with("/d:"))
    );
    assert!(!args.iter().any(|a| a.starts_with("/p:")));
}

#[test]
fn an_ipv6_address_is_bracketed() {
    let endpoint = RdpEndpoint {
        host: "fd00::5",
        ..endpoint()
    };
    let args = build_args(
        &endpoint,
        &RdpSettings::default(),
        &RdpCredentials::default(),
    )
    .unwrap();
    assert_eq!(args.lines().next(), Some("/v:[fd00::5]:3389"));
}

#[test]
fn a_tunnel_endpoint_is_used_as_given() {
    let endpoint = RdpEndpoint {
        host: "127.0.0.1",
        port: 40123,
        ..endpoint()
    };
    let args = build_args(
        &endpoint,
        &RdpSettings::default(),
        &RdpCredentials::default(),
    )
    .unwrap();
    assert_eq!(args.lines().next(), Some("/v:127.0.0.1:40123"));
}

#[test]
fn display_modes() {
    let fit_static = RdpSettings {
        dynamic_resolution: false,
        ..RdpSettings::default()
    };
    let args = lines(&fit_static, &RdpCredentials::default());
    assert!(args.contains(&"/smart-sizing".to_string()));
    assert!(!args.contains(&"/dynamic-resolution".to_string()));

    let fullscreen = RdpSettings {
        display: RdpDisplay::Fullscreen,
        dynamic_resolution: false,
        ..RdpSettings::default()
    };
    let args = lines(&fullscreen, &RdpCredentials::default());
    assert!(args.contains(&"/f".to_string()));
    assert!(!args.contains(&"/multimon".to_string()));
    assert!(!args.contains(&"/smart-sizing".to_string()));

    let fixed = RdpSettings {
        display: RdpDisplay::Fixed {
            width: 1920,
            height: 1080,
        },
        ..RdpSettings::default()
    };
    let args = lines(&fixed, &RdpCredentials::default());
    assert!(args.contains(&"/size:1920x1080".to_string()));
    assert!(args.contains(&"/dynamic-resolution".to_string()));
    assert!(!args.contains(&"/f".to_string()));
}

#[test]
fn multimon_only_goes_with_fullscreen() {
    let fullscreen = RdpSettings {
        display: RdpDisplay::Fullscreen,
        multimon: true,
        ..RdpSettings::default()
    };
    let args = lines(&fullscreen, &RdpCredentials::default());
    let f = args.iter().position(|a| a == "/f").unwrap();
    assert_eq!(args[f + 1], "/multimon");

    let windowed = RdpSettings {
        multimon: true,
        ..RdpSettings::default()
    };
    assert!(!lines(&windowed, &RdpCredentials::default()).contains(&"/multimon".to_string()));
}

#[test]
fn clipboard_audio_home_and_certificate() {
    let settings = RdpSettings {
        clipboard: false,
        audio: RdpAudio::Remote,
        share_home: true,
        cert_policy: RdpCertPolicy::Tofu,
        ..RdpSettings::default()
    };
    let args = lines(&settings, &RdpCredentials::default());
    assert!(args.contains(&"-clipboard".to_string()));
    assert!(!args.contains(&"+clipboard".to_string()));
    assert!(args.contains(&"/audio-mode:1".to_string()));
    assert!(!args.contains(&"/sound".to_string()));
    assert!(args.contains(&"+home-drive".to_string()));
    assert!(args.contains(&"/cert:tofu".to_string()));

    let off = RdpSettings {
        audio: RdpAudio::Off,
        ..RdpSettings::default()
    };
    assert!(lines(&off, &RdpCredentials::default()).contains(&"/audio-mode:2".to_string()));
    // The default certificate policy lets FreeRDP ask in its own window: no /cert at all.
    assert!(!defaults().iter().any(|a| a.starts_with("/cert")));
    assert!(!defaults().contains(&"+home-drive".to_string()));
}

#[test]
fn extra_arguments_come_last_in_their_order() {
    let settings = RdpSettings {
        extra_args: vec!["/scale:140".into(), "-wallpaper".into()],
        ..RdpSettings::default()
    };
    let args = lines(&settings, &admin());
    assert_eq!(args[args.len() - 2..], ["/scale:140", "-wallpaper"]);
}

#[test]
fn no_line_is_ever_empty() {
    let settings = RdpSettings {
        display: RdpDisplay::Fullscreen,
        multimon: true,
        share_home: true,
        cert_policy: RdpCertPolicy::Tofu,
        domain: Some("CORP".into()),
        extra_args: vec!["+fonts".into()],
        ..RdpSettings::default()
    };
    let args = build_args(&endpoint(), &settings, &admin()).unwrap();
    assert!(args.lines().all(|line| !line.is_empty()));
    let text = args.stdin_text();
    assert!(text.ends_with('\n'));
    assert!(
        !text.contains("\n\n"),
        "an empty line stops FreeRDP's reading"
    );
    assert_eq!(text.lines().count(), args.lines().count());
}

#[test]
fn a_control_character_anywhere_is_refused_without_echoing_it() {
    let line_break = RdpCredentials {
        username: Some("admin".into()),
        password: Some(SecretValue::new("pw\n/v:evil.example")),
    };
    let error = build_args(&endpoint(), &RdpSettings::default(), &line_break).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert!(error.message.starts_with("password"), "{}", error.message);
    assert!(!error.message.contains("evil"), "S7: {}", error.message);

    let user = RdpCredentials {
        username: Some("ad\rmin".into()),
        password: None,
    };
    assert!(build_args(&endpoint(), &RdpSettings::default(), &user).is_err());

    let domain = RdpSettings {
        domain: Some("CO\tRP".into()),
        ..RdpSettings::default()
    };
    assert!(build_args(&endpoint(), &domain, &RdpCredentials::default()).is_err());

    let host = RdpEndpoint {
        host: "10.0.0.5\n/p:x",
        ..endpoint()
    };
    assert!(build_args(&host, &RdpSettings::default(), &RdpCredentials::default()).is_err());

    let name = RdpEndpoint {
        name: "ad\u{7}01",
        ..endpoint()
    };
    assert!(build_args(&name, &RdpSettings::default(), &RdpCredentials::default()).is_err());
}

#[test]
fn reserved_extra_arguments_are_refused_again() {
    for reserved in [
        "/p:other",
        "/V:evil:3389",
        "/args-from:stdin",
        "/cert:ignore",
    ] {
        let settings = RdpSettings {
            extra_args: vec![reserved.into()],
            ..RdpSettings::default()
        };
        let error = build_args(&endpoint(), &settings, &RdpCredentials::default()).unwrap_err();
        assert_eq!(error.kind, ErrorKind::Validation, "{reserved}");
    }
}

#[test]
fn debug_never_shows_the_password() {
    let args = build_args(&endpoint(), &RdpSettings::default(), &admin()).unwrap();
    let shown = format!("{args:?}");
    assert!(!shown.contains("s3cret"), "{shown}");
    assert!(shown.contains("/p:***"), "{shown}");
    assert!(shown.contains("/u:admin"), "{shown}");
}
