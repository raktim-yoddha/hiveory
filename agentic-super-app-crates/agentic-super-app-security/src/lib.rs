//! Security vocabulary shared by host-owned authorization layers.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgenticSuperAppCapability {
    ReadShellProjection,
    ChangeActiveMode,
}

pub fn is_bootstrap_capability(capability: AgenticSuperAppCapability) -> bool {
    matches!(
        capability,
        AgenticSuperAppCapability::ReadShellProjection
            | AgenticSuperAppCapability::ChangeActiveMode
    )
}
