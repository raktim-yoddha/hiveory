use super::HiveoryPersistence;
use hiveory_protocol::{
    ChatAttachmentSummary, ChatBranchSummary, ChatConversationDetail, ChatConversationSummary,
    ChatCreateRequest, ChatDraftRequest, ChatEventEnvelope, ChatMessage, ChatMessagePart,
    ChatMessageRole, ChatMetadataRequest, ChatProviderStreamEvent, ChatProviderStreamEventKind,
    ChatReasoningEffort, ChatSendRequest, ChatSidebarPage, ChatSidebarQuery, ChatTurnState,
    ChatTurnSummary,
};
use serde_json::{json, Value};
use sqlx::{sqlite::SqliteRow, Row, Sqlite, Transaction};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum HiveoryChatStoreError {
    #[error("chat conversation was not found")]
    NotFound,
    #[error("chat command conflicts with an active turn")]
    ActiveTurn,
    #[error("chat input is invalid: {0}")]
    InvalidInput(String),
    #[error("chat state is inconsistent")]
    Inconsistent,
    #[error("database failure: {0}")]
    Database(#[from] sqlx::Error),
    #[error("serialization failure: {0}")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Debug, Clone)]
pub struct HiveoryChatTurnStart {
    pub conversation_id: String,
    pub branch_id: String,
    pub turn_id: String,
    pub user_message_id: String,
    pub assistant_message_id: String,
    pub job_id: Option<String>,
    pub already_started: bool,
}

#[derive(Debug, Clone)]
pub struct HiveoryChatStoredAttachment {
    pub summary: ChatAttachmentSummary,
    pub relative_path: String,
}

struct ChatEventInput<'a> {
    conversation_id: &'a str,
    branch_id: Option<&'a str>,
    turn_id: Option<&'a str>,
    message_id: Option<&'a str>,
    kind: &'a str,
    payload: Value,
    provider_sequence: Option<i64>,
}

#[derive(Clone)]
pub struct HiveoryChatStore {
    persistence: HiveoryPersistence,
}

impl HiveoryChatStore {
    pub fn new(persistence: HiveoryPersistence) -> Self {
        Self { persistence }
    }

    pub async fn create(
        &self,
        request: &ChatCreateRequest,
        command_request_id: Option<&str>,
    ) -> Result<ChatConversationDetail, HiveoryChatStoreError> {
        if let Some(command_request_id) = command_request_id {
            if let Some(row) =
                sqlx::query("SELECT id FROM hiveory_chat_conversations WHERE command_request_id=?")
                    .bind(command_request_id)
                    .fetch_optional(self.persistence.pool())
                    .await?
            {
                return self.detail(&row.get::<String, _>(0)).await;
            }
        }
        let conversation_id = Uuid::now_v7().to_string();
        let branch_id = Uuid::now_v7().to_string();
        let title = normalized_title(request.title.as_deref());
        let now = now_ms();
        let mut tx = self.persistence.pool().begin().await?;
        sqlx::query("INSERT INTO hiveory_chat_conversations (id, title, active_branch_id, command_request_id, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?)")
            .bind(&conversation_id).bind(&title).bind(&branch_id).bind(command_request_id).bind(now).bind(now)
            .execute(&mut *tx).await?;
        sqlx::query("INSERT INTO hiveory_chat_branches (id, conversation_id, label, created_at_unix_ms) VALUES (?, ?, 'Main', ?)")
            .bind(&branch_id).bind(&conversation_id).bind(now).execute(&mut *tx).await?;
        append_event(
            &mut tx,
            ChatEventInput {
                conversation_id: &conversation_id,
                branch_id: Some(&branch_id),
                turn_id: None,
                message_id: None,
                kind: "conversation_created",
                payload: json!({ "title": title }),
                provider_sequence: None,
            },
        )
        .await?;
        tx.commit().await?;
        self.detail(&conversation_id).await
    }

    pub async fn sidebar(
        &self,
        query: &ChatSidebarQuery,
    ) -> Result<ChatSidebarPage, HiveoryChatStoreError> {
        let limit = i64::from(query.limit.unwrap_or(50).clamp(1, 100));
        let search = query.search.clone().unwrap_or_default().trim().to_owned();
        let pattern = format!("%{}%", search.replace('%', "\\%").replace('_', "\\_"));
        let rows = sqlx::query(
            "SELECT c.id, c.title, c.active_branch_id, c.pinned, c.archived, c.updated_at_unix_ms,
                (SELECT substr(json_extract(p.payload_json, '$.text'), 1, 160)
                 FROM hiveory_chat_messages m
                 JOIN hiveory_chat_message_parts p ON p.message_id=m.id AND p.kind='text'
                 WHERE m.conversation_id=c.id ORDER BY m.created_at_unix_ms DESC LIMIT 1) AS preview
             FROM hiveory_chat_conversations c
             WHERE c.archived=? AND (c.title LIKE ? ESCAPE '\\' OR EXISTS (
                 SELECT 1 FROM hiveory_chat_messages sm
                 JOIN hiveory_chat_message_parts sp ON sp.message_id=sm.id AND sp.kind='text'
                 WHERE sm.conversation_id=c.id AND sp.payload_json LIKE ? ESCAPE '\\'))
             ORDER BY c.pinned DESC, c.updated_at_unix_ms DESC LIMIT ?",
        )
        .bind(if query.archived { 1 } else { 0 })
        .bind(&pattern)
        .bind(&pattern)
        .bind(limit)
        .fetch_all(self.persistence.pool())
        .await?;
        Ok(ChatSidebarPage {
            conversations: rows
                .into_iter()
                .map(conversation_summary_from_row)
                .collect(),
            next_cursor: None,
        })
    }

    pub async fn detail(
        &self,
        conversation_id: &str,
    ) -> Result<ChatConversationDetail, HiveoryChatStoreError> {
        let conversation = sqlx::query("SELECT id, title, active_branch_id, pinned, archived, created_at_unix_ms, updated_at_unix_ms FROM hiveory_chat_conversations WHERE id=?")
            .bind(conversation_id).fetch_optional(self.persistence.pool()).await?
            .ok_or(HiveoryChatStoreError::NotFound)?;
        let branches = sqlx::query("SELECT b.id, b.parent_branch_id, b.forked_after_message_id, b.label, b.created_at_unix_ms, c.active_branch_id FROM hiveory_chat_branches b JOIN hiveory_chat_conversations c ON c.id=b.conversation_id WHERE b.conversation_id=? ORDER BY b.created_at_unix_ms")
            .bind(conversation_id).fetch_all(self.persistence.pool()).await?
            .into_iter().map(branch_from_row).collect();
        let active_branch_id: String = conversation.get(2);
        let messages = self.messages(conversation_id, &active_branch_id).await?;
        let turns = sqlx::query("SELECT id, message_id, assistant_message_id, branch_id, provider_account_id, model, reasoning_effort, state, job_id, input_tokens, output_tokens, created_at_unix_ms, updated_at_unix_ms FROM hiveory_chat_turns WHERE conversation_id=? ORDER BY created_at_unix_ms")
            .bind(conversation_id).fetch_all(self.persistence.pool()).await?
            .into_iter().filter_map(|row| turn_from_row(row).ok()).collect();
        let draft = sqlx::query("SELECT draft FROM hiveory_chat_drafts WHERE conversation_id=?")
            .bind(conversation_id)
            .fetch_optional(self.persistence.pool())
            .await?
            .map(|row| row.get(0))
            .unwrap_or_default();
        let event_cursor: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(global_sequence), 0) FROM hiveory_chat_events WHERE conversation_id=?")
            .bind(conversation_id).fetch_one(self.persistence.pool()).await?;
        Ok(ChatConversationDetail {
            id: conversation.get(0),
            title: conversation.get(1),
            active_branch_id,
            pinned: conversation.get::<i64, _>(3) != 0,
            archived: conversation.get::<i64, _>(4) != 0,
            branches,
            messages,
            turns,
            draft,
            event_cursor,
            created_at_unix_ms: conversation.get(5),
            updated_at_unix_ms: conversation.get(6),
        })
    }

    async fn messages(
        &self,
        conversation_id: &str,
        branch_id: &str,
    ) -> Result<Vec<ChatMessage>, HiveoryChatStoreError> {
        let rows = sqlx::query("SELECT id, branch_id, role, turn_id, created_at_unix_ms FROM hiveory_chat_messages WHERE conversation_id=? AND branch_id=? ORDER BY branch_position")
            .bind(conversation_id).bind(branch_id).fetch_all(self.persistence.pool()).await?;
        let mut result = Vec::with_capacity(rows.len());
        for row in rows {
            let id: String = row.get(0);
            let parts = sqlx::query("SELECT kind, payload_json FROM hiveory_chat_message_parts WHERE message_id=? ORDER BY ordinal")
                .bind(&id).fetch_all(self.persistence.pool()).await?
                .into_iter().map(part_from_row).collect::<Result<Vec<_>, _>>()?;
            result.push(ChatMessage {
                id,
                branch_id: row.get(1),
                role: message_role(&row.get::<String, _>(2))?,
                parts,
                created_at_unix_ms: row.get(4),
                turn_id: row.get(3),
            });
        }
        Ok(result)
    }

    pub async fn save_draft(
        &self,
        request: &ChatDraftRequest,
    ) -> Result<(), HiveoryChatStoreError> {
        self.require_conversation(&request.conversation_id).await?;
        sqlx::query("INSERT INTO hiveory_chat_drafts (conversation_id, draft, updated_at_unix_ms) VALUES (?, ?, ?) ON CONFLICT(conversation_id) DO UPDATE SET draft=excluded.draft, updated_at_unix_ms=excluded.updated_at_unix_ms")
            .bind(&request.conversation_id).bind(&request.draft).bind(now_ms()).execute(self.persistence.pool()).await?;
        Ok(())
    }

    pub async fn update_metadata(
        &self,
        request: &ChatMetadataRequest,
    ) -> Result<ChatConversationDetail, HiveoryChatStoreError> {
        let mut tx = self.persistence.pool().begin().await?;
        let current = sqlx::query(
            "SELECT title, pinned, archived FROM hiveory_chat_conversations WHERE id=?",
        )
        .bind(&request.conversation_id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(HiveoryChatStoreError::NotFound)?;
        let title = request
            .title
            .as_deref()
            .map(|value| normalized_title(Some(value)))
            .unwrap_or_else(|| current.get(0));
        let pinned = request
            .pinned
            .map(i64::from)
            .unwrap_or_else(|| current.get(1));
        let archived = request
            .archived
            .map(i64::from)
            .unwrap_or_else(|| current.get(2));
        sqlx::query("UPDATE hiveory_chat_conversations SET title=?, pinned=?, archived=?, updated_at_unix_ms=? WHERE id=?")
            .bind(&title).bind(pinned).bind(archived).bind(now_ms()).bind(&request.conversation_id).execute(&mut *tx).await?;
        append_event(&mut tx, ChatEventInput {
            conversation_id: &request.conversation_id,
            branch_id: None,
            turn_id: None,
            message_id: None,
            kind: "conversation_metadata_updated",
            payload: json!({ "title": title, "pinned": pinned != 0, "archived": archived != 0 }),
            provider_sequence: None,
        })
        .await?;
        tx.commit().await?;
        self.detail(&request.conversation_id).await
    }

    pub async fn register_attachment(
        &self,
        attachment: &ChatAttachmentSummary,
        relative_path: &str,
    ) -> Result<ChatAttachmentSummary, HiveoryChatStoreError> {
        sqlx::query("INSERT OR IGNORE INTO hiveory_chat_attachments (id, display_name, mime_type, byte_count, sha256, relative_path, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(&attachment.id).bind(&attachment.display_name).bind(&attachment.mime_type).bind(attachment.bytes).bind(&attachment.sha256).bind(relative_path).bind(now_ms()).execute(self.persistence.pool()).await?;
        Ok(sqlx::query("SELECT id, display_name, mime_type, byte_count, sha256 FROM hiveory_chat_attachments WHERE sha256=?")
            .bind(&attachment.sha256).fetch_one(self.persistence.pool()).await.map(attachment_from_row)?)
    }

    pub async fn attach_to_message(
        &self,
        conversation_id: &str,
        message_id: &str,
        attachment_ids: &[String],
    ) -> Result<(), HiveoryChatStoreError> {
        self.require_conversation(conversation_id).await?;
        let message_exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM hiveory_chat_messages WHERE id=? AND conversation_id=?)",
        )
        .bind(message_id)
        .bind(conversation_id)
        .fetch_one(self.persistence.pool())
        .await?;
        if !message_exists {
            return Err(HiveoryChatStoreError::NotFound);
        }
        for attachment_id in attachment_ids {
            let attachment = sqlx::query("SELECT display_name, mime_type, byte_count, sha256 FROM hiveory_chat_attachments WHERE id=?")
                .bind(attachment_id).fetch_optional(self.persistence.pool()).await?
                .ok_or(HiveoryChatStoreError::NotFound)?;
            let inserted = sqlx::query("INSERT OR IGNORE INTO hiveory_chat_message_attachments (message_id, attachment_id) VALUES (?, ?)")
                .bind(message_id).bind(attachment_id).execute(self.persistence.pool()).await?;
            if inserted.rows_affected() > 0 {
                let ordinal: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(ordinal), -1) + 1 FROM hiveory_chat_message_parts WHERE message_id=?").bind(message_id).fetch_one(self.persistence.pool()).await?;
                let kind = if attachment.get::<String, _>(1).starts_with("image/") {
                    "image"
                } else {
                    "attachment"
                };
                let summary = json!({ "attachment": { "id": attachment_id, "display_name": attachment.get::<String, _>(0), "mime_type": attachment.get::<String, _>(1), "bytes": attachment.get::<i64, _>(2), "sha256": attachment.get::<String, _>(3) } });
                sqlx::query("INSERT INTO hiveory_chat_message_parts (message_id, ordinal, kind, payload_json) VALUES (?, ?, ?, ?)").bind(message_id).bind(ordinal).bind(kind).bind(serde_json::to_string(&summary)?).execute(self.persistence.pool()).await?;
            }
        }
        Ok(())
    }

    pub async fn remove_attachment(
        &self,
        conversation_id: &str,
        message_id: &str,
        attachment_id: &str,
    ) -> Result<Option<String>, HiveoryChatStoreError> {
        let mut tx = self.persistence.pool().begin().await?;
        let relative_path: Option<String> = sqlx::query_scalar("SELECT a.relative_path FROM hiveory_chat_attachments a JOIN hiveory_chat_message_attachments ma ON ma.attachment_id=a.id JOIN hiveory_chat_messages m ON m.id=ma.message_id WHERE m.conversation_id=? AND m.id=? AND a.id=?")
            .bind(conversation_id).bind(message_id).bind(attachment_id).fetch_optional(&mut *tx).await?;
        let Some(relative_path) = relative_path else {
            return Err(HiveoryChatStoreError::NotFound);
        };
        sqlx::query(
            "DELETE FROM hiveory_chat_message_attachments WHERE message_id=? AND attachment_id=?",
        )
        .bind(message_id)
        .bind(attachment_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query("DELETE FROM hiveory_chat_message_parts WHERE message_id=? AND kind IN ('attachment','image') AND payload_json LIKE ?").bind(message_id).bind(format!("%\\\"id\\\":\\\"{attachment_id}\\\"%" )).execute(&mut *tx).await?;
        let remaining: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM hiveory_chat_message_attachments WHERE attachment_id=?",
        )
        .bind(attachment_id)
        .fetch_one(&mut *tx)
        .await?;
        if remaining == 0 {
            sqlx::query("DELETE FROM hiveory_chat_attachments WHERE id=?")
                .bind(attachment_id)
                .execute(&mut *tx)
                .await?;
        }
        tx.commit().await?;
        Ok((remaining == 0).then_some(relative_path))
    }

    pub async fn start_turn(
        &self,
        request: &ChatSendRequest,
        job_id: Option<&str>,
        command_request_id: Option<&str>,
    ) -> Result<HiveoryChatTurnStart, HiveoryChatStoreError> {
        if request.text.trim().is_empty() && request.attachment_ids.is_empty() {
            return Err(HiveoryChatStoreError::InvalidInput(
                "a message or attachment is required".to_owned(),
            ));
        }
        self.start_turn_internal(request, job_id, None, None, command_request_id)
            .await
    }

    pub async fn turn_for_command(
        &self,
        command_request_id: &str,
    ) -> Result<Option<HiveoryChatTurnStart>, HiveoryChatStoreError> {
        Ok(sqlx::query("SELECT conversation_id, branch_id, id, message_id, assistant_message_id, job_id FROM hiveory_chat_turns WHERE command_request_id=?")
            .bind(command_request_id)
            .fetch_optional(self.persistence.pool())
            .await?
            .map(|row| HiveoryChatTurnStart {
                conversation_id: row.get(0),
                branch_id: row.get(1),
                turn_id: row.get(2),
                user_message_id: row.get(3),
                assistant_message_id: row.get(4),
                job_id: row.get(5),
                already_started: true,
            }))
    }

    pub async fn turn_configuration(
        &self,
        conversation_id: &str,
        turn_id: &str,
    ) -> Result<Option<(String, String)>, HiveoryChatStoreError> {
        Ok(sqlx::query(
            "SELECT provider_account_id, model FROM hiveory_chat_turns WHERE conversation_id=? AND id=?",
        )
        .bind(conversation_id)
        .bind(turn_id)
        .fetch_optional(self.persistence.pool())
        .await?
        .map(|row| (row.get(0), row.get(1))))
    }

    async fn start_turn_internal(
        &self,
        request: &ChatSendRequest,
        job_id: Option<&str>,
        existing_user_message_id: Option<&str>,
        user_text_override: Option<&str>,
        command_request_id: Option<&str>,
    ) -> Result<HiveoryChatTurnStart, HiveoryChatStoreError> {
        let mut tx = self.persistence.pool().begin().await?;
        if let Some(command_request_id) = command_request_id {
            if let Some(row) = sqlx::query("SELECT conversation_id, branch_id, id, message_id, assistant_message_id, job_id FROM hiveory_chat_turns WHERE command_request_id=?")
                .bind(command_request_id)
                .fetch_optional(&mut *tx)
                .await?
            {
                tx.rollback().await?;
                return Ok(HiveoryChatTurnStart {
                    conversation_id: row.get(0),
                    branch_id: row.get(1),
                    turn_id: row.get(2),
                    user_message_id: row.get(3),
                    assistant_message_id: row.get(4),
                    job_id: row.get(5),
                    already_started: true,
                });
            }
        }
        let conversation_exists: bool = sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM hiveory_chat_conversations WHERE id=? AND active_branch_id=?)")
            .bind(&request.conversation_id).bind(&request.branch_id).fetch_one(&mut *tx).await?;
        if !conversation_exists {
            return Err(HiveoryChatStoreError::NotFound);
        }
        let active: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hiveory_chat_turns WHERE conversation_id=? AND state IN ('queued','streaming','cancel_requested')")
            .bind(&request.conversation_id).fetch_one(&mut *tx).await?;
        if active > 0 {
            return Err(HiveoryChatStoreError::ActiveTurn);
        }
        let now = now_ms();
        let (user_message_id, user_position) = if let Some(id) = existing_user_message_id {
            let row = sqlx::query("SELECT id, branch_position FROM hiveory_chat_messages WHERE id=? AND conversation_id=? AND branch_id=? AND role='user'")
                .bind(id).bind(&request.conversation_id).bind(&request.branch_id).fetch_optional(&mut *tx).await?
                .ok_or(HiveoryChatStoreError::NotFound)?;
            (row.get(0), row.get(1))
        } else {
            let position: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(branch_position), -1) + 1 FROM hiveory_chat_messages WHERE branch_id=?")
                .bind(&request.branch_id).fetch_one(&mut *tx).await?;
            let id = Uuid::now_v7().to_string();
            sqlx::query("INSERT INTO hiveory_chat_messages (id, conversation_id, branch_id, role, status, branch_position, created_at_unix_ms) VALUES (?, ?, ?, 'user', 'complete', ?, ?)")
                .bind(&id).bind(&request.conversation_id).bind(&request.branch_id).bind(position).bind(now).execute(&mut *tx).await?;
            let text = user_text_override.unwrap_or(&request.text);
            let mut ordinal = 0;
            if !text.trim().is_empty() {
                insert_part(&mut tx, &id, ordinal, "text", json!({ "text": text })).await?;
                ordinal += 1;
            }
            for attachment_id in &request.attachment_ids {
                let attachment = sqlx::query("SELECT display_name, mime_type, byte_count, sha256 FROM hiveory_chat_attachments WHERE id=?")
                    .bind(attachment_id).fetch_optional(&mut *tx).await?
                    .ok_or(HiveoryChatStoreError::NotFound)?;
                sqlx::query("INSERT INTO hiveory_chat_message_attachments (message_id, attachment_id) VALUES (?, ?)")
                    .bind(&id).bind(attachment_id).execute(&mut *tx).await?;
                let summary = json!({ "attachment": { "id": attachment_id, "display_name": attachment.get::<String, _>(0), "mime_type": attachment.get::<String, _>(1), "bytes": attachment.get::<i64, _>(2), "sha256": attachment.get::<String, _>(3) } });
                let kind = if attachment.get::<String, _>(1).starts_with("image/") {
                    "image"
                } else {
                    "attachment"
                };
                insert_part(&mut tx, &id, ordinal, kind, summary).await?;
                ordinal += 1;
            }
            (id, position)
        };
        let assistant_message_id = Uuid::now_v7().to_string();
        let assistant_position = user_position + 1;
        sqlx::query("INSERT INTO hiveory_chat_messages (id, conversation_id, branch_id, role, status, branch_position, turn_id, created_at_unix_ms) VALUES (?, ?, ?, 'assistant', 'streaming', ?, ?, ?)")
            .bind(&assistant_message_id).bind(&request.conversation_id).bind(&request.branch_id).bind(assistant_position).bind::<Option<&str>>(None).bind(now).execute(&mut *tx).await?;
        let turn_id = Uuid::now_v7().to_string();
        sqlx::query("UPDATE hiveory_chat_messages SET turn_id=? WHERE id=?")
            .bind(&turn_id)
            .bind(&assistant_message_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("INSERT INTO hiveory_chat_turns (id, conversation_id, branch_id, message_id, assistant_message_id, provider_account_id, model, reasoning_effort, state, job_id, command_request_id, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?, ?, ?)")
            .bind(&turn_id).bind(&request.conversation_id).bind(&request.branch_id).bind(&user_message_id).bind(&assistant_message_id).bind(&request.provider_account_id).bind(&request.model).bind(reasoning_value(&request.reasoning_effort)).bind(job_id).bind(command_request_id).bind(now).bind(now).execute(&mut *tx).await?;
        append_event(
            &mut tx,
            ChatEventInput {
                conversation_id: &request.conversation_id,
                branch_id: Some(&request.branch_id),
                turn_id: Some(&turn_id),
                message_id: Some(&user_message_id),
                kind: "user_message_created",
                payload: json!({ "message_id": user_message_id }),
                provider_sequence: None,
            },
        )
        .await?;
        append_event(&mut tx, ChatEventInput {
            conversation_id: &request.conversation_id,
            branch_id: Some(&request.branch_id),
            turn_id: Some(&turn_id),
            message_id: Some(&assistant_message_id),
            kind: "turn_started",
            payload: json!({ "model": request.model, "reasoning_effort": reasoning_value(&request.reasoning_effort) }),
            provider_sequence: None,
        }).await?;
        sqlx::query("UPDATE hiveory_chat_conversations SET updated_at_unix_ms=? WHERE id=?")
            .bind(now)
            .bind(&request.conversation_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(HiveoryChatTurnStart {
            conversation_id: request.conversation_id.clone(),
            branch_id: request.branch_id.clone(),
            turn_id,
            user_message_id,
            assistant_message_id,
            job_id: job_id.map(str::to_owned),
            already_started: false,
        })
    }

    pub async fn apply_provider_event(
        &self,
        conversation_id: &str,
        turn_id: &str,
        event: &ChatProviderStreamEvent,
    ) -> Result<Option<ChatEventEnvelope>, HiveoryChatStoreError> {
        let mut tx = self.persistence.pool().begin().await?;
        let turn = sqlx::query("SELECT branch_id, assistant_message_id, state FROM hiveory_chat_turns WHERE id=? AND conversation_id=?")
            .bind(turn_id).bind(conversation_id).fetch_optional(&mut *tx).await?
            .ok_or(HiveoryChatStoreError::NotFound)?;
        if event.provider_sequence >= 0 {
            let already_seen: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hiveory_chat_events WHERE turn_id=? AND provider_sequence_start=?")
                .bind(turn_id).bind(event.provider_sequence).fetch_one(&mut *tx).await?;
            if already_seen > 0 {
                tx.rollback().await?;
                return Ok(None);
            }
        }
        let branch_id: String = turn.get(0);
        let assistant_message_id: String = turn.get(1);
        let state: String = turn.get(2);
        if matches!(
            state.as_str(),
            "completed" | "failed" | "cancelled" | "interrupted"
        ) {
            tx.rollback().await?;
            return Ok(None);
        }
        let (kind, payload) = match event.kind {
            ChatProviderStreamEventKind::TextDelta => {
                let delta = event.text.clone().unwrap_or_default();
                if delta.is_empty() {
                    tx.rollback().await?;
                    return Ok(None);
                }
                append_text_part(&mut tx, &assistant_message_id, &delta).await?;
                sqlx::query("UPDATE hiveory_chat_turns SET state='streaming', updated_at_unix_ms=? WHERE id=?").bind(now_ms()).bind(turn_id).execute(&mut *tx).await?;
                sqlx::query("UPDATE hiveory_chat_messages SET status='streaming' WHERE id=?")
                    .bind(&assistant_message_id)
                    .execute(&mut *tx)
                    .await?;
                ("assistant_text_appended", json!({ "text": delta }))
            }
            ChatProviderStreamEventKind::ReasoningSummary => {
                let summary = event.text.clone().unwrap_or_default();
                if summary.is_empty() {
                    tx.rollback().await?;
                    return Ok(None);
                }
                let ordinal: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(ordinal), -1) + 1 FROM hiveory_chat_message_parts WHERE message_id=?").bind(&assistant_message_id).fetch_one(&mut *tx).await?;
                insert_part(
                    &mut tx,
                    &assistant_message_id,
                    ordinal,
                    "reasoning_summary",
                    json!({ "text": summary }),
                )
                .await?;
                ("assistant_reasoning_summary", json!({ "text": event.text }))
            }
            ChatProviderStreamEventKind::Usage => {
                let ordinal: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(ordinal), -1) + 1 FROM hiveory_chat_message_parts WHERE message_id=?").bind(&assistant_message_id).fetch_one(&mut *tx).await?;
                insert_part(&mut tx, &assistant_message_id, ordinal, "usage", json!({ "input_tokens": event.input_tokens, "output_tokens": event.output_tokens })).await?;
                sqlx::query("UPDATE hiveory_chat_turns SET input_tokens=?, output_tokens=?, updated_at_unix_ms=? WHERE id=?")
                    .bind(event.input_tokens.map(|v| v as i64)).bind(event.output_tokens.map(|v| v as i64)).bind(now_ms()).bind(turn_id).execute(&mut *tx).await?;
                (
                    "turn_usage_recorded",
                    json!({ "input_tokens": event.input_tokens, "output_tokens": event.output_tokens }),
                )
            }
            ChatProviderStreamEventKind::Completed => {
                if event.input_tokens.is_some() || event.output_tokens.is_some() {
                    let ordinal: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(ordinal), -1) + 1 FROM hiveory_chat_message_parts WHERE message_id=?").bind(&assistant_message_id).fetch_one(&mut *tx).await?;
                    insert_part(&mut tx, &assistant_message_id, ordinal, "usage", json!({ "input_tokens": event.input_tokens, "output_tokens": event.output_tokens })).await?;
                }
                sqlx::query("UPDATE hiveory_chat_turns SET state='completed', input_tokens=?, output_tokens=?, updated_at_unix_ms=? WHERE id=?")
                    .bind(event.input_tokens.map(|v| v as i64)).bind(event.output_tokens.map(|v| v as i64)).bind(now_ms()).bind(turn_id).execute(&mut *tx).await?;
                sqlx::query("UPDATE hiveory_chat_messages SET status='complete' WHERE id=?")
                    .bind(&assistant_message_id)
                    .execute(&mut *tx)
                    .await?;
                (
                    "turn_completed",
                    json!({ "input_tokens": event.input_tokens, "output_tokens": event.output_tokens }),
                )
            }
            ChatProviderStreamEventKind::Failed => {
                let code = event
                    .error_code
                    .clone()
                    .unwrap_or_else(|| "provider_stream_failed".to_owned());
                let message = event
                    .text
                    .clone()
                    .unwrap_or_else(|| "The provider could not complete this response.".to_owned());
                sqlx::query(
                    "UPDATE hiveory_chat_turns SET state='failed', updated_at_unix_ms=? WHERE id=?",
                )
                .bind(now_ms())
                .bind(turn_id)
                .execute(&mut *tx)
                .await?;
                sqlx::query("UPDATE hiveory_chat_messages SET status='failed' WHERE id=?")
                    .bind(&assistant_message_id)
                    .execute(&mut *tx)
                    .await?;
                let ordinal: i64 = sqlx::query_scalar("SELECT COALESCE(MAX(ordinal), -1) + 1 FROM hiveory_chat_message_parts WHERE message_id=?").bind(&assistant_message_id).fetch_one(&mut *tx).await?;
                insert_part(
                    &mut tx,
                    &assistant_message_id,
                    ordinal,
                    "error",
                    json!({ "code": code, "message": message }),
                )
                .await?;
                ("turn_failed", json!({ "error_code": event.error_code }))
            }
        };
        if state == "completed" && matches!(event.kind, ChatProviderStreamEventKind::Completed) {
            tx.rollback().await?;
            return Ok(None);
        }
        let envelope = append_event(
            &mut tx,
            ChatEventInput {
                conversation_id,
                branch_id: Some(&branch_id),
                turn_id: Some(turn_id),
                message_id: Some(&assistant_message_id),
                kind,
                payload,
                provider_sequence: (event.provider_sequence >= 0)
                    .then_some(event.provider_sequence),
            },
        )
        .await?;
        sqlx::query("UPDATE hiveory_chat_conversations SET updated_at_unix_ms=? WHERE id=?")
            .bind(now_ms())
            .bind(conversation_id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(Some(envelope))
    }

    pub async fn cancel_requested(
        &self,
        conversation_id: &str,
        turn_id: &str,
    ) -> Result<Option<ChatEventEnvelope>, HiveoryChatStoreError> {
        self.set_turn_state(
            conversation_id,
            turn_id,
            "cancel_requested",
            "turn_cancel_requested",
        )
        .await
    }

    pub async fn cancelled(
        &self,
        conversation_id: &str,
        turn_id: &str,
    ) -> Result<Option<ChatEventEnvelope>, HiveoryChatStoreError> {
        self.set_turn_state(conversation_id, turn_id, "cancelled", "turn_cancelled")
            .await
    }

    async fn set_turn_state(
        &self,
        conversation_id: &str,
        turn_id: &str,
        state: &str,
        event_kind: &str,
    ) -> Result<Option<ChatEventEnvelope>, HiveoryChatStoreError> {
        let mut tx = self.persistence.pool().begin().await?;
        let row = sqlx::query("SELECT branch_id, assistant_message_id, state FROM hiveory_chat_turns WHERE id=? AND conversation_id=?").bind(turn_id).bind(conversation_id).fetch_optional(&mut *tx).await?.ok_or(HiveoryChatStoreError::NotFound)?;
        let old_state: String = row.get(2);
        if matches!(
            old_state.as_str(),
            "completed" | "failed" | "cancelled" | "interrupted"
        ) {
            tx.rollback().await?;
            return Ok(None);
        }
        sqlx::query("UPDATE hiveory_chat_turns SET state=?, updated_at_unix_ms=? WHERE id=?")
            .bind(state)
            .bind(now_ms())
            .bind(turn_id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("UPDATE hiveory_chat_messages SET status=? WHERE id=?")
            .bind(state)
            .bind(row.get::<String, _>(1))
            .execute(&mut *tx)
            .await?;
        let envelope = append_event(
            &mut tx,
            ChatEventInput {
                conversation_id,
                branch_id: Some(&row.get::<String, _>(0)),
                turn_id: Some(turn_id),
                message_id: Some(&row.get::<String, _>(1)),
                kind: event_kind,
                payload: json!({}),
                provider_sequence: None,
            },
        )
        .await?;
        tx.commit().await?;
        Ok(Some(envelope))
    }

    pub async fn branch_after(
        &self,
        conversation_id: &str,
        message_id: &str,
        command_request_id: Option<&str>,
    ) -> Result<ChatConversationDetail, HiveoryChatStoreError> {
        let (branch_id, position) = self.source_message(conversation_id, message_id).await?;
        let _ = self
            .copy_branch(
                conversation_id,
                &branch_id,
                position,
                Some(message_id),
                "Branch",
                command_request_id,
            )
            .await?;
        self.detail(conversation_id).await
    }

    pub async fn retry_turn(
        &self,
        conversation_id: &str,
        turn_id: &str,
        request: &ChatSendRequest,
        job_id: Option<&str>,
        command_request_id: Option<&str>,
    ) -> Result<HiveoryChatTurnStart, HiveoryChatStoreError> {
        let row = sqlx::query(
            "SELECT branch_id, message_id FROM hiveory_chat_turns WHERE id=? AND conversation_id=?",
        )
        .bind(turn_id)
        .bind(conversation_id)
        .fetch_optional(self.persistence.pool())
        .await?
        .ok_or(HiveoryChatStoreError::NotFound)?;
        let source_branch: String = row.get(0);
        let user_message_id: String = row.get(1);
        let (_, position): (String, i64) = self
            .source_message(conversation_id, &user_message_id)
            .await?;
        let (_, new_branch_id, copied_user_id) = self
            .copy_branch(
                conversation_id,
                &source_branch,
                position,
                Some(&user_message_id),
                "Retry",
                command_request_id,
            )
            .await?;
        let mut next = request.clone();
        next.branch_id = new_branch_id;
        self.start_turn_internal(
            &next,
            job_id,
            Some(&copied_user_id),
            None,
            command_request_id,
        )
        .await
    }

    pub async fn edit_message(
        &self,
        request: &hiveory_protocol::ChatEditRequest,
        job_id: Option<&str>,
        command_request_id: Option<&str>,
    ) -> Result<HiveoryChatTurnStart, HiveoryChatStoreError> {
        let (source_branch, position) = self
            .source_message(&request.conversation_id, &request.message_id)
            .await?;
        let copy_through = position - 1;
        let (_, branch_id, _) = self
            .copy_branch(
                &request.conversation_id,
                &source_branch,
                copy_through,
                Some(&request.message_id),
                "Edited",
                command_request_id,
            )
            .await?;
        let send = ChatSendRequest {
            conversation_id: request.conversation_id.clone(),
            branch_id,
            text: request.text.clone(),
            attachment_ids: Vec::new(),
            provider_account_id: request.provider_account_id.clone(),
            model: request.model.clone(),
            reasoning_effort: request.reasoning_effort,
        };
        self.start_turn(&send, job_id, command_request_id).await
    }

    async fn source_message(
        &self,
        conversation_id: &str,
        message_id: &str,
    ) -> Result<(String, i64), HiveoryChatStoreError> {
        let row = sqlx::query("SELECT branch_id, branch_position FROM hiveory_chat_messages WHERE id=? AND conversation_id=?").bind(message_id).bind(conversation_id).fetch_optional(self.persistence.pool()).await?.ok_or(HiveoryChatStoreError::NotFound)?;
        Ok((row.get(0), row.get(1)))
    }

    async fn copy_branch(
        &self,
        conversation_id: &str,
        source_branch_id: &str,
        copy_through: i64,
        forked_after: Option<&str>,
        label: &str,
        command_request_id: Option<&str>,
    ) -> Result<(String, String, String), HiveoryChatStoreError> {
        let mut tx = self.persistence.pool().begin().await?;
        if let Some(command_request_id) = command_request_id {
            if let Some(row) =
                sqlx::query("SELECT id FROM hiveory_chat_branches WHERE command_request_id=?")
                    .bind(command_request_id)
                    .fetch_optional(&mut *tx)
                    .await?
            {
                let branch_id: String = row.get(0);
                let copied_user_id = sqlx::query("SELECT id FROM hiveory_chat_messages WHERE branch_id=? AND role='user' AND copied_from_message_id=? LIMIT 1")
                    .bind(&branch_id)
                    .bind(forked_after)
                    .fetch_optional(&mut *tx)
                    .await?
                    .map(|item| item.get(0))
                    .unwrap_or_default();
                tx.rollback().await?;
                return Ok((source_branch_id.to_owned(), branch_id, copied_user_id));
            }
        }
        let new_branch_id = Uuid::now_v7().to_string();
        sqlx::query("INSERT INTO hiveory_chat_branches (id, conversation_id, parent_branch_id, forked_after_message_id, label, command_request_id, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(&new_branch_id).bind(conversation_id).bind(source_branch_id).bind(forked_after).bind(label).bind(command_request_id).bind(now_ms()).execute(&mut *tx).await?;
        let source_messages = sqlx::query("SELECT id, role, status, branch_position, turn_id, created_at_unix_ms FROM hiveory_chat_messages WHERE branch_id=? AND branch_position<=? ORDER BY branch_position")
            .bind(source_branch_id).bind(copy_through).fetch_all(&mut *tx).await?;
        let mut copied_user_id = String::new();
        for row in source_messages {
            let source_id: String = row.get(0);
            let new_id = Uuid::now_v7().to_string();
            sqlx::query("INSERT INTO hiveory_chat_messages (id, conversation_id, branch_id, copied_from_message_id, role, status, branch_position, turn_id, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
                .bind(&new_id).bind(conversation_id).bind(&new_branch_id).bind(&source_id).bind(row.get::<String, _>(1)).bind(row.get::<String, _>(2)).bind(row.get::<i64, _>(3)).bind(row.get::<Option<String>, _>(4)).bind(row.get::<i64, _>(5)).execute(&mut *tx).await?;
            if row.get::<String, _>(1) == "user" && source_id == forked_after.unwrap_or_default() {
                copied_user_id = new_id.clone();
            }
            let parts = sqlx::query("SELECT ordinal, kind, payload_json FROM hiveory_chat_message_parts WHERE message_id=? ORDER BY ordinal").bind(&source_id).fetch_all(&mut *tx).await?;
            for part in parts {
                sqlx::query("INSERT INTO hiveory_chat_message_parts (message_id, ordinal, kind, payload_json) VALUES (?, ?, ?, ?)").bind(&new_id).bind(part.get::<i64, _>(0)).bind(part.get::<String, _>(1)).bind(part.get::<String, _>(2)).execute(&mut *tx).await?;
            }
            let attachments = sqlx::query(
                "SELECT attachment_id FROM hiveory_chat_message_attachments WHERE message_id=?",
            )
            .bind(&source_id)
            .fetch_all(&mut *tx)
            .await?;
            for attachment in attachments {
                sqlx::query("INSERT INTO hiveory_chat_message_attachments (message_id, attachment_id) VALUES (?, ?)").bind(&new_id).bind(attachment.get::<String, _>(0)).execute(&mut *tx).await?;
            }
        }
        sqlx::query("UPDATE hiveory_chat_conversations SET active_branch_id=?, updated_at_unix_ms=? WHERE id=?").bind(&new_branch_id).bind(now_ms()).bind(conversation_id).execute(&mut *tx).await?;
        append_event(
            &mut tx,
            ChatEventInput {
                conversation_id,
                branch_id: Some(&new_branch_id),
                turn_id: None,
                message_id: forked_after,
                kind: "branch_created",
                payload: json!({ "label": label, "parent_branch_id": source_branch_id }),
                provider_sequence: None,
            },
        )
        .await?;
        tx.commit().await?;
        Ok((source_branch_id.to_owned(), new_branch_id, copied_user_id))
    }

    pub async fn events_since(
        &self,
        conversation_id: &str,
        after: i64,
        limit: u32,
    ) -> Result<Vec<ChatEventEnvelope>, HiveoryChatStoreError> {
        let rows = sqlx::query("SELECT global_sequence, aggregate_sequence, branch_id, turn_id, message_id, kind, payload_json, emitted_at_unix_ms FROM hiveory_chat_events WHERE conversation_id=? AND global_sequence>? ORDER BY global_sequence LIMIT ?").bind(conversation_id).bind(after).bind(i64::from(limit.clamp(1, 500))).fetch_all(self.persistence.pool()).await?;
        rows.into_iter()
            .map(|row| event_from_row(row, conversation_id.to_owned()))
            .collect()
    }

    pub async fn all_events_since(
        &self,
        after: i64,
    ) -> Result<Vec<ChatEventEnvelope>, HiveoryChatStoreError> {
        let rows = sqlx::query("SELECT global_sequence, aggregate_sequence, conversation_id, branch_id, turn_id, message_id, kind, payload_json, emitted_at_unix_ms FROM hiveory_chat_events WHERE global_sequence>? ORDER BY global_sequence LIMIT 500").bind(after).fetch_all(self.persistence.pool()).await?;
        rows.into_iter().map(global_event_from_row).collect()
    }

    pub async fn interrupt_active_turns(&self) -> Result<usize, HiveoryChatStoreError> {
        let rows = sqlx::query("SELECT id, conversation_id, branch_id, assistant_message_id FROM hiveory_chat_turns WHERE state IN ('queued','streaming','cancel_requested')")
            .fetch_all(self.persistence.pool()).await?;
        let count = rows.len();
        let mut tx = self.persistence.pool().begin().await?;
        for row in rows {
            let turn_id: String = row.get(0);
            let conversation_id: String = row.get(1);
            let branch_id: String = row.get(2);
            let assistant_message_id: String = row.get(3);
            sqlx::query("UPDATE hiveory_chat_turns SET state='interrupted', updated_at_unix_ms=? WHERE id=?")
                .bind(now_ms()).bind(&turn_id).execute(&mut *tx).await?;
            sqlx::query("UPDATE hiveory_chat_messages SET status='interrupted' WHERE id=?")
                .bind(&assistant_message_id)
                .execute(&mut *tx)
                .await?;
            append_event(&mut tx, ChatEventInput {
                conversation_id: &conversation_id,
                branch_id: Some(&branch_id),
                turn_id: Some(&turn_id),
                message_id: Some(&assistant_message_id),
                kind: "turn_interrupted",
                payload: json!({ "message": "The application restarted while this response was streaming." }),
                provider_sequence: None,
            }).await?;
        }
        tx.commit().await?;
        Ok(count)
    }

    pub async fn attachments_for_branch(
        &self,
        conversation_id: &str,
        branch_id: &str,
    ) -> Result<Vec<HiveoryChatStoredAttachment>, HiveoryChatStoreError> {
        let rows = sqlx::query("SELECT DISTINCT a.id, a.display_name, a.mime_type, a.byte_count, a.sha256, a.relative_path FROM hiveory_chat_attachments a JOIN hiveory_chat_message_attachments ma ON ma.attachment_id=a.id JOIN hiveory_chat_messages m ON m.id=ma.message_id WHERE m.conversation_id=? AND m.branch_id=? ORDER BY a.created_at_unix_ms")
            .bind(conversation_id).bind(branch_id).fetch_all(self.persistence.pool()).await?;
        rows.into_iter().map(stored_attachment_from_row).collect()
    }

    pub async fn delete_conversation(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<String>, HiveoryChatStoreError> {
        let paths: Vec<String> = sqlx::query("SELECT DISTINCT a.relative_path FROM hiveory_chat_attachments a JOIN hiveory_chat_message_attachments ma ON ma.attachment_id=a.id JOIN hiveory_chat_messages m ON m.id=ma.message_id WHERE m.conversation_id=?").bind(conversation_id).fetch_all(self.persistence.pool()).await?.into_iter().map(|row| row.get(0)).collect();
        let result = sqlx::query("DELETE FROM hiveory_chat_conversations WHERE id=?")
            .bind(conversation_id)
            .execute(self.persistence.pool())
            .await?;
        if result.rows_affected() == 0 {
            return Err(HiveoryChatStoreError::NotFound);
        }
        let mut orphaned_paths = Vec::new();
        for path in paths {
            let still_used: i64 = sqlx::query_scalar(
                "SELECT COUNT(*) FROM hiveory_chat_attachments WHERE relative_path=?",
            )
            .bind(&path)
            .fetch_one(self.persistence.pool())
            .await?;
            if still_used == 0 {
                let _ = sqlx::query("DELETE FROM hiveory_chat_attachments WHERE relative_path=?")
                    .bind(&path)
                    .execute(self.persistence.pool())
                    .await?;
                orphaned_paths.push(path);
            }
        }
        Ok(orphaned_paths)
    }

    async fn require_conversation(&self, id: &str) -> Result<(), HiveoryChatStoreError> {
        let exists: bool = sqlx::query_scalar(
            "SELECT EXISTS(SELECT 1 FROM hiveory_chat_conversations WHERE id=? )",
        )
        .bind(id)
        .fetch_one(self.persistence.pool())
        .await?;
        exists.then_some(()).ok_or(HiveoryChatStoreError::NotFound)
    }
}

async fn append_event(
    tx: &mut Transaction<'_, Sqlite>,
    input: ChatEventInput<'_>,
) -> Result<ChatEventEnvelope, HiveoryChatStoreError> {
    sqlx::query("UPDATE hiveory_chat_conversations SET next_aggregate_sequence=next_aggregate_sequence+1 WHERE id=?")
        .bind(input.conversation_id).execute(&mut **tx).await?;
    let aggregate_sequence: i64 = sqlx::query_scalar(
        "SELECT next_aggregate_sequence FROM hiveory_chat_conversations WHERE id=?",
    )
    .bind(input.conversation_id)
    .fetch_one(&mut **tx)
    .await?;
    let payload_json = serde_json::to_string(&input.payload)?;
    sqlx::query("INSERT INTO hiveory_chat_events (conversation_id, aggregate_sequence, branch_id, turn_id, message_id, kind, payload_json, provider_sequence_start, provider_sequence_end, emitted_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(input.conversation_id).bind(aggregate_sequence).bind(input.branch_id).bind(input.turn_id).bind(input.message_id).bind(input.kind).bind(&payload_json).bind(input.provider_sequence).bind(input.provider_sequence).bind(now_ms()).execute(&mut **tx).await?;
    let global_sequence: i64 = sqlx::query_scalar("SELECT last_insert_rowid()")
        .fetch_one(&mut **tx)
        .await?;
    Ok(ChatEventEnvelope {
        global_sequence,
        aggregate_sequence,
        conversation_id: input.conversation_id.to_owned(),
        branch_id: input.branch_id.map(str::to_owned),
        turn_id: input.turn_id.map(str::to_owned),
        message_id: input.message_id.map(str::to_owned),
        kind: input.kind.to_owned(),
        text_delta: input
            .payload
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_owned),
        message: input
            .payload
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_owned),
        emitted_at_unix_ms: now_ms(),
    })
}

async fn insert_part(
    tx: &mut Transaction<'_, Sqlite>,
    message_id: &str,
    ordinal: i64,
    kind: &str,
    payload: Value,
) -> Result<(), HiveoryChatStoreError> {
    sqlx::query("INSERT INTO hiveory_chat_message_parts (message_id, ordinal, kind, payload_json) VALUES (?, ?, ?, ?)").bind(message_id).bind(ordinal).bind(kind).bind(serde_json::to_string(&payload)?).execute(&mut **tx).await?;
    Ok(())
}

async fn append_text_part(
    tx: &mut Transaction<'_, Sqlite>,
    message_id: &str,
    delta: &str,
) -> Result<(), HiveoryChatStoreError> {
    if let Some(row) = sqlx::query("SELECT payload_json FROM hiveory_chat_message_parts WHERE message_id=? AND kind='text' ORDER BY ordinal LIMIT 1").bind(message_id).fetch_optional(&mut **tx).await? {
        let mut payload: Value = serde_json::from_str(&row.get::<String, _>(0))?;
        let current = payload.get("text").and_then(Value::as_str).unwrap_or_default().to_owned();
        payload["text"] = Value::String(format!("{current}{delta}"));
        sqlx::query("UPDATE hiveory_chat_message_parts SET payload_json=? WHERE message_id=? AND kind='text'").bind(serde_json::to_string(&payload)?).bind(message_id).execute(&mut **tx).await?;
    } else {
        insert_part(tx, message_id, 0, "text", json!({ "text": delta })).await?;
    }
    Ok(())
}

fn normalized_title(value: Option<&str>) -> String {
    let title = value.unwrap_or("New chat").trim();
    if title.is_empty() {
        "New chat".to_owned()
    } else {
        title.chars().take(80).collect()
    }
}

fn conversation_summary_from_row(row: SqliteRow) -> ChatConversationSummary {
    ChatConversationSummary {
        id: row.get(0),
        title: row.get(1),
        active_branch_id: row.get(2),
        pinned: row.get::<i64, _>(3) != 0,
        archived: row.get::<i64, _>(4) != 0,
        updated_at_unix_ms: row.get(5),
        preview: row.get(6),
    }
}
fn branch_from_row(row: SqliteRow) -> ChatBranchSummary {
    ChatBranchSummary {
        id: row.get(0),
        parent_branch_id: row.get(1),
        forked_after_message_id: row.get(2),
        label: row.get(3),
        created_at_unix_ms: row.get(4),
        active: row.get::<String, _>(0) == row.get::<String, _>(5),
    }
}
fn message_role(value: &str) -> Result<ChatMessageRole, HiveoryChatStoreError> {
    match value {
        "user" => Ok(ChatMessageRole::User),
        "assistant" => Ok(ChatMessageRole::Assistant),
        "system" => Ok(ChatMessageRole::System),
        _ => Err(HiveoryChatStoreError::Inconsistent),
    }
}
fn part_from_row(row: SqliteRow) -> Result<ChatMessagePart, HiveoryChatStoreError> {
    let kind: String = row.get(0);
    let payload: Value = serde_json::from_str(&row.get::<String, _>(1))?;
    let attachment = || {
        serde_json::from_value(
            payload
                .get("attachment")
                .cloned()
                .ok_or(HiveoryChatStoreError::Inconsistent)?,
        )
        .map_err(HiveoryChatStoreError::from)
    };
    Ok(match kind.as_str() {
        "text" => ChatMessagePart::Text {
            text: payload
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        },
        "reasoning_summary" => ChatMessagePart::ReasoningSummary {
            text: payload
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        },
        "error" => ChatMessagePart::Error {
            code: payload
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("provider_stream_failed")
                .to_owned(),
            message: payload
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("The provider could not complete this response.")
                .to_owned(),
        },
        "status" => ChatMessagePart::Status {
            code: payload
                .get("code")
                .and_then(Value::as_str)
                .unwrap_or("status")
                .to_owned(),
            text: payload
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        },
        "attachment" => ChatMessagePart::Attachment {
            attachment: attachment()?,
        },
        "image" => ChatMessagePart::Image {
            attachment: attachment()?,
        },
        "citation" => ChatMessagePart::Citation {
            url: payload
                .get("url")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            title: payload
                .get("title")
                .and_then(Value::as_str)
                .map(str::to_owned),
        },
        "usage" => ChatMessagePart::Usage {
            input_tokens: payload.get("input_tokens").and_then(Value::as_u64),
            output_tokens: payload.get("output_tokens").and_then(Value::as_u64),
        },
        "tool_call" => ChatMessagePart::ToolCall {
            call_id: payload
                .get("call_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            name: payload
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            arguments_json: payload
                .get("arguments_json")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        },
        "tool_result" => ChatMessagePart::ToolResult {
            call_id: payload
                .get("call_id")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
            result: payload
                .get("result")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_owned(),
        },
        _ => return Err(HiveoryChatStoreError::Inconsistent),
    })
}
fn turn_from_row(row: SqliteRow) -> Result<ChatTurnSummary, HiveoryChatStoreError> {
    Ok(ChatTurnSummary {
        id: row.get(0),
        message_id: row.get(1),
        assistant_message_id: row.get(2),
        branch_id: row.get(3),
        provider_account_id: row.get(4),
        model: row.get(5),
        reasoning_effort: reasoning_from_value(&row.get::<String, _>(6))?,
        state: turn_state_from_value(&row.get::<String, _>(7))?,
        job_id: row.get(8),
        input_tokens: row.get::<Option<i64>, _>(9).map(|v| v as u64),
        output_tokens: row.get::<Option<i64>, _>(10).map(|v| v as u64),
        created_at_unix_ms: row.get(11),
        updated_at_unix_ms: row.get(12),
    })
}
fn reasoning_value(value: &ChatReasoningEffort) -> &'static str {
    match value {
        ChatReasoningEffort::Auto => "auto",
        ChatReasoningEffort::Low => "low",
        ChatReasoningEffort::Medium => "medium",
        ChatReasoningEffort::High => "high",
    }
}
fn reasoning_from_value(value: &str) -> Result<ChatReasoningEffort, HiveoryChatStoreError> {
    match value {
        "auto" => Ok(ChatReasoningEffort::Auto),
        "low" => Ok(ChatReasoningEffort::Low),
        "medium" => Ok(ChatReasoningEffort::Medium),
        "high" => Ok(ChatReasoningEffort::High),
        _ => Err(HiveoryChatStoreError::Inconsistent),
    }
}
fn turn_state_from_value(value: &str) -> Result<ChatTurnState, HiveoryChatStoreError> {
    match value {
        "queued" => Ok(ChatTurnState::Queued),
        "streaming" => Ok(ChatTurnState::Streaming),
        "cancel_requested" => Ok(ChatTurnState::CancelRequested),
        "cancelled" => Ok(ChatTurnState::Cancelled),
        "completed" => Ok(ChatTurnState::Completed),
        "failed" => Ok(ChatTurnState::Failed),
        "interrupted" => Ok(ChatTurnState::Interrupted),
        _ => Err(HiveoryChatStoreError::Inconsistent),
    }
}
fn attachment_from_row(row: SqliteRow) -> ChatAttachmentSummary {
    ChatAttachmentSummary {
        id: row.get(0),
        display_name: row.get(1),
        mime_type: row.get(2),
        bytes: row.get(3),
        sha256: row.get(4),
    }
}
fn stored_attachment_from_row(
    row: SqliteRow,
) -> Result<HiveoryChatStoredAttachment, HiveoryChatStoreError> {
    Ok(HiveoryChatStoredAttachment {
        summary: ChatAttachmentSummary {
            id: row.get(0),
            display_name: row.get(1),
            mime_type: row.get(2),
            bytes: row.get(3),
            sha256: row.get(4),
        },
        relative_path: row.get(5),
    })
}
fn event_from_row(
    row: SqliteRow,
    conversation_id: String,
) -> Result<ChatEventEnvelope, HiveoryChatStoreError> {
    let payload: Value = serde_json::from_str(&row.get::<String, _>(6))?;
    Ok(ChatEventEnvelope {
        global_sequence: row.get(0),
        aggregate_sequence: row.get(1),
        conversation_id,
        branch_id: row.get(2),
        turn_id: row.get(3),
        message_id: row.get(4),
        kind: row.get(5),
        text_delta: payload
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_owned),
        message: payload
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_owned),
        emitted_at_unix_ms: row.get(7),
    })
}
fn global_event_from_row(row: SqliteRow) -> Result<ChatEventEnvelope, HiveoryChatStoreError> {
    let payload: Value = serde_json::from_str(&row.get::<String, _>(7))?;
    Ok(ChatEventEnvelope {
        global_sequence: row.get(0),
        aggregate_sequence: row.get(1),
        conversation_id: row.get(2),
        branch_id: row.get(3),
        turn_id: row.get(4),
        message_id: row.get(5),
        kind: row.get(6),
        text_delta: payload
            .get("text")
            .and_then(Value::as_str)
            .map(str::to_owned),
        message: payload
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_owned),
        emitted_at_unix_ms: row.get(8),
    })
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temporary_database_path() -> std::path::PathBuf {
        std::env::temp_dir().join(format!("hiveory-chat-{}.sqlite3", Uuid::now_v7()))
    }

    #[tokio::test]
    async fn replayed_commands_and_provider_deltas_have_one_effect() {
        let path = temporary_database_path();
        let persistence = HiveoryPersistence::open(&path).await.expect("database");
        let store = HiveoryChatStore::new(persistence.clone());
        let created = store
            .create(
                &ChatCreateRequest {
                    title: Some("Replay test".to_owned()),
                },
                Some("create-1"),
            )
            .await
            .expect("create");
        let replayed = store
            .create(
                &ChatCreateRequest {
                    title: Some("Different title".to_owned()),
                },
                Some("create-1"),
            )
            .await
            .expect("replay create");
        assert_eq!(created.id, replayed.id);

        let request = ChatSendRequest {
            conversation_id: created.id.clone(),
            branch_id: created.active_branch_id.clone(),
            text: "hello".to_owned(),
            attachment_ids: Vec::new(),
            provider_account_id: "provider".to_owned(),
            model: "model-a".to_owned(),
            reasoning_effort: ChatReasoningEffort::Auto,
        };
        let first = store
            .start_turn(&request, None, Some("send-1"))
            .await
            .expect("start");
        let replayed = store
            .start_turn(&request, None, Some("send-1"))
            .await
            .expect("replay start");
        assert!(!first.already_started);
        assert!(replayed.already_started);
        assert_eq!(first.turn_id, replayed.turn_id);

        let delta = ChatProviderStreamEvent {
            provider_sequence: 7,
            kind: ChatProviderStreamEventKind::TextDelta,
            text: Some("world".to_owned()),
            input_tokens: None,
            output_tokens: None,
            error_code: None,
        };
        assert!(store
            .apply_provider_event(&created.id, &first.turn_id, &delta)
            .await
            .expect("delta")
            .is_some());
        assert!(store
            .apply_provider_event(&created.id, &first.turn_id, &delta)
            .await
            .expect("duplicate delta")
            .is_none());
        let completed = ChatProviderStreamEvent {
            provider_sequence: 8,
            kind: ChatProviderStreamEventKind::Completed,
            text: None,
            input_tokens: Some(4),
            output_tokens: Some(2),
            error_code: None,
        };
        assert!(store
            .apply_provider_event(&created.id, &first.turn_id, &completed)
            .await
            .expect("complete")
            .is_some());
        let detail = store.detail(&created.id).await.expect("detail");
        let assistant = detail
            .messages
            .iter()
            .find(|message| message.id == first.assistant_message_id)
            .expect("assistant");
        assert_eq!(
            assistant
                .parts
                .iter()
                .filter_map(|part| match part {
                    ChatMessagePart::Text { text } => Some(text.as_str()),
                    _ => None,
                })
                .collect::<String>(),
            "world"
        );
        assert!(detail
            .turns
            .iter()
            .any(|turn| turn.id == first.turn_id && turn.state == ChatTurnState::Completed));

        let branched = store
            .branch_after(&created.id, &first.user_message_id, Some("branch-1"))
            .await
            .expect("branch");
        let replayed_branch = store
            .branch_after(&created.id, &first.user_message_id, Some("branch-1"))
            .await
            .expect("replay branch");
        assert_eq!(branched.active_branch_id, replayed_branch.active_branch_id);
        assert_eq!(branched.branches.len(), 2);

        let second_request = ChatSendRequest {
            conversation_id: created.id.clone(),
            branch_id: branched.active_branch_id.clone(),
            text: "interrupt me".to_owned(),
            attachment_ids: Vec::new(),
            provider_account_id: "provider".to_owned(),
            model: "model-b".to_owned(),
            reasoning_effort: ChatReasoningEffort::Low,
        };
        let second = store
            .start_turn(&second_request, None, Some("send-2"))
            .await
            .expect("second start");
        assert_eq!(store.interrupt_active_turns().await.expect("interrupt"), 1);
        let recovered = store.detail(&created.id).await.expect("recovered detail");
        assert!(recovered
            .turns
            .iter()
            .any(|turn| turn.id == second.turn_id && turn.state == ChatTurnState::Interrupted));

        drop(store);
        drop(persistence);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
    }
}
