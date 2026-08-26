use keyring::Entry;
use std::sync::Arc;
use thiserror::Error;
use uuid::Uuid;

pub const AGENTIC_SUPER_APP_SECRET_SERVICE: &str = "com.agenticsuperapp.desktop";

#[derive(Debug, Error)]
pub enum AgenticSuperAppSecretStoreError {
    #[error("the operating system credential store is unavailable")]
    Unavailable,
    #[error("the requested secret is unavailable")]
    NotFound,
}

pub trait AgenticSuperAppSecretStore: Send + Sync {
    fn put(&self, value: &str) -> Result<String, AgenticSuperAppSecretStoreError>;
    fn get(&self, reference: &str) -> Result<String, AgenticSuperAppSecretStoreError>;
    fn delete(&self, reference: &str) -> Result<(), AgenticSuperAppSecretStoreError>;
}

#[derive(Default)]
pub struct AgenticSuperAppKeyringSecretStore;

impl AgenticSuperAppKeyringSecretStore {
    fn entry(reference: &str) -> Result<Entry, AgenticSuperAppSecretStoreError> {
        Entry::new(AGENTIC_SUPER_APP_SECRET_SERVICE, reference)
            .map_err(|_| AgenticSuperAppSecretStoreError::Unavailable)
    }
}

impl AgenticSuperAppSecretStore for AgenticSuperAppKeyringSecretStore {
    fn put(&self, value: &str) -> Result<String, AgenticSuperAppSecretStoreError> {
        let reference = Uuid::now_v7().to_string();
        Self::entry(&reference)?
            .set_password(value)
            .map_err(|_| AgenticSuperAppSecretStoreError::Unavailable)?;
        Ok(reference)
    }
    fn get(&self, reference: &str) -> Result<String, AgenticSuperAppSecretStoreError> {
        Self::entry(reference)?
            .get_password()
            .map_err(|_| AgenticSuperAppSecretStoreError::NotFound)
    }
    fn delete(&self, reference: &str) -> Result<(), AgenticSuperAppSecretStoreError> {
        Self::entry(reference)?
            .delete_credential()
            .map_err(|_| AgenticSuperAppSecretStoreError::NotFound)
    }
}

pub type AgenticSuperAppSecretStoreHandle = Arc<dyn AgenticSuperAppSecretStore>;
