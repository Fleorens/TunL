use std::collections::HashSet;

use uuid::Uuid;

use super::Store;
use crate::error::{AppError, AppResult, ErrorDetail, ErrorKind};
use crate::model::{
    Connection, ConnectionInput, Group, GroupInput, normalize_connection_input,
    normalize_group_input,
};

/// Maximum length of a connection name, including any duplicate suffix (docs/05-modele-donnees.md §6).
const MAX_NAME_CHARS: usize = 80;

impl Store {
    /// Validate `input` and append a fresh connection. The original store is never mutated.
    pub fn create_connection(
        &self,
        input: &ConnectionInput,
        id: Uuid,
        now_ms: i64,
    ) -> AppResult<(Store, Connection)> {
        let normalized = normalize_connection_input(input, None, &self.groups, &self.connections)?;
        let connection = Connection::from_input(id, normalized, now_ms);
        let mut next = self.clone();
        next.connections.push(connection.clone());
        Ok((next, connection))
    }

    /// Apply validated `input` to an existing connection, keeping its id and creation date.
    pub fn update_connection(
        &self,
        id: Uuid,
        input: &ConnectionInput,
        now_ms: i64,
    ) -> AppResult<(Store, Connection)> {
        let current = self
            .find(id)
            .ok_or_else(|| AppError::not_found("connection"))?;
        let normalized =
            normalize_connection_input(input, Some(id), &self.groups, &self.connections)?;
        let updated = current.with_input(normalized, now_ms);
        let mut next = self.clone();
        next.replace_connection(updated.clone());
        Ok((next, updated))
    }

    /// Copy a connection under a fresh id, with a free `(n)` suffix and no history. Secrets are not copied (T12).
    pub fn duplicate_connection(
        &self,
        id: Uuid,
        new_id: Uuid,
        now_ms: i64,
    ) -> AppResult<(Store, Connection)> {
        let current = self
            .find(id)
            .ok_or_else(|| AppError::not_found("connection"))?;
        let mut input = current.to_input();
        input.name = free_name(&current.name, &self.connections);
        input.favorite = false;
        let duplicate = Connection::from_input(new_id, input, now_ms);
        let mut next = self.clone();
        next.connections.push(duplicate.clone());
        Ok((next, duplicate))
    }

    /// Remove a connection, refusing a bastion still used as a jump host.
    pub fn delete_connection(&self, id: Uuid) -> AppResult<Store> {
        if self.find(id).is_none() {
            return Err(AppError::not_found("connection"));
        }
        let used_by: Vec<String> = self
            .connections
            .iter()
            .filter(|c| c.id != id && c.jump_host_id == Some(id))
            .map(|c| c.name.clone())
            .collect();
        if !used_by.is_empty() {
            let mut names = used_by;
            names.sort();
            return Err(
                AppError::new(ErrorKind::InUse, "connection is used as a jump host")
                    .with_detail(ErrorDetail::InUse { names }),
            );
        }
        let mut next = self.clone();
        next.connections.retain(|c| c.id != id);
        Ok(next)
    }

    /// Toggle the favorite flag, bumping `updated_at`.
    pub fn set_favorite(
        &self,
        id: Uuid,
        favorite: bool,
        now_ms: i64,
    ) -> AppResult<(Store, Connection)> {
        let current = self
            .find(id)
            .cloned()
            .ok_or_else(|| AppError::not_found("connection"))?;
        let updated = Connection {
            favorite,
            updated_at: now_ms,
            ..current.clone()
        };
        let mut next = self.clone();
        next.replace_connection(updated.clone());
        Ok((next, updated))
    }

    /// Record that a connection was just used, without treating it as an edit.
    pub fn touch_connection(&self, id: Uuid, now_ms: i64) -> AppResult<(Store, Connection)> {
        let current = self
            .find(id)
            .cloned()
            .ok_or_else(|| AppError::not_found("connection"))?;
        let updated = Connection {
            last_connected_at: Some(now_ms),
            ..current.clone()
        };
        let mut next = self.clone();
        next.replace_connection(updated.clone());
        Ok((next, updated))
    }

    /// Validate a group input and append a fresh group.
    pub fn create_group(&self, input: &GroupInput, id: Uuid) -> AppResult<(Store, Group)> {
        let normalized = normalize_group_input(input, None, &self.groups)?;
        let group = Group {
            id,
            name: normalized.name,
            color: normalized.color,
        };
        let mut next = self.clone();
        next.groups.push(group.clone());
        Ok((next, group))
    }

    /// Apply validated `input` to an existing group.
    pub fn update_group(&self, id: Uuid, input: &GroupInput) -> AppResult<(Store, Group)> {
        if self.find_group(id).is_none() {
            return Err(AppError::not_found("group"));
        }
        let normalized = normalize_group_input(input, Some(id), &self.groups)?;
        let updated = Group {
            id,
            name: normalized.name,
            color: normalized.color,
        };
        let mut next = self.clone();
        next.replace_group(updated.clone());
        Ok((next, updated))
    }

    /// Remove a group; its connections lose their group without being edited.
    pub fn delete_group(&self, id: Uuid) -> AppResult<Store> {
        if self.find_group(id).is_none() {
            return Err(AppError::not_found("group"));
        }
        let mut next = self.clone();
        for connection in &mut next.connections {
            if connection.group_id == Some(id) {
                connection.group_id = None;
            }
        }
        next.groups.retain(|g| g.id != id);
        Ok(next)
    }

    /// Rewrite the group order, accepting only a full permutation of the current groups.
    pub fn reorder_groups(&self, ids: &[Uuid]) -> AppResult<Store> {
        if ids.len() != self.groups.len() {
            return Err(AppError::validation(
                "ids",
                "must list every group exactly once",
            ));
        }
        let mut seen: HashSet<Uuid> = HashSet::new();
        for &id in ids {
            if !self.groups.iter().any(|g| g.id == id) || !seen.insert(id) {
                return Err(AppError::validation(
                    "ids",
                    "must list every group exactly once",
                ));
            }
        }
        let mut next = self.clone();
        next.groups = ids
            .iter()
            .filter_map(|&id| self.groups.iter().find(|g| g.id == id).cloned())
            .collect();
        Ok(next)
    }

    fn find(&self, id: Uuid) -> Option<&Connection> {
        self.connections.iter().find(|c| c.id == id)
    }

    fn find_group(&self, id: Uuid) -> Option<&Group> {
        self.groups.iter().find(|g| g.id == id)
    }
}

impl Store {
    /// Overwrite the connection with the same id in place.
    fn replace_connection(&mut self, connection: Connection) {
        if let Some(slot) = self.connections.iter_mut().find(|c| c.id == connection.id) {
            *slot = connection;
        }
    }

    /// Overwrite the group with the same id in place.
    fn replace_group(&mut self, group: Group) {
        if let Some(slot) = self.groups.iter_mut().find(|g| g.id == group.id) {
            *slot = group;
        }
    }
}

/// The first `base (n)` that is free and within `MAX_NAME_CHARS`, shortening `base` so the total stays 80 chars.
fn free_name(base: &str, connections: &[Connection]) -> String {
    let mut n = 2;
    loop {
        let candidate = named(base, n);
        if !connections.iter().any(|c| c.name == candidate) {
            return candidate;
        }
        n += 1;
    }
}

/// `base (n)`, trimming `base` character-for-character if the total would exceed 80 characters.
fn named(base: &str, n: usize) -> String {
    let suffix = format!(" ({n})");
    let suffix_len = suffix.chars().count();
    let base_chars: Vec<char> = base.chars().collect();
    if base_chars.len() + suffix_len <= MAX_NAME_CHARS {
        return format!("{base}{suffix}");
    }
    let shortened: String = base_chars
        .into_iter()
        .take(MAX_NAME_CHARS - suffix_len)
        .collect();
    format!("{shortened}{suffix}")
}
