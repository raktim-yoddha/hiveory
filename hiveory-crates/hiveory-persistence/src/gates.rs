//! Durable decision gates for high-impact orchestration actions.

use super::{now_ms, HiveoryPersistence};
use hiveory_protocol::{
    CodeDecisionGate, CodeGateCreateRequest, CodeGateResolveRequest, CodeGateState,
};
use sqlx::Row;
use uuid::Uuid;

impl HiveoryPersistence {
    pub async fn create_orchestration_gate(
        &self,
        request: &CodeGateCreateRequest,
    ) -> Result<CodeDecisionGate, sqlx::Error> {
        let now = now_ms();
        let gate = CodeDecisionGate {
            id: format!("gate-{}", Uuid::now_v7()),
            run_id: request.run_id.clone(),
            task_id: request.task_id.clone(),
            dispatch_id: request.dispatch_id.clone(),
            title: request.title.clone(),
            reason: request.reason.clone(),
            state: CodeGateState::Open,
            allowed_actor: request.allowed_actor.clone(),
            resolved_by: None,
            resolution: None,
            expires_at_unix_ms: request.expires_at_unix_ms,
            created_at_unix_ms: now,
            updated_at_unix_ms: now,
        };
        sqlx::query(
            "INSERT INTO hiveory_code_decision_gates (id, run_id, task_id, dispatch_id, title, reason, state, allowed_actor, resolved_by, resolution, expires_at_unix_ms, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, 'open', ?, NULL, NULL, ?, ?, ?)",
        )
        .bind(&gate.id)
        .bind(&gate.run_id)
        .bind(&gate.task_id)
        .bind(&gate.dispatch_id)
        .bind(&gate.title)
        .bind(&gate.reason)
        .bind(&gate.allowed_actor)
        .bind(gate.expires_at_unix_ms)
        .bind(gate.created_at_unix_ms)
        .bind(gate.updated_at_unix_ms)
        .execute(self.pool())
        .await?;
        Ok(gate)
    }

    pub async fn orchestration_gates(
        &self,
        run_id: &str,
        include_resolved: bool,
    ) -> Result<Vec<CodeDecisionGate>, sqlx::Error> {
        sqlx::query(
            "UPDATE hiveory_code_decision_gates SET state='timed_out', resolved_by='system', resolution='Gate expired before resolution.', updated_at_unix_ms=? WHERE run_id=? AND state='open' AND expires_at_unix_ms IS NOT NULL AND expires_at_unix_ms<=?",
        )
        .bind(now_ms())
        .bind(run_id)
        .bind(now_ms())
        .execute(self.pool())
        .await?;
        let rows = if include_resolved {
            sqlx::query(
                "SELECT id, run_id, task_id, dispatch_id, title, reason, state, allowed_actor, resolved_by, resolution, expires_at_unix_ms, created_at_unix_ms, updated_at_unix_ms FROM hiveory_code_decision_gates WHERE run_id=? ORDER BY CASE WHEN state='open' THEN 0 ELSE 1 END, updated_at_unix_ms DESC",
            )
            .bind(run_id)
            .fetch_all(self.pool())
            .await?
        } else {
            sqlx::query(
                "SELECT id, run_id, task_id, dispatch_id, title, reason, state, allowed_actor, resolved_by, resolution, expires_at_unix_ms, created_at_unix_ms, updated_at_unix_ms FROM hiveory_code_decision_gates WHERE run_id=? AND state='open' ORDER BY updated_at_unix_ms DESC",
            )
            .bind(run_id)
            .fetch_all(self.pool())
            .await?
        };
        Ok(rows.into_iter().map(gate_from_row).collect())
    }

    pub async fn resolve_orchestration_gate(
        &self,
        request: &CodeGateResolveRequest,
    ) -> Result<Option<CodeDecisionGate>, sqlx::Error> {
        let updated = sqlx::query(
            "UPDATE hiveory_code_decision_gates SET state=?, resolved_by=?, resolution=?, updated_at_unix_ms=? WHERE id=? AND run_id=? AND state='open' AND (allowed_actor='*' OR allowed_actor=?)",
        )
        .bind(gate_state_value(request.state))
        .bind(&request.actor)
        .bind(&request.resolution)
        .bind(now_ms())
        .bind(&request.gate_id)
        .bind(&request.run_id)
        .bind(&request.actor)
        .execute(self.pool())
        .await?;
        if updated.rows_affected() == 0 {
            return Ok(None);
        }
        sqlx::query(
            "SELECT id, run_id, task_id, dispatch_id, title, reason, state, allowed_actor, resolved_by, resolution, expires_at_unix_ms, created_at_unix_ms, updated_at_unix_ms FROM hiveory_code_decision_gates WHERE id=?",
        )
        .bind(&request.gate_id)
        .fetch_optional(self.pool())
        .await
        .map(|row| row.map(gate_from_row))
    }
}

fn gate_from_row(row: sqlx::sqlite::SqliteRow) -> CodeDecisionGate {
    CodeDecisionGate {
        id: row.get(0),
        run_id: row.get(1),
        task_id: row.get(2),
        dispatch_id: row.get(3),
        title: row.get(4),
        reason: row.get(5),
        state: parse_gate_state(&row.get::<String, _>(6)),
        allowed_actor: row.get(7),
        resolved_by: row.get(8),
        resolution: row.get(9),
        expires_at_unix_ms: row.get(10),
        created_at_unix_ms: row.get(11),
        updated_at_unix_ms: row.get(12),
    }
}

fn gate_state_value(state: CodeGateState) -> &'static str {
    match state {
        CodeGateState::Open => "open",
        CodeGateState::Approved => "approved",
        CodeGateState::Rejected => "rejected",
        CodeGateState::TimedOut => "timed_out",
    }
}

fn parse_gate_state(value: &str) -> CodeGateState {
    match value {
        "approved" => CodeGateState::Approved,
        "rejected" => CodeGateState::Rejected,
        "timed_out" => CodeGateState::TimedOut,
        _ => CodeGateState::Open,
    }
}
