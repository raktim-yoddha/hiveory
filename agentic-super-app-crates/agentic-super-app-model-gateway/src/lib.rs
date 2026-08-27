use agentic_super_app_protocol::{
    AgentModelTurnRequest, AgentProviderStreamEvent, AgentProviderStreamEventKind,
    ChatModelTurnRequest, ChatProviderStreamEvent, ChatProviderStreamEventKind,
    ProviderDiagnosticRequest, SharedEventKind,
};
use agentic_super_app_secret_store::{AgenticSuperAppSecretStore, AgenticSuperAppSecretStoreError};
use async_trait::async_trait;
use futures_util::StreamExt;
use reqwest::Client;
use serde_json::json;
use std::collections::{HashMap, HashSet};
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
    async fn stream_chat_turn(
        &self,
        secret_reference: &str,
        request: ChatModelTurnRequest,
        cancellation: CancellationToken,
        on_event: Arc<dyn Fn(ChatProviderStreamEvent) + Send + Sync>,
    ) -> Result<(), AgenticSuperAppProviderError>;
    async fn stream_agent_turn(
        &self,
        secret_reference: &str,
        request: AgentModelTurnRequest,
        cancellation: CancellationToken,
        on_event: Arc<dyn Fn(AgentProviderStreamEvent) + Send + Sync>,
    ) -> Result<(), AgenticSuperAppProviderError>;
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

    async fn stream_chat_turn(
        &self,
        secret_reference: &str,
        request: ChatModelTurnRequest,
        cancellation: CancellationToken,
        on_event: Arc<dyn Fn(ChatProviderStreamEvent) + Send + Sync>,
    ) -> Result<(), AgenticSuperAppProviderError> {
        let input: Vec<serde_json::Value> = request
            .messages
            .iter()
            .map(|message| {
                let content: Vec<serde_json::Value> = message
                    .parts
                    .iter()
                    .filter_map(|part| match part.kind.as_str() {
                        "text" => part
                            .text
                            .as_ref()
                            .map(|text| json!({ "type": "input_text", "text": text })),
                        "image" => part.data_url.as_ref().map(|data_url| {
                            json!({ "type": "input_image", "image_url": data_url })
                        }),
                        "file" => part.data_url.as_ref().map(|data_url| {
                            json!({ "type": "input_file", "filename": part.file_name, "file_data": data_url })
                        }),
                        _ => None,
                    })
                    .collect();
                json!({
                    "role": match message.role {
                        agentic_super_app_protocol::ChatMessageRole::User => "user",
                        agentic_super_app_protocol::ChatMessageRole::Assistant => "assistant",
                        agentic_super_app_protocol::ChatMessageRole::System => "system",
                    },
                    "content": content,
                })
            })
            .collect();
        let mut payload = json!({
            "model": request.model,
            "input": input,
            "stream": true,
            "store": false,
            "tools": [],
        });
        if !matches!(
            request.reasoning_effort,
            agentic_super_app_protocol::ChatReasoningEffort::Auto
        ) {
            payload["reasoning"] = json!({ "effort": match request.reasoning_effort {
                agentic_super_app_protocol::ChatReasoningEffort::Low => "low",
                agentic_super_app_protocol::ChatReasoningEffort::Medium => "medium",
                agentic_super_app_protocol::ChatReasoningEffort::High => "high",
                agentic_super_app_protocol::ChatReasoningEffort::Auto => "auto",
            }});
        }
        let response = self
            .client
            .post("https://api.openai.com/v1/responses")
            .bearer_auth(self.token(secret_reference)?)
            .json(&payload)
            .send()
            .await
            .map_err(|error| AgenticSuperAppProviderError::Request(error.to_string()))?;
        if !response.status().is_success() {
            return Err(AgenticSuperAppProviderError::Request(format!(
                "provider returned HTTP {}",
                response.status()
            )));
        }
        let mut body = response.bytes_stream();
        let mut buffer = String::new();
        let mut fallback_sequence = 0i64;
        let mut completed = false;
        loop {
            let next = tokio::select! {
                _ = cancellation.cancelled() => return Err(AgenticSuperAppProviderError::Cancelled),
                item = body.next() => item,
            };
            let Some(chunk) = next else { break };
            let chunk =
                chunk.map_err(|error| AgenticSuperAppProviderError::Request(error.to_string()))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some((frame, consumed)) =
                next_sse_frame(&buffer).map(|(frame, consumed)| (frame.to_owned(), consumed))
            {
                buffer.drain(..consumed);
                let data = frame
                    .lines()
                    .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
                    .collect::<Vec<_>>()
                    .join("\n");
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }
                let value: serde_json::Value = serde_json::from_str(&data)
                    .map_err(|_| AgenticSuperAppProviderError::InvalidResponse)?;
                let sequence = value
                    .get("sequence_number")
                    .and_then(serde_json::Value::as_i64)
                    .unwrap_or_else(|| {
                        fallback_sequence += 1;
                        fallback_sequence
                    });
                let event_type = value
                    .get("type")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default();
                let event = match event_type {
                    "response.output_text.delta" => ChatProviderStreamEvent {
                        provider_sequence: sequence,
                        kind: ChatProviderStreamEventKind::TextDelta,
                        text: value
                            .get("delta")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_owned),
                        input_tokens: None,
                        output_tokens: None,
                        error_code: None,
                    },
                    "response.reasoning_summary_text.delta" => ChatProviderStreamEvent {
                        provider_sequence: sequence,
                        kind: ChatProviderStreamEventKind::ReasoningSummary,
                        text: value
                            .get("delta")
                            .and_then(serde_json::Value::as_str)
                            .map(str::to_owned),
                        input_tokens: None,
                        output_tokens: None,
                        error_code: None,
                    },
                    "response.completed" => {
                        completed = true;
                        let usage = value
                            .get("response")
                            .and_then(|response| response.get("usage"));
                        ChatProviderStreamEvent {
                            provider_sequence: sequence,
                            kind: ChatProviderStreamEventKind::Completed,
                            text: None,
                            input_tokens: usage
                                .and_then(|item| item.get("input_tokens"))
                                .and_then(serde_json::Value::as_u64),
                            output_tokens: usage
                                .and_then(|item| item.get("output_tokens"))
                                .and_then(serde_json::Value::as_u64),
                            error_code: None,
                        }
                    }
                    "response.failed" | "response.incomplete" => ChatProviderStreamEvent {
                        provider_sequence: sequence,
                        kind: ChatProviderStreamEventKind::Failed,
                        text: None,
                        input_tokens: None,
                        output_tokens: None,
                        error_code: Some("provider_response_incomplete".to_owned()),
                    },
                    _ => continue,
                };
                on_event(event);
            }
        }
        if !completed {
            return Err(AgenticSuperAppProviderError::InvalidResponse);
        }
        Ok(())
    }

    async fn stream_agent_turn(
        &self,
        secret_reference: &str,
        request: AgentModelTurnRequest,
        cancellation: CancellationToken,
        on_event: Arc<dyn Fn(AgentProviderStreamEvent) + Send + Sync>,
    ) -> Result<(), AgenticSuperAppProviderError> {
        let input = request
            .input_items_json
            .iter()
            .map(|item| {
                serde_json::from_str::<serde_json::Value>(item)
                    .map_err(|_| AgenticSuperAppProviderError::InvalidResponse)
            })
            .collect::<Result<Vec<_>, _>>()?;
        let tools = request
            .tools
            .iter()
            .map(|tool| {
                let parameters = serde_json::from_str::<serde_json::Value>(&tool.input_schema_json)
                    .map_err(|_| AgenticSuperAppProviderError::InvalidResponse)?;
                Ok(json!({
                    "type": "function",
                    "name": tool.name,
                    "description": tool.description,
                    "parameters": parameters,
                    "strict": true,
                }))
            })
            .collect::<Result<Vec<serde_json::Value>, AgenticSuperAppProviderError>>()?;
        let payload = json!({
            "model": request.model,
            "instructions": request.system_instructions,
            "input": input,
            "tools": tools,
            "parallel_tool_calls": false,
            "stream": true,
            "store": false,
        });
        let response = self
            .client
            .post("https://api.openai.com/v1/responses")
            .bearer_auth(self.token(secret_reference)?)
            .json(&payload)
            .send()
            .await
            .map_err(|error| AgenticSuperAppProviderError::Request(error.to_string()))?;
        if !response.status().is_success() {
            return Err(AgenticSuperAppProviderError::Request(format!(
                "provider returned HTTP {}",
                response.status()
            )));
        }
        let mut body = response.bytes_stream();
        let mut buffer = String::new();
        let mut fallback_sequence = 0i64;
        let mut completed = false;
        let mut function_calls = HashMap::<String, (String, String)>::new();
        let mut emitted_calls = HashSet::<String>::new();
        loop {
            let next = tokio::select! {
                _ = cancellation.cancelled() => return Err(AgenticSuperAppProviderError::Cancelled),
                item = body.next() => item,
            };
            let Some(chunk) = next else { break };
            let chunk =
                chunk.map_err(|error| AgenticSuperAppProviderError::Request(error.to_string()))?;
            buffer.push_str(&String::from_utf8_lossy(&chunk));
            while let Some((frame, consumed)) =
                next_sse_frame(&buffer).map(|(frame, consumed)| (frame.to_owned(), consumed))
            {
                buffer.drain(..consumed);
                let data = frame
                    .lines()
                    .filter_map(|line| line.strip_prefix("data:").map(str::trim_start))
                    .collect::<Vec<_>>()
                    .join("\n");
                if data.is_empty() || data == "[DONE]" {
                    continue;
                }
                let value: serde_json::Value = serde_json::from_str(&data)
                    .map_err(|_| AgenticSuperAppProviderError::InvalidResponse)?;
                let sequence = value
                    .get("sequence_number")
                    .and_then(serde_json::Value::as_i64)
                    .unwrap_or_else(|| {
                        fallback_sequence += 1;
                        fallback_sequence
                    });
                let event_type = value
                    .get("type")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or_default();
                match event_type {
                    "response.output_text.delta" => on_event(AgentProviderStreamEvent {
                        provider_sequence: sequence,
                        kind: AgentProviderStreamEventKind::TextDelta,
                        text: value
                            .get("delta")
                            .and_then(|item| item.as_str())
                            .map(str::to_owned),
                        call_id: None,
                        name: None,
                        arguments_json: None,
                        item_json: None,
                        input_tokens: None,
                        output_tokens: None,
                        error_code: None,
                    }),
                    "response.reasoning_summary_text.delta"
                    | "response.reasoning_summary.delta" => on_event(AgentProviderStreamEvent {
                        provider_sequence: sequence,
                        kind: AgentProviderStreamEventKind::ReasoningSummary,
                        text: value
                            .get("delta")
                            .and_then(|item| item.as_str())
                            .map(str::to_owned),
                        call_id: None,
                        name: None,
                        arguments_json: None,
                        item_json: None,
                        input_tokens: None,
                        output_tokens: None,
                        error_code: None,
                    }),
                    "response.function_call_arguments.delta" => {
                        let call_id = value
                            .get("call_id")
                            .or_else(|| value.get("item_id"))
                            .and_then(|item| item.as_str())
                            .unwrap_or_default()
                            .to_owned();
                        if !call_id.is_empty() {
                            let entry = function_calls
                                .entry(call_id)
                                .or_insert_with(|| (String::new(), String::new()));
                            if let Some(name) = value.get("name").and_then(|item| item.as_str()) {
                                entry.0 = name.to_owned();
                            }
                            if let Some(delta) = value.get("delta").and_then(|item| item.as_str()) {
                                entry.1.push_str(delta);
                            }
                        }
                    }
                    "response.output_item.done" => {
                        let item = value
                            .get("item")
                            .cloned()
                            .unwrap_or(serde_json::Value::Null);
                        if item.get("type").and_then(|item| item.as_str()) == Some("function_call")
                        {
                            let call_id = item
                                .get("call_id")
                                .and_then(|item| item.as_str())
                                .unwrap_or_default()
                                .to_owned();
                            let name = item
                                .get("name")
                                .and_then(|item| item.as_str())
                                .unwrap_or_default()
                                .to_owned();
                            let arguments = item
                                .get("arguments")
                                .and_then(|item| item.as_str())
                                .map(str::to_owned)
                                .unwrap_or_else(|| {
                                    function_calls
                                        .get(&call_id)
                                        .map(|(_, arguments)| arguments.clone())
                                        .unwrap_or_else(|| "{}".to_owned())
                                });
                            if !call_id.is_empty() && emitted_calls.insert(call_id.clone()) {
                                on_event(AgentProviderStreamEvent {
                                    provider_sequence: sequence,
                                    kind: AgentProviderStreamEventKind::FunctionCall,
                                    text: None,
                                    call_id: Some(call_id),
                                    name: Some(name),
                                    arguments_json: Some(arguments),
                                    item_json: Some(item.to_string()),
                                    input_tokens: None,
                                    output_tokens: None,
                                    error_code: None,
                                });
                            }
                        } else {
                            on_event(AgentProviderStreamEvent {
                                provider_sequence: sequence,
                                kind: AgentProviderStreamEventKind::OutputItem,
                                text: None,
                                call_id: None,
                                name: None,
                                arguments_json: None,
                                item_json: Some(item.to_string()),
                                input_tokens: None,
                                output_tokens: None,
                                error_code: None,
                            });
                        }
                    }
                    "response.completed" => {
                        if let Some(output) = value
                            .get("response")
                            .and_then(|response| response.get("output"))
                            .and_then(|output| output.as_array())
                        {
                            for item in output {
                                if item.get("type").and_then(|item| item.as_str())
                                    != Some("function_call")
                                {
                                    continue;
                                }
                                let call_id = item
                                    .get("call_id")
                                    .and_then(|item| item.as_str())
                                    .unwrap_or_default()
                                    .to_owned();
                                if call_id.is_empty() || !emitted_calls.insert(call_id.clone()) {
                                    continue;
                                }
                                let (fallback_name, fallback_arguments) = function_calls
                                    .get(&call_id)
                                    .cloned()
                                    .unwrap_or_else(|| (String::new(), "{}".to_owned()));
                                on_event(AgentProviderStreamEvent {
                                    provider_sequence: sequence,
                                    kind: AgentProviderStreamEventKind::FunctionCall,
                                    text: None,
                                    call_id: Some(call_id),
                                    name: Some(
                                        item.get("name")
                                            .and_then(|value| value.as_str())
                                            .unwrap_or(&fallback_name)
                                            .to_owned(),
                                    ),
                                    arguments_json: Some(
                                        item.get("arguments")
                                            .and_then(|value| value.as_str())
                                            .unwrap_or(&fallback_arguments)
                                            .to_owned(),
                                    ),
                                    item_json: Some(item.to_string()),
                                    input_tokens: None,
                                    output_tokens: None,
                                    error_code: None,
                                });
                            }
                        }
                        let usage = value
                            .get("response")
                            .and_then(|response| response.get("usage"));
                        on_event(AgentProviderStreamEvent {
                            provider_sequence: sequence,
                            kind: AgentProviderStreamEventKind::Completed,
                            text: None,
                            call_id: None,
                            name: None,
                            arguments_json: None,
                            item_json: None,
                            input_tokens: usage
                                .and_then(|item| item.get("input_tokens"))
                                .and_then(|item| item.as_u64()),
                            output_tokens: usage
                                .and_then(|item| item.get("output_tokens"))
                                .and_then(|item| item.as_u64()),
                            error_code: None,
                        });
                        completed = true;
                    }
                    "response.failed" | "response.incomplete" => {
                        on_event(AgentProviderStreamEvent {
                            provider_sequence: sequence,
                            kind: AgentProviderStreamEventKind::Failed,
                            text: None,
                            call_id: None,
                            name: None,
                            arguments_json: None,
                            item_json: None,
                            input_tokens: None,
                            output_tokens: None,
                            error_code: Some("provider_response_incomplete".to_owned()),
                        });
                        return Err(AgenticSuperAppProviderError::Request(
                            "provider reported an incomplete response".to_owned(),
                        ));
                    }
                    _ => {}
                }
            }
        }
        if !completed {
            return Err(AgenticSuperAppProviderError::InvalidResponse);
        }
        Ok(())
    }
}

fn next_sse_frame(buffer: &str) -> Option<(&str, usize)> {
    let lf = buffer.find("\n\n").map(|index| (index, 2));
    let crlf = buffer.find("\r\n\r\n").map(|index| (index, 4));
    match (lf, crlf) {
        (Some(left), Some(right)) if left.0 <= right.0 => {
            Some((&buffer[..left.0], left.0 + left.1))
        }
        (Some(left), None) => Some((&buffer[..left.0], left.0 + left.1)),
        (_, Some(right)) => Some((&buffer[..right.0], right.0 + right.1)),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::next_sse_frame;

    #[test]
    fn sse_parser_handles_fragmented_lf_and_crlf_frames() {
        let lf = "data: {\"type\":\"response.output_text.delta\"}\n\nrest";
        let (frame, consumed) = next_sse_frame(lf).expect("LF frame");
        assert_eq!(frame, "data: {\"type\":\"response.output_text.delta\"}");
        assert_eq!(&lf[consumed..], "rest");

        let crlf = "data: {\"type\":\"response.completed\"}\r\n\r\nrest";
        let (frame, consumed) = next_sse_frame(crlf).expect("CRLF frame");
        assert_eq!(frame, "data: {\"type\":\"response.completed\"}");
        assert_eq!(&crlf[consumed..], "rest");
    }

    #[test]
    fn sse_parser_waits_for_a_complete_frame() {
        assert!(next_sse_frame("data: incomplete").is_none());
    }
}
