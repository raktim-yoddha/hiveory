use agentic_super_app_protocol::{AgentArtifactKind, ChatAttachmentSummary};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
};
use thiserror::Error;
use uuid::Uuid;
use zip::{write::SimpleFileOptions, ZipWriter};

const PDF_LIMIT: u64 = 20 * 1024 * 1024;
const IMAGE_LIMIT: u64 = 10 * 1024 * 1024;
const TEXT_LIMIT: u64 = 2 * 1024 * 1024;
pub const MAX_ATTACHMENTS_PER_TURN: usize = 10;
pub const MAX_ATTACHMENTS_BYTES_PER_TURN: u64 = 50 * 1024 * 1024;
const MAX_EXPORT_ATTACHMENTS: usize = 100;
const MAX_EXPORT_BYTES: u64 = 200 * 1024 * 1024;

#[derive(Debug, Error)]
pub enum AgenticSuperAppArtifactError {
    #[error("attachment path is not a regular file")]
    NotAFile,
    #[error("attachment type is not supported")]
    UnsupportedType,
    #[error("attachment is too large")]
    TooLarge,
    #[error("attachment is not valid UTF-8")]
    InvalidText,
    #[error("attachment content does not match its declared type")]
    InvalidContent,
    #[error("attachment storage is unavailable")]
    Storage,
    #[error("export could not be written")]
    Export,
}

#[derive(Debug, Clone)]
pub struct AgenticSuperAppStoredAttachment {
    pub summary: ChatAttachmentSummary,
    pub absolute_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct AgenticSuperAppStoredAgentArtifact {
    pub kind: AgentArtifactKind,
    pub name: String,
    pub relative_path: String,
    pub absolute_path: PathBuf,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone)]
pub struct AgenticSuperAppArtifactStore {
    root: PathBuf,
}

impl AgenticSuperAppArtifactStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn import_paths(
        &self,
        paths: &[PathBuf],
    ) -> Result<Vec<AgenticSuperAppStoredAttachment>, AgenticSuperAppArtifactError> {
        if paths.len() > MAX_ATTACHMENTS_PER_TURN {
            return Err(AgenticSuperAppArtifactError::TooLarge);
        }
        let mut total = 0u64;
        let mut imported = Vec::with_capacity(paths.len());
        for path in paths {
            let attachment = self.import_one(path)?;
            total = total
                .checked_add(attachment.summary.bytes as u64)
                .ok_or(AgenticSuperAppArtifactError::TooLarge)?;
            if total > MAX_ATTACHMENTS_BYTES_PER_TURN {
                return Err(AgenticSuperAppArtifactError::TooLarge);
            }
            imported.push(attachment);
        }
        Ok(imported)
    }

    fn import_one(
        &self,
        source: &Path,
    ) -> Result<AgenticSuperAppStoredAttachment, AgenticSuperAppArtifactError> {
        let link_metadata =
            fs::symlink_metadata(source).map_err(|_| AgenticSuperAppArtifactError::Storage)?;
        if !link_metadata.is_file() || link_metadata.file_type().is_symlink() {
            return Err(AgenticSuperAppArtifactError::NotAFile);
        }
        let canonical = source
            .canonicalize()
            .map_err(|_| AgenticSuperAppArtifactError::Storage)?;
        let metadata =
            fs::metadata(&canonical).map_err(|_| AgenticSuperAppArtifactError::Storage)?;
        if !metadata.is_file() {
            return Err(AgenticSuperAppArtifactError::NotAFile);
        }
        let bytes = metadata.len();
        let display_name = source
            .file_name()
            .and_then(|value| value.to_str())
            .filter(|value| !value.is_empty())
            .unwrap_or("attachment")
            .to_owned();
        let (mime_type, limit) = classify(&display_name, &canonical)?;
        if bytes > limit {
            return Err(AgenticSuperAppArtifactError::TooLarge);
        }

        let mut input =
            File::open(&canonical).map_err(|_| AgenticSuperAppArtifactError::Storage)?;
        let mut content = Vec::with_capacity(bytes.min(1024 * 1024) as usize);
        input
            .read_to_end(&mut content)
            .map_err(|_| AgenticSuperAppArtifactError::Storage)?;
        if content.len() as u64 != bytes {
            return Err(AgenticSuperAppArtifactError::Storage);
        }
        validate_content(&mime_type, &content)?;
        let sha256 = hex_digest(&content);
        let relative_path = PathBuf::from("attachments")
            .join(&sha256[..2])
            .join(&sha256);
        let destination = self.root.join(&relative_path);
        if !destination.exists() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|_| AgenticSuperAppArtifactError::Storage)?;
            }
            let temporary = self
                .root
                .join("tmp")
                .join(format!("{}.part", Uuid::now_v7()));
            if let Some(parent) = temporary.parent() {
                fs::create_dir_all(parent).map_err(|_| AgenticSuperAppArtifactError::Storage)?;
            }
            let mut output =
                File::create(&temporary).map_err(|_| AgenticSuperAppArtifactError::Storage)?;
            output
                .write_all(&content)
                .and_then(|_| output.sync_all())
                .map_err(|_| AgenticSuperAppArtifactError::Storage)?;
            if fs::rename(&temporary, &destination).is_err() {
                let _ = fs::remove_file(&temporary);
                if !destination.exists() {
                    return Err(AgenticSuperAppArtifactError::Storage);
                }
            }
        }
        Ok(AgenticSuperAppStoredAttachment {
            summary: ChatAttachmentSummary {
                id: Uuid::now_v7().to_string(),
                display_name,
                mime_type,
                bytes: bytes as i64,
                sha256,
            },
            absolute_path: destination,
        })
    }

    pub fn resolve_relative_path(
        &self,
        relative_path: &str,
    ) -> Result<PathBuf, AgenticSuperAppArtifactError> {
        let relative = Path::new(relative_path);
        if relative.is_absolute()
            || relative.components().any(|component| {
                matches!(
                    component,
                    std::path::Component::ParentDir
                        | std::path::Component::Prefix(_)
                        | std::path::Component::RootDir
                )
            })
        {
            return Err(AgenticSuperAppArtifactError::Storage);
        }
        Ok(self.root.join(relative))
    }

    /// Store a text artifact emitted by an Agent under its private content
    /// root. The caller persists the returned metadata with the run; this
    /// method never accepts an absolute or parent-traversing path.
    pub fn write_agent_text(
        &self,
        run_id: &str,
        name: &str,
        content: &str,
        kind: AgentArtifactKind,
    ) -> Result<AgenticSuperAppStoredAgentArtifact, AgenticSuperAppArtifactError> {
        if run_id.trim().is_empty() || content.len() as u64 > TEXT_LIMIT {
            return Err(AgenticSuperAppArtifactError::TooLarge);
        }
        let safe_run_id = sanitize_archive_name(run_id);
        let safe_name = sanitize_archive_name(name);
        if safe_name.is_empty() {
            return Err(AgenticSuperAppArtifactError::Storage);
        }
        let bytes = content.as_bytes();
        let sha256 = hex_digest(bytes);
        let relative_path = format!("agent-artifacts/{safe_run_id}/{sha256}-{safe_name}");
        let destination = self.resolve_relative_path(&relative_path)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|_| AgenticSuperAppArtifactError::Storage)?;
        }
        if !destination.exists() {
            let temporary = self
                .root
                .join("tmp")
                .join(format!("{}.part", Uuid::now_v7()));
            if let Some(parent) = temporary.parent() {
                fs::create_dir_all(parent).map_err(|_| AgenticSuperAppArtifactError::Storage)?;
            }
            let mut output =
                File::create(&temporary).map_err(|_| AgenticSuperAppArtifactError::Storage)?;
            output
                .write_all(bytes)
                .and_then(|_| output.sync_all())
                .map_err(|_| AgenticSuperAppArtifactError::Storage)?;
            if fs::rename(&temporary, &destination).is_err() {
                let _ = fs::remove_file(&temporary);
                if !destination.exists() {
                    return Err(AgenticSuperAppArtifactError::Storage);
                }
            }
        }
        Ok(AgenticSuperAppStoredAgentArtifact {
            kind,
            name: safe_name,
            relative_path,
            absolute_path: destination,
            bytes: bytes.len() as u64,
            sha256,
        })
    }

    pub fn remove_relative_path(
        &self,
        relative_path: &str,
    ) -> Result<(), AgenticSuperAppArtifactError> {
        let path = self.resolve_relative_path(relative_path)?;
        if path.exists() {
            fs::remove_file(path).map_err(|_| AgenticSuperAppArtifactError::Storage)?;
        }
        Ok(())
    }

    pub fn write_export(
        &self,
        destination: &Path,
        manifest_json: &str,
        attachments: &[(String, PathBuf)],
    ) -> Result<(), AgenticSuperAppArtifactError> {
        if attachments.len() > MAX_EXPORT_ATTACHMENTS {
            return Err(AgenticSuperAppArtifactError::Export);
        }
        if let Some(parent) = destination
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|_| AgenticSuperAppArtifactError::Export)?;
        }
        let temporary = destination.with_extension(format!("{}.part", Uuid::now_v7()));
        let file = File::create(&temporary).map_err(|_| AgenticSuperAppArtifactError::Export)?;
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        archive
            .start_file("manifest.json", options)
            .map_err(|_| AgenticSuperAppArtifactError::Export)?;
        archive
            .write_all(manifest_json.as_bytes())
            .map_err(|_| AgenticSuperAppArtifactError::Export)?;
        let mut total_bytes = 0u64;
        for (name, path) in attachments {
            let metadata = fs::metadata(path).map_err(|_| AgenticSuperAppArtifactError::Export)?;
            total_bytes = total_bytes
                .checked_add(metadata.len())
                .ok_or(AgenticSuperAppArtifactError::Export)?;
            if total_bytes > MAX_EXPORT_BYTES {
                return Err(AgenticSuperAppArtifactError::Export);
            }
            let safe_name = sanitize_archive_name(name);
            let mut input = File::open(path).map_err(|_| AgenticSuperAppArtifactError::Export)?;
            archive
                .start_file(format!("attachments/{safe_name}"), options)
                .map_err(|_| AgenticSuperAppArtifactError::Export)?;
            std::io::copy(&mut input, &mut archive)
                .map_err(|_| AgenticSuperAppArtifactError::Export)?;
        }
        let file = archive
            .finish()
            .map_err(|_| AgenticSuperAppArtifactError::Export)?;
        file.sync_all()
            .map_err(|_| AgenticSuperAppArtifactError::Export)?;
        fs::rename(&temporary, destination).map_err(|_| AgenticSuperAppArtifactError::Export)?;
        Ok(())
    }
}

fn classify(
    display_name: &str,
    path: &Path,
) -> Result<(String, u64), AgenticSuperAppArtifactError> {
    let mut header = [0u8; 12];
    let mut file = File::open(path).map_err(|_| AgenticSuperAppArtifactError::Storage)?;
    let read = file
        .read(&mut header)
        .map_err(|_| AgenticSuperAppArtifactError::Storage)?;
    if read >= 5 && &header[..5] == b"%PDF-" {
        return Ok(("application/pdf".to_owned(), PDF_LIMIT));
    }
    if read >= 8 && header[..8] == [137, 80, 78, 71, 13, 10, 26, 10] {
        return Ok(("image/png".to_owned(), IMAGE_LIMIT));
    }
    if read >= 3 && header[..3] == [0xff, 0xd8, 0xff] {
        return Ok(("image/jpeg".to_owned(), IMAGE_LIMIT));
    }
    if read >= 12 && &header[..4] == b"RIFF" && &header[8..12] == b"WEBP" {
        return Ok(("image/webp".to_owned(), IMAGE_LIMIT));
    }
    let extension = Path::new(display_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "txt" | "md" | "markdown") {
        return Ok(("text/plain".to_owned(), TEXT_LIMIT));
    }
    Err(AgenticSuperAppArtifactError::UnsupportedType)
}

fn validate_content(mime_type: &str, content: &[u8]) -> Result<(), AgenticSuperAppArtifactError> {
    match mime_type {
        "text/plain" => {
            if content.contains(&0) || std::str::from_utf8(content).is_err() {
                Err(AgenticSuperAppArtifactError::InvalidText)
            } else {
                Ok(())
            }
        }
        "application/pdf" => content
            .windows(5)
            .any(|window| window == b"%%EOF")
            .then_some(())
            .ok_or(AgenticSuperAppArtifactError::InvalidContent),
        "image/png" | "image/jpeg" | "image/webp" => Ok(()),
        _ => Err(AgenticSuperAppArtifactError::UnsupportedType),
    }
}

fn hex_digest(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}

fn sanitize_archive_name(name: &str) -> String {
    let candidate = Path::new(name)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("attachment");
    candidate
        .chars()
        .map(|character| {
            if character.is_control() {
                '_'
            } else {
                character
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{sanitize_archive_name, AgenticSuperAppArtifactStore};
    use std::{fs, path::PathBuf};

    #[test]
    fn archive_names_cannot_escape_the_attachment_directory() {
        assert_eq!(sanitize_archive_name("../../secret.txt"), "secret.txt");
    }

    #[test]
    fn import_rejects_unsupported_extensions_before_storage() {
        let root = std::env::temp_dir().join("agentic-super-app-artifact-test");
        let source = root.join("unsupported.bin");
        let _ = fs::create_dir_all(&root);
        fs::write(&source, b"not supported").expect("source");
        let result =
            AgenticSuperAppArtifactStore::new(root.clone()).import_paths(&[PathBuf::from(&source)]);
        assert!(result.is_err());
        let _ = fs::remove_file(source);
        let _ = fs::remove_dir_all(root);
    }
}
