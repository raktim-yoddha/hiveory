//! Bounded Git integration for Code mode.
//!
//! Repository inspection is kept separate from hosted-source access. Mutating
//! operations remain explicit and are called only by trusted host commands.

use git2::{
    build::CheckoutBuilder,
    BranchType, DiffFormat, DiffOptions, Index, IndexAddOption, IndexEntry,
    IndexTime, MergeOptions, Reference, Remote, Repository, Signature, StashFlags, Status,
    StatusOptions, WorktreeAddOptions, WorktreeLockStatus, WorktreePruneOptions,
};
use hiveory_code_domain::validate_relative_path;
use hiveory_protocol::{
    CodeGitBranch, CodeGitCommit, CodeGitDiff, CodeGitFileStatus, CodeGitOperationResult,
    CodeGitRemote, CodeGitRepositorySummary, CodeGitStash, CodeGitStatus, CodeGitWorktree,
};
use std::{
    collections::BTreeSet,
    fs, io,
    path::{Path, PathBuf},
    process::{Command, Stdio},
};
use thiserror::Error;

const MAX_DIFF_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum HiveoryGitError {
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
    #[error("the Git request is invalid: {0}")]
    InvalidInput(String),
    #[error("Git {operation} failed: {detail}")]
    Command { operation: String, detail: String },
    #[error("there are no staged changes to commit")]
    NoStagedChanges,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HiveoryCreatedWorktree {
    pub name: String,
    pub path: PathBuf,
    pub branch: String,
    pub base_oid: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HiveoryWorktreeInspection {
    pub path: PathBuf,
    pub dirty_files: Vec<String>,
    pub locked: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HiveoryListedWorktree {
    pub name: String,
    pub path: PathBuf,
    pub branch: Option<String>,
    pub locked: bool,
    pub dirty_files: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HiveoryCheckpoint {
    pub ref_name: String,
    pub commit_oid: String,
    pub changed_files: Vec<String>,
}

#[derive(Debug, Default, Clone, Copy)]
pub struct HiveoryGitService;

impl HiveoryGitService {
    pub fn status(
        &self,
        workspace_id: &str,
        root: &Path,
    ) -> Result<CodeGitStatus, HiveoryGitError> {
        let repository = Repository::discover(root).map_err(|error| {
            if error.code() == git2::ErrorCode::NotFound {
                HiveoryGitError::NotRepository
            } else {
                HiveoryGitError::Git(error)
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
                    unstaged: is_unstaged(status),
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
        staged: bool,
    ) -> Result<CodeGitDiff, HiveoryGitError> {
        let repository = Repository::discover(root).map_err(|error| {
            if error.code() == git2::ErrorCode::NotFound {
                HiveoryGitError::NotRepository
            } else {
                HiveoryGitError::Git(error)
            }
        })?;
        let normalized_path = relative_path
            .map(|path| {
                validate_relative_path(path, false)
                    .map_err(|error| HiveoryGitError::InvalidPath(error.to_string()))
            })
            .transpose()?;
        let binary = std::cell::Cell::new(false);
        let truncated = std::cell::Cell::new(false);
        let mut options = DiffOptions::new();
        if let Some(path) = normalized_path.as_deref() {
            options.pathspec(path);
        }
        let diff = if staged {
            let index = repository.index()?;
            let head_tree = repository
                .head()
                .ok()
                .and_then(|head| head.peel_to_tree().ok());
            repository.diff_tree_to_index(
                head_tree.as_ref(),
                Some(&index),
                Some(&mut options),
            )?
        } else {
            repository.diff_index_to_workdir(None, Some(&mut options))?
        };
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

    pub fn stage(
        &self,
        workspace_id: &str,
        root: &Path,
        relative_paths: &[String],
        stage: bool,
    ) -> Result<CodeGitOperationResult, HiveoryGitError> {
        let repository = self.open_repository(root)?;
        let paths = normalized_paths(relative_paths)?;
        if stage {
            let mut index = repository.index()?;
            if paths.is_empty() {
                index.add_all([Path::new(".")], IndexAddOption::DEFAULT, None)?;
            } else {
                let worktree = repository.workdir().unwrap_or(root);
                for path in &paths {
                    let relative = Path::new(path);
                    if fs::symlink_metadata(worktree.join(relative)).is_ok() {
                        index.add_path(relative)?;
                    } else {
                        index.remove_path(relative)?;
                    }
                }
            }
            index.write()?;
        } else {
            let paths = if paths.is_empty() {
                self.dirty_paths(root)?
            } else {
                paths
            };
            if !paths.is_empty() {
                let head = repository
                    .head()
                    .ok()
                    .and_then(|reference| reference.peel_to_commit().ok());
                if let Some(head) = head {
                    repository.reset_default(
                        Some(head.as_object()),
                        paths.iter().map(String::as_str),
                    )?;
                } else {
                    let mut index = repository.index()?;
                    for path in &paths {
                        let _ = index.remove_path(Path::new(path));
                    }
                    index.write()?;
                }
            }
        }
        Ok(operation_result(
            workspace_id,
            if stage { "stage" } else { "unstage" },
            if relative_paths.is_empty() {
                if stage {
                    "Staged all changes.".to_owned()
                } else {
                    "Unstaged all changes.".to_owned()
                }
            } else {
                format!(
                    "{} {} path{}.",
                    if stage { "Staged" } else { "Unstaged" },
                    relative_paths.len(),
                    if relative_paths.len() == 1 { "" } else { "s" }
                )
            },
            None,
            self.current_branch(root)?,
        ))
    }

    pub fn discard(
        &self,
        workspace_id: &str,
        root: &Path,
        relative_paths: &[String],
        include_untracked: bool,
    ) -> Result<CodeGitOperationResult, HiveoryGitError> {
        let repository = self.open_repository(root)?;
        let paths = if relative_paths.is_empty() {
            self.dirty_paths(root)?
        } else {
            normalized_paths(relative_paths)?
        };
        if paths.is_empty() {
            return Ok(operation_result(
                workspace_id,
                "discard",
                "There are no changes to discard.",
                None,
                self.current_branch(root)?,
            ));
        }

        let has_head = repository
            .head()
            .ok()
            .and_then(|reference| reference.target())
            .is_some();
        let worktree = repository.workdir().unwrap_or(root).to_path_buf();
        let mut checkout = CheckoutBuilder::new();
        checkout.force().update_index(true);
        let mut remove_paths = Vec::new();
        for path in &paths {
            let relative = Path::new(path);
            let status = repository.status_file(relative).unwrap_or(Status::CURRENT);
            let untracked = !has_head
                || (status.is_wt_new()
                    && !status.is_wt_modified()
                    && !status.is_wt_deleted()
                    && !status.is_index_modified()
                    && !status.is_index_deleted()
                    && !status.is_index_renamed()
                    && !status.is_index_typechange());
            if untracked {
                if !include_untracked {
                    return Err(HiveoryGitError::InvalidInput(format!(
                        "'{path}' is untracked; enable untracked-file removal to discard it"
                    )));
                }
                remove_paths.push(path.clone());
            } else {
                checkout.path(relative);
            }
        }
        if has_head && !remove_paths.is_empty() && remove_paths.len() == paths.len() {
            // No checkout is needed when every selected path is untracked.
        } else if has_head {
            repository.checkout_head(Some(&mut checkout))?;
        }

        let mut index = repository.index()?;
        for path in remove_paths {
            let absolute = worktree.join(Path::new(&path));
            remove_untracked_path(&absolute)?;
            let _ = index.remove_path(Path::new(&path));
        }
        index.write()?;
        Ok(operation_result(
            workspace_id,
            "discard",
            format!("Discarded {} path{}.", paths.len(), if paths.len() == 1 { "" } else { "s" }),
            None,
            self.current_branch(root)?,
        ))
    }

    pub fn commit(
        &self,
        workspace_id: &str,
        root: &Path,
        message: &str,
    ) -> Result<CodeGitOperationResult, HiveoryGitError> {
        let repository = self.open_repository(root)?;
        let message = message.trim();
        if message.is_empty() {
            return Err(HiveoryGitError::InvalidInput(
                "A commit message is required.".to_owned(),
            ));
        }
        let mut index = repository.index()?;
        if index.has_conflicts() {
            return Err(HiveoryGitError::MergeConflict(
                "Resolve conflicts before committing.".to_owned(),
            ));
        }
        let tree_oid = index.write_tree()?;
        let head = repository.head().ok().and_then(|reference| reference.target());
        let same_as_head = head
            .and_then(|oid| repository.find_commit(oid).ok())
            .is_some_and(|commit| commit.tree_id() == tree_oid);
        if same_as_head || (head.is_none() && index.is_empty()) {
            return Err(HiveoryGitError::NoStagedChanges);
        }
        let signature = repository.signature().map_err(|error| {
            HiveoryGitError::InvalidInput(format!(
                "Configure Git user.name and user.email before committing ({error})."
            ))
        })?;
        let tree = repository.find_tree(tree_oid)?;
        let oid = if let Some(parent_oid) = head {
            let parent = repository.find_commit(parent_oid)?;
            repository.commit(
                Some("HEAD"),
                &signature,
                &signature,
                message,
                &tree,
                &[&parent],
            )?
        } else {
            repository.commit(
                Some("HEAD"),
                &signature,
                &signature,
                message,
                &tree,
                &[],
            )?
        };
        Ok(operation_result(
            workspace_id,
            "commit",
            format!("Created commit {}.", oid.to_string().chars().take(8).collect::<String>()),
            Some(oid.to_string()),
            self.current_branch(root)?,
        ))
    }

    pub fn create_branch(
        &self,
        workspace_id: &str,
        root: &Path,
        name: &str,
        start_point: Option<&str>,
    ) -> Result<CodeGitOperationResult, HiveoryGitError> {
        let repository = self.open_repository(root)?;
        let name = validate_branch_name(name)?;
        if repository.find_branch(&name, BranchType::Local).is_ok() {
            return Err(HiveoryGitError::InvalidInput(format!(
                "The branch '{name}' already exists."
            )));
        }
        let reference = start_point.unwrap_or("HEAD").trim();
        let object = repository.revparse_single(reference)?;
        let commit = object.peel_to_commit()?;
        repository.branch(&name, &commit, false)?;
        Ok(operation_result(
            workspace_id,
            "branch_create",
            format!("Created branch '{name}'."),
            Some(commit.id().to_string()),
            Some(name),
        ))
    }

    pub fn checkout_branch(
        &self,
        workspace_id: &str,
        root: &Path,
        name: &str,
        create: bool,
        start_point: Option<&str>,
    ) -> Result<CodeGitOperationResult, HiveoryGitError> {
        let repository = self.open_repository(root)?;
        let name = validate_branch_name(name)?;
        let existing = repository.find_branch(&name, BranchType::Local);
        if existing.is_err() {
            if !create {
                return Err(HiveoryGitError::InvalidInput(format!(
                    "The branch '{name}' does not exist."
                )));
            }
            let reference = start_point.unwrap_or("HEAD").trim();
            let object = repository.revparse_single(reference)?;
            let commit = object.peel_to_commit()?;
            repository.branch(&name, &commit, false)?;
        } else if create {
            return Err(HiveoryGitError::InvalidInput(format!(
                "The branch '{name}' already exists."
            )));
        }
        let branch = repository.find_branch(&name, BranchType::Local)?;
        let current = repository
            .head()
            .ok()
            .and_then(|head| head.shorthand().ok().map(ToOwned::to_owned));
        if current.as_deref() != Some(name.as_str()) {
            let mut checkout = CheckoutBuilder::new();
            checkout.safe().update_index(true);
            let target = branch.get().peel(git2::ObjectType::Commit)?;
            repository.checkout_tree(&target, Some(&mut checkout))?;
            repository.set_head(&format!("refs/heads/{name}"))?;
        }
        Ok(operation_result(
            workspace_id,
            "branch_checkout",
            format!("Checked out '{name}'."),
            branch.get().target().map(|oid| oid.to_string()),
            Some(name),
        ))
    }

    pub fn delete_branch(
        &self,
        workspace_id: &str,
        root: &Path,
        name: &str,
        force: bool,
    ) -> Result<CodeGitOperationResult, HiveoryGitError> {
        let repository = self.open_repository(root)?;
        let name = validate_branch_name(name)?;
        let mut branch = repository.find_branch(&name, BranchType::Local)?;
        if branch.is_head() {
            return Err(HiveoryGitError::InvalidInput(
                "The current branch cannot be deleted.".to_owned(),
            ));
        }
        if force {
            self.run_git(root, "branch delete", &["branch".to_owned(), "-D".to_owned(), name.clone()])?;
        } else {
            branch.delete()?;
        }
        Ok(operation_result(
            workspace_id,
            "branch_delete",
            format!("Deleted branch '{name}'."),
            None,
            self.current_branch(root)?,
        ))
    }

    pub fn fetch(
        &self,
        workspace_id: &str,
        root: &Path,
        remote: Option<&str>,
        branch: Option<&str>,
    ) -> Result<CodeGitOperationResult, HiveoryGitError> {
        let remote = validate_remote(remote)?;
        let branch = validate_optional_branch(branch)?;
        let mut args = vec!["fetch".to_owned()];
        if let Some(remote) = remote {
            args.push(remote);
            if let Some(branch) = branch {
                args.push(branch);
            }
        } else {
            args.extend(["--all".to_owned(), "--prune".to_owned()]);
        }
        let output = self.run_git(root, "fetch", &args)?;
        Ok(operation_result(
            workspace_id,
            "fetch",
            command_message(output, "Fetched remote changes."),
            None,
            self.current_branch(root)?,
        ))
    }

    pub fn pull(
        &self,
        workspace_id: &str,
        root: &Path,
        remote: Option<&str>,
        branch: Option<&str>,
    ) -> Result<CodeGitOperationResult, HiveoryGitError> {
        let remote = validate_remote(remote)?;
        let branch = validate_optional_branch(branch)?;
        let mut args = vec!["pull".to_owned(), "--ff-only".to_owned()];
        if let Some(remote) = remote {
            args.push(remote);
            if let Some(branch) = branch {
                args.push(branch);
            }
        }
        let output = self.run_git(root, "pull", &args)?;
        Ok(operation_result(
            workspace_id,
            "pull",
            command_message(output, "Pulled remote changes."),
            None,
            self.current_branch(root)?,
        ))
    }

    pub fn push(
        &self,
        workspace_id: &str,
        root: &Path,
        remote: Option<&str>,
        branch: Option<&str>,
    ) -> Result<CodeGitOperationResult, HiveoryGitError> {
        let remote = validate_remote(remote)?;
        let branch = validate_optional_branch(branch)?;
        let mut args = vec!["push".to_owned()];
        if let Some(remote) = remote {
            args.push(remote);
            if let Some(branch) = branch {
                args.push(branch);
            }
        }
        let output = self.run_git(root, "push", &args)?;
        Ok(operation_result(
            workspace_id,
            "push",
            command_message(output, "Pushed local changes."),
            None,
            self.current_branch(root)?,
        ))
    }

    pub fn stash_save(
        &self,
        workspace_id: &str,
        root: &Path,
        message: Option<&str>,
    ) -> Result<CodeGitOperationResult, HiveoryGitError> {
        let mut repository = self.open_repository(root)?;
        let signature = repository.signature().map_err(|error| {
            HiveoryGitError::InvalidInput(format!(
                "Configure Git user.name and user.email before stashing ({error})."
            ))
        })?;
        let message = message.map(str::trim).filter(|value| !value.is_empty());
        let oid = repository.stash_save2(
            &signature,
            message.or(Some("Hiveory source-control stash")),
            Some(StashFlags::INCLUDE_UNTRACKED),
        )?;
        Ok(operation_result(
            workspace_id,
            "stash_save",
            format!("Saved stash {}.", oid.to_string().chars().take(8).collect::<String>()),
            Some(oid.to_string()),
            self.current_branch(root)?,
        ))
    }

    pub fn stash_pop(
        &self,
        workspace_id: &str,
        root: &Path,
        index: u32,
    ) -> Result<CodeGitOperationResult, HiveoryGitError> {
        let mut repository = self.open_repository(root)?;
        repository.stash_pop(index as usize, None)?;
        Ok(operation_result(
            workspace_id,
            "stash_pop",
            format!("Applied stash {index}."),
            None,
            self.current_branch(root)?,
        ))
    }

    pub fn stash_drop(
        &self,
        workspace_id: &str,
        root: &Path,
        index: u32,
    ) -> Result<CodeGitOperationResult, HiveoryGitError> {
        let mut repository = self.open_repository(root)?;
        repository.stash_drop(index as usize)?;
        Ok(operation_result(
            workspace_id,
            "stash_drop",
            format!("Dropped stash {index}."),
            None,
            self.current_branch(root)?,
        ))
    }

    fn run_git(
        &self,
        root: &Path,
        operation: &str,
        args: &[String],
    ) -> Result<String, HiveoryGitError> {
        let output = Command::new("git")
            .args(args)
            .current_dir(root)
            .env("GIT_TERMINAL_PROMPT", "0")
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| HiveoryGitError::Command {
                operation: operation.to_owned(),
                detail: if error.kind() == io::ErrorKind::NotFound {
                    "Git is not installed or is not available on PATH.".to_owned()
                } else {
                    error.to_string()
                },
            })?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr);
            return Err(HiveoryGitError::Command {
                operation: operation.to_owned(),
                detail: sanitize_command_detail(&detail),
            });
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    pub fn head_oid(&self, root: &Path) -> Result<String, HiveoryGitError> {
        let repository = self.open_repository(root)?;
        repository
            .head()
            .ok()
            .and_then(|head| head.target())
            .map(|oid| oid.to_string())
            .ok_or(HiveoryGitError::MissingHead)
    }

    pub fn current_branch(&self, root: &Path) -> Result<Option<String>, HiveoryGitError> {
        let repository = self.open_repository(root)?;
        Ok(repository
            .head()
            .ok()
            .and_then(|head| head.shorthand().ok().map(ToOwned::to_owned)))
    }

    pub fn repository_summary(
        &self,
        workspace_id: &str,
        root: &Path,
    ) -> Result<CodeGitRepositorySummary, HiveoryGitError> {
        let mut repository = self.open_repository(root)?;
        let stashes = list_stashes(&mut repository)?;
        let head = repository.head().ok();
        let branch = head
            .as_ref()
            .and_then(|reference| reference.shorthand().ok().map(ToOwned::to_owned));
        let head_oid = head
            .as_ref()
            .and_then(|reference| reference.target())
            .map(|oid| oid.to_string());
        let detached = head
            .as_ref()
            .map(|reference| reference.is_branch())
            .is_some_and(|value| !value);
        let upstream = branch.as_deref().and_then(|name| {
            repository
                .find_branch(name, BranchType::Local)
                .ok()
                .and_then(|local| local.upstream().ok())
                .and_then(|remote| remote.name().ok().flatten().map(ToOwned::to_owned))
        });

        let remotes = repository
            .remotes()?
            .iter()
            .filter_map(Result::ok)
            .flatten()
            .filter_map(|name| {
                let remote = repository.find_remote(name).ok()?;
                let fetch_url = remote.url().ok().map(ToOwned::to_owned);
                let push_url = remote
                    .pushurl()
                    .ok()
                    .flatten()
                    .map(ToOwned::to_owned)
                    .or_else(|| fetch_url.clone());
                Some(CodeGitRemote {
                    name: name.to_owned(),
                    fetch_url,
                    push_url,
                })
            })
            .collect::<Vec<_>>();

        let mut branches = Vec::new();
        for item in repository.branches(Some(BranchType::Local))? {
            let (branch_ref, _) = item?;
            let Some(name) = branch_ref.name()?.map(ToOwned::to_owned) else {
                continue;
            };
            let current = branch.as_deref() == Some(name.as_str());
            let upstream_ref = branch_ref.upstream().ok();
            let upstream_name = upstream_ref
                .as_ref()
                .and_then(|reference| reference.name().ok().flatten().map(ToOwned::to_owned));
            let (ahead, behind) = match (
                branch_ref.get().target(),
                upstream_ref
                    .as_ref()
                    .and_then(|reference| reference.get().target()),
            ) {
                (Some(local), Some(remote)) => repository
                    .graph_ahead_behind(local, remote)
                    .unwrap_or((0, 0)),
                _ => (0, 0),
            };
            branches.push(CodeGitBranch {
                name,
                current,
                upstream: upstream_name,
                ahead,
                behind,
            });
        }
        branches.sort_by(|left, right| left.name.cmp(&right.name));

        let worktrees = self
            .list_worktrees(root)?
            .into_iter()
            .map(|worktree| CodeGitWorktree {
                name: worktree.name,
                path: worktree.path.to_string_lossy().into_owned(),
                branch: worktree.branch,
                locked: worktree.locked,
                dirty_files: worktree.dirty_files,
            })
            .collect::<Vec<_>>();

        let mut commits = Vec::new();
        if let Some(oid) = head_oid.as_deref() {
            let mut walk = repository.revwalk()?;
            walk.push(
                git2::Oid::from_str(oid)
                    .map_err(|error| HiveoryGitError::InvalidPath(error.to_string()))?,
            )?;
            for commit_oid in walk.take(40) {
                let commit = repository.find_commit(commit_oid?)?;
                let message = commit
                    .summary()
                    .ok()
                    .flatten()
                    .unwrap_or_default()
                    .trim()
                    .to_owned();
                let author = commit.author().name().ok().map(ToOwned::to_owned);
                let committed_at_unix_ms = commit.time().seconds().checked_mul(1000);
                let oid = commit.id().to_string();
                commits.push(CodeGitCommit {
                    short_oid: oid.chars().take(8).collect(),
                    oid,
                    message,
                    author,
                    committed_at_unix_ms,
                });
            }
        }

        let status = self.status(workspace_id, root)?;
        let repository_name = repository
            .workdir()
            .and_then(|path| path.file_name())
            .map(|name| name.to_string_lossy().into_owned());
        Ok(CodeGitRepositorySummary {
            workspace_id: workspace_id.to_owned(),
            root_path: root.to_string_lossy().into_owned(),
            repository_name,
            head_oid,
            branch,
            detached,
            upstream,
            remotes,
            branches,
            worktrees,
            commits,
            stashes,
            has_conflicts: status.files.iter().any(|file| file.conflict),
        })
    }

    pub fn resolve_ref_oid(&self, root: &Path, reference: &str) -> Result<String, HiveoryGitError> {
        let repository = self.open_repository(root)?;
        let object = repository.revparse_single(reference.trim())?;
        let commit = object.peel(git2::ObjectType::Commit)?;
        Ok(commit.id().to_string())
    }

    pub fn ensure_repository(&self, root: &Path) -> Result<String, HiveoryGitError> {
        let repository = match Repository::discover(root) {
            Ok(repo) => repo,
            Err(_) => Repository::init(root)?,
        };
        if repository.head().is_err() {
            let sig = Signature::now("Hiveory", "hiveory@local")?;
            let tree_id = {
                let mut index = repository.index()?;
                index.write_tree()?
            };
            let tree = repository.find_tree(tree_id)?;
            let oid = repository.commit(Some("HEAD"), &sig, &sig, "Initial commit", &tree, &[])?;
            Ok(oid.to_string())
        } else {
            let head = repository.head()?;
            let target = head.target().ok_or(HiveoryGitError::MissingHead)?;
            Ok(target.to_string())
        }
    }

    pub fn list_worktrees(
        &self,
        repository_root: &Path,
    ) -> Result<Vec<HiveoryListedWorktree>, HiveoryGitError> {
        let repository = self.open_repository(repository_root)?;
        let mut worktrees = Vec::new();
        for name in repository.worktrees()?.iter() {
            let Ok(Some(name)) = name else { continue };
            let worktree = repository.find_worktree(name)?;
            let path = worktree.path().to_path_buf();
            let branch = if path.exists() {
                self.current_branch(&path)?
            } else {
                None
            };
            let dirty_files = if path.exists() {
                self.dirty_paths(&path)?
            } else {
                Vec::new()
            };
            worktrees.push(HiveoryListedWorktree {
                name: name.to_owned(),
                path,
                branch,
                locked: matches!(worktree.is_locked()?, WorktreeLockStatus::Locked(_)),
                dirty_files,
            });
        }
        Ok(worktrees)
    }

    pub fn create_worktree(
        &self,
        repository_root: &Path,
        name: &str,
        path: &Path,
        branch_name: &str,
        base_oid: &str,
    ) -> Result<HiveoryCreatedWorktree, HiveoryGitError> {
        if name.trim().is_empty()
            || name.contains('/')
            || name.contains('\\')
            || name.contains([' ', ':'])
        {
            return Err(HiveoryGitError::InvalidWorktreeName);
        }
        if !path.is_absolute() {
            return Err(HiveoryGitError::WorktreeOutsideManagedRoot);
        }
        if path.exists() {
            return Err(HiveoryGitError::InvalidPath(
                "the managed worktree path already exists".to_owned(),
            ));
        }
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)?;
        }
        let repository = self.open_repository(repository_root)?;
        let oid = git2::Oid::from_str(base_oid)
            .map_err(|error| HiveoryGitError::InvalidPath(error.to_string()))?;
        let commit = repository.find_commit(oid)?;
        let branch = repository.branch(branch_name, &commit, false)?;
        let reference = branch.into_reference();
        let mut options = WorktreeAddOptions::new();
        options.reference(Some(&reference)).lock(true);
        repository.worktree(name, path, Some(&options))?;
        Ok(HiveoryCreatedWorktree {
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
    ) -> Result<HiveoryWorktreeInspection, HiveoryGitError> {
        let repository = self.open_repository(repository_root)?;
        let worktree = repository.find_worktree(name)?;
        let locked = matches!(worktree.is_locked()?, WorktreeLockStatus::Locked(_));
        let path = worktree.path().to_path_buf();
        let dirty_files = if path.exists() {
            self.dirty_paths(&path)?
        } else {
            Vec::new()
        };
        Ok(HiveoryWorktreeInspection {
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
    ) -> Result<(), HiveoryGitError> {
        let inspection = self.inspect_worktree(repository_root, name)?;
        if !is_within(managed_root, &inspection.path) {
            return Err(HiveoryGitError::WorktreeOutsideManagedRoot);
        }
        if inspection.locked && !force {
            return Err(HiveoryGitError::WorktreeLocked);
        }
        if !force {
            if let Some(path) = inspection.dirty_files.first() {
                return Err(HiveoryGitError::WorktreeDirty(path.clone()));
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
    ) -> Result<(), HiveoryGitError> {
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
    ) -> Result<CodeGitDiff, HiveoryGitError> {
        let repository = self.open_repository(repository_root)?;
        let from = repository.find_commit(
            git2::Oid::from_str(from_oid)
                .map_err(|error| HiveoryGitError::InvalidPath(error.to_string()))?,
        )?;
        let to = repository.find_commit(
            git2::Oid::from_str(to_oid)
                .map_err(|error| HiveoryGitError::InvalidPath(error.to_string()))?,
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

    pub fn dirty_paths(&self, root: &Path) -> Result<Vec<String>, HiveoryGitError> {
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
    ) -> Result<HiveoryCheckpoint, HiveoryGitError> {
        let repository = self.open_repository(worktree_root)?;
        let parent_oid = match parent_oid {
            Some(value) => git2::Oid::from_str(value)
                .map_err(|error| HiveoryGitError::InvalidPath(error.to_string()))?,
            None => repository
                .head()
                .ok()
                .and_then(|head| head.target())
                .ok_or(HiveoryGitError::MissingHead)?,
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
                return Err(HiveoryGitError::MergeConflict(normalized));
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
        Ok(HiveoryCheckpoint {
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
    ) -> Result<HiveoryCheckpoint, HiveoryGitError> {
        let repository = self.open_repository(repository_root)?;
        let mut current_oid = git2::Oid::from_str(base_oid)
            .map_err(|error| HiveoryGitError::InvalidPath(error.to_string()))?;
        let signature = checkpoint_signature()?;
        let mut changed_files = BTreeSet::new();
        for checkpoint_oid in checkpoint_oids {
            let current = repository.find_commit(current_oid)?;
            let their = repository.find_commit(
                git2::Oid::from_str(checkpoint_oid)
                    .map_err(|error| HiveoryGitError::InvalidPath(error.to_string()))?,
            )?;
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
                return Err(HiveoryGitError::MergeConflict(
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
        Ok(HiveoryCheckpoint {
            ref_name: ref_name.to_owned(),
            commit_oid: oid.to_string(),
            changed_files: changed_files.into_iter().collect(),
        })
    }

    fn open_repository(&self, root: &Path) -> Result<Repository, HiveoryGitError> {
        Repository::discover(root).map_err(|error| {
            if error.code() == git2::ErrorCode::NotFound {
                HiveoryGitError::NotRepository
            } else {
                HiveoryGitError::Git(error)
            }
        })
    }
}

fn checkpoint_signature() -> Result<Signature<'static>, HiveoryGitError> {
    Signature::now("Hiveory", "checkpoint@localhost.invalid").map_err(HiveoryGitError::Git)
}

fn operation_result(
    workspace_id: &str,
    operation: &str,
    message: impl Into<String>,
    oid: Option<String>,
    branch: Option<String>,
) -> CodeGitOperationResult {
    CodeGitOperationResult {
        workspace_id: workspace_id.to_owned(),
        operation: operation.to_owned(),
        message: message.into(),
        oid,
        branch,
    }
}

fn normalized_paths(paths: &[String]) -> Result<Vec<String>, HiveoryGitError> {
    let mut normalized = BTreeSet::new();
    for path in paths {
        let path = validate_relative_path(path.trim(), false)
            .map_err(|error| HiveoryGitError::InvalidPath(error.to_string()))?;
        normalized.insert(path);
    }
    Ok(normalized.into_iter().collect())
}

fn validate_branch_name(value: &str) -> Result<String, HiveoryGitError> {
    let value = value.trim();
    if value.is_empty() || value.len() > 240 || value.starts_with('-') {
        return Err(HiveoryGitError::InvalidInput(
            "Branch names must be 1-240 characters and cannot start with '-'.".to_owned(),
        ));
    }
    let reference = format!("refs/heads/{value}");
    if !Reference::is_valid_name(&reference) {
        return Err(HiveoryGitError::InvalidInput(
            "The branch name contains characters Git does not allow.".to_owned(),
        ));
    }
    Ok(value.to_owned())
}

fn validate_remote(remote: Option<&str>) -> Result<Option<String>, HiveoryGitError> {
    let Some(value) = remote.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if !Remote::is_valid_name(value) || value.starts_with('-') {
        return Err(HiveoryGitError::InvalidInput(
            "The remote name is invalid.".to_owned(),
        ));
    }
    Ok(Some(value.to_owned()))
}

fn validate_optional_branch(branch: Option<&str>) -> Result<Option<String>, HiveoryGitError> {
    let Some(value) = branch.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    validate_branch_name(value).map(Some)
}

fn list_stashes(repository: &mut Repository) -> Result<Vec<CodeGitStash>, HiveoryGitError> {
    let mut stashes = Vec::new();
    repository.stash_foreach(|index, message, oid| {
        stashes.push(CodeGitStash {
            index: index.min(u32::MAX as usize) as u32,
            oid: oid.to_string(),
            message: message.to_owned(),
        });
        true
    })?;
    Ok(stashes)
}

fn remove_untracked_path(path: &Path) -> Result<(), HiveoryGitError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(HiveoryGitError::Io(error)),
    };
    if metadata.file_type().is_symlink() || metadata.is_file() {
        fs::remove_file(path)?;
        return Ok(());
    }
    Err(HiveoryGitError::InvalidInput(
        "Discarding directories is disabled; select the files inside the directory instead."
            .to_owned(),
    ))
}

fn command_message(output: String, fallback: &str) -> String {
    let output = output.trim();
    if output.is_empty() {
        fallback.to_owned()
    } else {
        output.chars().take(6000).collect()
    }
}

fn sanitize_command_detail(value: &str) -> String {
    value
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .take(8)
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(2000)
        .collect()
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

fn is_unstaged(status: Status) -> bool {
    status.is_conflicted()
        || status.is_wt_new()
        || status.is_wt_modified()
        || status.is_wt_deleted()
        || status.is_wt_renamed()
        || status.is_wt_typechange()
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
        let root = std::env::temp_dir().join(format!("hiveory-code-git-{}", uuid::Uuid::now_v7()));
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
        let status = HiveoryGitService.status("workspace", &root).unwrap();
        assert_eq!(status.files[0].relative_path, "README.md");
        assert_eq!(status.files[0].status, "modified");
        let diff = HiveoryGitService
            .diff("workspace", &root, Some("README.md"), false)
            .unwrap();
        assert!(diff.content.contains("changed"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn repository_summary_reports_branch_and_recent_commit() {
        let root =
            std::env::temp_dir().join(format!("hiveory-code-summary-{}", uuid::Uuid::now_v7()));
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
            .commit(
                Some("HEAD"),
                &signature,
                &signature,
                "initial commit",
                &tree,
                &[],
            )
            .unwrap();
        drop(tree);
        drop(repository);

        let summary = HiveoryGitService
            .repository_summary("workspace", &root)
            .unwrap();
        assert!(summary.branches.iter().any(|branch| branch.current));
        assert_eq!(summary.commits.len(), 1);
        assert_eq!(summary.commits[0].message, "initial commit");
        assert!(!summary.detached);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn stages_unstages_and_commits_partial_changes() {
        let root = std::env::temp_dir().join(format!(
            "hiveory-code-git-operations-{}",
            uuid::Uuid::now_v7()
        ));
        fs::create_dir_all(&root).unwrap();
        let repository = Repository::init(&root).unwrap();
        repository
            .config()
            .unwrap()
            .set_str("user.name", "Hiveory test")
            .unwrap();
        repository
            .config()
            .unwrap()
            .set_str("user.email", "hiveory-test@example.invalid")
            .unwrap();
        fs::write(root.join("README.md"), "one\n").unwrap();
        let mut index = repository.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repository.find_tree(tree_id).unwrap();
        let signature = Signature::now("test", "test@example.invalid").unwrap();
        repository
            .commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .unwrap();
        drop(tree);
        drop(repository);

        let service = HiveoryGitService;
        fs::write(root.join("README.md"), "two\n").unwrap();
        service
            .stage(
                "workspace",
                &root,
                &["README.md".to_owned()],
                true,
            )
            .unwrap();
        let status = service.status("workspace", &root).unwrap();
        let readme = status
            .files
            .iter()
            .find(|file| file.relative_path == "README.md")
            .unwrap();
        assert!(readme.staged);
        assert!(!readme.unstaged);

        fs::write(root.join("README.md"), "three\n").unwrap();
        let status = service.status("workspace", &root).unwrap();
        let readme = status
            .files
            .iter()
            .find(|file| file.relative_path == "README.md")
            .unwrap();
        assert!(readme.staged);
        assert!(readme.unstaged);

        service
            .stage(
                "workspace",
                &root,
                &["README.md".to_owned()],
                true,
            )
            .unwrap();
        let status = service.status("workspace", &root).unwrap();
        let readme = status
            .files
            .iter()
            .find(|file| file.relative_path == "README.md")
            .unwrap();
        assert!(readme.staged);
        assert!(!readme.unstaged);

        service
            .stage(
                "workspace",
                &root,
                &["README.md".to_owned()],
                false,
            )
            .unwrap();
        let status = service.status("workspace", &root).unwrap();
        let readme = status
            .files
            .iter()
            .find(|file| file.relative_path == "README.md")
            .unwrap();
        assert!(!readme.staged);
        assert!(readme.unstaged);

        service
            .stage(
                "workspace",
                &root,
                &["README.md".to_owned()],
                true,
            )
            .unwrap();
        let result = service.commit("workspace", &root, "update README").unwrap();
        assert!(result.oid.is_some());
        assert!(service.status("workspace", &root).unwrap().files.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn branch_stash_and_discard_operations_preserve_explicit_boundaries() {
        let root = std::env::temp_dir().join(format!(
            "hiveory-code-git-boundaries-{}",
            uuid::Uuid::now_v7()
        ));
        fs::create_dir_all(&root).unwrap();
        let repository = Repository::init(&root).unwrap();
        repository
            .config()
            .unwrap()
            .set_str("user.name", "Hiveory test")
            .unwrap();
        repository
            .config()
            .unwrap()
            .set_str("user.email", "hiveory-test@example.invalid")
            .unwrap();
        fs::write(root.join("README.md"), "original\n").unwrap();
        let mut index = repository.index().unwrap();
        index.add_path(Path::new("README.md")).unwrap();
        index.write().unwrap();
        let tree_id = index.write_tree().unwrap();
        let tree = repository.find_tree(tree_id).unwrap();
        let signature = Signature::now("test", "test@example.invalid").unwrap();
        repository
            .commit(Some("HEAD"), &signature, &signature, "initial", &tree, &[])
            .unwrap();
        let base_branch = repository
            .head()
            .unwrap()
            .shorthand()
            .unwrap()
            .to_owned();
        drop(tree);
        drop(repository);

        let service = HiveoryGitService;
        service
            .checkout_branch("workspace", &root, "feature/test", true, None)
            .unwrap();
        assert_eq!(service.current_branch(&root).unwrap().as_deref(), Some("feature/test"));
        service
            .checkout_branch("workspace", &root, &base_branch, false, None)
            .unwrap();
        service
            .create_branch("workspace", &root, "feature/second", None)
            .unwrap();
        service
            .delete_branch("workspace", &root, "feature/second", false)
            .unwrap();

        fs::write(root.join("README.md"), "stashed\n").unwrap();
        service
            .stash_save("workspace", &root, Some("before review"))
            .unwrap();
        assert!(service.status("workspace", &root).unwrap().files.is_empty());
        let summary = service.repository_summary("workspace", &root).unwrap();
        assert_eq!(summary.stashes.len(), 1);
        service.stash_pop("workspace", &root, 0).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("README.md"))
                .unwrap()
                .replace("\r\n", "\n"),
            "stashed\n"
        );

        fs::write(root.join("README.md"), "discarded\n").unwrap();
        fs::write(root.join("scratch.txt"), "temporary\n").unwrap();
        service
            .discard(
                "workspace",
                &root,
                &["README.md".to_owned(), "scratch.txt".to_owned()],
                true,
            )
            .unwrap();
        assert_eq!(
            fs::read_to_string(root.join("README.md"))
                .unwrap()
                .replace("\r\n", "\n"),
            "original\n"
        );
        assert!(!root.join("scratch.txt").exists());
        assert!(service.status("workspace", &root).unwrap().files.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn creates_and_cleans_a_managed_checkpoint_worktree() {
        let root =
            std::env::temp_dir().join(format!("hiveory-code-worktree-{}", uuid::Uuid::now_v7()));
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

        let service = HiveoryGitService;
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
