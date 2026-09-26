use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

use crate::model::AccentColor;

/// A group of connections. Group order is the array order; `group_reorder` rewrites it (T08).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct Group {
    pub id: Uuid,
    pub name: String,
    pub color: Option<AccentColor>,
}

/// What the user enters to create or edit a group.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export)]
pub struct GroupInput {
    pub name: String,
    pub color: Option<AccentColor>,
}
