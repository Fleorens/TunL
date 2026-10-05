use std::path::{Path, PathBuf};

use super::auth::{AuthPlan, expand_home, plan_for};
use crate::model::SshAuth;

#[test]
fn each_saved_method_has_its_plan() {
    assert_eq!(plan_for(&SshAuth::Password), AuthPlan::Password);
    assert_eq!(plan_for(&SshAuth::Agent), AuthPlan::Agent);
    assert_eq!(
        plan_for(&SshAuth::Key {
            path: "~/.ssh/id_ed25519".into()
        }),
        AuthPlan::Key {
            path: "~/.ssh/id_ed25519".into()
        }
    );
}

#[test]
fn a_leading_tilde_is_the_home_directory() {
    let home = Some(Path::new("/home/ada"));
    assert_eq!(
        expand_home("~/.ssh/id_ed25519", home),
        PathBuf::from("/home/ada/.ssh/id_ed25519")
    );
    assert_eq!(expand_home("~", home), PathBuf::from("/home/ada"));
    assert_eq!(expand_home("/etc/key", home), PathBuf::from("/etc/key"));
    // Only a leading `~/` (or `~` alone) is expanded: `~bob` and a `~` inside the path stay as written.
    assert_eq!(expand_home("~bob/key", home), PathBuf::from("~bob/key"));
    assert_eq!(expand_home("/keys/~/id", home), PathBuf::from("/keys/~/id"));
    // Without a home directory, the path stays as written.
    assert_eq!(expand_home("~/.ssh/id", None), PathBuf::from("~/.ssh/id"));
}
