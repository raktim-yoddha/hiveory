use hiveory_protocol::{AgentArtifactKind, ChatAttachmentSummary};
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
pub enum HiveoryArtifactError {
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
pub struct HiveoryStoredAttachment {
    pub summary: ChatAttachmentSummary,
    pub absolute_path: PathBuf,
}

#[derive(Debug, Clone)]
pub struct HiveoryStoredAgentArtifact {
    pub kind: AgentArtifactKind,
    pub name: String,
    pub relative_path: String,
    pub absolute_path: PathBuf,
    pub bytes: u64,
    pub sha256: String,
}

#[derive(Debug, Clone)]
pub struct HiveoryArtifactStore {
    root: PathBuf,
}

impl HiveoryArtifactStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn import_paths(
        &self,
        paths: &[PathBuf],
    ) -> Result<Vec<HiveoryStoredAttachment>, HiveoryArtifactError> {
        let mut files = Vec::new();
        for path in paths {
            collect_attachment_files(path, &mut files)?;
        }
        if files.len() > MAX_ATTACHMENTS_PER_TURN {
            return Err(HiveoryArtifactError::TooLarge);
        }
        let mut imported = Vec::with_capacity(files.len());
        for path in files {
            let attachment = self.import_one(&path)?;
            imported.push(attachment);
        }
        enforce_attachment_total(&imported)?;
        Ok(imported)
    }

    pub fn import_bytes(
        &self,
        display_name: &str,
        declared_mime_type: &str,
        content: &[u8],
    ) -> Result<HiveoryStoredAttachment, HiveoryArtifactError> {
        let display_name = display_name
            .rsplit(['/', '\\'])
            .next()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or("attachment")
            .to_owned();
        let (mime_type, limit) = classify_bytes(&display_name, content, declared_mime_type)?;
        if content.len() as u64 > limit {
            return Err(HiveoryArtifactError::TooLarge);
        }
        validate_content(&mime_type, content)?;
        self.store_content(display_name, mime_type, content)
    }

    fn import_one(&self, source: &Path) -> Result<HiveoryStoredAttachment, HiveoryArtifactError> {
        let link_metadata =
            fs::symlink_metadata(source).map_err(|_| HiveoryArtifactError::Storage)?;
        if !link_metadata.is_file() || link_metadata.file_type().is_symlink() {
            return Err(HiveoryArtifactError::NotAFile);
        }
        let canonical = source
            .canonicalize()
            .map_err(|_| HiveoryArtifactError::Storage)?;
        let metadata = fs::metadata(&canonical).map_err(|_| HiveoryArtifactError::Storage)?;
        if !metadata.is_file() {
            return Err(HiveoryArtifactError::NotAFile);
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
            return Err(HiveoryArtifactError::TooLarge);
        }

        let mut input = File::open(&canonical).map_err(|_| HiveoryArtifactError::Storage)?;
        let mut content = Vec::with_capacity(bytes.min(1024 * 1024) as usize);
        input
            .read_to_end(&mut content)
            .map_err(|_| HiveoryArtifactError::Storage)?;
        if content.len() as u64 != bytes {
            return Err(HiveoryArtifactError::Storage);
        }
        validate_content(&mime_type, &content)?;
        self.store_content(display_name, mime_type, &content)
    }

    fn store_content(
        &self,
        display_name: String,
        mime_type: String,
        content: &[u8],
    ) -> Result<HiveoryStoredAttachment, HiveoryArtifactError> {
        let bytes = content.len() as u64;
        if bytes > MAX_ATTACHMENTS_BYTES_PER_TURN {
            return Err(HiveoryArtifactError::TooLarge);
        }
        let sha256 = hex_digest(content);
        let relative_path = PathBuf::from("attachments")
            .join(&sha256[..2])
            .join(&sha256);
        let destination = self.root.join(&relative_path);
        if !destination.exists() {
            if let Some(parent) = destination.parent() {
                fs::create_dir_all(parent).map_err(|_| HiveoryArtifactError::Storage)?;
            }
            let temporary = self
                .root
                .join("tmp")
                .join(format!("{}.part", Uuid::now_v7()));
            if let Some(parent) = temporary.parent() {
                fs::create_dir_all(parent).map_err(|_| HiveoryArtifactError::Storage)?;
            }
            let mut output = File::create(&temporary).map_err(|_| HiveoryArtifactError::Storage)?;
            output
                .write_all(content)
                .and_then(|_| output.sync_all())
                .map_err(|_| HiveoryArtifactError::Storage)?;
            if fs::rename(&temporary, &destination).is_err() {
                let _ = fs::remove_file(&temporary);
                if !destination.exists() {
                    return Err(HiveoryArtifactError::Storage);
                }
            }
        }
        Ok(HiveoryStoredAttachment {
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
    ) -> Result<PathBuf, HiveoryArtifactError> {
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
            return Err(HiveoryArtifactError::Storage);
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
    ) -> Result<HiveoryStoredAgentArtifact, HiveoryArtifactError> {
        if run_id.trim().is_empty() || content.len() as u64 > TEXT_LIMIT {
            return Err(HiveoryArtifactError::TooLarge);
        }
        let safe_run_id = sanitize_archive_name(run_id);
        let safe_name = sanitize_archive_name(name);
        if safe_name.is_empty() {
            return Err(HiveoryArtifactError::Storage);
        }
        let bytes = content.as_bytes();
        let sha256 = hex_digest(bytes);
        let relative_path = format!("agent-artifacts/{safe_run_id}/{sha256}-{safe_name}");
        let destination = self.resolve_relative_path(&relative_path)?;
        if let Some(parent) = destination.parent() {
            fs::create_dir_all(parent).map_err(|_| HiveoryArtifactError::Storage)?;
        }
        if !destination.exists() {
            let temporary = self
                .root
                .join("tmp")
                .join(format!("{}.part", Uuid::now_v7()));
            if let Some(parent) = temporary.parent() {
                fs::create_dir_all(parent).map_err(|_| HiveoryArtifactError::Storage)?;
            }
            let mut output = File::create(&temporary).map_err(|_| HiveoryArtifactError::Storage)?;
            output
                .write_all(bytes)
                .and_then(|_| output.sync_all())
                .map_err(|_| HiveoryArtifactError::Storage)?;
            if fs::rename(&temporary, &destination).is_err() {
                let _ = fs::remove_file(&temporary);
                if !destination.exists() {
                    return Err(HiveoryArtifactError::Storage);
                }
            }
        }
        Ok(HiveoryStoredAgentArtifact {
            kind,
            name: safe_name,
            relative_path,
            absolute_path: destination,
            bytes: bytes.len() as u64,
            sha256,
        })
    }

    pub fn remove_relative_path(&self, relative_path: &str) -> Result<(), HiveoryArtifactError> {
        let path = self.resolve_relative_path(relative_path)?;
        if path.exists() {
            fs::remove_file(path).map_err(|_| HiveoryArtifactError::Storage)?;
        }
        Ok(())
    }

    pub fn write_export(
        &self,
        destination: &Path,
        manifest_json: &str,
        attachments: &[(String, PathBuf)],
    ) -> Result<(), HiveoryArtifactError> {
        if attachments.len() > MAX_EXPORT_ATTACHMENTS {
            return Err(HiveoryArtifactError::Export);
        }
        if let Some(parent) = destination
            .parent()
            .filter(|path| !path.as_os_str().is_empty())
        {
            fs::create_dir_all(parent).map_err(|_| HiveoryArtifactError::Export)?;
        }
        let temporary = destination.with_extension(format!("{}.part", Uuid::now_v7()));
        let file = File::create(&temporary).map_err(|_| HiveoryArtifactError::Export)?;
        let mut archive = ZipWriter::new(file);
        let options = SimpleFileOptions::default();
        archive
            .start_file("manifest.json", options)
            .map_err(|_| HiveoryArtifactError::Export)?;
        archive
            .write_all(manifest_json.as_bytes())
            .map_err(|_| HiveoryArtifactError::Export)?;
        let mut total_bytes = 0u64;
        for (name, path) in attachments {
            let metadata = fs::metadata(path).map_err(|_| HiveoryArtifactError::Export)?;
            total_bytes = total_bytes
                .checked_add(metadata.len())
                .ok_or(HiveoryArtifactError::Export)?;
            if total_bytes > MAX_EXPORT_BYTES {
                return Err(HiveoryArtifactError::Export);
            }
            let safe_name = sanitize_archive_name(name);
            let mut input = File::open(path).map_err(|_| HiveoryArtifactError::Export)?;
            archive
                .start_file(format!("attachments/{safe_name}"), options)
                .map_err(|_| HiveoryArtifactError::Export)?;
            std::io::copy(&mut input, &mut archive).map_err(|_| HiveoryArtifactError::Export)?;
        }
        let file = archive.finish().map_err(|_| HiveoryArtifactError::Export)?;
        file.sync_all().map_err(|_| HiveoryArtifactError::Export)?;
        fs::rename(&temporary, destination).map_err(|_| HiveoryArtifactError::Export)?;
        Ok(())
    }
}

fn classify(display_name: &str, path: &Path) -> Result<(String, u64), HiveoryArtifactError> {
    let mut header = [0u8; 12];
    let mut file = File::open(path).map_err(|_| HiveoryArtifactError::Storage)?;
    let read = file
        .read(&mut header)
        .map_err(|_| HiveoryArtifactError::Storage)?;
    classify_bytes(display_name, &header[..read], "")
}

fn classify_bytes(
    display_name: &str,
    content: &[u8],
    declared_mime_type: &str,
) -> Result<(String, u64), HiveoryArtifactError> {
    let detected = if content.len() >= 5 && &content[..5] == b"%PDF-" {
        Some(("application/pdf", PDF_LIMIT))
    } else if content.len() >= 8 && content[..8] == [137, 80, 78, 71, 13, 10, 26, 10] {
        Some(("image/png", IMAGE_LIMIT))
    } else if content.len() >= 3 && content[..3] == [0xff, 0xd8, 0xff] {
        Some(("image/jpeg", IMAGE_LIMIT))
    } else if content.len() >= 12 && &content[..4] == b"RIFF" && &content[8..12] == b"WEBP" {
        Some(("image/webp", IMAGE_LIMIT))
    } else {
        let extension = Path::new(display_name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        matches!(extension.as_str(), "txt" | "md" | "markdown")
            .then_some(("text/plain", TEXT_LIMIT))
    };
    let Some((mime_type, limit)) = detected else {
        return Err(HiveoryArtifactError::UnsupportedType);
    };
    if !declared_mime_type.trim().is_empty() && declared_mime_type != mime_type {
        return Err(HiveoryArtifactError::InvalidContent);
    }
    Ok((mime_type.to_owned(), limit))
}

fn collect_attachment_files(
    path: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), HiveoryArtifactError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| HiveoryArtifactError::Storage)?;
    if metadata.file_type().is_symlink() {
        return Err(HiveoryArtifactError::NotAFile);
    }
    if metadata.is_file() {
        files.push(path.to_owned());
        return Ok(());
    }
    if !metadata.is_dir() {
        return Err(HiveoryArtifactError::NotAFile);
    }
    let mut entries = fs::read_dir(path)
        .map_err(|_| HiveoryArtifactError::Storage)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| HiveoryArtifactError::Storage)?;
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        collect_attachment_files(&entry.path(), files)?;
        if files.len() > MAX_ATTACHMENTS_PER_TURN {
            return Err(HiveoryArtifactError::TooLarge);
        }
    }
    Ok(())
}

fn enforce_attachment_total(
    attachments: &[HiveoryStoredAttachment],
) -> Result<(), HiveoryArtifactError> {
    let total = attachments.iter().try_fold(0u64, |total, attachment| {
        total
            .checked_add(attachment.summary.bytes.max(0) as u64)
            .ok_or(HiveoryArtifactError::TooLarge)
    })?;
    if total > MAX_ATTACHMENTS_BYTES_PER_TURN {
        Err(HiveoryArtifactError::TooLarge)
    } else {
        Ok(())
    }
}

fn validate_content(mime_type: &str, content: &[u8]) -> Result<(), HiveoryArtifactError> {
    match mime_type {
        "text/plain" => {
            if content.contains(&0) || std::str::from_utf8(content).is_err() {
                Err(HiveoryArtifactError::InvalidText)
            } else {
                Ok(())
            }
        }
        "application/pdf" => content
            .windows(5)
            .any(|window| window == b"%%EOF")
            .then_some(())
            .ok_or(HiveoryArtifactError::InvalidContent),
        "image/png" | "image/jpeg" | "image/webp" => Ok(()),
        _ => Err(HiveoryArtifactError::UnsupportedType),
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
    use super::{sanitize_archive_name, HiveoryArtifactStore};
    use std::{fs, path::PathBuf};

    #[test]
    fn archive_names_cannot_escape_the_attachment_directory() {
        assert_eq!(sanitize_archive_name("../../secret.txt"), "secret.txt");
    }

    #[test]
    fn import_rejects_unsupported_extensions_before_storage() {
        let root = std::env::temp_dir().join("hiveory-artifact-test");
        let source = root.join("unsupported.bin");
        let _ = fs::create_dir_all(&root);
        fs::write(&source, b"not supported").expect("source");
        let result =
            HiveoryArtifactStore::new(root.clone()).import_paths(&[PathBuf::from(&source)]);
        assert!(result.is_err());
        let _ = fs::remove_file(source);
        let _ = fs::remove_dir_all(root);
    }
}
