//! Capability-scoped workspace and file access for Code mode.
//!
//! A workspace root is canonicalized exactly once at intake and then held as
//! a `cap-std` directory capability. Renderer-supplied paths are lexical,
//! relative paths only; no renderer path is ever opened with ambient authority.

use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use hiveory_code_domain::{
    allows, capabilities_for_trust, language_for_path, validate_relative_path, CodeDomainError,
    CODE_MAX_FILE_BYTES, CODE_MAX_TREE_ENTRIES,
};
use hiveory_protocol::{
    CodeDocument, CodeFileKind, CodeFileNode, CodeFileTree, CodeWorkspaceCapability,
    CodeWorkspaceKind, CodeWorkspaceSummary, CodeWorkspaceTrust,
};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    io::{self, Write},
    path::{Path, PathBuf},
    sync::{Arc, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};
use thiserror::Error;
use uuid::Uuid;

const LOCAL_HOST_ID: &str = "local";

#[derive(Debug, Error)]
pub enum HiveoryWorkspaceError {
    #[error("workspace path could not be opened: {0}")]
    InvalidRoot(String),
    #[error("workspace was not found")]
    NotFound,
    #[error("workspace is untrusted; trust it before performing this action")]
    Untrusted,
    #[error("workspace path is invalid: {0}")]
    InvalidPath(String),
    #[error("file is too large for the inline editor")]
    FileTooLarge,
    #[error("binary files are read-only in the inline editor")]
    BinaryFile,
    #[error("file changed since it was opened")]
    FileConflict,
    #[error("symbolic links are not editable through the workspace service")]
    SymlinkNotAllowed,
    #[error("filesystem operation failed: {0}")]
    Io(#[from] io::Error),
    #[error("workspace capability {0:?} is not granted")]
    CapabilityDenied(CodeWorkspaceCapability),
}

#[derive(Clone)]
struct WorkspaceHandle {
    summary: CodeWorkspaceSummary,
    root: Arc<Dir>,
}

#[derive(Debug, Clone)]
pub struct HiveoryWorkspaceMetadata {
    pub project_id: String,
    pub workspace_kind: CodeWorkspaceKind,
    pub worktree_name: Option<String>,
    pub base_ref: Option<String>,
    pub branch: Option<String>,
    pub managed_by_app: bool,
    pub available: bool,
    pub unavailable_reason: Option<String>,
}

#[derive(Clone, Default)]
pub struct HiveoryWorkspaceService {
    workspaces: Arc<RwLock<HashMap<String, WorkspaceHandle>>>,
}

impl HiveoryWorkspaceService {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn open_workspace(
        &self,
        path: &Path,
        workspace_id: Option<&str>,
        trust: CodeWorkspaceTrust,
    ) -> Result<CodeWorkspaceSummary, HiveoryWorkspaceError> {
        let canonical_root = std::fs::canonicalize(path)
            .map_err(|error| HiveoryWorkspaceError::InvalidRoot(error.to_string()))?;
        let metadata = std::fs::metadata(&canonical_root)
            .map_err(|error| HiveoryWorkspaceError::InvalidRoot(error.to_string()))?;
        if !metadata.is_dir() {
            return Err(HiveoryWorkspaceError::InvalidRoot(
                "the selected path is not a directory".to_owned(),
            ));
        }
        let canonical_root_string = canonical_root.to_string_lossy().into_owned();
        if let Ok(workspaces) = self.workspaces.read() {
            if let Some(existing) = workspaces
                .values()
                .find(|workspace| workspace.summary.root_path == canonical_root_string)
            {
                return Ok(existing.summary.clone());
            }
        }
        let root = Dir::open_ambient_dir(&canonical_root, ambient_authority())?;
        let id = workspace_id
            .filter(|value| !value.trim().is_empty())
            .map(ToOwned::to_owned)
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        let display_name = canonical_root
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("Workspace")
            .to_owned();
        let summary = CodeWorkspaceSummary {
            id: id.clone(),
            host_id: LOCAL_HOST_ID.to_owned(),
            display_name,
            root_path: canonical_root.to_string_lossy().into_owned(),
            repository_name: if canonical_root.join(".git").exists() {
                Some(
                    canonical_root
                        .file_name()
                        .and_then(|name| name.to_str())
                        .unwrap_or("repository")
                        .to_owned(),
                )
            } else {
                None
            },
            branch: None,
            is_git_repository: canonical_root.join(".git").exists(),
            trust,
            capabilities: capabilities_for_trust(trust),
            project_id: format!("legacy-project-{id}"),
            workspace_kind: CodeWorkspaceKind::Primary,
            worktree_name: None,
            base_ref: None,
            managed_by_app: false,
            available: true,
            unavailable_reason: None,
            updated_at_unix_ms: now_ms(),
        };
        self.workspaces
            .write()
            .map_err(|_| HiveoryWorkspaceError::InvalidRoot("workspace lock poisoned".to_owned()))?
            .insert(
                id,
                WorkspaceHandle {
                    summary: summary.clone(),
                    root: Arc::new(root),
                },
            );
        Ok(summary)
    }

    pub fn summaries(&self) -> Result<Vec<CodeWorkspaceSummary>, HiveoryWorkspaceError> {
        let mut summaries = self
            .workspaces
            .read()
            .map_err(|_| HiveoryWorkspaceError::NotFound)?
            .values()
            .map(|workspace| workspace.summary.clone())
            .collect::<Vec<_>>();
        summaries.sort_by(|left, right| left.display_name.cmp(&right.display_name));
        Ok(summaries)
    }

    pub fn summary(
        &self,
        workspace_id: &str,
    ) -> Result<CodeWorkspaceSummary, HiveoryWorkspaceError> {
        Ok(self.handle(workspace_id)?.summary)
    }

    pub fn root_path(&self, workspace_id: &str) -> Result<PathBuf, HiveoryWorkspaceError> {
        Ok(PathBuf::from(self.handle(workspace_id)?.summary.root_path))
    }

    pub fn update_workspace_metadata(
        &self,
        workspace_id: &str,
        metadata: HiveoryWorkspaceMetadata,
    ) -> Result<CodeWorkspaceSummary, HiveoryWorkspaceError> {
        let mut workspaces = self
            .workspaces
            .write()
            .map_err(|_| HiveoryWorkspaceError::NotFound)?;
        let handle = workspaces
            .get_mut(workspace_id)
            .ok_or(HiveoryWorkspaceError::NotFound)?;
        handle.summary.project_id = metadata.project_id;
        handle.summary.workspace_kind = metadata.workspace_kind;
        handle.summary.worktree_name = metadata.worktree_name;
        handle.summary.base_ref = metadata.base_ref;
        handle.summary.branch = metadata.branch;
        handle.summary.managed_by_app = metadata.managed_by_app;
        handle.summary.available = metadata.available;
        handle.summary.unavailable_reason = metadata.unavailable_reason;
        handle.summary.updated_at_unix_ms = now_ms();
        Ok(handle.summary.clone())
    }

    pub fn rename_workspace(
        &self,
        workspace_id: &str,
        display_name: String,
    ) -> Result<CodeWorkspaceSummary, HiveoryWorkspaceError> {
        let mut workspaces = self
            .workspaces
            .write()
            .map_err(|_| HiveoryWorkspaceError::NotFound)?;
        let handle = workspaces
            .get_mut(workspace_id)
            .ok_or(HiveoryWorkspaceError::NotFound)?;
        handle.summary.display_name = display_name;
        handle.summary.updated_at_unix_ms = now_ms();
        Ok(handle.summary.clone())
    }

    pub fn close_workspace(
        &self,
        workspace_id: &str,
    ) -> Result<CodeWorkspaceSummary, HiveoryWorkspaceError> {
        self.workspaces
            .write()
            .map_err(|_| HiveoryWorkspaceError::NotFound)?
            .remove(workspace_id)
            .map(|handle| handle.summary)
            .ok_or(HiveoryWorkspaceError::NotFound)
    }

    pub fn set_trust(
        &self,
        workspace_id: &str,
        trust: CodeWorkspaceTrust,
    ) -> Result<CodeWorkspaceSummary, HiveoryWorkspaceError> {
        let mut workspaces = self
            .workspaces
            .write()
            .map_err(|_| HiveoryWorkspaceError::NotFound)?;
        let handle = workspaces
            .get_mut(workspace_id)
            .ok_or(HiveoryWorkspaceError::NotFound)?;
        handle.summary.trust = trust;
        handle.summary.capabilities = capabilities_for_trust(trust);
        handle.summary.updated_at_unix_ms = now_ms();
        Ok(handle.summary.clone())
    }

    pub fn require(
        &self,
        workspace_id: &str,
        capability: CodeWorkspaceCapability,
    ) -> Result<CodeWorkspaceSummary, HiveoryWorkspaceError> {
        let summary = self.summary(workspace_id)?;
        if !allows(summary.trust, capability) {
            return Err(HiveoryWorkspaceError::CapabilityDenied(capability));
        }
        Ok(summary)
    }

    pub fn file_tree(
        &self,
        workspace_id: &str,
        relative_directory: Option<&str>,
    ) -> Result<CodeFileTree, HiveoryWorkspaceError> {
        self.require(workspace_id, CodeWorkspaceCapability::ReadFiles)?;
        let handle = self.handle(workspace_id)?;
        let directory = validate_relative_path(relative_directory.unwrap_or(""), true)
            .map_err(domain_path_error)?;
        let directory_handle = open_directory(&handle.root, &directory)?;
        let mut entries = Vec::new();
        let mut truncated = false;
        for entry in directory_handle.entries()? {
            let entry = entry?;
            if entries.len() >= CODE_MAX_TREE_ENTRIES {
                truncated = true;
                break;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name == "." || name == ".." {
                continue;
            }
            let entry_type = entry.file_type()?;
            let kind = if entry_type.is_symlink() {
                CodeFileKind::Symlink
            } else if entry_type.is_dir() {
                CodeFileKind::Directory
            } else {
                CodeFileKind::File
            };
            let relative_path = if directory.is_empty() {
                name.clone()
            } else {
                format!("{directory}/{name}")
            };
            let metadata = if entry_type.is_symlink() {
                None
            } else {
                entry.metadata().ok()
            };
            let language = metadata
                .as_ref()
                .filter(|_| !entry_type.is_dir())
                .and_then(|_| language_for_path(&relative_path));
            entries.push(CodeFileNode {
                name,
                relative_path,
                kind,
                size: metadata
                    .as_ref()
                    .filter(|_| !entry_type.is_dir())
                    .map(|item| item.len()),
                language,
                modified_at_unix_ms: metadata
                    .as_ref()
                    .and_then(|item| item.modified().ok())
                    .and_then(unix_ms),
            });
        }
        entries.sort_by(|left, right| {
            let left_directory = matches!(left.kind, CodeFileKind::Directory);
            let right_directory = matches!(right.kind, CodeFileKind::Directory);
            right_directory.cmp(&left_directory).then_with(|| {
                left.name
                    .to_ascii_lowercase()
                    .cmp(&right.name.to_ascii_lowercase())
            })
        });
        Ok(CodeFileTree {
            workspace_id: workspace_id.to_owned(),
            directory,
            entries,
            truncated,
        })
    }

    pub fn read_file(
        &self,
        workspace_id: &str,
        relative_path: &str,
    ) -> Result<CodeDocument, HiveoryWorkspaceError> {
        self.require(workspace_id, CodeWorkspaceCapability::ReadFiles)?;
        let normalized = validate_relative_path(relative_path, false).map_err(domain_path_error)?;
        let handle = self.handle(workspace_id)?;
        let (parent, file_name) = open_parent_directory(&handle.root, &normalized)?;
        let metadata = parent.symlink_metadata(&file_name)?;
        if metadata.file_type().is_symlink() {
            return Err(HiveoryWorkspaceError::SymlinkNotAllowed);
        }
        if !metadata.is_file() {
            return Err(HiveoryWorkspaceError::InvalidPath(
                "only regular files can be opened in the editor".to_owned(),
            ));
        }
        if metadata.len() > CODE_MAX_FILE_BYTES {
            return Err(HiveoryWorkspaceError::FileTooLarge);
        }
        let bytes = parent.read(&file_name)?;
        document_from_bytes(workspace_id, &normalized, bytes)
    }

    pub fn save_file(
        &self,
        workspace_id: &str,
        relative_path: &str,
        content: &str,
        expected_fingerprint: Option<&str>,
    ) -> Result<CodeDocument, HiveoryWorkspaceError> {
        self.require(workspace_id, CodeWorkspaceCapability::WriteFiles)?;
        if content.len() as u64 > CODE_MAX_FILE_BYTES {
            return Err(HiveoryWorkspaceError::FileTooLarge);
        }
        let normalized = validate_relative_path(relative_path, false).map_err(domain_path_error)?;
        let handle = self.handle(workspace_id)?;
        let (parent, file_name) = open_parent_directory(&handle.root, &normalized)?;
        let existing = match parent.symlink_metadata(&file_name) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() {
                    return Err(HiveoryWorkspaceError::SymlinkNotAllowed);
                }
                if !metadata.is_file() {
                    return Err(HiveoryWorkspaceError::InvalidPath(
                        "only regular files can be saved".to_owned(),
                    ));
                }
                Some(parent.read(&file_name)?)
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => None,
            Err(error) => return Err(error.into()),
        };
        if let Some(expected) = expected_fingerprint {
            let actual = existing.as_deref().map(fingerprint);
            if actual.as_deref() != Some(expected) {
                return Err(HiveoryWorkspaceError::FileConflict);
            }
        }

        let temporary_name = format!(".hiveory-{}.tmp", Uuid::now_v7());
        let mut temporary = parent.open_with(
            &temporary_name,
            OpenOptions::new().write(true).create_new(true),
        )?;
        temporary.write_all(content.as_bytes())?;
        temporary.sync_all()?;
        drop(temporary);
        parent.rename(&temporary_name, &parent, &file_name)?;
        document_from_bytes(workspace_id, &normalized, content.as_bytes().to_vec())
    }

    fn handle(&self, workspace_id: &str) -> Result<WorkspaceHandle, HiveoryWorkspaceError> {
        self.workspaces
            .read()
            .map_err(|_| HiveoryWorkspaceError::NotFound)?
            .get(workspace_id)
            .cloned()
            .ok_or(HiveoryWorkspaceError::NotFound)
    }
}

fn open_directory(root: &Dir, relative: &str) -> Result<Dir, HiveoryWorkspaceError> {
    if relative.is_empty() {
        return Ok(root.open_dir(".")?);
    }
    let mut current = root.open_dir(".")?;
    for component in relative.split('/') {
        let metadata = current.symlink_metadata(component)?;
        if metadata.file_type().is_symlink() || !metadata.is_dir() {
            return Err(HiveoryWorkspaceError::SymlinkNotAllowed);
        }
        current = current.open_dir(component)?;
    }
    Ok(current)
}

fn open_parent_directory(
    root: &Dir,
    relative: &str,
) -> Result<(Dir, String), HiveoryWorkspaceError> {
    let mut components = relative.split('/').collect::<Vec<_>>();
    let file_name = components
        .pop()
        .ok_or(HiveoryWorkspaceError::InvalidPath(
            "file path is empty".to_owned(),
        ))?
        .to_owned();
    let parent_path = components.join("/");
    Ok((open_directory(root, &parent_path)?, file_name))
}

fn document_from_bytes(
    workspace_id: &str,
    relative_path: &str,
    bytes: Vec<u8>,
) -> Result<CodeDocument, HiveoryWorkspaceError> {
    let binary = bytes.contains(&0) || std::str::from_utf8(&bytes).is_err();
    let content = if binary {
        String::new()
    } else {
        String::from_utf8(bytes.clone()).map_err(|_| HiveoryWorkspaceError::BinaryFile)?
    };
    Ok(CodeDocument {
        workspace_id: workspace_id.to_owned(),
        relative_path: relative_path.to_owned(),
        language: language_for_path(relative_path),
        fingerprint: fingerprint(&bytes),
        bytes: bytes.len() as u64,
        read_only: binary,
        binary,
        content,
    })
}

fn fingerprint(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn domain_path_error(error: CodeDomainError) -> HiveoryWorkspaceError {
    HiveoryWorkspaceError::InvalidPath(error.to_string())
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn unix_ms(time: cap_std::time::SystemTime) -> Option<i64> {
    time.into_std()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as i64)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn reads_and_atomically_saves_inside_a_workspace() {
        let root = std::env::temp_dir().join(format!("hiveory-code-workspace-{}", Uuid::now_v7()));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/main.rs"), "fn main() {}\n").unwrap();
        let service = HiveoryWorkspaceService::new();
        let summary = service
            .open_workspace(&root, None, CodeWorkspaceTrust::Trusted)
            .unwrap();
        let tree = service.file_tree(&summary.id, Some("src")).unwrap();
        assert_eq!(tree.entries[0].relative_path, "src/main.rs");
        let document = service.read_file(&summary.id, "src\\main.rs").unwrap();
        let saved = service
            .save_file(
                &summary.id,
                "src/main.rs",
                "fn main() { println!(\"ok\"); }\n",
                Some(&document.fingerprint),
            )
            .unwrap();
        assert!(saved.content.contains("println"));
        assert_eq!(
            service
                .read_file(&summary.id, "src/main.rs")
                .unwrap()
                .content,
            saved.content
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn untrusted_workspace_cannot_save() {
        let root = std::env::temp_dir().join(format!("hiveory-code-untrusted-{}", Uuid::now_v7()));
        fs::create_dir_all(&root).unwrap();
        let service = HiveoryWorkspaceService::new();
        let summary = service
            .open_workspace(&root, None, CodeWorkspaceTrust::Untrusted)
            .unwrap();
        assert!(matches!(
            service.save_file(&summary.id, "new.txt", "no", None),
            Err(HiveoryWorkspaceError::CapabilityDenied(
                CodeWorkspaceCapability::WriteFiles
            ))
        ));
        let _ = fs::remove_dir_all(root);
    }
}
