//! Security vocabulary shared by host-owned authorization layers.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HiveoryCapability {
    ReadShellProjection,
    ChangeActiveMode,
}

pub fn is_bootstrap_capability(capability: HiveoryCapability) -> bool {
    matches!(
        capability,
        HiveoryCapability::ReadShellProjection | HiveoryCapability::ChangeActiveMode
    )
}
