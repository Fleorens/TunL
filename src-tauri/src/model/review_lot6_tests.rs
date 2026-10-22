//! Regressions found at the lot 6 review (T28c–T39): each test pins a defect that `npm run review` had missed.
use super::validate_extra_args;

/// T28c passes `/server-name:<real host>` behind a bastion so FreeRDP checks the certificate against it. Extra
/// arguments come last and win: an extra `/server-name` (typed, or brought by an imported file, T32) would
/// silently point the check at another entry.
#[test]
fn an_extra_server_name_cannot_override_the_tunnel_check() {
    for arg in ["/server-name:other.lan", "/SERVER-NAME:other.lan"] {
        assert!(validate_extra_args(&[arg.to_string()]).is_err(), "{arg}");
    }
}
