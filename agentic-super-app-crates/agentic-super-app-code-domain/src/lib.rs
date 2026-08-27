//! Pure Code-mode policies and pane-tree invariants.
//!
//! This crate deliberately has no Tauri, filesystem, process, or database
//! dependencies. Host services use these functions as the single source of
//! truth for trust capabilities, safe relative paths, and layout validation.

use agentic_super_app_protocol::{
    CodePaneKind, CodePaneLayout, CodePaneNode, CodePaneOrientation, CodeTask, CodeTaskDependency,
    CodeTaskState, CodeWorkspaceCapability, CodeWorkspaceTrust,
};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path};
use thiserror::Error;

pub const CODE_LAYOUT_VERSION: u32 = 1;
pub const CODE_MAX_FILE_BYTES: u64 = 5 * 1024 * 1024;
pub const CODE_MAX_TREE_ENTRIES: usize = 5_000;
pub const CODE_MAX_ORCHESTRATION_TASKS: usize = 128;
pub const CODE_MAX_ORCHESTRATION_EDGES: usize = 1_024;
pub const CODE_MAX_ORCHESTRATION_TEXT_BYTES: usize = 32 * 1024;

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
    #[error("orchestration DAG has too many tasks")]
    TooManyTasks,
    #[error("orchestration DAG has too many dependency edges")]
    TooManyEdges,
    #[error("task IDs must be unique and non-empty")]
    DuplicateTask,
    #[error("dependency references missing task {0}")]
    MissingTask(String),
    #[error("a task cannot depend on itself")]
    SelfDependency,
    #[error("orchestration DAG contains a cycle")]
    Cycle,
    #[error("orchestration text exceeds the supported limit")]
    TextTooLarge,
    #[error("orchestration text cannot be empty")]
    EmptyText,
}

/// Validates and topologically sorts an orchestration DAG. The returned order
/// is deterministic, which keeps fan-in and UI ordering reproducible.
pub fn validate_orchestration_dag(
    task_ids: &[String],
    dependencies: &[CodeTaskDependency],
) -> Result<Vec<String>, CodeDomainError> {
    if task_ids.len() > CODE_MAX_ORCHESTRATION_TASKS {
        return Err(CodeDomainError::TooManyTasks);
    }
    if dependencies.len() > CODE_MAX_ORCHESTRATION_EDGES {
        return Err(CodeDomainError::TooManyEdges);
    }
    let mut known = HashSet::with_capacity(task_ids.len());
    for id in task_ids {
        if id.trim().is_empty() || !known.insert(id.as_str()) {
            return Err(CodeDomainError::DuplicateTask);
        }
    }
    let mut indegree = task_ids
        .iter()
        .map(|id| (id.clone(), 0_usize))
        .collect::<HashMap<_, _>>();
    let mut outgoing: HashMap<&str, Vec<&str>> = HashMap::new();
    let mut seen_edges = HashSet::new();
    for dependency in dependencies {
        if dependency.task_id == dependency.depends_on_task_id {
            return Err(CodeDomainError::SelfDependency);
        }
        if !known.contains(dependency.task_id.as_str()) {
            return Err(CodeDomainError::MissingTask(dependency.task_id.clone()));
        }
        if !known.contains(dependency.depends_on_task_id.as_str()) {
            return Err(CodeDomainError::MissingTask(
                dependency.depends_on_task_id.clone(),
            ));
        }
        if !seen_edges.insert((
            dependency.task_id.as_str(),
            dependency.depends_on_task_id.as_str(),
        )) {
            continue;
        }
        *indegree
            .get_mut(&dependency.task_id)
            .expect("validated task ID") += 1;
        outgoing
            .entry(dependency.depends_on_task_id.as_str())
            .or_default()
            .push(dependency.task_id.as_str());
    }

    let mut ready = task_ids
        .iter()
        .filter(|id| indegree.get(*id).copied() == Some(0))
        .cloned()
        .collect::<Vec<_>>();
    ready.sort();
    let mut order = Vec::with_capacity(task_ids.len());
    while let Some(id) = ready.first().cloned() {
        ready.remove(0);
        order.push(id.clone());
        if let Some(children) = outgoing.get(id.as_str()) {
            for child in children {
                let degree = indegree.get_mut(*child).expect("validated task ID");
                *degree -= 1;
                if *degree == 0 {
                    ready.push((*child).to_owned());
                }
            }
            ready.sort();
        }
    }
    if order.len() != task_ids.len() {
        return Err(CodeDomainError::Cycle);
    }
    Ok(order)
}

pub fn ready_orchestration_task_ids(
    tasks: &[CodeTask],
    dependencies: &[CodeTaskDependency],
) -> Vec<String> {
    let by_id = tasks
        .iter()
        .map(|task| (task.id.as_str(), task))
        .collect::<HashMap<_, _>>();
    let mut ready = tasks
        .iter()
        .filter(|task| matches!(task.state, CodeTaskState::Ready))
        .filter(|task| {
            dependencies
                .iter()
                .filter(|edge| edge.task_id == task.id)
                .all(|edge| {
                    by_id
                        .get(edge.depends_on_task_id.as_str())
                        .is_some_and(|dependency| {
                            matches!(dependency.state, CodeTaskState::Completed)
                        })
                })
        })
        .map(|task| (task.position, task.id.clone()))
        .collect::<Vec<_>>();
    ready.sort();
    ready.into_iter().map(|(_, id)| id).collect()
}

pub fn adaptive_concurrency_cap(logical_cpus: usize, memory_bytes: Option<u64>) -> u8 {
    let cpu_cap = (logical_cpus / 2).max(1);
    let memory_cap = memory_bytes
        .map(|bytes| (bytes / (3 * 1024 * 1024 * 1024)).max(1) as usize)
        .unwrap_or(4);
    cpu_cap.min(memory_cap).clamp(1, 8) as u8
}

pub fn validate_orchestration_text(value: &str) -> Result<(), CodeDomainError> {
    if value.trim().is_empty() {
        return Err(CodeDomainError::EmptyText);
    }
    if value.len() > CODE_MAX_ORCHESTRATION_TEXT_BYTES {
        return Err(CodeDomainError::TextTooLarge);
    }
    Ok(())
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

    fn edge(task_id: &str, depends_on_task_id: &str) -> CodeTaskDependency {
        CodeTaskDependency {
            run_id: "run".to_owned(),
            task_id: task_id.to_owned(),
            depends_on_task_id: depends_on_task_id.to_owned(),
        }
    }

    #[test]
    fn validates_and_orders_a_dag_deterministically() {
        let ids = vec!["b".to_owned(), "a".to_owned(), "c".to_owned()];
        let order = validate_orchestration_dag(&ids, &[edge("c", "b"), edge("b", "a")]).unwrap();
        assert_eq!(order, vec!["a", "b", "c"]);
    }

    #[test]
    fn rejects_cycles_and_missing_dependencies() {
        let ids = vec!["a".to_owned(), "b".to_owned()];
        assert_eq!(
            validate_orchestration_dag(&ids, &[edge("a", "b"), edge("b", "a")]),
            Err(CodeDomainError::Cycle)
        );
        assert_eq!(
            validate_orchestration_dag(&ids, &[edge("a", "missing")]),
            Err(CodeDomainError::MissingTask("missing".to_owned()))
        );
    }

    #[test]
    fn reports_ready_tasks_only_after_completed_dependencies() {
        let task = |id: &str, state: CodeTaskState, position: u32| CodeTask {
            id: id.to_owned(),
            run_id: "run".to_owned(),
            client_id: id.to_owned(),
            title: id.to_owned(),
            specification: id.to_owned(),
            state,
            position,
            active_dispatch_id: None,
            latest_checkpoint_id: None,
            base_checkpoint_id: None,
            attempt: 0,
            error: None,
            created_at_unix_ms: 0,
            updated_at_unix_ms: 0,
        };
        let tasks = vec![
            task("b", CodeTaskState::Ready, 2),
            task("a", CodeTaskState::Completed, 1),
        ];
        assert_eq!(
            ready_orchestration_task_ids(&tasks, &[edge("b", "a")]),
            vec!["b"]
        );
    }

    #[test]
    fn computes_a_conservative_adaptive_cap() {
        assert_eq!(
            adaptive_concurrency_cap(16, Some(24 * 1024 * 1024 * 1024)),
            8
        );
        assert_eq!(adaptive_concurrency_cap(8, Some(6 * 1024 * 1024 * 1024)), 2);
        assert_eq!(adaptive_concurrency_cap(1, None), 1);
    }
}
