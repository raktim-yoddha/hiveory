use keyring::Entry;
use std::sync::Arc;
use thiserror::Error;
use uuid::Uuid;

pub const HIVEORY_SECRET_SERVICE: &str = "com.hiveory.desktop";

#[derive(Debug, Error)]
pub enum HiveorySecretStoreError {
    #[error("the operating system credential store is unavailable")]
    Unavailable,
    #[error("the requested secret is unavailable")]
    NotFound,
}

pub trait HiveorySecretStore: Send + Sync {
    fn put(&self, value: &str) -> Result<String, HiveorySecretStoreError>;
    fn get(&self, reference: &str) -> Result<String, HiveorySecretStoreError>;
    fn delete(&self, reference: &str) -> Result<(), HiveorySecretStoreError>;
}

#[derive(Default)]
pub struct HiveoryKeyringSecretStore;

impl HiveoryKeyringSecretStore {
    fn entry(reference: &str) -> Result<Entry, HiveorySecretStoreError> {
        Entry::new(HIVEORY_SECRET_SERVICE, reference)
            .map_err(|_| HiveorySecretStoreError::Unavailable)
    }
}

impl HiveorySecretStore for HiveoryKeyringSecretStore {
    fn put(&self, value: &str) -> Result<String, HiveorySecretStoreError> {
        let reference = Uuid::now_v7().to_string();
        Self::entry(&reference)?
            .set_password(value)
            .map_err(|_| HiveorySecretStoreError::Unavailable)?;
        Ok(reference)
    }
    fn get(&self, reference: &str) -> Result<String, HiveorySecretStoreError> {
        Self::entry(reference)?
            .get_password()
            .map_err(|_| HiveorySecretStoreError::NotFound)
    }
    fn delete(&self, reference: &str) -> Result<(), HiveorySecretStoreError> {
        Self::entry(reference)?
            .delete_credential()
            .map_err(|_| HiveorySecretStoreError::NotFound)
    }
}

pub type HiveorySecretStoreHandle = Arc<dyn HiveorySecretStore>;
