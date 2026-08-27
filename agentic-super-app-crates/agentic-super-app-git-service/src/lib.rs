//! Read-only Git integration for Code mode.
//!
//! Phase 4 intentionally exposes status and diff only. Mutations, worktrees,
//! commits, and remotes remain behind later approval and policy surfaces.

use agentic_super_app_code_domain::validate_relative_path;
use agentic_super_app_protocol::{CodeGitDiff, CodeGitFileStatus, CodeGitStatus};
use git2::{
    BranchType, DiffFormat, DiffOptions, Index, IndexEntry, IndexTime, MergeOptions, Repository,
    Signature, Status, StatusOptions, WorktreeAddOptions, WorktreeLockStatus, WorktreePruneOptions,
};
use std::{
    collections::BTreeSet,
    fs, io,
    path::{Path, PathBuf},
};
use thiserror::Error;

const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum AgenticSuperAppGitError {
    #[error("the workspace is not a Git repository")]
    NotRepository,
    #[error("Git operation failed: {0}")]
    Git(#[from] git2::Error),
    #[error("Git filesystem operation failed: {0}")]
    Io(#[from] io::Error),
    #[error("Git path is invalid: {0}")]
    InvalidPath(String),
    #[error("the requested worktree name is invalid")]
    InvalidWorktreeName,
    #[error("the managed worktree path is outside the orchestration directory")]
    WorktreeOutsideManagedRoot,
    #[error("the managed worktree is dirty: {0}")]
    WorktreeDirty(String),
    #[error("the managed worktree is locked")]
    WorktreeLocked,
    #[error("the repository has no commit to use as a base")]
    MissingHead,
    #[error("the checkpoint merge has conflicts in: {0}")]
    MergeConflict(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgenticSuperAppCreatedWorktree {
    pub name: String,
    pub path: PathBuf,
    pub branch: String,
    pub base_oid: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgenticSuperAppWorktreeInspection {
    pub path: PathBuf,
    pub dirty_files: Vec<String>,
    pub locked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgenticSuperAppCheckpoint {
    pub ref_name: String,
    pub commit_oid: String,
    pub changed_files: Vec<String>,
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

    pub fn head_oid(&self, root: &Path) -> Result<String, AgenticSuperAppGitError> {
        let repository = self.open_repository(root)?;
        repository
            .head()
            .ok()
            .and_then(|head| head.target())
            .map(|oid| oid.to_string())
            .ok_or(AgenticSuperAppGitError::MissingHead)
    }

    pub fn create_worktree(
        &self,
        repository_root: &Path,
        name: &str,
        path: &Path,
        branch_name: &str,
        base_oid: &str,
    ) -> Result<AgenticSuperAppCreatedWorktree, AgenticSuperAppGitError> {
        if name.trim().is_empty()
            || name.contains('/')
            || name.contains('\\')
            || name.contains([' ', ':'])
        {
            return Err(AgenticSuperAppGitError::InvalidWorktreeName);
        }
        if !path.is_absolute() {
            return Err(AgenticSuperAppGitError::WorktreeOutsideManagedRoot);
        }
        if path.exists() {
            return Err(AgenticSuperAppGitError::InvalidPath(
                "the managed worktree path already exists".to_owned(),
            ));
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let repository = self.open_repository(repository_root)?;
        let oid = git2::Oid::from_str(base_oid)
            .map_err(|error| AgenticSuperAppGitError::InvalidPath(error.to_string()))?;
        let commit = repository.find_commit(oid)?;
        let branch = repository.branch(branch_name, &commit, false)?;
        let reference = branch.into_reference();
        let mut options = WorktreeAddOptions::new();
        options.reference(Some(&reference)).lock(true);
        repository.worktree(name, path, Some(&options))?;
        Ok(AgenticSuperAppCreatedWorktree {
            name: name.to_owned(),
            path: path.to_path_buf(),
            branch: branch_name.to_owned(),
            base_oid: base_oid.to_owned(),
        })
    }

    pub fn inspect_worktree(
        &self,
        repository_root: &Path,
        name: &str,
    ) -> Result<AgenticSuperAppWorktreeInspection, AgenticSuperAppGitError> {
        let repository = self.open_repository(repository_root)?;
        let worktree = repository.find_worktree(name)?;
        let locked = matches!(worktree.is_locked()?, WorktreeLockStatus::Locked(_));
        let path = worktree.path().to_path_buf();
        let dirty_files = if path.exists() {
            self.dirty_paths(&path)?
        } else {
            Vec::new()
        };
        Ok(AgenticSuperAppWorktreeInspection {
            path,
            dirty_files,
            locked,
        })
    }

    pub fn remove_worktree(
        &self,
        repository_root: &Path,
        name: &str,
        managed_root: &Path,
        force: bool,
    ) -> Result<(), AgenticSuperAppGitError> {
        let inspection = self.inspect_worktree(repository_root, name)?;
        if !is_within(managed_root, &inspection.path) {
            return Err(AgenticSuperAppGitError::WorktreeOutsideManagedRoot);
        }
        if inspection.locked && !force {
            return Err(AgenticSuperAppGitError::WorktreeLocked);
        }
        if !force {
            if let Some(path) = inspection.dirty_files.first() {
                return Err(AgenticSuperAppGitError::WorktreeDirty(path.clone()));
            }
        }
        let repository = self.open_repository(repository_root)?;
        let worktree = repository.find_worktree(name)?;
        if force && inspection.locked {
            worktree.unlock()?;
        }
        let mut options = WorktreePruneOptions::new();
        options.valid(true).working_tree(true).locked(force);
        worktree.prune(Some(&mut options))?;
        Ok(())
    }

    pub fn unlock_worktree(
        &self,
        repository_root: &Path,
        name: &str,
    ) -> Result<(), AgenticSuperAppGitError> {
        let repository = self.open_repository(repository_root)?;
        let worktree = repository.find_worktree(name)?;
        if matches!(worktree.is_locked()?, WorktreeLockStatus::Locked(_)) {
            worktree.unlock()?;
        }
        Ok(())
    }

    pub fn checkpoint_diff(
        &self,
        repository_root: &Path,
        from_oid: &str,
        to_oid: &str,
    ) -> Result<CodeGitDiff, AgenticSuperAppGitError> {
        let repository = self.open_repository(repository_root)?;
        let from = repository.find_commit(
            git2::Oid::from_str(from_oid)
                .map_err(|error| AgenticSuperAppGitError::InvalidPath(error.to_string()))?,
        )?;
        let to = repository.find_commit(
            git2::Oid::from_str(to_oid)
                .map_err(|error| AgenticSuperAppGitError::InvalidPath(error.to_string()))?,
        )?;
        let diff = repository.diff_tree_to_tree(Some(&from.tree()?), Some(&to.tree()?), None)?;
        let binary = std::cell::Cell::new(false);
        let truncated = std::cell::Cell::new(false);
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
            workspace_id: String::new(),
            relative_path: None,
            content: String::from_utf8_lossy(&bytes).into_owned(),
            binary: binary.get(),
            truncated: truncated.get(),
        })
    }

    pub fn dirty_paths(&self, root: &Path) -> Result<Vec<String>, AgenticSuperAppGitError> {
        let repository = self.open_repository(root)?;
        let mut options = StatusOptions::new();
        options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false)
            .renames_head_to_index(true)
            .renames_index_to_workdir(true);
        let mut paths = BTreeSet::new();
        for entry in repository.statuses(Some(&mut options))?.iter() {
            if let Ok(path) = entry.path() {
                paths.insert(path.replace('\\', "/"));
            }
        }
        Ok(paths.into_iter().collect())
    }

    pub fn create_checkpoint(
        &self,
        worktree_root: &Path,
        ref_name: &str,
        parent_oid: Option<&str>,
        message: &str,
    ) -> Result<AgenticSuperAppCheckpoint, AgenticSuperAppGitError> {
        let repository = self.open_repository(worktree_root)?;
        let parent_oid = match parent_oid {
            Some(value) => git2::Oid::from_str(value)
                .map_err(|error| AgenticSuperAppGitError::InvalidPath(error.to_string()))?,
            None => repository
                .head()
                .ok()
                .and_then(|head| head.target())
                .ok_or(AgenticSuperAppGitError::MissingHead)?,
        };
        let parent = repository.find_commit(parent_oid)?;
        let base_tree = parent.tree()?;
        let mut index = Index::new()?;
        index.read_tree(&base_tree)?;
        let mut changed_files = BTreeSet::new();
        let mut options = StatusOptions::new();
        options
            .include_untracked(true)
            .recurse_untracked_dirs(true)
            .include_ignored(false)
            .renames_head_to_index(true)
            .renames_index_to_workdir(true);
        for entry in repository.statuses(Some(&mut options))?.iter() {
            let Ok(path) = entry.path() else { continue };
            let normalized = path.replace('\\', "/");
            changed_files.insert(normalized.clone());
            let relative = Path::new(&normalized);
            if entry.status().is_conflicted() {
                return Err(AgenticSuperAppGitError::MergeConflict(normalized));
            }
            let absolute = worktree_root.join(relative);
            if entry.status().is_wt_deleted() || entry.status().is_index_deleted() {
                let _ = index.remove_path(relative);
                continue;
            }
            if absolute.is_file() {
                let bytes = fs::read(&absolute)?;
                let blob = repository.blob(&bytes)?;
                index.add(&IndexEntry {
                    ctime: IndexTime::new(0, 0),
                    mtime: IndexTime::new(0, 0),
                    dev: 0,
                    ino: 0,
                    mode: file_mode(&absolute),
                    uid: 0,
                    gid: 0,
                    file_size: bytes.len().min(u32::MAX as usize) as u32,
                    id: blob,
                    flags: 0,
                    flags_extended: 0,
                    path: normalized.into_bytes(),
                })?;
            }
        }
        let tree_oid = index.write_tree_to(&repository)?;
        let tree = repository.find_tree(tree_oid)?;
        let signature = checkpoint_signature()?;
        let oid = repository.commit(
            Some("HEAD"),
            &signature,
            &signature,
            message,
            &tree,
            &[&parent],
        )?;
        let mut worktree_index = repository.index()?;
        worktree_index.read_tree(&tree)?;
        worktree_index.write()?;
        if ref_name != "HEAD" {
            let checkpoint_ref = if ref_name.starts_with("refs/") {
                ref_name.to_owned()
            } else {
                format!("refs/heads/{ref_name}")
            };
            repository.reference(
                &checkpoint_ref,
                oid,
                true,
                "agentic orchestration checkpoint",
            )?;
        }
        Ok(AgenticSuperAppCheckpoint {
            ref_name: ref_name.to_owned(),
            commit_oid: oid.to_string(),
            changed_files: changed_files.into_iter().collect(),
        })
    }

    pub fn merge_checkpoints(
        &self,
        repository_root: &Path,
        base_oid: &str,
        checkpoint_oids: &[String],
        ref_name: &str,
        message: &str,
    ) -> Result<AgenticSuperAppCheckpoint, AgenticSuperAppGitError> {
        let repository = self.open_repository(repository_root)?;
        let mut current_oid = git2::Oid::from_str(base_oid)
            .map_err(|error| AgenticSuperAppGitError::InvalidPath(error.to_string()))?;
        let signature = checkpoint_signature()?;
        let mut changed_files = BTreeSet::new();
        for checkpoint_oid in checkpoint_oids {
            let current = repository.find_commit(current_oid)?;
            let their =
                repository
                    .find_commit(git2::Oid::from_str(checkpoint_oid).map_err(|error| {
                        AgenticSuperAppGitError::InvalidPath(error.to_string())
                    })?)?;
            let mut options = MergeOptions::new();
            options.fail_on_conflict(false);
            let mut index = repository.merge_commits(&current, &their, Some(&options))?;
            if index.has_conflicts() {
                for conflict in index.conflicts()? {
                    let conflict = conflict?;
                    let entry = conflict.our.or(conflict.their).or(conflict.ancestor);
                    if let Some(entry) = entry {
                        changed_files.insert(String::from_utf8_lossy(&entry.path).into_owned());
                    }
                }
                return Err(AgenticSuperAppGitError::MergeConflict(
                    changed_files.into_iter().collect::<Vec<_>>().join(", "),
                ));
            }
            current_oid = index.write_tree_to(&repository).and_then(|tree_oid| {
                let tree = repository.find_tree(tree_oid)?;
                repository.commit(
                    None,
                    &signature,
                    &signature,
                    "orchestration integration intermediate",
                    &tree,
                    &[&current, &their],
                )
            })?;
        }
        let commit = repository.find_commit(current_oid)?;
        let tree = commit.tree()?;
        let oid = repository.commit(
            Some(ref_name),
            &signature,
            &signature,
            message,
            &tree,
            &[&commit],
        )?;
        Ok(AgenticSuperAppCheckpoint {
            ref_name: ref_name.to_owned(),
            commit_oid: oid.to_string(),
            changed_files: changed_files.into_iter().collect(),
        })
    }

    fn open_repository(&self, root: &Path) -> Result<Repository, AgenticSuperAppGitError> {
        Repository::discover(root).map_err(|error| {
            if error.code() == git2::ErrorCode::NotFound {
                AgenticSuperAppGitError::NotRepository
            } else {
                AgenticSuperAppGitError::Git(error)
            }
        })
    }
}

fn checkpoint_signature() -> Result<Signature<'static>, AgenticSuperAppGitError> {
    Signature::now("Agentic Super App", "checkpoint@localhost.invalid")
        .map_err(AgenticSuperAppGitError::Git)
}

fn file_mode(path: &Path) -> u32 {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if fs::metadata(path)
            .map(|metadata| metadata.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
        {
            return 0o100755;
        }
    }
    #[cfg(not(unix))]
    let _ = path;
    0o100644
}

fn is_within(root: &Path, candidate: &Path) -> bool {
    let root = root.components().collect::<Vec<_>>();
    let candidate = candidate.components().collect::<Vec<_>>();
    candidate.len() >= root.len() && candidate[..root.len()] == root[..]
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

    #[test]
    fn creates_and_cleans_a_managed_checkpoint_worktree() {
        let root =
            std::env::temp_dir().join(format!("agentic-code-worktree-{}", uuid::Uuid::now_v7()));
        let managed_root = root.join("managed");
        let worktree_path = managed_root.join("worker-one");
        fs::create_dir_all(&root).unwrap();
        let repository = Repository::init(&root).unwrap();
        fs::write(root.join("README.md"), "hello\n").unwrap();
        let mut index = repository.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repository.find_tree(tree_id).unwrap();
        let signature = Signature::now("test", "test@example.invalid").unwrap();
        let head = repository
            .commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .unwrap()
            .to_string();
        drop(tree);
        drop(repository);

        let service = AgenticSuperAppGitService;
        let created = service
            .create_worktree(
                &root,
                "worker-one",
                &worktree_path,
                "agentic/test-worker",
                &head,
            )
            .unwrap();
        fs::write(created.path.join("README.md"), "worker change\n").unwrap();
        let checkpoint = service
            .create_checkpoint(
                &created.path,
                "agentic/test-checkpoint",
                Some(&head),
                "worker result",
            )
            .unwrap();
        assert!(!checkpoint.commit_oid.is_empty());
        service.unlock_worktree(&root, "worker-one").unwrap();
        let inspection = service.inspect_worktree(&root, "worker-one").unwrap();
        assert!(!inspection.locked);
        assert!(inspection.dirty_files.is_empty());
        service
            .remove_worktree(&root, "worker-one", &managed_root, false)
            .unwrap();
        assert!(!worktree_path.exists());
        let _ = fs::remove_dir_all(root);
    }
}
