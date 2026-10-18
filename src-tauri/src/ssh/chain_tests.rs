use uuid::Uuid;

use super::chain::resolve_chain;
use crate::error::{AppError, ErrorKind};
use crate::model::{Connection, ConnectionInput, MAX_JUMP_HOSTS, Protocol};

fn connection(name: &str, protocol: Protocol, jump: Option<Uuid>) -> Connection {
    Connection::from_input(
        Uuid::new_v4(),
        ConnectionInput {
            name: name.into(),
            host: format!("{name}.lan"),
            jump_host_id: jump,
            ..ConnectionInput::template(protocol)
        },
        1_000,
    )
}

fn ssh(name: &str, jump: Option<Uuid>) -> Connection {
    connection(name, Protocol::Ssh, jump)
}

fn names(hops: &[&Connection]) -> Vec<String> {
    hops.iter().map(|c| c.name.clone()).collect()
}

/// A validation error's message starts with its field: `jumpHostId: …`.
fn field(error: &AppError) -> Option<&str> {
    error.message.split(':').next()
}

#[test]
fn a_direct_connection_has_an_empty_chain() {
    let web = ssh("web", None);
    let all = vec![web.clone()];
    assert!(resolve_chain(&web, &all).unwrap().is_empty());
}

#[test]
fn the_chain_is_in_dialling_order() {
    let a = ssh("a", None);
    let b = ssh("b", Some(a.id));
    let c = ssh("c", Some(b.id));
    let web = ssh("web", Some(c.id));
    // Order in the store does not matter.
    let all = vec![web.clone(), b.clone(), c.clone(), a.clone()];
    assert_eq!(names(&resolve_chain(&web, &all).unwrap()), ["a", "b", "c"]);
}

#[test]
fn four_bastions_pass_five_are_refused() {
    let mut all: Vec<Connection> = Vec::new();
    let mut previous: Option<Uuid> = None;
    for i in 0..=MAX_JUMP_HOSTS {
        let hop = ssh(&format!("hop{i}"), previous);
        previous = Some(hop.id);
        all.push(hop);
    }
    // all[4] goes through hop0..hop3: four bastions.
    assert_eq!(resolve_chain(&all[4], &all).unwrap().len(), MAX_JUMP_HOSTS);

    let web = ssh("web", previous);
    all.push(web.clone());
    let error = resolve_chain(&web, &all).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert_eq!(field(&error), Some("jumpHostId"));
}

#[test]
fn a_loop_is_refused_even_through_the_target() {
    // a → b → a: the store refuses it when saving, a hand-edited file may still hold it.
    let mut a = ssh("a", None);
    let b = ssh("b", Some(a.id));
    a.jump_host_id = Some(b.id);
    let all = vec![a.clone(), b.clone()];
    let error = resolve_chain(&a, &all).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert_eq!(field(&error), Some("jumpHostId"));

    // A connection that is its own bastion.
    let mut me = ssh("me", None);
    me.jump_host_id = Some(me.id);
    let error = resolve_chain(&me, std::slice::from_ref(&me)).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
}

#[test]
fn a_loop_further_up_the_chain_is_refused_too() {
    // web → a → b → a
    let mut a = ssh("a", None);
    let b = ssh("b", Some(a.id));
    a.jump_host_id = Some(b.id);
    let web = ssh("web", Some(a.id));
    let all = vec![web.clone(), a, b];
    assert_eq!(
        resolve_chain(&web, &all).unwrap_err().kind,
        ErrorKind::Validation
    );
}

#[test]
fn an_rdp_bastion_is_refused() {
    let rdp = connection("desk", Protocol::Rdp, None);
    let web = ssh("web", Some(rdp.id));
    let all = vec![web.clone(), rdp];
    let error = resolve_chain(&web, &all).unwrap_err();
    assert_eq!(error.kind, ErrorKind::Validation);
    assert_eq!(field(&error), Some("jumpHostId"));
}

#[test]
fn a_missing_bastion_is_not_found() {
    let web = ssh("web", Some(Uuid::new_v4()));
    let all = vec![web.clone()];
    assert_eq!(
        resolve_chain(&web, &all).unwrap_err().kind,
        ErrorKind::NotFound
    );
}
