//! Durable, addressed orchestration deliveries.
//!
//! A mailbox is deliberately separate from the historical run activity log.
//! The activity log is an append-only audit stream; deliveries have a
//! recipient, FIFO sequence, acknowledgement state, and replay semantics.

use super::{now_ms, AgenticSuperAppPersistence};
use agentic_super_app_protocol::{
    CodeMailboxDelivery, CodeMailboxQuery, CodeMailboxSendRequest, CodeOrchestrationMessageKind,
    CodeParticipant, CodeParticipantKind,
};
use sqlx::Row;
use uuid::Uuid;

const MAILBOX_LIMIT: u32 = 250;

impl AgenticSuperAppPersistence {
    pub async fn send_orchestration_mailbox(
        &self,
        request: &CodeMailboxSendRequest,
    ) -> Result<CodeMailboxDelivery, sqlx::Error> {
        let mut transaction = self.pool().begin().await?;
        if let Some(client_request_id) = request
            .client_request_id
            .as_deref()
            .filter(|value| !value.is_empty())
        {
            if let Some(row) = sqlx::query(
                "SELECT id, run_id, sender_address, recipient_address, kind, payload, thread_id, delivery_sequence, acknowledged, created_at_unix_ms, acknowledged_at_unix_ms FROM agentic_super_app_code_mailbox_deliveries WHERE run_id=? AND client_request_id=?",
            )
            .bind(&request.run_id)
            .bind(client_request_id)
            .fetch_optional(&mut *transaction)
            .await?
            {
                transaction.commit().await?;
                return Ok(mailbox_delivery_from_row(row));
            }
        }

        let now = now_ms();
        ensure_participant(
            &mut transaction,
            &request.run_id,
            &request.sender_address,
            participant_kind(&request.sender_address),
            &request.sender_address,
            now,
        )
        .await?;
        ensure_participant(
            &mut transaction,
            &request.run_id,
            &request.recipient_address,
            participant_kind(&request.recipient_address),
            &request.recipient_address,
            now,
        )
        .await?;

        let updated = sqlx::query(
            "UPDATE agentic_super_app_code_participants SET next_delivery_sequence=next_delivery_sequence+1, updated_at_unix_ms=? WHERE run_id=? AND address=?",
        )
        .bind(now)
        .bind(&request.run_id)
        .bind(&request.recipient_address)
        .execute(&mut *transaction)
        .await?;
        if updated.rows_affected() != 1 {
            transaction.rollback().await?;
            return Err(sqlx::Error::RowNotFound);
        }
        let sequence: i64 = sqlx::query(
            "SELECT next_delivery_sequence - 1 FROM agentic_super_app_code_participants WHERE run_id=? AND address=?",
        )
        .bind(&request.run_id)
        .bind(&request.recipient_address)
        .fetch_one(&mut *transaction)
        .await?
        .get(0);
        let delivery = CodeMailboxDelivery {
            id: format!("delivery-{}", Uuid::now_v7()),
            run_id: request.run_id.clone(),
            sender_address: request.sender_address.clone(),
            recipient_address: request.recipient_address.clone(),
            kind: request.kind,
            payload: request.payload.clone(),
            thread_id: request.thread_id.clone(),
            sequence: u64::try_from(sequence).unwrap_or(0),
            acknowledged: false,
            created_at_unix_ms: now,
            acknowledged_at_unix_ms: None,
        };
        sqlx::query(
            "INSERT INTO agentic_super_app_code_mailbox_deliveries (id, run_id, sender_address, recipient_address, kind, payload, thread_id, delivery_sequence, acknowledged, created_at_unix_ms, acknowledged_at_unix_ms, client_request_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NULL, ?)",
        )
        .bind(&delivery.id)
        .bind(&delivery.run_id)
        .bind(&delivery.sender_address)
        .bind(&delivery.recipient_address)
        .bind(message_kind_value(delivery.kind))
        .bind(&delivery.payload)
        .bind(&delivery.thread_id)
        .bind(i64::try_from(delivery.sequence).unwrap_or(i64::MAX))
        .bind(delivery.created_at_unix_ms)
        .bind(&request.client_request_id)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        Ok(delivery)
    }

    pub async fn orchestration_inbox(
        &self,
        query: &CodeMailboxQuery,
    ) -> Result<Vec<CodeMailboxDelivery>, sqlx::Error> {
        let limit = i64::from(query.limit.unwrap_or(MAILBOX_LIMIT).clamp(1, MAILBOX_LIMIT));
        let rows = if query.include_acknowledged {
            sqlx::query(
                "SELECT id, run_id, sender_address, recipient_address, kind, payload, thread_id, delivery_sequence, acknowledged, created_at_unix_ms, acknowledged_at_unix_ms FROM agentic_super_app_code_mailbox_deliveries WHERE run_id=? AND recipient_address=? ORDER BY delivery_sequence LIMIT ?",
            )
            .bind(&query.run_id)
            .bind(&query.recipient_address)
            .bind(limit)
            .fetch_all(self.pool())
            .await?
        } else {
            sqlx::query(
                "SELECT id, run_id, sender_address, recipient_address, kind, payload, thread_id, delivery_sequence, acknowledged, created_at_unix_ms, acknowledged_at_unix_ms FROM agentic_super_app_code_mailbox_deliveries WHERE run_id=? AND recipient_address=? AND acknowledged=0 ORDER BY delivery_sequence LIMIT ?",
            )
            .bind(&query.run_id)
            .bind(&query.recipient_address)
            .bind(limit)
            .fetch_all(self.pool())
            .await?
        };
        Ok(rows.into_iter().map(mailbox_delivery_from_row).collect())
    }

    pub async fn acknowledge_orchestration_mailbox(
        &self,
        run_id: &str,
        delivery_id: &str,
        recipient_address: &str,
    ) -> Result<bool, sqlx::Error> {
        Ok(sqlx::query(
            "UPDATE agentic_super_app_code_mailbox_deliveries SET acknowledged=1, acknowledged_at_unix_ms=? WHERE id=? AND run_id=? AND recipient_address=? AND acknowledged=0",
        )
        .bind(now_ms())
        .bind(delivery_id)
        .bind(run_id)
        .bind(recipient_address)
        .execute(self.pool())
        .await?
        .rows_affected()
            > 0)
    }

    pub async fn orchestration_participants(
        &self,
        run_id: &str,
    ) -> Result<Vec<CodeParticipant>, sqlx::Error> {
        Ok(sqlx::query(
            "SELECT id, run_id, address, kind, display_name, active, created_at_unix_ms, updated_at_unix_ms FROM agentic_super_app_code_participants WHERE run_id=? ORDER BY created_at_unix_ms, address",
        )
        .bind(run_id)
        .fetch_all(self.pool())
        .await?
        .into_iter()
        .map(participant_from_row)
        .collect())
    }
}

async fn ensure_participant(
    transaction: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    run_id: &str,
    address: &str,
    kind: CodeParticipantKind,
    display_name: &str,
    now: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO agentic_super_app_code_participants (id, run_id, address, kind, display_name, active, next_delivery_sequence, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, 1, 1, ?, ?) ON CONFLICT(run_id, address) DO UPDATE SET active=1, updated_at_unix_ms=excluded.updated_at_unix_ms",
    )
    .bind(format!("participant-{}", Uuid::now_v7()))
    .bind(run_id)
    .bind(address)
    .bind(participant_kind_value(kind))
    .bind(display_name)
    .bind(now)
    .bind(now)
    .execute(&mut **transaction)
    .await?;
    Ok(())
}

fn mailbox_delivery_from_row(row: sqlx::sqlite::SqliteRow) -> CodeMailboxDelivery {
    CodeMailboxDelivery {
        id: row.get(0),
        run_id: row.get(1),
        sender_address: row.get(2),
        recipient_address: row.get(3),
        kind: parse_message_kind(&row.get::<String, _>(4)),
        payload: row.get(5),
        thread_id: row.get(6),
        sequence: u64::try_from(row.get::<i64, _>(7)).unwrap_or(0),
        acknowledged: row.get::<i64, _>(8) != 0,
        created_at_unix_ms: row.get(9),
        acknowledged_at_unix_ms: row.get(10),
    }
}

fn participant_from_row(row: sqlx::sqlite::SqliteRow) -> CodeParticipant {
    CodeParticipant {
        id: row.get(0),
        run_id: row.get(1),
        address: row.get(2),
        kind: parse_participant_kind(&row.get::<String, _>(3)),
        display_name: row.get(4),
        active: row.get::<i64, _>(5) != 0,
        created_at_unix_ms: row.get(6),
        updated_at_unix_ms: row.get(7),
    }
}

fn participant_kind(address: &str) -> CodeParticipantKind {
    if address.starts_with("worker:") {
        CodeParticipantKind::Worker
    } else if address.starts_with("coordinator:") {
        CodeParticipantKind::Coordinator
    } else if address.starts_with("user:") {
        CodeParticipantKind::User
    } else {
        CodeParticipantKind::System
    }
}

fn participant_kind_value(kind: CodeParticipantKind) -> &'static str {
    match kind {
        CodeParticipantKind::Coordinator => "coordinator",
        CodeParticipantKind::Worker => "worker",
        CodeParticipantKind::User => "user",
        CodeParticipantKind::System => "system",
    }
}

fn parse_participant_kind(value: &str) -> CodeParticipantKind {
    match value {
        "coordinator" => CodeParticipantKind::Coordinator,
        "worker" => CodeParticipantKind::Worker,
        "user" => CodeParticipantKind::User,
        _ => CodeParticipantKind::System,
    }
}

fn message_kind_value(kind: CodeOrchestrationMessageKind) -> &'static str {
    match kind {
        CodeOrchestrationMessageKind::Status => "status",
        CodeOrchestrationMessageKind::Heartbeat => "heartbeat",
        CodeOrchestrationMessageKind::Question => "question",
        CodeOrchestrationMessageKind::Answer => "answer",
        CodeOrchestrationMessageKind::Escalation => "escalation",
        CodeOrchestrationMessageKind::Progress => "progress",
        CodeOrchestrationMessageKind::Completion => "completion",
    }
}

fn parse_message_kind(value: &str) -> CodeOrchestrationMessageKind {
    match value {
        "heartbeat" => CodeOrchestrationMessageKind::Heartbeat,
        "question" => CodeOrchestrationMessageKind::Question,
        "answer" => CodeOrchestrationMessageKind::Answer,
        "escalation" => CodeOrchestrationMessageKind::Escalation,
        "progress" => CodeOrchestrationMessageKind::Progress,
        "completion" => CodeOrchestrationMessageKind::Completion,
        _ => CodeOrchestrationMessageKind::Status,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use agentic_super_app_code_domain::capabilities_for_trust;
    use agentic_super_app_protocol::{
        CodeGateCreateRequest, CodeGateResolveRequest, CodeGateState, CodeMailboxQuery,
        CodeMailboxSendRequest, CodeOrchestrationMessageKind, CodeReviewPolicy,
        CodeRunCreateRequest, CodeWorkspaceKind, CodeWorkspaceSummary, CodeWorkspaceTrust,
    };

    async fn fixture() -> (
        AgenticSuperAppPersistence,
        String,
        String,
        std::path::PathBuf,
    ) {
        let path = std::env::temp_dir().join(format!(
            "agentic-super-app-mailbox-{}.sqlite3",
            Uuid::now_v7()
        ));
        let persistence = AgenticSuperAppPersistence::open(&path)
            .await
            .expect("open database");
        let workspace_id = "workspace-mailbox".to_owned();
        persistence
            .save_code_workspace(&CodeWorkspaceSummary {
                id: workspace_id.clone(),
                host_id: "local".to_owned(),
                display_name: "Mailbox fixture".to_owned(),
                root_path: std::env::temp_dir().to_string_lossy().into_owned(),
                repository_name: None,
                branch: None,
                is_git_repository: false,
                trust: CodeWorkspaceTrust::Trusted,
                capabilities: capabilities_for_trust(CodeWorkspaceTrust::Trusted),
                project_id: "project-mailbox".to_owned(),
                workspace_kind: CodeWorkspaceKind::Primary,
                worktree_name: None,
                base_ref: None,
                managed_by_app: false,
                available: true,
                unavailable_reason: None,
                updated_at_unix_ms: now_ms(),
            })
            .await
            .expect("save workspace");
        let run_id = "run-mailbox".to_owned();
        persistence
            .insert_orchestration_run(
                &CodeRunCreateRequest {
                    workspace_id: workspace_id.clone(),
                    title: "Mailbox run".to_owned(),
                    objective: "Test addressed delivery".to_owned(),
                    review_policy: CodeReviewPolicy::Manual,
                    concurrency_limit: Some(1),
                    model: None,
                    coordinator_id: Some("local".to_owned()),
                    adapter_id: Some("codex-cli".to_owned()),
                },
                &run_id,
                1,
                1,
            )
            .await
            .expect("save run");
        (persistence, workspace_id, run_id, path)
    }

    #[tokio::test]
    async fn mailbox_is_fifo_idempotent_and_replayable_after_reopen() {
        let (persistence, _workspace_id, run_id, path) = fixture().await;
        let request = CodeMailboxSendRequest {
            run_id: run_id.clone(),
            sender_address: "coordinator:local".to_owned(),
            recipient_address: "worker:one".to_owned(),
            kind: CodeOrchestrationMessageKind::Progress,
            payload: "Inspect the bounded task.".to_owned(),
            thread_id: Some("thread-1".to_owned()),
            client_request_id: Some("request-1".to_owned()),
        };
        let first = persistence
            .send_orchestration_mailbox(&request)
            .await
            .expect("send");
        let replay = persistence
            .send_orchestration_mailbox(&request)
            .await
            .expect("replay");
        assert_eq!(first, replay);
        let second = persistence
            .send_orchestration_mailbox(&CodeMailboxSendRequest {
                client_request_id: Some("request-2".to_owned()),
                payload: "Report completion.".to_owned(),
                ..request.clone()
            })
            .await
            .expect("send second");
        assert_eq!(second.sequence, 2);
        let inbox = persistence
            .orchestration_inbox(&CodeMailboxQuery {
                run_id: run_id.clone(),
                recipient_address: "worker:one".to_owned(),
                include_acknowledged: false,
                limit: Some(10),
            })
            .await
            .expect("inbox");
        assert_eq!(inbox.len(), 2);
        assert_eq!(inbox[0].sequence, 1);
        assert!(persistence
            .acknowledge_orchestration_mailbox(&run_id, &first.id, "worker:one")
            .await
            .expect("ack"));
        assert_eq!(
            persistence
                .orchestration_inbox(&CodeMailboxQuery {
                    run_id: run_id.clone(),
                    recipient_address: "worker:one".to_owned(),
                    include_acknowledged: false,
                    limit: Some(10)
                })
                .await
                .expect("pending inbox")
                .len(),
            1
        );
        drop(persistence);
        let reopened = AgenticSuperAppPersistence::open(&path)
            .await
            .expect("reopen database");
        assert_eq!(
            reopened
                .orchestration_inbox(&CodeMailboxQuery {
                    run_id,
                    recipient_address: "worker:one".to_owned(),
                    include_acknowledged: true,
                    limit: Some(10)
                })
                .await
                .expect("replayed inbox")
                .len(),
            2
        );
        drop(reopened);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
    }

    #[tokio::test]
    async fn gates_require_the_allowed_actor_and_keep_resolution() {
        let (persistence, _workspace_id, run_id, path) = fixture().await;
        let gate = persistence
            .create_orchestration_gate(&CodeGateCreateRequest {
                run_id: run_id.clone(),
                task_id: None,
                dispatch_id: None,
                title: "Review publish".to_owned(),
                reason: "An explicit user decision is required.".to_owned(),
                allowed_actor: "user".to_owned(),
                expires_at_unix_ms: None,
            })
            .await
            .expect("create gate");
        assert!(persistence
            .resolve_orchestration_gate(&CodeGateResolveRequest {
                run_id: run_id.clone(),
                gate_id: gate.id.clone(),
                actor: "worker:one".to_owned(),
                state: CodeGateState::Approved,
                resolution: None,
            })
            .await
            .expect("wrong actor")
            .is_none());
        let resolved = persistence
            .resolve_orchestration_gate(&CodeGateResolveRequest {
                run_id: run_id.clone(),
                gate_id: gate.id.clone(),
                actor: "user".to_owned(),
                state: CodeGateState::Approved,
                resolution: Some("Reviewed locally.".to_owned()),
            })
            .await
            .expect("resolve")
            .expect("resolved gate");
        assert_eq!(resolved.state, CodeGateState::Approved);
        assert_eq!(
            persistence
                .orchestration_gates(&run_id, false)
                .await
                .expect("open gates")
                .len(),
            0
        );
        drop(persistence);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
    }
}
