//! Read-only Git integration for Code mode.
//!
//! Phase 4 intentionally exposes status and diff only. Mutations, worktrees,
//! commits, and remotes remain behind later approval and policy surfaces.

use agentic_super_app_code_domain::validate_relative_path;
use agentic_super_app_protocol::{CodeGitDiff, CodeGitFileStatus, CodeGitStatus};
use git2::{BranchType, DiffFormat, DiffOptions, Repository, Status, StatusOptions};
use std::path::Path;
use thiserror::Error;

const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum AgenticSuperAppGitError {
    #[error("the workspace is not a Git repository")]
    NotRepository,
    #[error("Git operation failed: {0}")]
    Git(#[from] git2::Error),
    #[error("Git path is invalid: {0}")]
    InvalidPath(String),
}

#[derive(Debug, Default, Clone, Copy)]
pub struct AgenticSuperAppGitService;

impl AgenticSuperAppGitService {
    pub fn status(
        &self,
        workspace_id: &str,
        root: &Path,
    ) -> Result<CodeGitStatus, AgenticSuperAppGitError> {
        let repository = Repository::discover(root).map_err(|error| {
            if error.code() == git2::ErrorCode::NotFound {
                AgenticSuperAppGitError::NotRepository
            } else {
                AgenticSuperAppGitError::Git(error)
            }
        })?;
        let branch = repository
            .head()
            .ok()
            .and_then(|head| head.shorthand().ok().map(ToOwned::to_owned));
        let (ahead, behind) = ahead_behind(&repository);
        let mut options = StatusOptions::new();
        options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false)
            .renames_head_to_index(true)
            .renames_index_to_workdir(true);
        let statuses = repository.statuses(Some(&mut options))?;
        let files = statuses
            .iter()
            .filter_map(|entry| {
                let path = entry.path().ok()?.replace('\\', "/");
                let status = entry.status();
                Some(CodeGitFileStatus {
                    relative_path: path,
                    status: status_label(status).to_owned(),
                    staged: is_staged(status),
                    conflict: status.is_conflicted(),
                })
            })
            .collect();
        Ok(CodeGitStatus {
            workspace_id: workspace_id.to_owned(),
            branch,
            ahead,
            behind,
            files,
        })
    }

    pub fn diff(
        &self,
        workspace_id: &str,
        root: &Path,
        relative_path: Option<&str>,
    ) -> Result<CodeGitDiff, AgenticSuperAppGitError> {
        let repository = Repository::discover(root).map_err(|error| {
            if error.code() == git2::ErrorCode::NotFound {
                AgenticSuperAppGitError::NotRepository
            } else {
                AgenticSuperAppGitError::Git(error)
            }
        })?;
        let normalized_path = relative_path
            .map(|path| {
                validate_relative_path(path, false)
                    .map_err(|error| AgenticSuperAppGitError::InvalidPath(error.to_string()))
            })
            .transpose()?;
        let binary = std::cell::Cell::new(false);
        let truncated = std::cell::Cell::new(false);
        let mut options = DiffOptions::new();
        if let Some(path) = normalized_path.as_deref() {
            options.pathspec(path);
        }
        let diff = repository.diff_index_to_workdir(None, Some(&mut options))?;
        let mut bytes = Vec::new();
        diff.print(DiffFormat::Patch, |delta, _hunk, line| {
            binary.set(binary.get() || delta.flags().is_binary());
            if bytes.len() + line.content().len() > MAX_DIFF_BYTES {
                truncated.set(true);
                return false;
            }
            bytes.extend_from_slice(line.content());
            true
        })?;
        Ok(CodeGitDiff {
            workspace_id: workspace_id.to_owned(),
            relative_path: normalized_path,
            content: String::from_utf8_lossy(&bytes).into_owned(),
            binary: binary.get(),
            truncated: truncated.get(),
        })
    }
}

fn is_staged(status: Status) -> bool {
    status.is_index_new()
        || status.is_index_modified()
        || status.is_index_deleted()
        || status.is_index_renamed()
        || status.is_index_typechange()
}

fn status_label(status: Status) -> &'static str {
    if status.is_conflicted() {
        "conflict"
    } else if status.is_index_new() || status.is_wt_new() {
        "added"
    } else if status.is_index_deleted() || status.is_wt_deleted() {
        "deleted"
    } else if status.is_index_renamed() || status.is_wt_renamed() {
        "renamed"
    } else if status.is_index_typechange() || status.is_wt_typechange() {
        "type_changed"
    } else if status.is_index_modified() || status.is_wt_modified() {
        "modified"
    } else if status.is_ignored() {
        "ignored"
    } else {
        "changed"
    }
}

fn ahead_behind(repository: &Repository) -> (usize, usize) {
    let Ok(head) = repository.head() else {
        return (0, 0);
    };
    let Some(local) = head.target() else {
        return (0, 0);
    };
    let Ok(name) = head.shorthand() else {
        return (0, 0);
    };
    let Ok(branch) = repository.find_branch(name, BranchType::Local) else {
        return (0, 0);
    };
    let Ok(upstream) = branch.upstream() else {
        return (0, 0);
    };
    let Some(remote) = upstream.get().target() else {
        return (0, 0);
    };
    repository
        .graph_ahead_behind(local, remote)
        .unwrap_or((0, 0))
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Repository, Signature};
    use std::fs;

    #[test]
    fn reports_worktree_changes_without_mutating_git() {
        let root = std::env::temp_dir().join(format!("agentic-code-git-{}", uuid::Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        let repository = Repository::init(&root).unwrap();
        fs::write(root.join("README.md"), "hello\n").unwrap();
        let mut index = repository.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repository.find_tree(tree_id).unwrap();
        let signature = Signature::now("test", "test@example.invalid").unwrap();
        repository
            .commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .unwrap();
        fs::write(root.join("README.md"), "changed\n").unwrap();
        let status = AgenticSuperAppGitService
            .status("workspace", &root)
            .unwrap();
        assert_eq!(status.files[0].relative_path, "README.md");
        assert_eq!(status.files[0].status, "modified");
        let diff = AgenticSuperAppGitService
            .diff("workspace", &root, Some("README.md"))
            .unwrap();
        assert!(diff.content.contains("changed"));
        let _ = fs::remove_dir_all(root);
    }
}
