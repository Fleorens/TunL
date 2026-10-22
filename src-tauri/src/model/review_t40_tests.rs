//! Decisions of the security review (T40), pinned so a later change has to be deliberate.
use super::ReachabilitySettings;

/// One TCP connect per address every 60 s could get the user banned by sshguard or fail2ban on their own servers:
/// the probes run every 5 minutes by default (still 15 s to 1 h in the settings).
#[test]
fn the_probes_run_every_five_minutes_by_default() {
    let defaults = ReachabilitySettings::default();
    assert!(defaults.enabled);
    assert_eq!(defaults.interval_secs, 300);
}
