use hiveory_protocol::{ChatMessage, ChatMessagePart, ChatReasoningEffort, ChatSendRequest};
use thiserror::Error;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum HiveoryChatDomainError {
    #[error("a conversation ID is required")]
    MissingConversation,
    #[error("a branch ID is required")]
    MissingBranch,
    #[error("a provider account is required")]
    MissingProvider,
    #[error("a model ID is required")]
    MissingModel,
    #[error("a message or attachment is required")]
    EmptyTurn,
}

pub fn validate_send_request(request: &ChatSendRequest) -> Result<(), HiveoryChatDomainError> {
    if request.conversation_id.trim().is_empty() {
        return Err(HiveoryChatDomainError::MissingConversation);
    }
    if request.branch_id.trim().is_empty() {
        return Err(HiveoryChatDomainError::MissingBranch);
    }
    if request.provider_account_id.trim().is_empty() {
        return Err(HiveoryChatDomainError::MissingProvider);
    }
    if request.model.trim().is_empty() {
        return Err(HiveoryChatDomainError::MissingModel);
    }
    if request.text.trim().is_empty() && request.attachment_ids.is_empty() {
        return Err(HiveoryChatDomainError::EmptyTurn);
    }
    Ok(())
}

pub fn estimate_context_tokens(messages: &[ChatMessage]) -> u64 {
    messages
        .iter()
        .flat_map(|message| message.parts.iter())
        .map(|part| match part {
            ChatMessagePart::Text { text }
            | ChatMessagePart::ReasoningSummary { text }
            | ChatMessagePart::Status { text, .. } => text.len() as u64,
            ChatMessagePart::Error { message, .. } => message.len() as u64,
            ChatMessagePart::Attachment { attachment } | ChatMessagePart::Image { attachment } => {
                attachment.bytes.max(0) as u64 / 4
            }
            ChatMessagePart::Citation { url, title } => {
                url.len() as u64 + title.as_deref().unwrap_or_default().len() as u64
            }
            ChatMessagePart::Usage {
                input_tokens,
                output_tokens,
            } => input_tokens.unwrap_or_default() + output_tokens.unwrap_or_default(),
            ChatMessagePart::ToolCall {
                name,
                arguments_json,
                ..
            } => (name.len() + arguments_json.len()) as u64,
            ChatMessagePart::ToolResult { result, .. } => result.len() as u64,
        })
        .sum::<u64>()
        .div_ceil(3)
}

pub fn reasoning_value(value: ChatReasoningEffort) -> &'static str {
    match value {
        ChatReasoningEffort::Auto => "auto",
        ChatReasoningEffort::Low => "low",
        ChatReasoningEffort::Medium => "medium",
        ChatReasoningEffort::High => "high",
        ChatReasoningEffort::Xhigh => "xhigh",
        ChatReasoningEffort::Max => "max",
        ChatReasoningEffort::Ultra => "ultra",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hiveory_protocol::{ChatAttachmentSummary, ChatMessagePart, ChatMessageRole};

    fn request() -> ChatSendRequest {
        ChatSendRequest {
            conversation_id: "conversation".to_owned(),
            branch_id: "branch".to_owned(),
            text: "hello".to_owned(),
            attachment_ids: Vec::new(),
            provider_account_id: "provider".to_owned(),
            model: "model".to_owned(),
            reasoning_effort: ChatReasoningEffort::Auto,
        }
    }

    #[test]
    fn validation_rejects_empty_turns() {
        let mut value = request();
        value.text.clear();
        assert_eq!(
            validate_send_request(&value),
            Err(HiveoryChatDomainError::EmptyTurn)
        );
    }

    #[test]
    fn context_estimate_accounts_for_typed_parts() {
        let messages = vec![ChatMessage {
            id: "message".to_owned(),
            branch_id: "branch".to_owned(),
            role: ChatMessageRole::User,
            parts: vec![
                ChatMessagePart::Text {
                    text: "123456".to_owned(),
                },
                ChatMessagePart::Attachment {
                    attachment: ChatAttachmentSummary {
                        id: "a".to_owned(),
                        display_name: "a.txt".to_owned(),
                        mime_type: "text/plain".to_owned(),
                        bytes: 12,
                        sha256: "hash".to_owned(),
                    },
                },
            ],
            created_at_unix_ms: 0,
            turn_id: None,
        }];
        assert!(estimate_context_tokens(&messages) > 0);
    }
}
