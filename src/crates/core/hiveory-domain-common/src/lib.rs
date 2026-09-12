//! Shared domain primitives. Privileged domain behavior belongs in dedicated crates.

use serde::{Deserialize, Serialize};
use uuid::Uuid;

#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct HiveoryId(pub String);

impl HiveoryId {
    pub fn new() -> Self {
        Self(Uuid::now_v7().to_string())
    }
}

impl Default for HiveoryId {
    fn default() -> Self {
        Self::new()
    }
}
