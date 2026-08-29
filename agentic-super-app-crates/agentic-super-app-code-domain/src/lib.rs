//! Pure Code-mode policies and pane-tree invariants.
//!
//! This crate deliberately has no Tauri, filesystem, process, or database
//! dependencies. Host services use these functions as the single source of
//! truth for trust capabilities, safe relative paths, and layout validation.

use agentic_super_app_protocol::{
    CodePaneKind, CodePaneLayout, CodePaneNode, CodePaneOrientation, CodePanePlacement,
    CodePanePreset, CodeTask, CodeTaskDependency, CodeTaskState, CodeWorkspaceCapability,
    CodeWorkspaceTrust,
};
use std::collections::{HashMap, HashSet};
use std::path::{Component, Path};
use thiserror::Error;

pub const CODE_LAYOUT_VERSION: u32 = 2;
pub const CODE_MAX_PANES: usize = 17;
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
    #[error("maximum limit of 17 panes reached")]
    TooManyPanes,
    #[error("preset {preset} supports up to {max} panes, but workspace has {count}")]
    PresetCapacityExceeded {
        preset: String,
        count: usize,
        max: usize,
    },
    #[error("pane {0} not found")]
    PaneNotFound(String),
    #[error("pane title must be between 1 and 80 non-control characters")]
    InvalidTitle,
    #[error("cannot split internal node")]
    CannotSplitInternalNode,
    #[error("cannot move to non-leaf target")]
    InvalidMoveTarget,
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

/// Creates a clean, empty canvas layout for a workspace.
pub fn default_layout(workspace_id: &str) -> CodePaneLayout {
    CodePaneLayout {
        workspace_id: workspace_id.to_owned(),
        version: CODE_LAYOUT_VERSION,
        root_id: "root".to_owned(),
        nodes: vec![CodePaneNode {
            pane_id: "root".to_owned(),
            parent_id: None,
            kind: CodePaneKind::Empty,
            orientation: None,
            ratio_percent: None,
            children: Vec::new(),
            resource_id: None,
            title: None,
        }],
        revision: 0,
        focused_pane_id: Some("root".to_owned()),
        maximized_pane_id: None,
    }
}

/// Validates a pane title: 1 to 80 characters, trimmed, no control characters.
pub fn validate_title(title: &str) -> Result<String, CodeDomainError> {
    let trimmed = title.trim();
    if trimmed.is_empty() || trimmed.chars().count() > 80 {
        return Err(CodeDomainError::InvalidTitle);
    }
    if trimmed.chars().any(|c| c.is_control()) {
        return Err(CodeDomainError::InvalidTitle);
    }
    Ok(trimmed.to_owned())
}

/// Validates layout tree invariants, ratios, and leaf bounds.
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
    let leaves_count = layout
        .nodes
        .iter()
        .filter(|n| n.children.is_empty())
        .count();
    if leaves_count > CODE_MAX_PANES {
        return Err(CodeDomainError::InvalidLayout(format!(
            "too many panes: {} (maximum is {})",
            leaves_count, CODE_MAX_PANES
        )));
    }
    if leaves_count == 0 {
        return Err(CodeDomainError::InvalidLayout(
            "layout has no leaf panes".to_owned(),
        ));
    }
    let mut ids = HashSet::new();
    for node in &layout.nodes {
        if node.pane_id.trim().is_empty() || !ids.insert(node.pane_id.as_str()) {
            return Err(CodeDomainError::InvalidLayout(
                "pane ids must be unique and non-empty".to_owned(),
            ));
        }
        let is_split = node.orientation.is_some();
        if is_split {
            if node.kind != CodePaneKind::Empty || node.children.len() != 2 {
                return Err(CodeDomainError::InvalidLayout(format!(
                    "split {} must be an empty node with exactly two children",
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
            if node.title.is_some() {
                return Err(CodeDomainError::InvalidLayout(format!(
                    "split {} cannot have a title",
                    node.pane_id
                )));
            }
            if node.resource_id.is_some() {
                return Err(CodeDomainError::InvalidLayout(format!(
                    "split {} cannot have a resource_id",
                    node.pane_id
                )));
            }
        } else {
            if !node.children.is_empty() {
                return Err(CodeDomainError::InvalidLayout(format!(
                    "leaf {} cannot have children",
                    node.pane_id
                )));
            }
            if node.kind == CodePaneKind::Empty && node.resource_id.is_some() {
                return Err(CodeDomainError::InvalidLayout(format!(
                    "empty leaf {} cannot have a resource_id",
                    node.pane_id
                )));
            }
            if let Some(title) = &node.title {
                if validate_title(title).is_err() {
                    return Err(CodeDomainError::InvalidLayout(format!(
                        "leaf {} has invalid title",
                        node.pane_id
                    )));
                }
            }
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
        .collect::<HashMap<_, _>>();
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
        by_id: &HashMap<&str, &CodePaneNode>,
        visiting: &mut HashSet<String>,
        visited: &mut HashSet<String>,
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

    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    visit(&layout.root_id, &by_id, &mut visiting, &mut visited)?;
    if visited.len() != layout.nodes.len() {
        return Err(CodeDomainError::InvalidLayout(
            "layout contains unreachable nodes".to_owned(),
        ));
    }

    if let Some(focused_id) = &layout.focused_pane_id {
        let node = by_id.get(focused_id.as_str()).ok_or_else(|| {
            CodeDomainError::InvalidLayout(format!("focused pane {} not found", focused_id))
        })?;
        if !node.children.is_empty() {
            return Err(CodeDomainError::InvalidLayout(format!(
                "focused pane {} is an internal node",
                focused_id
            )));
        }
    }
    if let Some(maximized_id) = &layout.maximized_pane_id {
        let node = by_id.get(maximized_id.as_str()).ok_or_else(|| {
            CodeDomainError::InvalidLayout(format!("maximized pane {} not found", maximized_id))
        })?;
        if !node.children.is_empty() {
            return Err(CodeDomainError::InvalidLayout(format!(
                "maximized pane {} is an internal node",
                maximized_id
            )));
        }
    }
    Ok(())
}

/// Returns the visual leaf order (left-to-right, top-to-bottom) of the layout tree.
pub fn visual_leaf_order(layout: &CodePaneLayout) -> Vec<String> {
    let by_id: HashMap<&str, &CodePaneNode> = layout
        .nodes
        .iter()
        .map(|node| (node.pane_id.as_str(), node))
        .collect();
    let mut leaves = Vec::new();
    fn collect_leaves<'a>(
        node_id: &'a str,
        by_id: &HashMap<&'a str, &'a CodePaneNode>,
        leaves: &mut Vec<String>,
    ) {
        if let Some(node) = by_id.get(node_id) {
            if node.children.is_empty() {
                leaves.push(node.pane_id.clone());
            } else {
                for child in &node.children {
                    collect_leaves(child.as_str(), by_id, leaves);
                }
            }
        }
    }
    collect_leaves(layout.root_id.as_str(), &by_id, &mut leaves);
    leaves
}

/// Converts a v1 layout to v2, pruning unbound legacy editor/diff leaves while preserving active terminals/previews.
pub fn migrate_layout_v1(v1_layout: &CodePaneLayout) -> CodePaneLayout {
    if v1_layout.version == CODE_LAYOUT_VERSION && validate_layout(v1_layout).is_ok() {
        return v1_layout.clone();
    }

    // Collect bound resources (terminals, previews, threads, or leaves with resource_id)
    let bound_leaves = v1_layout
        .nodes
        .iter()
        .filter(|n| n.children.is_empty())
        .filter(|n| {
            n.resource_id.is_some()
                || matches!(
                    n.kind,
                    CodePaneKind::Terminal
                        | CodePaneKind::CodingAgent
                        | CodePaneKind::Preview
                        | CodePaneKind::Thread
                ) && n.resource_id.is_some()
        })
        .cloned()
        .collect::<Vec<_>>();

    if bound_leaves.is_empty() {
        return default_layout(&v1_layout.workspace_id);
    }

    if bound_leaves.len() == 1 {
        let leaf = &bound_leaves[0];
        let root = CodePaneNode {
            pane_id: leaf.pane_id.clone(),
            parent_id: None,
            kind: leaf.kind,
            orientation: None,
            ratio_percent: None,
            children: Vec::new(),
            resource_id: leaf.resource_id.clone(),
            title: leaf.title.clone().or_else(|| match leaf.kind {
                CodePaneKind::Terminal | CodePaneKind::CodingAgent => Some("Terminal".to_owned()),
                CodePaneKind::Preview => Some("Preview".to_owned()),
                CodePaneKind::Thread => Some("Thread".to_owned()),
                _ => None,
            }),
        };
        let layout = CodePaneLayout {
            workspace_id: v1_layout.workspace_id.clone(),
            version: CODE_LAYOUT_VERSION,
            root_id: root.pane_id.clone(),
            nodes: vec![root],
            revision: 0,
            focused_pane_id: Some(leaf.pane_id.clone()),
            maximized_pane_id: None,
        };
        if validate_layout(&layout).is_ok() {
            return layout;
        }
    }

    // Multiple bound leaves: arrange with Tidy preset
    let clean_layout = CodePaneLayout {
        workspace_id: v1_layout.workspace_id.clone(),
        version: CODE_LAYOUT_VERSION,
        root_id: bound_leaves[0].pane_id.clone(),
        nodes: bound_leaves
            .into_iter()
            .map(|mut l| {
                l.parent_id = None;
                l.children = Vec::new();
                l.orientation = None;
                l.ratio_percent = None;
                l
            })
            .collect(),
        revision: 0,
        focused_pane_id: None,
        maximized_pane_id: None,
    };

    if let Ok(tidied) = apply_layout_preset(&clean_layout, CodePanePreset::Tidy) {
        return tidied;
    }

    default_layout(&v1_layout.workspace_id)
}

fn next_generated_id(prefix: &str, existing: &HashSet<&str>) -> String {
    for i in 1..10_000 {
        let candidate = format!("{}_{}", prefix, i);
        if !existing.contains(candidate.as_str()) {
            return candidate;
        }
    }
    format!("{}_{}", prefix, uuid_fallback())
}

fn uuid_fallback() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(42)
}

/// Splits a leaf pane horizontally or vertically, adding a new Empty leaf beside it.
pub fn split_pane(
    layout: &CodePaneLayout,
    pane_id: &str,
    placement: CodePanePlacement,
) -> Result<CodePaneLayout, CodeDomainError> {
    let leaves = visual_leaf_order(layout);
    if leaves.len() >= CODE_MAX_PANES {
        return Err(CodeDomainError::TooManyPanes);
    }
    let target_node = layout
        .nodes
        .iter()
        .find(|n| n.pane_id == pane_id)
        .ok_or_else(|| CodeDomainError::PaneNotFound(pane_id.to_owned()))?;
    if !target_node.children.is_empty() {
        return Err(CodeDomainError::CannotSplitInternalNode);
    }

    let existing_ids: HashSet<&str> = layout.nodes.iter().map(|n| n.pane_id.as_str()).collect();
    let split_id = next_generated_id("split", &existing_ids);
    let mut updated_existing = existing_ids.clone();
    updated_existing.insert(&split_id);
    let new_leaf_id = next_generated_id("pane", &updated_existing);

    let orientation = match placement {
        CodePanePlacement::Left | CodePanePlacement::Right | CodePanePlacement::Center => {
            CodePaneOrientation::Horizontal
        }
        CodePanePlacement::Top | CodePanePlacement::Bottom => CodePaneOrientation::Vertical,
    };

    let children = match placement {
        CodePanePlacement::Right | CodePanePlacement::Bottom | CodePanePlacement::Center => {
            vec![pane_id.to_owned(), new_leaf_id.clone()]
        }
        CodePanePlacement::Left | CodePanePlacement::Top => {
            vec![new_leaf_id.clone(), pane_id.to_owned()]
        }
    };

    let mut new_nodes = Vec::with_capacity(layout.nodes.len() + 2);
    let mut root_id = layout.root_id.clone();
    let is_root = layout.root_id == pane_id;
    let target_parent_id = target_node.parent_id.clone();

    if is_root {
        root_id = split_id.clone();
    }

    for node in &layout.nodes {
        if node.pane_id == pane_id {
            let mut updated = node.clone();
            updated.parent_id = Some(split_id.clone());
            new_nodes.push(updated);
        } else if Some(node.pane_id.as_str()) == target_parent_id.as_deref() {
            let mut updated = node.clone();
            updated.children = updated
                .children
                .into_iter()
                .map(|child| {
                    if child == pane_id {
                        split_id.clone()
                    } else {
                        child
                    }
                })
                .collect();
            new_nodes.push(updated);
        } else {
            new_nodes.push(node.clone());
        }
    }

    // Split container node
    new_nodes.push(CodePaneNode {
        pane_id: split_id.clone(),
        parent_id: target_parent_id,
        kind: CodePaneKind::Empty,
        orientation: Some(orientation),
        ratio_percent: Some(50),
        children,
        resource_id: None,
        title: None,
    });

    // New empty leaf node
    new_nodes.push(CodePaneNode {
        pane_id: new_leaf_id.clone(),
        parent_id: Some(split_id),
        kind: CodePaneKind::Empty,
        orientation: None,
        ratio_percent: None,
        children: Vec::new(),
        resource_id: None,
        title: None,
    });

    let new_layout = CodePaneLayout {
        workspace_id: layout.workspace_id.clone(),
        version: CODE_LAYOUT_VERSION,
        root_id,
        nodes: new_nodes,
        revision: layout.revision,
        focused_pane_id: Some(new_leaf_id),
        maximized_pane_id: None,
    };

    validate_layout(&new_layout)?;
    Ok(new_layout)
}

/// Renames a leaf pane.
pub fn rename_pane(
    layout: &CodePaneLayout,
    pane_id: &str,
    title: &str,
) -> Result<CodePaneLayout, CodeDomainError> {
    let valid_title = validate_title(title)?;
    let mut found = false;
    let mut new_nodes = Vec::with_capacity(layout.nodes.len());
    for node in &layout.nodes {
        if node.pane_id == pane_id {
            if !node.children.is_empty() {
                return Err(CodeDomainError::CannotSplitInternalNode);
            }
            let mut updated = node.clone();
            updated.title = Some(valid_title.clone());
            new_nodes.push(updated);
            found = true;
        } else {
            new_nodes.push(node.clone());
        }
    }
    if !found {
        return Err(CodeDomainError::PaneNotFound(pane_id.to_owned()));
    }
    let new_layout = CodePaneLayout {
        workspace_id: layout.workspace_id.clone(),
        version: CODE_LAYOUT_VERSION,
        root_id: layout.root_id.clone(),
        nodes: new_nodes,
        revision: layout.revision,
        focused_pane_id: layout.focused_pane_id.clone(),
        maximized_pane_id: layout.maximized_pane_id.clone(),
    };
    validate_layout(&new_layout)?;
    Ok(new_layout)
}

/// Resizes a split node, clamping ratio between 10% and 90%.
pub fn resize_split(
    layout: &CodePaneLayout,
    split_id: &str,
    ratio_percent: u8,
) -> Result<CodePaneLayout, CodeDomainError> {
    let clamped_ratio = ratio_percent.clamp(10, 90);
    let mut found = false;
    let mut new_nodes = Vec::with_capacity(layout.nodes.len());
    for node in &layout.nodes {
        if node.pane_id == split_id {
            if node.orientation.is_none() {
                return Err(CodeDomainError::InvalidLayout(format!(
                    "node {} is not a split",
                    split_id
                )));
            }
            let mut updated = node.clone();
            updated.ratio_percent = Some(clamped_ratio);
            new_nodes.push(updated);
            found = true;
        } else {
            new_nodes.push(node.clone());
        }
    }
    if !found {
        return Err(CodeDomainError::PaneNotFound(split_id.to_owned()));
    }
    let new_layout = CodePaneLayout {
        workspace_id: layout.workspace_id.clone(),
        version: CODE_LAYOUT_VERSION,
        root_id: layout.root_id.clone(),
        nodes: new_nodes,
        revision: layout.revision,
        focused_pane_id: layout.focused_pane_id.clone(),
        maximized_pane_id: layout.maximized_pane_id.clone(),
    };
    validate_layout(&new_layout)?;
    Ok(new_layout)
}

/// Sets the focused leaf pane.
pub fn focus_pane(
    layout: &CodePaneLayout,
    pane_id: &str,
) -> Result<CodePaneLayout, CodeDomainError> {
    let node = layout
        .nodes
        .iter()
        .find(|n| n.pane_id == pane_id)
        .ok_or_else(|| CodeDomainError::PaneNotFound(pane_id.to_owned()))?;
    if !node.children.is_empty() {
        return Err(CodeDomainError::InvalidLayout(format!(
            "cannot focus internal node {}",
            pane_id
        )));
    }
    let mut new_layout = layout.clone();
    new_layout.focused_pane_id = Some(pane_id.to_owned());
    validate_layout(&new_layout)?;
    Ok(new_layout)
}

/// Sets or clears the maximized leaf pane.
pub fn set_maximized_pane(
    layout: &CodePaneLayout,
    pane_id: Option<&str>,
) -> Result<CodePaneLayout, CodeDomainError> {
    if let Some(id) = pane_id {
        let node = layout
            .nodes
            .iter()
            .find(|n| n.pane_id == id)
            .ok_or_else(|| CodeDomainError::PaneNotFound(id.to_owned()))?;
        if !node.children.is_empty() {
            return Err(CodeDomainError::InvalidLayout(format!(
                "cannot maximize internal node {}",
                id
            )));
        }
    }
    let mut new_layout = layout.clone();
    new_layout.maximized_pane_id = pane_id.map(ToString::to_string);
    if let Some(id) = pane_id {
        new_layout.focused_pane_id = Some(id.to_owned());
    }
    validate_layout(&new_layout)?;
    Ok(new_layout)
}

/// Closes a pane and collapses any resulting unary parent node.
/// If the last pane is closed, resets to a single Empty leaf.
pub fn close_pane_and_collapse(
    layout: &CodePaneLayout,
    pane_id: &str,
) -> Result<CodePaneLayout, CodeDomainError> {
    let target = layout
        .nodes
        .iter()
        .find(|n| n.pane_id == pane_id)
        .ok_or_else(|| CodeDomainError::PaneNotFound(pane_id.to_owned()))?;
    if !target.children.is_empty() {
        return Err(CodeDomainError::InvalidLayout(format!(
            "cannot close internal node {}",
            pane_id
        )));
    }

    let leaves = visual_leaf_order(layout);
    if leaves.len() <= 1 {
        return Ok(default_layout(&layout.workspace_id));
    }

    let parent_id = target
        .parent_id
        .clone()
        .ok_or_else(|| CodeDomainError::InvalidLayout("leaf has no parent".to_owned()))?;

    let parent_node = layout
        .nodes
        .iter()
        .find(|n| n.pane_id == parent_id)
        .ok_or_else(|| CodeDomainError::InvalidLayout("parent node is missing".to_owned()))?;

    let sibling_id = parent_node
        .children
        .iter()
        .find(|c| *c != pane_id)
        .cloned()
        .ok_or_else(|| CodeDomainError::InvalidLayout("sibling is missing".to_owned()))?;

    let grandparent_id = parent_node.parent_id.clone();
    let is_parent_root = layout.root_id == parent_id;

    let mut new_nodes = Vec::with_capacity(layout.nodes.len());
    let mut new_root_id = layout.root_id.clone();

    if is_parent_root {
        new_root_id = sibling_id.clone();
    }

    for node in &layout.nodes {
        if node.pane_id == pane_id || node.pane_id == parent_id {
            // Delete target pane and collapsed parent
            continue;
        } else if node.pane_id == sibling_id {
            let mut updated = node.clone();
            updated.parent_id = grandparent_id.clone();
            new_nodes.push(updated);
        } else if Some(node.pane_id.as_str()) == grandparent_id.as_deref() {
            let mut updated = node.clone();
            updated.children = updated
                .children
                .into_iter()
                .map(|c| {
                    if c == parent_id {
                        sibling_id.clone()
                    } else {
                        c
                    }
                })
                .collect();
            new_nodes.push(updated);
        } else {
            new_nodes.push(node.clone());
        }
    }

    let remaining_leaves = new_nodes
        .iter()
        .filter(|n| n.children.is_empty())
        .map(|n| n.pane_id.clone())
        .collect::<Vec<_>>();

    let focused_pane_id = if layout.focused_pane_id.as_deref() == Some(pane_id) {
        remaining_leaves.first().cloned()
    } else {
        layout.focused_pane_id.clone()
    };

    let maximized_pane_id = if layout.maximized_pane_id.as_deref() == Some(pane_id) {
        None
    } else {
        layout.maximized_pane_id.clone()
    };

    let new_layout = CodePaneLayout {
        workspace_id: layout.workspace_id.clone(),
        version: CODE_LAYOUT_VERSION,
        root_id: new_root_id,
        nodes: new_nodes,
        revision: layout.revision,
        focused_pane_id,
        maximized_pane_id,
    };

    validate_layout(&new_layout)?;
    Ok(new_layout)
}

/// Moves a pane. Center swaps the two leaves; edge placements (Left, Right, Top, Bottom)
/// detach the pane, collapse its old parent, and dock it beside the target.
pub fn move_pane(
    layout: &CodePaneLayout,
    pane_id: &str,
    target_pane_id: &str,
    placement: CodePanePlacement,
) -> Result<CodePaneLayout, CodeDomainError> {
    if pane_id == target_pane_id {
        return Ok(layout.clone());
    }

    let source = layout
        .nodes
        .iter()
        .find(|n| n.pane_id == pane_id)
        .ok_or_else(|| CodeDomainError::PaneNotFound(pane_id.to_owned()))?;
    let target = layout
        .nodes
        .iter()
        .find(|n| n.pane_id == target_pane_id)
        .ok_or_else(|| CodeDomainError::PaneNotFound(target_pane_id.to_owned()))?;

    if !source.children.is_empty() || !target.children.is_empty() {
        return Err(CodeDomainError::InvalidMoveTarget);
    }

    if placement == CodePanePlacement::Center {
        // Swap leaves in place
        let mut new_nodes = Vec::with_capacity(layout.nodes.len());
        for node in &layout.nodes {
            if node.pane_id == pane_id {
                let mut swapped = node.clone();
                swapped.kind = target.kind;
                swapped.resource_id = target.resource_id.clone();
                swapped.title = target.title.clone();
                new_nodes.push(swapped);
            } else if node.pane_id == target_pane_id {
                let mut swapped = node.clone();
                swapped.kind = source.kind;
                swapped.resource_id = source.resource_id.clone();
                swapped.title = source.title.clone();
                new_nodes.push(swapped);
            } else {
                new_nodes.push(node.clone());
            }
        }
        let new_layout = CodePaneLayout {
            workspace_id: layout.workspace_id.clone(),
            version: CODE_LAYOUT_VERSION,
            root_id: layout.root_id.clone(),
            nodes: new_nodes,
            revision: layout.revision,
            focused_pane_id: Some(target_pane_id.to_owned()),
            maximized_pane_id: None,
        };
        validate_layout(&new_layout)?;
        return Ok(new_layout);
    }

    // Edge placement:
    // 1. Detach source and collapse unary parent
    let closed = close_pane_and_collapse(layout, pane_id)?;

    // 2. Find target in collapsed tree and split around it
    let existing_ids: HashSet<&str> = closed.nodes.iter().map(|n| n.pane_id.as_str()).collect();
    let split_id = next_generated_id("split", &existing_ids);

    let orientation = match placement {
        CodePanePlacement::Left | CodePanePlacement::Right | CodePanePlacement::Center => {
            CodePaneOrientation::Horizontal
        }
        CodePanePlacement::Top | CodePanePlacement::Bottom => CodePaneOrientation::Vertical,
    };

    let children = match placement {
        CodePanePlacement::Right | CodePanePlacement::Bottom | CodePanePlacement::Center => {
            vec![target_pane_id.to_owned(), pane_id.to_owned()]
        }
        CodePanePlacement::Left | CodePanePlacement::Top => {
            vec![pane_id.to_owned(), target_pane_id.to_owned()]
        }
    };

    let target_in_closed = closed
        .nodes
        .iter()
        .find(|n| n.pane_id == target_pane_id)
        .ok_or_else(|| CodeDomainError::PaneNotFound(target_pane_id.to_owned()))?;

    let is_target_root = closed.root_id == target_pane_id;
    let target_parent_id = target_in_closed.parent_id.clone();

    let mut new_root_id = closed.root_id.clone();
    if is_target_root {
        new_root_id = split_id.clone();
    }

    let mut new_nodes = Vec::with_capacity(closed.nodes.len() + 2);
    for node in &closed.nodes {
        if node.pane_id == target_pane_id {
            let mut updated = node.clone();
            updated.parent_id = Some(split_id.clone());
            new_nodes.push(updated);
        } else if Some(node.pane_id.as_str()) == target_parent_id.as_deref() {
            let mut updated = node.clone();
            updated.children = updated
                .children
                .into_iter()
                .map(|c| {
                    if c == target_pane_id {
                        split_id.clone()
                    } else {
                        c
                    }
                })
                .collect();
            new_nodes.push(updated);
        } else {
            new_nodes.push(node.clone());
        }
    }

    // Re-add split node
    new_nodes.push(CodePaneNode {
        pane_id: split_id.clone(),
        parent_id: target_parent_id,
        kind: CodePaneKind::Empty,
        orientation: Some(orientation),
        ratio_percent: Some(50),
        children,
        resource_id: None,
        title: None,
    });

    // Re-add moved source leaf
    let mut moved_source = source.clone();
    moved_source.parent_id = Some(split_id);
    new_nodes.push(moved_source);

    let new_layout = CodePaneLayout {
        workspace_id: layout.workspace_id.clone(),
        version: CODE_LAYOUT_VERSION,
        root_id: new_root_id,
        nodes: new_nodes,
        revision: layout.revision,
        focused_pane_id: Some(pane_id.to_owned()),
        maximized_pane_id: None,
    };

    validate_layout(&new_layout)?;
    Ok(new_layout)
}

/// Returns the maximum number of panes supported by the given preset.
pub fn preset_max_panes(preset: CodePanePreset) -> usize {
    match preset {
        CodePanePreset::Vertical | CodePanePreset::EqualColumns => 4,
        CodePanePreset::Horizontal | CodePanePreset::EqualRows => 4,
        CodePanePreset::TwoRows => 8,
        CodePanePreset::ThreeRows => 12,
        CodePanePreset::FourRows => 16,
        CodePanePreset::Focus | CodePanePreset::MainLeft => 17,
        CodePanePreset::MainTop => 12,
        CodePanePreset::Grid => 16,
        CodePanePreset::Tidy => 17,
    }
}

/// Applies a deterministic layout preset.
pub fn apply_layout_preset(
    layout: &CodePaneLayout,
    preset: CodePanePreset,
) -> Result<CodePaneLayout, CodeDomainError> {
    apply_layout_preset_with_primary(layout, preset, None)
}

/// Applies a layout preset while optionally making a specific leaf the primary pane.
/// The primary pane is selected atomically with the topology change so callers do not
/// need to race a separate focus mutation against the preset mutation.
pub fn apply_layout_preset_with_primary(
    layout: &CodePaneLayout,
    preset: CodePanePreset,
    primary_pane_id: Option<&str>,
) -> Result<CodePaneLayout, CodeDomainError> {
    let leaves_order = visual_leaf_order(layout);
    if leaves_order.is_empty() {
        return Ok(default_layout(&layout.workspace_id));
    }

    let mut leaf_nodes: Vec<CodePaneNode> = leaves_order
        .iter()
        .filter_map(|id| layout.nodes.iter().find(|n| &n.pane_id == id))
        .cloned()
        .collect();

    let max_allowed = preset_max_panes(preset);
    if leaf_nodes.len() > max_allowed {
        return Err(CodeDomainError::PresetCapacityExceeded {
            preset: format!("{:?}", preset),
            count: leaf_nodes.len(),
            max: max_allowed,
        });
    }

    let preferred_primary = primary_pane_id.or(layout.focused_pane_id.as_deref());
    if let Some(focused_id) = preferred_primary {
        if let Some(pos) = leaf_nodes.iter().position(|n| n.pane_id == focused_id) {
            let focused_node = leaf_nodes.remove(pos);
            leaf_nodes.insert(0, focused_node);
        }
    }

    if leaf_nodes.len() == 1 {
        let mut single = leaf_nodes[0].clone();
        single.parent_id = None;
        single.children = Vec::new();
        single.orientation = None;
        single.ratio_percent = None;
        let single_id = single.pane_id.clone();
        return Ok(CodePaneLayout {
            workspace_id: layout.workspace_id.clone(),
            version: CODE_LAYOUT_VERSION,
            root_id: single_id.clone(),
            nodes: vec![single],
            revision: layout.revision,
            focused_pane_id: Some(single_id),
            maximized_pane_id: None,
        });
    }

    let mut generated_nodes = Vec::new();
    let mut split_counter = 0;

    fn build_balanced_stack(
        leaves: &[CodePaneNode],
        orientation: CodePaneOrientation,
        split_counter: &mut usize,
        generated_nodes: &mut Vec<CodePaneNode>,
    ) -> String {
        if leaves.is_empty() {
            panic!("build_balanced_stack called with empty leaves");
        }
        if leaves.len() == 1 {
            let mut leaf = leaves[0].clone();
            leaf.children = Vec::new();
            leaf.orientation = None;
            leaf.ratio_percent = None;
            let id = leaf.pane_id.clone();
            generated_nodes.push(leaf);
            return id;
        }

        *split_counter += 1;
        let split_id = format!("split_{}", split_counter);
        let mid = leaves.len() / 2;
        let left_leaves = &leaves[..mid];
        let right_leaves = &leaves[mid..];

        let left_id = build_balanced_stack(left_leaves, orientation, split_counter, generated_nodes);
        let right_id = build_balanced_stack(right_leaves, orientation, split_counter, generated_nodes);

        let left_ratio = ((left_leaves.len() as f64 / leaves.len() as f64) * 100.0).round() as u8;
        let ratio_percent = left_ratio.clamp(10, 90);

        for node in generated_nodes.iter_mut() {
            if node.pane_id == left_id || node.pane_id == right_id {
                node.parent_id = Some(split_id.clone());
            }
        }

        generated_nodes.push(CodePaneNode {
            pane_id: split_id.clone(),
            parent_id: None,
            kind: CodePaneKind::Empty,
            orientation: Some(orientation),
            ratio_percent: Some(ratio_percent),
            children: vec![left_id, right_id],
            resource_id: None,
            title: None,
        });

        split_id
    }

    fn build_column_group(
        col_roots: &[(String, usize)],
        split_counter: &mut usize,
        generated_nodes: &mut Vec<CodePaneNode>,
    ) -> String {
        if col_roots.is_empty() {
            panic!("build_column_group called with empty columns");
        }
        if col_roots.len() == 1 {
            return col_roots[0].0.clone();
        }

        let total_leaves: usize = col_roots.iter().map(|(_, count)| *count).sum();
        *split_counter += 1;
        let split_id = format!("split_{}", split_counter);

        let mid = col_roots.len() / 2;
        let left_cols = &col_roots[..mid];
        let right_cols = &col_roots[mid..];

        let left_id = build_column_group(left_cols, split_counter, generated_nodes);
        let right_id = build_column_group(right_cols, split_counter, generated_nodes);

        let left_leaves: usize = left_cols.iter().map(|(_, count)| *count).sum();
        let left_ratio = ((left_leaves as f64 / total_leaves as f64) * 100.0).round() as u8;
        let ratio_percent = left_ratio.clamp(10, 90);

        for node in generated_nodes.iter_mut() {
            if node.pane_id == left_id || node.pane_id == right_id {
                node.parent_id = Some(split_id.clone());
            }
        }

        generated_nodes.push(CodePaneNode {
            pane_id: split_id.clone(),
            parent_id: None,
            kind: CodePaneKind::Empty,
            orientation: Some(CodePaneOrientation::Horizontal),
            ratio_percent: Some(ratio_percent),
            children: vec![left_id, right_id],
            resource_id: None,
            title: None,
        });

        split_id
    }

    fn build_fixed_row_grid(
        leaves: &[CodePaneNode],
        max_rows_per_col: usize,
        split_counter: &mut usize,
        generated_nodes: &mut Vec<CodePaneNode>,
    ) -> String {
        let n = leaves.len();
        if n == 1 {
            let mut leaf = leaves[0].clone();
            leaf.children = Vec::new();
            leaf.orientation = None;
            leaf.ratio_percent = None;
            let id = leaf.pane_id.clone();
            generated_nodes.push(leaf);
            return id;
        }

        let mut col_slices: Vec<&[CodePaneNode]> = Vec::new();
        let mut start = 0;
        while start < n {
            let end = (start + max_rows_per_col).min(n);
            col_slices.push(&leaves[start..end]);
            start = end;
        }

        let mut col_roots = Vec::new();
        for col_leaves in col_slices {
            let root_id = build_balanced_stack(col_leaves, CodePaneOrientation::Vertical, split_counter, generated_nodes);
            col_roots.push((root_id, 1));
        }

        build_column_group(&col_roots, split_counter, generated_nodes)
    }

    fn build_focus_layout(
        leaves: &[CodePaneNode],
        split_counter: &mut usize,
        generated_nodes: &mut Vec<CodePaneNode>,
    ) -> String {
        if leaves.len() == 1 {
            let mut leaf = leaves[0].clone();
            leaf.parent_id = None;
            leaf.children = Vec::new();
            leaf.orientation = None;
            leaf.ratio_percent = None;
            let id = leaf.pane_id.clone();
            generated_nodes.push(leaf);
            return id;
        }

        let mut main_leaf = leaves[0].clone();
        main_leaf.children = Vec::new();
        main_leaf.orientation = None;
        main_leaf.ratio_percent = None;
        let main_id = main_leaf.pane_id.clone();

        let supporting = &leaves[1..];
        let sup_count = supporting.len();

        let right_root_id = if sup_count <= 4 {
            build_balanced_stack(supporting, CodePaneOrientation::Vertical, split_counter, generated_nodes)
        } else {
            let col1_count = sup_count / 2;
            let col1_leaves = &supporting[..col1_count];
            let col2_leaves = &supporting[col1_count..];

            let col1_id = build_balanced_stack(col1_leaves, CodePaneOrientation::Vertical, split_counter, generated_nodes);
            let col2_id = build_balanced_stack(col2_leaves, CodePaneOrientation::Vertical, split_counter, generated_nodes);

            *split_counter += 1;
            let right_split_id = format!("split_{}", split_counter);

            for node in generated_nodes.iter_mut() {
                if node.pane_id == col1_id || node.pane_id == col2_id {
                    node.parent_id = Some(right_split_id.clone());
                }
            }

            generated_nodes.push(CodePaneNode {
                pane_id: right_split_id.clone(),
                parent_id: None,
                kind: CodePaneKind::Empty,
                orientation: Some(CodePaneOrientation::Horizontal),
                ratio_percent: Some(50),
                children: vec![col1_id, col2_id],
                resource_id: None,
                title: None,
            });

            right_split_id
        };

        *split_counter += 1;
        let root_split_id = format!("split_{}", split_counter);

        main_leaf.parent_id = Some(root_split_id.clone());
        generated_nodes.push(main_leaf);

        for node in generated_nodes.iter_mut() {
            if node.pane_id == right_root_id {
                node.parent_id = Some(root_split_id.clone());
            }
        }

        generated_nodes.push(CodePaneNode {
            pane_id: root_split_id.clone(),
            parent_id: None,
            kind: CodePaneKind::Empty,
            orientation: Some(CodePaneOrientation::Horizontal),
            ratio_percent: Some(60),
            children: vec![main_id, right_root_id],
            resource_id: None,
            title: None,
        });

        root_split_id
    }

    fn build_main_side(
        leaves: &[CodePaneNode],
        main_orientation: CodePaneOrientation,
        sub_orientation: CodePaneOrientation,
        split_counter: &mut usize,
        generated_nodes: &mut Vec<CodePaneNode>,
    ) -> String {
        if leaves.len() == 1 {
            let mut leaf = leaves[0].clone();
            leaf.parent_id = None;
            leaf.children = Vec::new();
            leaf.orientation = None;
            leaf.ratio_percent = None;
            let id = leaf.pane_id.clone();
            generated_nodes.push(leaf);
            return id;
        }

        let mut main_leaf = leaves[0].clone();
        let remaining_leaves = &leaves[1..];

        main_leaf.children = Vec::new();
        main_leaf.orientation = None;
        main_leaf.ratio_percent = None;
        let main_id = main_leaf.pane_id.clone();

        let sub_id = build_balanced_stack(
            remaining_leaves,
            sub_orientation,
            split_counter,
            generated_nodes,
        );

        *split_counter += 1;
        let root_split_id = format!("split_{}", split_counter);

        main_leaf.parent_id = Some(root_split_id.clone());
        generated_nodes.push(main_leaf);

        for node in generated_nodes.iter_mut() {
            if node.pane_id == sub_id {
                node.parent_id = Some(root_split_id.clone());
            }
        }

        generated_nodes.push(CodePaneNode {
            pane_id: root_split_id.clone(),
            parent_id: None,
            kind: CodePaneKind::Empty,
            orientation: Some(main_orientation),
            ratio_percent: Some(58),
            children: vec![main_id, sub_id],
            resource_id: None,
            title: None,
        });

        root_split_id
    }

    let root_id = match preset {
        CodePanePreset::Vertical | CodePanePreset::EqualColumns => build_balanced_stack(
            &leaf_nodes,
            CodePaneOrientation::Horizontal,
            &mut split_counter,
            &mut generated_nodes,
        ),
        CodePanePreset::Horizontal | CodePanePreset::EqualRows => build_balanced_stack(
            &leaf_nodes,
            CodePaneOrientation::Vertical,
            &mut split_counter,
            &mut generated_nodes,
        ),
        CodePanePreset::TwoRows => build_fixed_row_grid(
            &leaf_nodes,
            2,
            &mut split_counter,
            &mut generated_nodes,
        ),
        CodePanePreset::ThreeRows => build_fixed_row_grid(
            &leaf_nodes,
            3,
            &mut split_counter,
            &mut generated_nodes,
        ),
        CodePanePreset::FourRows => build_fixed_row_grid(
            &leaf_nodes,
            4,
            &mut split_counter,
            &mut generated_nodes,
        ),
        CodePanePreset::Focus | CodePanePreset::MainLeft => build_focus_layout(
            &leaf_nodes,
            &mut split_counter,
            &mut generated_nodes,
        ),
        CodePanePreset::MainTop => build_main_side(
            &leaf_nodes,
            CodePaneOrientation::Vertical,
            CodePaneOrientation::Horizontal,
            &mut split_counter,
            &mut generated_nodes,
        ),
        CodePanePreset::Grid => build_fixed_row_grid(
            &leaf_nodes,
            2,
            &mut split_counter,
            &mut generated_nodes,
        ),
        CodePanePreset::Tidy => match leaf_nodes.len() {
            1 => {
                let mut single = leaf_nodes[0].clone();
                single.children = Vec::new();
                single.orientation = None;
                single.ratio_percent = None;
                let id = single.pane_id.clone();
                generated_nodes.push(single);
                id
            }
            2 => build_balanced_stack(
                &leaf_nodes,
                CodePaneOrientation::Horizontal,
                &mut split_counter,
                &mut generated_nodes,
            ),
            3 => build_focus_layout(
                &leaf_nodes,
                &mut split_counter,
                &mut generated_nodes,
            ),
            4..=8 => build_fixed_row_grid(
                &leaf_nodes,
                2,
                &mut split_counter,
                &mut generated_nodes,
            ),
            9..=12 => build_fixed_row_grid(
                &leaf_nodes,
                3,
                &mut split_counter,
                &mut generated_nodes,
            ),
            13..=16 => build_fixed_row_grid(
                &leaf_nodes,
                4,
                &mut split_counter,
                &mut generated_nodes,
            ),
            _ => build_focus_layout(
                &leaf_nodes,
                &mut split_counter,
                &mut generated_nodes,
            ),
        },
    };

    let focused = preferred_primary
        .map(ToOwned::to_owned)
        .filter(|id| leaf_nodes.iter().any(|l| &l.pane_id == id))
        .or_else(|| leaf_nodes.first().map(|l| l.pane_id.clone()));

    let new_layout = CodePaneLayout {
        workspace_id: layout.workspace_id.clone(),
        version: CODE_LAYOUT_VERSION,
        root_id,
        nodes: generated_nodes,
        revision: layout.revision,
        focused_pane_id: focused,
        maximized_pane_id: None,
    };

    validate_layout(&new_layout)?;
    Ok(new_layout)
}

#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// Finds the nearest neighboring leaf in the specified spatial direction (Alt+Arrow navigation).
pub fn nearest_pane_in_direction(
    layout: &CodePaneLayout,
    active_pane_id: &str,
    direction: CodePanePlacement,
) -> Option<String> {
    let by_id: HashMap<&str, &CodePaneNode> = layout
        .nodes
        .iter()
        .map(|node| (node.pane_id.as_str(), node))
        .collect();

    let mut rects: HashMap<String, Rect> = HashMap::new();

    fn compute_rects(
        node_id: &str,
        rect: Rect,
        by_id: &HashMap<&str, &CodePaneNode>,
        rects: &mut HashMap<String, Rect>,
    ) {
        if let Some(node) = by_id.get(node_id) {
            if node.children.is_empty() {
                rects.insert(node.pane_id.clone(), rect);
            } else if node.children.len() == 2 {
                let ratio = node.ratio_percent.unwrap_or(50) as f64 / 100.0;
                match node.orientation.unwrap_or(CodePaneOrientation::Horizontal) {
                    CodePaneOrientation::Horizontal => {
                        let w1 = rect.w * ratio;
                        let w2 = rect.w * (1.0 - ratio);
                        compute_rects(
                            &node.children[0],
                            Rect {
                                x: rect.x,
                                y: rect.y,
                                w: w1,
                                h: rect.h,
                            },
                            by_id,
                            rects,
                        );
                        compute_rects(
                            &node.children[1],
                            Rect {
                                x: rect.x + w1,
                                y: rect.y,
                                w: w2,
                                h: rect.h,
                            },
                            by_id,
                            rects,
                        );
                    }
                    CodePaneOrientation::Vertical => {
                        let h1 = rect.h * ratio;
                        let h2 = rect.h * (1.0 - ratio);
                        compute_rects(
                            &node.children[0],
                            Rect {
                                x: rect.x,
                                y: rect.y,
                                w: rect.w,
                                h: h1,
                            },
                            by_id,
                            rects,
                        );
                        compute_rects(
                            &node.children[1],
                            Rect {
                                x: rect.x,
                                y: rect.y + h1,
                                w: rect.w,
                                h: h2,
                            },
                            by_id,
                            rects,
                        );
                    }
                }
            }
        }
    }

    compute_rects(
        &layout.root_id,
        Rect {
            x: 0.0,
            y: 0.0,
            w: 1.0,
            h: 1.0,
        },
        &by_id,
        &mut rects,
    );

    let active_rect = rects.get(active_pane_id)?;
    let active_cx = active_rect.x + active_rect.w / 2.0;
    let active_cy = active_rect.y + active_rect.h / 2.0;

    let mut best_id: Option<String> = None;
    let mut min_distance = f64::MAX;

    for (candidate_id, r) in &rects {
        if candidate_id == active_pane_id {
            continue;
        }
        let cx = r.x + r.w / 2.0;
        let cy = r.y + r.h / 2.0;

        let is_in_direction = match direction {
            CodePanePlacement::Left => cx < active_cx - 0.01,
            CodePanePlacement::Right => cx > active_cx + 0.01,
            CodePanePlacement::Top => cy < active_cy - 0.01,
            CodePanePlacement::Bottom => cy > active_cy + 0.01,
            CodePanePlacement::Center => false,
        };

        if !is_in_direction {
            continue;
        }

        let dx = cx - active_cx;
        let dy = cy - active_cy;
        let dist = match direction {
            CodePanePlacement::Left | CodePanePlacement::Right => dx.abs() + dy.abs() * 2.0,
            CodePanePlacement::Top | CodePanePlacement::Bottom => dy.abs() + dx.abs() * 2.0,
            _ => dx.abs() + dy.abs(),
        };

        if dist < min_distance {
            min_distance = dist;
            best_id = Some(candidate_id.clone());
        }
    }

    best_id
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
    fn default_layout_is_empty_leaf_root_and_valid() {
        let layout = default_layout("ws_1");
        assert_eq!(layout.version, 2);
        assert_eq!(layout.root_id, "root");
        assert_eq!(layout.nodes.len(), 1);
        assert_eq!(layout.nodes[0].kind, CodePaneKind::Empty);
        assert_eq!(layout.focused_pane_id, Some("root".to_owned()));
        assert_eq!(layout.maximized_pane_id, None);
        validate_layout(&layout).unwrap();
    }

    #[test]
    fn split_right_and_down_creates_valid_binary_tree() {
        let layout = default_layout("ws_1");
        let split_1 = split_pane(&layout, "root", CodePanePlacement::Right).unwrap();
        assert_eq!(split_1.nodes.len(), 3);
        let leaves = visual_leaf_order(&split_1);
        assert_eq!(leaves.len(), 2);
        validate_layout(&split_1).unwrap();

        let split_2 = split_pane(&split_1, &leaves[1], CodePanePlacement::Bottom).unwrap();
        assert_eq!(split_2.nodes.len(), 5);
        let leaves_2 = visual_leaf_order(&split_2);
        assert_eq!(leaves_2.len(), 3);
        validate_layout(&split_2).unwrap();
    }

    #[test]
    fn split_limit_rejects_leaf_18() {
        let mut layout = default_layout("ws_1");
        for _ in 0..16 {
            let leaves = visual_leaf_order(&layout);
            layout = split_pane(&layout, &leaves[0], CodePanePlacement::Right).unwrap();
        }
        let leaves = visual_leaf_order(&layout);
        assert_eq!(leaves.len(), 17);
        assert_eq!(
            split_pane(&layout, &leaves[0], CodePanePlacement::Right),
            Err(CodeDomainError::TooManyPanes)
        );
    }

    #[test]
    fn close_collapses_root_and_nested_unary_parents() {
        let layout = default_layout("ws_1");
        let split_1 = split_pane(&layout, "root", CodePanePlacement::Right).unwrap();
        let leaves = visual_leaf_order(&split_1);
        let closed = close_pane_and_collapse(&split_1, &leaves[1]).unwrap();
        assert_eq!(closed.nodes.len(), 1);
        assert_eq!(closed.root_id, leaves[0]);
        validate_layout(&closed).unwrap();
    }

    #[test]
    fn closing_only_leaf_resets_to_empty_root() {
        let layout = default_layout("ws_1");
        let closed = close_pane_and_collapse(&layout, "root").unwrap();
        assert_eq!(closed.nodes.len(), 1);
        assert_eq!(closed.root_id, "root");
        assert_eq!(closed.nodes[0].kind, CodePaneKind::Empty);
        validate_layout(&closed).unwrap();
    }

    #[test]
    fn rename_trims_validates_length_rejects_control_chars_and_persists_unicode() {
        let layout = default_layout("ws_1");
        let renamed = rename_pane(&layout, "root", "  ✨ Terminal 1  ").unwrap();
        assert_eq!(renamed.nodes[0].title.as_deref(), Some("✨ Terminal 1"));

        assert_eq!(
            rename_pane(&layout, "root", "   "),
            Err(CodeDomainError::InvalidTitle)
        );
        assert_eq!(
            rename_pane(&layout, "root", &"a".repeat(81)),
            Err(CodeDomainError::InvalidTitle)
        );
        assert_eq!(
            rename_pane(&layout, "root", "bad\ntitle"),
            Err(CodeDomainError::InvalidTitle)
        );
    }

    #[test]
    fn move_center_swaps_and_edge_reparents() {
        let layout = default_layout("ws_1");
        let split_1 = split_pane(&layout, "root", CodePanePlacement::Right).unwrap();
        let leaves = visual_leaf_order(&split_1);
        let renamed_1 = rename_pane(&split_1, &leaves[0], "First").unwrap();
        let renamed_2 = rename_pane(&renamed_1, &leaves[1], "Second").unwrap();

        // Swap Center
        let swapped = move_pane(
            &renamed_2,
            &leaves[0],
            &leaves[1],
            CodePanePlacement::Center,
        )
        .unwrap();
        assert_eq!(
            swapped
                .nodes
                .iter()
                .find(|n| n.pane_id == leaves[0])
                .unwrap()
                .title
                .as_deref(),
            Some("Second")
        );
        assert_eq!(
            swapped
                .nodes
                .iter()
                .find(|n| n.pane_id == leaves[1])
                .unwrap()
                .title
                .as_deref(),
            Some("First")
        );

        // Self-drop is no-op
        let self_drop =
            move_pane(&renamed_2, &leaves[0], &leaves[0], CodePanePlacement::Left).unwrap();
        assert_eq!(self_drop, renamed_2);

        // Edge move
        let edge_moved = move_pane(
            &renamed_2,
            &leaves[0],
            &leaves[1],
            CodePanePlacement::Bottom,
        )
        .unwrap();
        validate_layout(&edge_moved).unwrap();
    }

    #[test]
    fn resize_clamps_between_10_and_90() {
        let layout = default_layout("ws_1");
        let split_1 = split_pane(&layout, "root", CodePanePlacement::Right).unwrap();
        let split_id = split_1.root_id.clone();
        let resized = resize_split(&split_1, &split_id, 99).unwrap();
        assert_eq!(
            resized
                .nodes
                .iter()
                .find(|n| n.pane_id == split_id)
                .unwrap()
                .ratio_percent,
            Some(90)
        );
    }

    #[test]
    fn presets_are_deterministic_for_all_valid_counts() {
        let mut layout = default_layout("ws_1");
        for count in 1..=17 {
            for preset in [
                CodePanePreset::Vertical,
                CodePanePreset::Horizontal,
                CodePanePreset::TwoRows,
                CodePanePreset::ThreeRows,
                CodePanePreset::FourRows,
                CodePanePreset::Focus,
                CodePanePreset::EqualColumns,
                CodePanePreset::EqualRows,
                CodePanePreset::MainLeft,
                CodePanePreset::MainTop,
                CodePanePreset::Grid,
                CodePanePreset::Tidy,
            ] {
                let max_allowed = preset_max_panes(preset);
                if count <= max_allowed {
                    let applied = apply_layout_preset(&layout, preset).unwrap();
                    validate_layout(&applied).unwrap();
                    let leaves = visual_leaf_order(&applied);
                    assert_eq!(leaves.len(), count);
                } else {
                    assert!(matches!(
                        apply_layout_preset(&layout, preset),
                        Err(CodeDomainError::PresetCapacityExceeded { .. })
                    ));
                }
            }
            if count < 17 {
                let leaves = visual_leaf_order(&layout);
                layout = split_pane(&layout, &leaves[0], CodePanePlacement::Right).unwrap();
            }
        }
    }

    #[test]
    fn preset_capacity_limits_are_strictly_enforced() {
        let mut layout = default_layout("ws_1");
        for _ in 0..4 {
            let leaves = visual_leaf_order(&layout);
            layout = split_pane(&layout, &leaves[0], CodePanePlacement::Right).unwrap();
        }
        // 5 panes: Vertical and Horizontal must fail with PresetCapacityExceeded
        assert_eq!(
            apply_layout_preset(&layout, CodePanePreset::Vertical),
            Err(CodeDomainError::PresetCapacityExceeded {
                preset: "Vertical".to_owned(),
                count: 5,
                max: 4,
            })
        );
        assert_eq!(
            apply_layout_preset(&layout, CodePanePreset::Horizontal),
            Err(CodeDomainError::PresetCapacityExceeded {
                preset: "Horizontal".to_owned(),
                count: 5,
                max: 4,
            })
        );
        // 2 Rows (max 8) should succeed at 5 panes
        assert!(apply_layout_preset(&layout, CodePanePreset::TwoRows).is_ok());

        // Split to 9 panes
        for _ in 0..4 {
            let leaves = visual_leaf_order(&layout);
            layout = split_pane(&layout, &leaves[0], CodePanePlacement::Right).unwrap();
        }
        assert_eq!(visual_leaf_order(&layout).len(), 9);
        assert!(matches!(
            apply_layout_preset(&layout, CodePanePreset::TwoRows),
            Err(CodeDomainError::PresetCapacityExceeded { count: 9, max: 8, .. })
        ));
        assert!(apply_layout_preset(&layout, CodePanePreset::ThreeRows).is_ok());

        // Split to 13 panes
        for _ in 0..4 {
            let leaves = visual_leaf_order(&layout);
            layout = split_pane(&layout, &leaves[0], CodePanePlacement::Right).unwrap();
        }
        assert_eq!(visual_leaf_order(&layout).len(), 13);
        assert!(matches!(
            apply_layout_preset(&layout, CodePanePreset::ThreeRows),
            Err(CodeDomainError::PresetCapacityExceeded { count: 13, max: 12, .. })
        ));
        assert!(apply_layout_preset(&layout, CodePanePreset::FourRows).is_ok());

        // Split to 17 panes
        for _ in 0..4 {
            let leaves = visual_leaf_order(&layout);
            layout = split_pane(&layout, &leaves[0], CodePanePlacement::Right).unwrap();
        }
        assert_eq!(visual_leaf_order(&layout).len(), 17);
        assert!(matches!(
            apply_layout_preset(&layout, CodePanePreset::FourRows),
            Err(CodeDomainError::PresetCapacityExceeded { count: 17, max: 16, .. })
        ));
        assert!(apply_layout_preset(&layout, CodePanePreset::Focus).is_ok());
    }

    #[test]
    fn preset_drop_keeps_the_dragged_pane_primary() {
        let layout = default_layout("ws_1");
        let split = split_pane(&layout, "root", CodePanePlacement::Right).unwrap();
        let leaves = visual_leaf_order(&split);
        let applied =
            apply_layout_preset_with_primary(&split, CodePanePreset::Focus, Some(&leaves[1]))
                .unwrap();

        assert_eq!(applied.focused_pane_id.as_deref(), Some(leaves[1].as_str()));
        assert_eq!(visual_leaf_order(&applied).first(), Some(&leaves[1]));
        validate_layout(&applied).unwrap();
    }

    #[test]
    fn migrates_legacy_v1_layouts_cleanly() {
        let v1_empty = CodePaneLayout {
            workspace_id: "ws_old".to_owned(),
            version: 1,
            root_id: "root".to_owned(),
            nodes: vec![
                CodePaneNode {
                    pane_id: "root".to_owned(),
                    parent_id: None,
                    kind: CodePaneKind::Empty,
                    orientation: Some(CodePaneOrientation::Horizontal),
                    ratio_percent: Some(50),
                    children: vec!["editor".to_owned(), "terminal".to_owned()],
                    resource_id: None,
                    title: None,
                },
                CodePaneNode {
                    pane_id: "editor".to_owned(),
                    parent_id: Some("root".to_owned()),
                    kind: CodePaneKind::Editor,
                    orientation: None,
                    ratio_percent: None,
                    children: Vec::new(),
                    resource_id: None,
                    title: None,
                },
                CodePaneNode {
                    pane_id: "terminal".to_owned(),
                    parent_id: Some("root".to_owned()),
                    kind: CodePaneKind::Terminal,
                    orientation: None,
                    ratio_percent: None,
                    children: Vec::new(),
                    resource_id: None,
                    title: None,
                },
            ],
            revision: 0,
            focused_pane_id: None,
            maximized_pane_id: None,
        };

        // Unbound standard layout migrates to single Empty leaf
        let migrated = migrate_layout_v1(&v1_empty);
        assert_eq!(migrated.version, 2);
        assert_eq!(migrated.nodes.len(), 1);
        assert_eq!(migrated.nodes[0].kind, CodePaneKind::Empty);
        validate_layout(&migrated).unwrap();

        // Bound terminal leaf survives
        let mut v1_bound = v1_empty.clone();
        v1_bound.nodes[2].resource_id = Some("term_123".to_owned());
        let migrated_bound = migrate_layout_v1(&v1_bound);
        assert_eq!(migrated_bound.version, 2);
        assert_eq!(migrated_bound.nodes.len(), 1);
        assert_eq!(
            migrated_bound.nodes[0].resource_id.as_deref(),
            Some("term_123")
        );
        validate_layout(&migrated_bound).unwrap();
    }

    #[test]
    fn nearest_pane_in_direction_navigates_correctly() {
        let layout = default_layout("ws_1");
        let split_1 = split_pane(&layout, "root", CodePanePlacement::Right).unwrap();
        let leaves = visual_leaf_order(&split_1);
        let split_2 = split_pane(&split_1, &leaves[1], CodePanePlacement::Bottom).unwrap();
        let leaves_3 = visual_leaf_order(&split_2); // [leaves[0], top_right, bottom_right]

        let right = nearest_pane_in_direction(&split_2, &leaves_3[0], CodePanePlacement::Right);
        assert!(
            right == Some(leaves_3[1].clone()) || right == Some(leaves_3[2].clone()),
            "Right neighbor should be one of the right-column panes"
        );
        assert_eq!(
            nearest_pane_in_direction(&split_2, &leaves_3[1], CodePanePlacement::Left),
            Some(leaves_3[0].clone())
        );
        assert_eq!(
            nearest_pane_in_direction(&split_2, &leaves_3[1], CodePanePlacement::Bottom),
            Some(leaves_3[2].clone())
        );
        assert_eq!(
            nearest_pane_in_direction(&split_2, &leaves_3[2], CodePanePlacement::Top),
            Some(leaves_3[1].clone())
        );
    }
}
