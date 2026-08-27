//! Pure Code-mode policies and pane-tree invariants.
//!
//! This crate deliberately has no Tauri, filesystem, process, or database
//! dependencies. Host services use these functions as the single source of
//! truth for trust capabilities, safe relative paths, and layout validation.

use agentic_super_app_protocol::{
    CodePaneKind, CodePaneLayout, CodePaneNode, CodePaneOrientation, CodeWorkspaceCapability,
    CodeWorkspaceTrust,
};
use std::path::{Component, Path};
use thiserror::Error;

pub const CODE_LAYOUT_VERSION: u32 = 1;
pub const CODE_MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
pub const CODE_MAX_TREE_ENTRIES: usize = 5_000;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CodeDomainError {
    #[error("workspace path must be relative to the approved workspace root")]
    AbsolutePath,
    #[error("workspace path contains a parent traversal")]
    ParentTraversal,
    #[error("workspace path contains an invalid component")]
    InvalidPath,
    #[error("workspace path cannot be empty")]
    EmptyPath,
    #[error("pane layout is invalid: {0}")]
    InvalidLayout(String),
}

pub fn capabilities_for_trust(trust: CodeWorkspaceTrust) -> Vec<CodeWorkspaceCapability> {
    match trust {
        CodeWorkspaceTrust::Untrusted => vec![CodeWorkspaceCapability::ReadFiles],
        CodeWorkspaceTrust::Trusted => vec![
            CodeWorkspaceCapability::ReadFiles,
            CodeWorkspaceCapability::WriteFiles,
            CodeWorkspaceCapability::ExecuteProcesses,
            CodeWorkspaceCapability::ReadGit,
            CodeWorkspaceCapability::OpenPreview,
        ],
    }
}

pub fn allows(trust: CodeWorkspaceTrust, capability: CodeWorkspaceCapability) -> bool {
    capabilities_for_trust(trust).contains(&capability)
}

/// Validates a user-supplied path before it is passed to a capability-scoped
/// directory handle. The returned value uses forward slashes so the persisted
/// and wire representations remain portable across Windows and Unix hosts.
pub fn validate_relative_path(value: &str, allow_root: bool) -> Result<String, CodeDomainError> {
    if value.is_empty() {
        return if allow_root {
            Ok(String::new())
        } else {
            Err(CodeDomainError::EmptyPath)
        };
    }
    if value.contains('\0') {
        return Err(CodeDomainError::InvalidPath);
    }

    let normalized = value.replace('\\', "/");
    if normalized.starts_with('/') || Path::new(value).is_absolute() {
        return Err(CodeDomainError::AbsolutePath);
    }
    if Path::new(value).components().any(|component| {
        matches!(
            component,
            Component::Prefix(_) | Component::RootDir | Component::ParentDir
        )
    }) {
        return Err(CodeDomainError::ParentTraversal);
    }

    let mut parts = Vec::new();
    for part in normalized.split('/') {
        if part.is_empty() {
            continue;
        }
        if part == ".." {
            return Err(CodeDomainError::ParentTraversal);
        }
        if part == "." {
            return Err(CodeDomainError::InvalidPath);
        }
        parts.push(part);
    }
    if parts.is_empty() {
        return if allow_root {
            Ok(String::new())
        } else {
            Err(CodeDomainError::EmptyPath)
        };
    }
    Ok(parts.join("/"))
}

pub fn language_for_path(path: &str) -> Option<String> {
    let extension = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    let language = match extension.as_str() {
        "rs" => "rust",
        "ts" => "typescript",
        "tsx" => "typescript",
        "js" => "javascript",
        "jsx" => "javascript",
        "json" => "json",
        "md" | "markdown" => "markdown",
        "css" => "css",
        "scss" => "scss",
        "html" | "htm" => "html",
        "toml" => "ini",
        "yaml" | "yml" => "yaml",
        "py" => "python",
        "go" => "go",
        "java" => "java",
        "c" => "c",
        "h" => "c",
        "cpp" | "cc" | "cxx" => "cpp",
        "sql" => "sql",
        "sh" | "bash" => "shell",
        "xml" => "xml",
        _ => return None,
    };
    Some(language.to_owned())
}

pub fn default_layout(workspace_id: &str) -> CodePaneLayout {
    CodePaneLayout {
        workspace_id: workspace_id.to_owned(),
        version: CODE_LAYOUT_VERSION,
        root_id: "root".to_owned(),
        nodes: vec![
            CodePaneNode {
                pane_id: "root".to_owned(),
                parent_id: None,
                kind: CodePaneKind::Empty,
                orientation: Some(CodePaneOrientation::Horizontal),
                ratio_percent: Some(24),
                children: vec!["editor".to_owned(), "terminal".to_owned()],
                resource_id: None,
            },
            CodePaneNode {
                pane_id: "editor".to_owned(),
                parent_id: Some("root".to_owned()),
                kind: CodePaneKind::Editor,
                orientation: None,
                ratio_percent: None,
                children: Vec::new(),
                resource_id: None,
            },
            CodePaneNode {
                pane_id: "terminal".to_owned(),
                parent_id: Some("root".to_owned()),
                kind: CodePaneKind::Terminal,
                orientation: None,
                ratio_percent: None,
                children: Vec::new(),
                resource_id: None,
            },
        ],
    }
}

pub fn validate_layout(layout: &CodePaneLayout) -> Result<(), CodeDomainError> {
    if layout.version != CODE_LAYOUT_VERSION {
        return Err(CodeDomainError::InvalidLayout(format!(
            "unsupported version {}",
            layout.version
        )));
    }
    if layout.nodes.is_empty() {
        return Err(CodeDomainError::InvalidLayout(
            "layout has no nodes".to_owned(),
        ));
    }
    let mut ids = std::collections::HashSet::new();
    for node in &layout.nodes {
        if node.pane_id.trim().is_empty() || !ids.insert(node.pane_id.as_str()) {
            return Err(CodeDomainError::InvalidLayout(
                "pane ids must be unique and non-empty".to_owned(),
            ));
        }
        let is_split = node.orientation.is_some();
        if is_split {
            if node.kind != CodePaneKind::Empty || node.children.len() < 2 {
                return Err(CodeDomainError::InvalidLayout(format!(
                    "split {} must be an empty node with at least two children",
                    node.pane_id
                )));
            }
            if node
                .ratio_percent
                .is_some_and(|ratio| !(10..=90).contains(&ratio))
            {
                return Err(CodeDomainError::InvalidLayout(format!(
                    "split {} ratio must be between 10 and 90",
                    node.pane_id
                )));
            }
        } else if !node.children.is_empty() {
            return Err(CodeDomainError::InvalidLayout(format!(
                "leaf {} cannot have children",
                node.pane_id
            )));
        }
    }
    let root = layout
        .nodes
        .iter()
        .find(|node| node.pane_id == layout.root_id)
        .ok_or_else(|| CodeDomainError::InvalidLayout("root node is missing".to_owned()))?;
    if root.parent_id.is_some() {
        return Err(CodeDomainError::InvalidLayout(
            "root node cannot have a parent".to_owned(),
        ));
    }

    let by_id = layout
        .nodes
        .iter()
        .map(|node| (node.pane_id.as_str(), node))
        .collect::<std::collections::HashMap<_, _>>();
    for node in &layout.nodes {
        if let Some(parent_id) = &node.parent_id {
            let parent = by_id.get(parent_id.as_str()).ok_or_else(|| {
                CodeDomainError::InvalidLayout(format!("parent {} is missing", parent_id))
            })?;
            if !parent.children.iter().any(|child| child == &node.pane_id) {
                return Err(CodeDomainError::InvalidLayout(format!(
                    "parent {} does not reference {}",
                    parent_id, node.pane_id
                )));
            }
        }
        for child_id in &node.children {
            let child = by_id.get(child_id.as_str()).ok_or_else(|| {
                CodeDomainError::InvalidLayout(format!("child {} is missing", child_id))
            })?;
            if child.parent_id.as_deref() != Some(node.pane_id.as_str()) {
                return Err(CodeDomainError::InvalidLayout(format!(
                    "child {} has an inconsistent parent",
                    child_id
                )));
            }
        }
    }

    fn visit(
        id: &str,
        by_id: &std::collections::HashMap<&str, &CodePaneNode>,
        visiting: &mut std::collections::HashSet<String>,
        visited: &mut std::collections::HashSet<String>,
    ) -> Result<(), CodeDomainError> {
        if !visiting.insert(id.to_owned()) {
            return Err(CodeDomainError::InvalidLayout(
                "pane tree contains a cycle".to_owned(),
            ));
        }
        let node = by_id
            .get(id)
            .ok_or_else(|| CodeDomainError::InvalidLayout(format!("node {} is missing", id)))?;
        for child_id in &node.children {
            visit(child_id, by_id, visiting, visited)?;
        }
        visiting.remove(id);
        visited.insert(id.to_owned());
        Ok(())
    }

    let mut visiting = std::collections::HashSet::new();
    let mut visited = std::collections::HashSet::new();
    visit(&layout.root_id, &by_id, &mut visiting, &mut visited)?;
    if visited.len() != layout.nodes.len() {
        return Err(CodeDomainError::InvalidLayout(
            "layout contains unreachable nodes".to_owned(),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_escape_attempts_and_normalizes_separators() {
        assert_eq!(
            validate_relative_path("src\\main.rs", false).unwrap(),
            "src/main.rs"
        );
        assert_eq!(
            validate_relative_path("src//main.rs", false).unwrap(),
            "src/main.rs"
        );
        assert_eq!(
            validate_relative_path("../secrets", false),
            Err(CodeDomainError::ParentTraversal)
        );
        assert_eq!(
            validate_relative_path("C:\\secrets", false),
            Err(CodeDomainError::AbsolutePath)
        );
        assert_eq!(
            validate_relative_path("/secrets", false),
            Err(CodeDomainError::AbsolutePath)
        );
    }

    #[test]
    fn default_layout_is_deterministic_and_valid() {
        let layout = default_layout("workspace");
        assert_eq!(layout, default_layout("workspace"));
        validate_layout(&layout).unwrap();
    }

    #[test]
    fn untrusted_workspaces_are_read_only() {
        assert!(allows(
            CodeWorkspaceTrust::Untrusted,
            CodeWorkspaceCapability::ReadFiles
        ));
        assert!(!allows(
            CodeWorkspaceTrust::Untrusted,
            CodeWorkspaceCapability::WriteFiles
        ));
        assert!(allows(
            CodeWorkspaceTrust::Trusted,
            CodeWorkspaceCapability::OpenPreview
        ));
    }
}
