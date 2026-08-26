use agentic_super_app_protocol::{ProviderDiagnosticRequest, SharedEventKind};
use agentic_super_app_secret_store::{AgenticSuperAppSecretStore, AgenticSuperAppSecretStoreError};
use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::json;
use std::sync::Arc;
use thiserror::Error;
use tokio_util::sync::CancellationToken;

#[derive(Debug, Error)]
pub enum AgenticSuperAppProviderError {
    #[error("provider credentials are unavailable")]
    CredentialsUnavailable,
    #[error("provider request failed: {0}")]
    Request(String),
    #[error("provider response was invalid")]
    InvalidResponse,
    #[error("provider request was cancelled")]
    Cancelled,
}

#[derive(Debug, Clone)]
pub struct AgenticSuperAppProviderUsage {
    pub input_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
}

#[async_trait]
pub trait AgenticSuperAppModelProvider: Send + Sync {
    async fn validate_credentials(
        &self,
        secret_reference: &str,
    ) -> Result<(), AgenticSuperAppProviderError>;
    async fn stream_diagnostic(
        &self,
        secret_reference: &str,
        request: ProviderDiagnosticRequest,
        cancellation: CancellationToken,
        on_event: Arc<dyn Fn(SharedEventKind, Option<String>, Option<String>) + Send + Sync>,
    ) -> Result<AgenticSuperAppProviderUsage, AgenticSuperAppProviderError>;
}

#[derive(Clone)]
pub struct AgenticSuperAppOpenAiResponsesProvider {
    client: Client,
    secrets: Arc<dyn AgenticSuperAppSecretStore>,
}
impl AgenticSuperAppOpenAiResponsesProvider {
    pub fn new(secrets: Arc<dyn AgenticSuperAppSecretStore>) -> Self {
        Self {
            client: Client::new(),
            secrets,
        }
    }
    fn token(&self, reference: &str) -> Result<String, AgenticSuperAppProviderError> {
        self.secrets.get(reference).map_err(|error| match error {
            AgenticSuperAppSecretStoreError::NotFound
            | AgenticSuperAppSecretStoreError::Unavailable => {
                AgenticSuperAppProviderError::CredentialsUnavailable
            }
        })
    }
}

#[async_trait]
impl AgenticSuperAppModelProvider for AgenticSuperAppOpenAiResponsesProvider {
    async fn validate_credentials(
        &self,
        secret_reference: &str,
    ) -> Result<(), AgenticSuperAppProviderError> {
        let response = self
            .client
            .get("https://api.openai.com/v1/models")
            .bearer_auth(self.token(secret_reference)?)
            .send()
            .await
            .map_err(|error| AgenticSuperAppProviderError::Request(error.to_string()))?;
        if response.status().is_success() {
            Ok(())
        } else {
            Err(AgenticSuperAppProviderError::Request(format!(
                "authentication returned HTTP {}",
                response.status()
            )))
        }
    }
    async fn stream_diagnostic(
        &self,
        secret_reference: &str,
        request: ProviderDiagnosticRequest,
        cancellation: CancellationToken,
        on_event: Arc<dyn Fn(SharedEventKind, Option<String>, Option<String>) + Send + Sync>,
    ) -> Result<AgenticSuperAppProviderUsage, AgenticSuperAppProviderError> {
        let response = self.client.post("https://api.openai.com/v1/responses").bearer_auth(self.token(secret_reference)?)
            .json(&json!({"model": request.model, "input": request.prompt, "stream": true, "store": false, "tools": []}))
            .send().await.map_err(|error| AgenticSuperAppProviderError::Request(error.to_string()))?;
        if !response.status().is_success() {
            return Err(AgenticSuperAppProviderError::Request(format!(
                "provider returned HTTP {}",
                response.status()
            )));
        }
        let mut body = response.bytes_stream();
        let mut buffer = String::new();
        let mut usage = AgenticSuperAppProviderUsage {
            input_tokens: None,
            output_tokens: None,
        };
        loop {
            let next = tokio::select! { _ = cancellation.cancelled() => return Err(AgenticSuperAppProviderError::Cancelled), item = body.next() => item };
            let Some(chunk) = next else { break };
            let chunk =
                chunk.map_err(|error| AgenticSuperAppProviderError::Request(error.to_string()))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some(index) = buffer.find("\n\n") {
                let frame = buffer[..index].to_owned();
                buffer.drain(..index + 2);
                for line in frame.lines().filter_map(|line| line.strip_prefix("data: ")) {
                    if line == "[DONE]" {
                        continue;
                    }
                    let value: serde_json::Value = serde_json::from_str(line)
                        .map_err(|_| AgenticSuperAppProviderError::InvalidResponse)?;
                    match value.get("type").and_then(|item| item.as_str()) {
                        Some("response.output_text.delta") => {
                            if let Some(delta) = value.get("delta").and_then(|item| item.as_str()) {
                                on_event(
                                    SharedEventKind::ProviderTextDelta,
                                    None,
                                    Some(delta.to_owned()),
                                );
                            }
                        }
                        Some("response.completed") => {
                            if let Some(details) =
                                value.get("response").and_then(|item| item.get("usage"))
                            {
                                usage.input_tokens =
                                    details.get("input_tokens").and_then(|item| item.as_u64());
                                usage.output_tokens =
                                    details.get("output_tokens").and_then(|item| item.as_u64());
                            }
                            on_event(
                                SharedEventKind::ProviderCompleted,
                                Some("Provider stream completed".to_owned()),
                                None,
                            );
                        }
                        Some("response.failed") => {
                            return Err(AgenticSuperAppProviderError::Request(
                                "provider reported a failed response".to_owned(),
                            ))
                        }
                        _ => {}
                    }
                }
            }
        }
        Ok(usage)
    }
}
