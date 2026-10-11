use russh::Preferred;
use russh::keys::{Algorithm, EcdsaCurve, HashAlg};

use super::connect::{client_config, client_config_for, host_key_order};

#[test]
fn with_nothing_recorded_russh_keeps_its_own_order() {
    assert_eq!(host_key_order(&[]), Preferred::default().key.into_owned());
    assert_eq!(
        client_config(15).preferred.key.as_ref(),
        Preferred::default().key.as_ref()
    );
}

#[test]
fn a_recorded_rsa_key_brings_every_rsa_signature_first() {
    let order = host_key_order(&[Algorithm::Rsa { hash: None }]);
    assert_eq!(
        order[..3],
        [
            Algorithm::Rsa {
                hash: Some(HashAlg::Sha512)
            },
            Algorithm::Rsa {
                hash: Some(HashAlg::Sha256)
            },
            Algorithm::Rsa { hash: None },
        ]
    );
    assert_eq!(order[3], Algorithm::Ed25519);
    assert_eq!(order.len(), Preferred::default().key.len());
}

#[test]
fn an_ecdsa_key_keeps_its_curve() {
    let p384 = Algorithm::Ecdsa {
        curve: EcdsaCurve::NistP384,
    };
    let config = client_config_for(15, std::slice::from_ref(&p384));
    assert_eq!(config.preferred.key[0], p384);
    assert_eq!(config.preferred.key[1], Algorithm::Ed25519);
}

#[test]
fn the_rest_of_the_config_is_unchanged() {
    let config = client_config_for(15, &[Algorithm::Ed25519]);
    assert_eq!(config.inactivity_timeout, None);
    assert_eq!(
        config.keepalive_interval,
        Some(std::time::Duration::from_secs(15))
    );
    assert_eq!(config.keepalive_max, 3);
    assert_eq!(
        config.preferred.kex.as_ref(),
        Preferred::default().kex.as_ref()
    );
}
