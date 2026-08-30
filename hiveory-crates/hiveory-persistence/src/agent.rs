//! Durable storage for named Agents, conversations, runs, approvals, skills,
//! memory, and artifacts.

use hiveory_agent_domain::{
    memory_class_from_value, memory_class_value, memory_policy_from_value, memory_policy_value,
    policy_from_value, policy_value, run_state_from_value, run_state_value,
    skill_origin_from_value, skill_origin_value, tool_call_state_from_value, tool_call_state_value,
    tool_risk_from_value, tool_risk_value, validate_agent_create, validate_agent_update,
    validate_run_transition, validate_tool_transition, AgentSkillPackage,
};
use hiveory_protocol::{
    AgentApprovalDecision, AgentApprovalPolicy, AgentApprovalSummary, AgentArtifactKind,
    AgentArtifactSummary, AgentConversationCreateRequest, AgentConversationDetail,
    AgentConversationQuery, AgentConversationSummary, AgentCreateRequest, AgentDashboard,
    AgentDetail, AgentEventEnvelope, AgentEventKind, AgentEventsQuery, AgentFolderGrant,
    AgentFolderGrantRequest, AgentMemoryClass, AgentMemoryMutationRequest, AgentMemoryPolicy,
    AgentMemoryQuery, AgentMemorySummary, AgentMessage, AgentRunDetail, AgentRunStartRequest,
    AgentRunState, AgentRunSummary, AgentRuntimeLimits, AgentSkillConflict, AgentSkillOrigin,
    AgentSkillSummary, AgentSummary, AgentToolCallState, AgentToolCallSummary, AgentToolRisk,
    AgentUpdateRequest,
};
use serde_json::Value;
use sqlx::{sqlite::SqliteRow, Row};
use std::time::{SystemTime, UNIX_EPOCH};
use thiserror::Error;
use uuid::Uuid;

const DEFAULT_PAGE_SIZE: u32 = 50;

#[derive(Debug, Error)]
pub enum HiveoryAgentStoreError {
    #[error("agent was not found")]
    NotFound,
    #[error("agent request conflicts with existing durable state")]
    Conflict,
    #[error("agent input is invalid: {0}")]
    InvalidInput(String),
    #[error("the requested agent state is no longer current")]
    StaleLease,
    #[error("database failure: {0}")]
    Database(#[from] sqlx::Error),
    #[error("serialization failure: {0}")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Clone)]
pub struct HiveoryAgentStore {
    persistence: super::HiveoryPersistence,
}

impl HiveoryAgentStore {
    pub fn new(persistence: super::HiveoryPersistence) -> Self {
        Self { persistence }
    }

    pub fn persistence(&self) -> &super::HiveoryPersistence {
        &self.persistence
    }

    pub async fn create(
        &self,
        request: &AgentCreateRequest,
    ) -> Result<AgentDetail, HiveoryAgentStoreError> {
        validate_agent_create(request)
            .map_err(|error| HiveoryAgentStoreError::InvalidInput(error.to_string()))?;
        let id = Uuid::now_v7().to_string();
        let now = now_ms();
        let limits = serde_json::to_string(&request.runtime_limits)?;
        let mut transaction = self.persistence.pool().begin().await?;
        sqlx::query(
            "INSERT INTO hiveory_agents (id, name, description, avatar_color, provider_account_id, model, archived, current_version, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?, ?)",
        )
        .bind(&id)
        .bind(request.name.trim())
        .bind(request.description.trim())
        .bind(request.avatar_color.trim())
        .bind(request.provider_account_id.trim())
        .bind(request.model.trim())
        .bind(now)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO hiveory_agent_versions (agent_id, version, operating_brief, system_instructions, approval_policy, memory_policy, runtime_limits_json, created_at_unix_ms) VALUES (?, 1, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&id)
        .bind(&request.operating_brief)
        .bind(&request.system_instructions)
        .bind(policy_value(request.approval_policy))
        .bind(memory_policy_value(request.memory_policy))
        .bind(limits)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        self.detail(&id).await
    }

    pub async fn update(
        &self,
        request: &AgentUpdateRequest,
    ) -> Result<AgentDetail, HiveoryAgentStoreError> {
        validate_agent_update(request)
            .map_err(|error| HiveoryAgentStoreError::InvalidInput(error.to_string()))?;
        if self.agent_row(&request.agent_id).await?.is_none() {
            return Err(HiveoryAgentStoreError::NotFound);
        }
        let version: i64 = sqlx::query("SELECT current_version FROM hiveory_agents WHERE id=?")
            .bind(&request.agent_id)
            .fetch_one(self.persistence.pool())
            .await?
            .get(0);
        let next_version = u32::try_from(version).unwrap_or(1).saturating_add(1);
        let now = now_ms();
        let limits = serde_json::to_string(&request.runtime_limits)?;
        let mut transaction = self.persistence.pool().begin().await?;
        sqlx::query(
            "UPDATE hiveory_agents SET name=?, description=?, avatar_color=?, provider_account_id=?, model=?, current_version=?, updated_at_unix_ms=? WHERE id=?",
        )
        .bind(request.name.trim())
        .bind(request.description.trim())
        .bind(request.avatar_color.trim())
        .bind(request.provider_account_id.trim())
        .bind(request.model.trim())
        .bind(i64::from(next_version))
        .bind(now)
        .bind(&request.agent_id)
        .execute(&mut *transaction)
        .await?;
        sqlx::query(
            "INSERT INTO hiveory_agent_versions (agent_id, version, operating_brief, system_instructions, approval_policy, memory_policy, runtime_limits_json, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(&request.agent_id)
        .bind(i64::from(next_version))
        .bind(&request.operating_brief)
        .bind(&request.system_instructions)
        .bind(policy_value(request.approval_policy))
        .bind(memory_policy_value(request.memory_policy))
        .bind(limits)
        .bind(now)
        .execute(&mut *transaction)
        .await?;
        transaction.commit().await?;
        self.detail(&request.agent_id).await
    }

    pub async fn list(&self) -> Result<Vec<AgentSummary>, HiveoryAgentStoreError> {
        let rows = sqlx::query(
            "SELECT a.id, a.name, a.description, a.avatar_color, a.provider_account_id, a.model, a.current_version, a.archived, a.created_at_unix_ms, a.updated_at_unix_ms,
             (SELECT state FROM hiveory_agent_runs r WHERE r.agent_id=a.id AND r.state IN ('queued','preparing','running','awaiting_approval','awaiting_input','interrupted') ORDER BY r.updated_at_unix_ms DESC LIMIT 1),
             (SELECT COUNT(*) FROM hiveory_agent_skills s WHERE s.agent_id=a.id AND s.enabled=1),
             (SELECT COUNT(*) FROM hiveory_agent_tools t WHERE t.agent_id=a.id AND t.enabled=1),
             (SELECT COUNT(*) FROM hiveory_agent_folders f WHERE f.agent_id=a.id)
             FROM hiveory_agents a WHERE a.archived=0 ORDER BY a.updated_at_unix_ms DESC",
        )
        .fetch_all(self.persistence.pool())
        .await?;
        Ok(rows.into_iter().map(summary_from_row).collect())
    }

    pub async fn archive(
        &self,
        agent_id: &str,
        archived: bool,
    ) -> Result<(), HiveoryAgentStoreError> {
        let result =
            sqlx::query("UPDATE hiveory_agents SET archived=?, updated_at_unix_ms=? WHERE id=?")
                .bind(if archived { 1 } else { 0 })
                .bind(now_ms())
                .bind(agent_id)
                .execute(self.persistence.pool())
                .await?;
        if result.rows_affected() == 0 {
            return Err(HiveoryAgentStoreError::NotFound);
        }
        Ok(())
    }

    pub async fn delete(&self, agent_id: &str) -> Result<(), HiveoryAgentStoreError> {
        let mut transaction = self.persistence.pool().begin().await?;
        sqlx::query("DELETE FROM hiveory_agent_memory_fts WHERE agent_id=?")
            .bind(agent_id)
            .execute(&mut *transaction)
            .await?;
        let result = sqlx::query("DELETE FROM hiveory_agents WHERE id=?")
            .bind(agent_id)
            .execute(&mut *transaction)
            .await?;
        if result.rows_affected() == 0 {
            return Err(HiveoryAgentStoreError::NotFound);
        }
        transaction.commit().await?;
        Ok(())
    }

    pub async fn detail(&self, agent_id: &str) -> Result<AgentDetail, HiveoryAgentStoreError> {
        let row = self
            .agent_row(agent_id)
            .await?
            .ok_or(HiveoryAgentStoreError::NotFound)?;
        let version: i64 = row.get(7);
        let config = sqlx::query("SELECT operating_brief, system_instructions, approval_policy, memory_policy, runtime_limits_json FROM hiveory_agent_versions WHERE agent_id=? AND version=?")
            .bind(agent_id).bind(version).fetch_one(self.persistence.pool()).await?;
        let folders = self.folders(agent_id).await?;
        let skills = self.skills_for_agent(agent_id).await?;
        let conflicts = self.conflicts(agent_id).await?;
        let recent_runs = self.runs_for_agent(agent_id, 12).await?;
        Ok(AgentDetail {
            summary: summary_from_row(row),
            operating_brief: config.get(0),
            system_instructions: config.get(1),
            approval_policy: policy_from_value(config.get::<String, _>(2).as_str())
                .unwrap_or(AgentApprovalPolicy::AskForMutations),
            memory_policy: memory_policy_from_value(config.get::<String, _>(3).as_str())
                .unwrap_or(AgentMemoryPolicy::ExplicitOnly),
            runtime_limits: serde_json::from_str::<AgentRuntimeLimits>(&config.get::<String, _>(4))
                .unwrap_or_else(|_| default_limits()),
            folders,
            tools: Vec::new(),
            skills,
            conflicts,
            recent_runs,
        })
    }

    pub async fn add_folder(
        &self,
        request: &AgentFolderGrantRequest,
    ) -> Result<AgentFolderGrant, HiveoryAgentStoreError> {
        if request.path.trim().is_empty() || (!request.read && !request.write) {
            return Err(HiveoryAgentStoreError::InvalidInput(
                "a readable or writable folder grant is required".to_owned(),
            ));
        }
        self.ensure_agent(&request.agent_id).await?;
        let path = std::path::Path::new(request.path.trim());
        let root_path = path.canonicalize().map_err(|_| {
            HiveoryAgentStoreError::InvalidInput(
                "folder must exist and be canonicalizable".to_owned(),
            )
        })?;
        if !root_path.is_dir() {
            return Err(HiveoryAgentStoreError::InvalidInput(
                "folder grant must point to a directory".to_owned(),
            ));
        }
        let root_path = root_path.to_string_lossy().to_string();
        let display_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .filter(|name| !name.is_empty())
            .unwrap_or("Granted folder")
            .to_owned();
        let grant = AgentFolderGrant {
            id: Uuid::now_v7().to_string(),
            agent_id: request.agent_id.clone(),
            display_name,
            root_path,
            read: request.read,
            write: request.write,
            created_at_unix_ms: now_ms(),
        };
        let result = sqlx::query("INSERT INTO hiveory_agent_folders (id, agent_id, display_name, root_path, can_read, can_write, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?)")
            .bind(&grant.id).bind(&grant.agent_id).bind(&grant.display_name).bind(&grant.root_path).bind(if grant.read { 1 } else { 0 }).bind(if grant.write { 1 } else { 0 }).bind(grant.created_at_unix_ms).execute(self.persistence.pool()).await;
        match result {
            Ok(_) => Ok(grant),
            Err(sqlx::Error::Database(error)) if error.message().contains("UNIQUE") => {
                Err(HiveoryAgentStoreError::Conflict)
            }
            Err(error) => Err(error.into()),
        }
    }

    pub async fn delete_folder(
        &self,
        agent_id: &str,
        grant_id: &str,
    ) -> Result<(), HiveoryAgentStoreError> {
        let result = sqlx::query("DELETE FROM hiveory_agent_folders WHERE agent_id=? AND id=?")
            .bind(agent_id)
            .bind(grant_id)
            .execute(self.persistence.pool())
            .await?;
        if result.rows_affected() == 0 {
            return Err(HiveoryAgentStoreError::NotFound);
        }
        Ok(())
    }

    pub async fn folders(
        &self,
        agent_id: &str,
    ) -> Result<Vec<AgentFolderGrant>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT id, agent_id, display_name, root_path, can_read, can_write, created_at_unix_ms FROM hiveory_agent_folders WHERE agent_id=? ORDER BY display_name")
            .bind(agent_id).fetch_all(self.persistence.pool()).await?.into_iter().map(|row| AgentFolderGrant { id: row.get(0), agent_id: row.get(1), display_name: row.get(2), root_path: row.get(3), read: row.get::<i64, _>(4) != 0, write: row.get::<i64, _>(5) != 0, created_at_unix_ms: row.get(6) }).collect())
    }

    pub async fn enable_tool(
        &self,
        agent_id: &str,
        name: &str,
        enabled: bool,
    ) -> Result<(), HiveoryAgentStoreError> {
        self.ensure_agent(agent_id).await?;
        sqlx::query("INSERT INTO hiveory_agent_tools (agent_id, tool_name, enabled) VALUES (?, ?, ?) ON CONFLICT(agent_id, tool_name) DO UPDATE SET enabled=excluded.enabled")
            .bind(agent_id).bind(name).bind(if enabled { 1 } else { 0 }).execute(self.persistence.pool()).await?;
        Ok(())
    }

    pub async fn enabled_tools(
        &self,
        agent_id: &str,
    ) -> Result<Vec<String>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT tool_name FROM hiveory_agent_tools WHERE agent_id=? AND enabled=1 ORDER BY tool_name").bind(agent_id).fetch_all(self.persistence.pool()).await?.into_iter().map(|row| row.get(0)).collect())
    }

    pub async fn upsert_skill(
        &self,
        package: &AgentSkillPackage,
    ) -> Result<(), HiveoryAgentStoreError> {
        let summary = &package.summary;
        sqlx::query("INSERT INTO hiveory_skill_catalog (id, name, version, description, origin, source_path, triggers_json, permissions_json, instructions, resources_json, valid, validation_message, discovered_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET name=excluded.name, version=excluded.version, description=excluded.description, origin=excluded.origin, source_path=excluded.source_path, triggers_json=excluded.triggers_json, permissions_json=excluded.permissions_json, instructions=excluded.instructions, resources_json=excluded.resources_json, valid=excluded.valid, validation_message=excluded.validation_message, discovered_at_unix_ms=excluded.discovered_at_unix_ms")
            .bind(&summary.id).bind(&summary.name).bind(&summary.version).bind(&summary.description).bind(skill_origin_value(summary.origin)).bind(&summary.source_path).bind(serde_json::to_string(&summary.triggers)?).bind(serde_json::to_string(&summary.permissions)?).bind(&package.instructions).bind(serde_json::to_string(&package.resources)?).bind(if summary.valid { 1 } else { 0 }).bind(&summary.validation_message).bind(now_ms()).execute(self.persistence.pool()).await?;
        Ok(())
    }

    pub async fn catalog(&self) -> Result<Vec<AgentSkillSummary>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT c.id, c.name, c.version, c.description, c.origin, c.source_path, c.triggers_json, c.permissions_json, c.valid, c.validation_message, 0 FROM hiveory_skill_catalog c ORDER BY c.name")
            .fetch_all(self.persistence.pool()).await?.into_iter().map(skill_from_row).collect())
    }

    pub async fn skills_for_agent(
        &self,
        agent_id: &str,
    ) -> Result<Vec<AgentSkillSummary>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT c.id, c.name, c.version, c.description, c.origin, c.source_path, c.triggers_json, c.permissions_json, c.valid, c.validation_message, COALESCE(s.enabled, 0) FROM hiveory_skill_catalog c LEFT JOIN hiveory_agent_skills s ON s.skill_id=c.id AND s.agent_id=? ORDER BY c.name")
            .bind(agent_id).fetch_all(self.persistence.pool()).await?.into_iter().map(skill_from_row).collect())
    }

    pub async fn set_skill_enabled(
        &self,
        agent_id: &str,
        skill_id: &str,
        enabled: bool,
    ) -> Result<(), HiveoryAgentStoreError> {
        self.ensure_agent(agent_id).await?;
        sqlx::query("INSERT INTO hiveory_agent_skills (agent_id, skill_id, enabled) VALUES (?, ?, ?) ON CONFLICT(agent_id, skill_id) DO UPDATE SET enabled=excluded.enabled").bind(agent_id).bind(skill_id).bind(if enabled { 1 } else { 0 }).execute(self.persistence.pool()).await?;
        Ok(())
    }

    pub async fn skill_package(
        &self,
        skill_id: &str,
    ) -> Result<Option<(AgentSkillSummary, String)>, HiveoryAgentStoreError> {
        let Some(row) = sqlx::query("SELECT id, name, version, description, origin, source_path, triggers_json, permissions_json, valid, validation_message, 0, instructions FROM hiveory_skill_catalog WHERE id=?").bind(skill_id).fetch_optional(self.persistence.pool()).await? else { return Ok(None); };
        let summary = AgentSkillSummary {
            id: row.get(0),
            name: row.get(1),
            version: row.get(2),
            description: row.get(3),
            origin: skill_origin_from_value(&row.get::<String, _>(4))
                .unwrap_or(AgentSkillOrigin::ApplicationData),
            source_path: row.get(5),
            triggers: serde_json::from_str(&row.get::<String, _>(6)).unwrap_or_default(),
            permissions: serde_json::from_str(&row.get::<String, _>(7)).unwrap_or_default(),
            enabled: row.get::<i64, _>(10) != 0,
            valid: row.get::<i64, _>(8) != 0,
            validation_message: row.get(9),
        };
        Ok(Some((summary, row.get(11))))
    }

    pub async fn set_skill_conflict(
        &self,
        agent_id: &str,
        trigger: &str,
        skill_id: &str,
    ) -> Result<(), HiveoryAgentStoreError> {
        self.ensure_agent(agent_id).await?;
        sqlx::query("INSERT INTO hiveory_skill_conflicts (agent_id, trigger, selected_skill_id) VALUES (?, ?, ?) ON CONFLICT(agent_id, trigger) DO UPDATE SET selected_skill_id=excluded.selected_skill_id").bind(agent_id).bind(trigger.trim()).bind(skill_id).execute(self.persistence.pool()).await?;
        Ok(())
    }

    pub async fn conflicts(
        &self,
        agent_id: &str,
    ) -> Result<Vec<AgentSkillConflict>, HiveoryAgentStoreError> {
        let skills = self.skills_for_agent(agent_id).await?;
        let mut by_trigger = std::collections::BTreeMap::<String, Vec<String>>::new();
        for skill in skills {
            for trigger in skill.triggers {
                by_trigger
                    .entry(trigger)
                    .or_default()
                    .push(skill.id.clone());
            }
        }
        let selected = sqlx::query(
            "SELECT trigger, selected_skill_id FROM hiveory_skill_conflicts WHERE agent_id=?",
        )
        .bind(agent_id)
        .fetch_all(self.persistence.pool())
        .await?
        .into_iter()
        .map(|row| (row.get::<String, _>(0), row.get::<Option<String>, _>(1)))
        .collect::<std::collections::HashMap<_, _>>();
        Ok(by_trigger
            .into_iter()
            .filter(|(_, ids)| ids.len() > 1)
            .map(|(trigger, skill_ids)| AgentSkillConflict {
                selected_skill_id: selected.get(&trigger).cloned().flatten(),
                trigger,
                skill_ids,
            })
            .collect())
    }

    pub async fn create_conversation(
        &self,
        request: &AgentConversationCreateRequest,
    ) -> Result<AgentConversationDetail, HiveoryAgentStoreError> {
        self.ensure_agent(&request.agent_id).await?;
        let id = Uuid::now_v7().to_string();
        let now = now_ms();
        let title = request
            .title
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("New agent conversation")
            .chars()
            .take(120)
            .collect::<String>();
        sqlx::query("INSERT INTO hiveory_agent_conversations (id, agent_id, title, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?)").bind(&id).bind(&request.agent_id).bind(title).bind(now).bind(now).execute(self.persistence.pool()).await?;
        self.conversation_detail(&id).await
    }

    pub async fn conversations(
        &self,
        query: &AgentConversationQuery,
    ) -> Result<Vec<AgentConversationSummary>, HiveoryAgentStoreError> {
        self.ensure_agent(&query.agent_id).await?;
        let limit = i64::from(query.limit.unwrap_or(DEFAULT_PAGE_SIZE).clamp(1, 100));
        Ok(sqlx::query("SELECT c.id, c.agent_id, c.title, (SELECT COUNT(*) FROM hiveory_agent_messages m WHERE m.conversation_id=c.id), c.updated_at_unix_ms FROM hiveory_agent_conversations c WHERE c.agent_id=? ORDER BY c.updated_at_unix_ms DESC LIMIT ?").bind(&query.agent_id).bind(limit).fetch_all(self.persistence.pool()).await?.into_iter().map(|row| AgentConversationSummary { id: row.get(0), agent_id: row.get(1), title: row.get(2), message_count: row.get::<i64, _>(3).max(0) as u32, updated_at_unix_ms: row.get(4) }).collect())
    }

    pub async fn conversation_detail(
        &self,
        conversation_id: &str,
    ) -> Result<AgentConversationDetail, HiveoryAgentStoreError> {
        let row = sqlx::query("SELECT id, agent_id, title, updated_at_unix_ms FROM hiveory_agent_conversations WHERE id=?").bind(conversation_id).fetch_optional(self.persistence.pool()).await?.ok_or(HiveoryAgentStoreError::NotFound)?;
        let messages = self.conversation_messages(conversation_id).await?;
        let runs = self.conversation_runs(conversation_id).await?;
        Ok(AgentConversationDetail {
            id: row.get(0),
            agent_id: row.get(1),
            title: row.get(2),
            messages,
            runs,
            draft: String::new(),
            updated_at_unix_ms: row.get(3),
        })
    }

    async fn conversation_messages(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<AgentMessage>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT id, run_id, role, kind, content, tool_call_id, created_at_unix_ms FROM hiveory_agent_messages WHERE conversation_id=? ORDER BY created_at_unix_ms ASC LIMIT 500").bind(conversation_id).fetch_all(self.persistence.pool()).await?.into_iter().map(message_from_row).collect())
    }

    async fn conversation_runs(
        &self,
        conversation_id: &str,
    ) -> Result<Vec<AgentRunSummary>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT id, agent_id, agent_version, conversation_id, state, substr(prompt, 1, 160), background, step_count, tool_call_count, pending_approval_id, lease_generation, input_tokens, output_tokens, error, created_at_unix_ms, updated_at_unix_ms, completed_at_unix_ms FROM hiveory_agent_runs WHERE conversation_id=? ORDER BY created_at_unix_ms DESC").bind(conversation_id).fetch_all(self.persistence.pool()).await?.into_iter().map(run_from_row).collect())
    }

    pub async fn create_run(
        &self,
        request: &AgentRunStartRequest,
    ) -> Result<AgentRunSummary, HiveoryAgentStoreError> {
        self.ensure_agent(&request.agent_id).await?;
        if request.prompt.trim().is_empty() {
            return Err(HiveoryAgentStoreError::InvalidInput(
                "prompt is required".to_owned(),
            ));
        }
        let conversation_id = if let Some(id) = request.conversation_id.as_deref() {
            let owner: String =
                sqlx::query("SELECT agent_id FROM hiveory_agent_conversations WHERE id=?")
                    .bind(id)
                    .fetch_optional(self.persistence.pool())
                    .await?
                    .ok_or(HiveoryAgentStoreError::NotFound)?
                    .get(0);
            if owner != request.agent_id {
                return Err(HiveoryAgentStoreError::Conflict);
            }
            id.to_owned()
        } else {
            let detail = self
                .create_conversation(&AgentConversationCreateRequest {
                    agent_id: request.agent_id.clone(),
                    title: Some(request.prompt.trim().chars().take(80).collect()),
                })
                .await?;
            detail.id
        };
        let id = Uuid::now_v7().to_string();
        let now = now_ms();
        let version: i64 = sqlx::query("SELECT current_version FROM hiveory_agents WHERE id=?")
            .bind(&request.agent_id)
            .fetch_one(self.persistence.pool())
            .await?
            .get(0);
        sqlx::query("INSERT INTO hiveory_agent_runs (id, agent_id, agent_version, conversation_id, state, prompt, background, routine_execution_id, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, 'queued', ?, ?, ?, ?, ?)").bind(&id).bind(&request.agent_id).bind(version).bind(&conversation_id).bind(request.prompt.trim()).bind(if request.background { 1 } else { 0 }).bind(&request.routine_execution_id).bind(now).bind(now).execute(self.persistence.pool()).await?;
        sqlx::query("INSERT INTO hiveory_agent_messages (id, run_id, conversation_id, role, kind, content, created_at_unix_ms) VALUES (?, ?, ?, 'user', 'prompt', ?, ?)").bind(Uuid::now_v7().to_string()).bind(&id).bind(&conversation_id).bind(request.prompt.trim()).bind(now).execute(self.persistence.pool()).await?;
        sqlx::query("UPDATE hiveory_agent_conversations SET updated_at_unix_ms=? WHERE id=?")
            .bind(now)
            .bind(conversation_id)
            .execute(self.persistence.pool())
            .await?;
        self.run(&id).await?.ok_or(HiveoryAgentStoreError::NotFound)
    }

    pub async fn run(
        &self,
        run_id: &str,
    ) -> Result<Option<AgentRunSummary>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT id, agent_id, agent_version, conversation_id, state, substr(prompt, 1, 160), background, step_count, tool_call_count, pending_approval_id, lease_generation, input_tokens, output_tokens, error, created_at_unix_ms, updated_at_unix_ms, completed_at_unix_ms FROM hiveory_agent_runs WHERE id=?").bind(run_id).fetch_optional(self.persistence.pool()).await?.map(run_from_row))
    }

    pub async fn routine_execution_id(
        &self,
        run_id: &str,
    ) -> Result<Option<String>, HiveoryAgentStoreError> {
        Ok(
            sqlx::query("SELECT routine_execution_id FROM hiveory_agent_runs WHERE id=?")
                .bind(run_id)
                .fetch_optional(self.persistence.pool())
                .await?
                .and_then(|row| row.get(0)),
        )
    }

    pub async fn runs(
        &self,
        agent_id: Option<&str>,
        state: Option<AgentRunState>,
        limit: u32,
    ) -> Result<Vec<AgentRunSummary>, HiveoryAgentStoreError> {
        let limit = i64::from(limit.clamp(1, 200));
        let rows = match (agent_id, state) {
            (Some(agent_id), Some(state)) => sqlx::query("SELECT id, agent_id, agent_version, conversation_id, state, substr(prompt, 1, 160), background, step_count, tool_call_count, pending_approval_id, lease_generation, input_tokens, output_tokens, error, created_at_unix_ms, updated_at_unix_ms, completed_at_unix_ms FROM hiveory_agent_runs WHERE agent_id=? AND state=? ORDER BY updated_at_unix_ms DESC LIMIT ?")
                .bind(agent_id).bind(run_state_value(state)).bind(limit).fetch_all(self.persistence.pool()).await?,
            (Some(agent_id), None) => sqlx::query("SELECT id, agent_id, agent_version, conversation_id, state, substr(prompt, 1, 160), background, step_count, tool_call_count, pending_approval_id, lease_generation, input_tokens, output_tokens, error, created_at_unix_ms, updated_at_unix_ms, completed_at_unix_ms FROM hiveory_agent_runs WHERE agent_id=? ORDER BY updated_at_unix_ms DESC LIMIT ?")
                .bind(agent_id).bind(limit).fetch_all(self.persistence.pool()).await?,
            (None, Some(state)) => sqlx::query("SELECT id, agent_id, agent_version, conversation_id, state, substr(prompt, 1, 160), background, step_count, tool_call_count, pending_approval_id, lease_generation, input_tokens, output_tokens, error, created_at_unix_ms, updated_at_unix_ms, completed_at_unix_ms FROM hiveory_agent_runs WHERE state=? ORDER BY updated_at_unix_ms DESC LIMIT ?")
                .bind(run_state_value(state)).bind(limit).fetch_all(self.persistence.pool()).await?,
            (None, None) => sqlx::query("SELECT id, agent_id, agent_version, conversation_id, state, substr(prompt, 1, 160), background, step_count, tool_call_count, pending_approval_id, lease_generation, input_tokens, output_tokens, error, created_at_unix_ms, updated_at_unix_ms, completed_at_unix_ms FROM hiveory_agent_runs ORDER BY updated_at_unix_ms DESC LIMIT ?")
                .bind(limit).fetch_all(self.persistence.pool()).await?,
        };
        Ok(rows.into_iter().map(run_from_row).collect())
    }

    async fn runs_for_agent(
        &self,
        agent_id: &str,
        limit: u32,
    ) -> Result<Vec<AgentRunSummary>, HiveoryAgentStoreError> {
        self.runs(Some(agent_id), None, limit).await
    }

    pub async fn claim_run(
        &self,
        run_id: &str,
    ) -> Result<Option<(AgentRunSummary, u64)>, HiveoryAgentStoreError> {
        let result = sqlx::query("UPDATE hiveory_agent_runs SET state='preparing', lease_generation=lease_generation+1, updated_at_unix_ms=? WHERE id=? AND state IN ('queued','interrupted')").bind(now_ms()).bind(run_id).execute(self.persistence.pool()).await?;
        if result.rows_affected() == 0 {
            return Ok(None);
        }
        let run = self
            .run(run_id)
            .await?
            .ok_or(HiveoryAgentStoreError::NotFound)?;
        Ok(Some((run.clone(), run.lease_generation)))
    }

    pub async fn transition_run(
        &self,
        run_id: &str,
        next: AgentRunState,
        lease: Option<u64>,
        error: Option<&str>,
    ) -> Result<AgentRunSummary, HiveoryAgentStoreError> {
        let current = self
            .run(run_id)
            .await?
            .ok_or(HiveoryAgentStoreError::NotFound)?;
        validate_run_transition(current.state, next)
            .map_err(|value| HiveoryAgentStoreError::InvalidInput(value.to_string()))?;
        let completed = if matches!(
            next,
            AgentRunState::Completed | AgentRunState::Failed | AgentRunState::Cancelled
        ) {
            Some(now_ms())
        } else {
            None
        };
        let result = if let Some(lease) = lease {
            sqlx::query("UPDATE hiveory_agent_runs SET state=?, error=?, updated_at_unix_ms=?, completed_at_unix_ms=? WHERE id=? AND lease_generation=?")
                .bind(run_state_value(next)).bind(error).bind(now_ms()).bind(completed).bind(run_id).bind(i64::try_from(lease).unwrap_or(i64::MAX)).execute(self.persistence.pool()).await?
        } else {
            sqlx::query("UPDATE hiveory_agent_runs SET state=?, error=?, updated_at_unix_ms=?, completed_at_unix_ms=? WHERE id=?")
                .bind(run_state_value(next)).bind(error).bind(now_ms()).bind(completed).bind(run_id).execute(self.persistence.pool()).await?
        };
        if result.rows_affected() == 0 && lease.is_some() {
            return Err(HiveoryAgentStoreError::StaleLease);
        }
        self.run(run_id)
            .await?
            .ok_or(HiveoryAgentStoreError::NotFound)
    }

    pub async fn increment_progress(
        &self,
        run_id: &str,
        lease: u64,
        step: bool,
        tool_call: bool,
    ) -> Result<(), HiveoryAgentStoreError> {
        let result = sqlx::query("UPDATE hiveory_agent_runs SET step_count=step_count+?, tool_call_count=tool_call_count+?, updated_at_unix_ms=? WHERE id=? AND lease_generation=?")
            .bind(if step { 1 } else { 0 }).bind(if tool_call { 1 } else { 0 }).bind(now_ms()).bind(run_id).bind(i64::try_from(lease).unwrap_or(i64::MAX)).execute(self.persistence.pool()).await?;
        if result.rows_affected() == 0 {
            return Err(HiveoryAgentStoreError::StaleLease);
        }
        Ok(())
    }

    pub async fn set_usage(
        &self,
        run_id: &str,
        lease: u64,
        input_tokens: Option<u64>,
        output_tokens: Option<u64>,
    ) -> Result<(), HiveoryAgentStoreError> {
        let result = sqlx::query("UPDATE hiveory_agent_runs SET input_tokens=?, output_tokens=?, updated_at_unix_ms=? WHERE id=? AND lease_generation=?").bind(input_tokens.map(|value| i64::try_from(value).unwrap_or(i64::MAX))).bind(output_tokens.map(|value| i64::try_from(value).unwrap_or(i64::MAX))).bind(now_ms()).bind(run_id).bind(i64::try_from(lease).unwrap_or(i64::MAX)).execute(self.persistence.pool()).await?;
        if result.rows_affected() == 0 {
            return Err(HiveoryAgentStoreError::StaleLease);
        }
        Ok(())
    }

    pub async fn set_pending_approval(
        &self,
        run_id: &str,
        lease: u64,
        approval_id: Option<&str>,
    ) -> Result<(), HiveoryAgentStoreError> {
        let result = sqlx::query("UPDATE hiveory_agent_runs SET pending_approval_id=?, updated_at_unix_ms=? WHERE id=? AND lease_generation=?").bind(approval_id).bind(now_ms()).bind(run_id).bind(i64::try_from(lease).unwrap_or(i64::MAX)).execute(self.persistence.pool()).await?;
        if result.rows_affected() == 0 {
            return Err(HiveoryAgentStoreError::StaleLease);
        }
        Ok(())
    }

    pub async fn interrupt_active_runs(&self) -> Result<usize, HiveoryAgentStoreError> {
        Ok(sqlx::query("UPDATE hiveory_agent_runs SET state='interrupted', updated_at_unix_ms=? WHERE state IN ('queued','preparing','running')").bind(now_ms()).execute(self.persistence.pool()).await?.rows_affected() as usize)
    }

    pub async fn requeue_run(
        &self,
        run_id: &str,
    ) -> Result<AgentRunSummary, HiveoryAgentStoreError> {
        let result = sqlx::query("UPDATE hiveory_agent_runs SET state='queued', pending_approval_id=NULL, error=NULL, completed_at_unix_ms=NULL, updated_at_unix_ms=? WHERE id=? AND state IN ('awaiting_approval','awaiting_input','interrupted')")
            .bind(now_ms()).bind(run_id).execute(self.persistence.pool()).await?;
        if result.rows_affected() == 0 {
            return Err(HiveoryAgentStoreError::Conflict);
        }
        self.run(run_id)
            .await?
            .ok_or(HiveoryAgentStoreError::NotFound)
    }

    pub async fn set_parent_run(
        &self,
        run_id: &str,
        parent_run_id: &str,
    ) -> Result<(), HiveoryAgentStoreError> {
        let result = sqlx::query(
            "UPDATE hiveory_agent_runs SET parent_run_id=?, updated_at_unix_ms=? WHERE id=?",
        )
        .bind(parent_run_id)
        .bind(now_ms())
        .bind(run_id)
        .execute(self.persistence.pool())
        .await?;
        if result.rows_affected() == 0 {
            return Err(HiveoryAgentStoreError::NotFound);
        }
        Ok(())
    }

    pub async fn parent_run_id(
        &self,
        run_id: &str,
    ) -> Result<Option<String>, HiveoryAgentStoreError> {
        Ok(
            sqlx::query("SELECT parent_run_id FROM hiveory_agent_runs WHERE id=?")
                .bind(run_id)
                .fetch_optional(self.persistence.pool())
                .await?
                .ok_or(HiveoryAgentStoreError::NotFound)?
                .get(0),
        )
    }

    pub async fn child_runs(
        &self,
        parent_run_id: &str,
        limit: u32,
    ) -> Result<Vec<AgentRunSummary>, HiveoryAgentStoreError> {
        let limit = i64::from(limit.clamp(1, 200));
        Ok(sqlx::query("SELECT id, agent_id, agent_version, conversation_id, state, substr(prompt, 1, 160), background, step_count, tool_call_count, pending_approval_id, lease_generation, input_tokens, output_tokens, error, created_at_unix_ms, updated_at_unix_ms, completed_at_unix_ms FROM hiveory_agent_runs WHERE parent_run_id=? ORDER BY updated_at_unix_ms DESC LIMIT ?")
            .bind(parent_run_id)
            .bind(limit)
            .fetch_all(self.persistence.pool())
            .await?
            .into_iter()
            .map(run_from_row)
            .collect())
    }

    pub async fn active_child_run_count(
        &self,
        parent_run_id: &str,
    ) -> Result<u32, HiveoryAgentStoreError> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM hiveory_agent_runs WHERE parent_run_id=? AND state IN ('queued','preparing','running','awaiting_approval','awaiting_input','interrupted')")
            .bind(parent_run_id)
            .fetch_one(self.persistence.pool())
            .await?;
        Ok(count.max(0) as u32)
    }

    pub async fn append_message(
        &self,
        run_id: &str,
        role: &str,
        kind: &str,
        content: &str,
        tool_call_id: Option<&str>,
    ) -> Result<AgentMessage, HiveoryAgentStoreError> {
        let row = sqlx::query("SELECT conversation_id FROM hiveory_agent_runs WHERE id=?")
            .bind(run_id)
            .fetch_optional(self.persistence.pool())
            .await?
            .ok_or(HiveoryAgentStoreError::NotFound)?;
        let message = AgentMessage {
            id: Uuid::now_v7().to_string(),
            run_id: run_id.to_owned(),
            role: role.to_owned(),
            kind: kind.to_owned(),
            content: content.to_owned(),
            tool_call_id: tool_call_id.map(str::to_owned),
            created_at_unix_ms: now_ms(),
        };
        sqlx::query("INSERT INTO hiveory_agent_messages (id, run_id, conversation_id, role, kind, content, tool_call_id, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(&message.id).bind(run_id).bind(row.get::<String, _>(0)).bind(&message.role).bind(&message.kind).bind(&message.content).bind(&message.tool_call_id).bind(message.created_at_unix_ms).execute(self.persistence.pool()).await?;
        Ok(message)
    }

    pub async fn messages(
        &self,
        run_id: &str,
    ) -> Result<Vec<AgentMessage>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT id, run_id, role, kind, content, tool_call_id, created_at_unix_ms FROM hiveory_agent_messages WHERE run_id=? ORDER BY created_at_unix_ms ASC").bind(run_id).fetch_all(self.persistence.pool()).await?.into_iter().map(message_from_row).collect())
    }

    pub async fn create_tool_call(
        &self,
        run_id: &str,
        call_id: &str,
        name: &str,
        arguments_json: &str,
        risk: AgentToolRisk,
    ) -> Result<AgentToolCallSummary, HiveoryAgentStoreError> {
        if let Some(existing) = self.tool_call(run_id, call_id).await? {
            return Ok(existing);
        }
        let now = now_ms();
        let summary = AgentToolCallSummary {
            id: Uuid::now_v7().to_string(),
            run_id: run_id.to_owned(),
            call_id: call_id.to_owned(),
            name: name.to_owned(),
            arguments_json: arguments_json.to_owned(),
            risk,
            state: AgentToolCallState::Proposed,
            approval_id: None,
            result_preview: None,
            created_at_unix_ms: now,
            updated_at_unix_ms: now,
        };
        sqlx::query("INSERT INTO hiveory_agent_tool_calls (id, run_id, call_id, name, arguments_json, risk, state, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, 'proposed', ?, ?)").bind(&summary.id).bind(run_id).bind(call_id).bind(name).bind(arguments_json).bind(tool_risk_value(risk)).bind(now).bind(now).execute(self.persistence.pool()).await?;
        Ok(summary)
    }

    pub async fn tool_call(
        &self,
        run_id: &str,
        call_id: &str,
    ) -> Result<Option<AgentToolCallSummary>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT id, run_id, call_id, name, arguments_json, risk, state, approval_id, result_preview, created_at_unix_ms, updated_at_unix_ms FROM hiveory_agent_tool_calls WHERE run_id=? AND call_id=?").bind(run_id).bind(call_id).fetch_optional(self.persistence.pool()).await?.map(tool_call_from_row))
    }

    pub async fn tool_call_by_id(
        &self,
        tool_call_id: &str,
    ) -> Result<Option<AgentToolCallSummary>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT id, run_id, call_id, name, arguments_json, risk, state, approval_id, result_preview, created_at_unix_ms, updated_at_unix_ms FROM hiveory_agent_tool_calls WHERE id=?").bind(tool_call_id).fetch_optional(self.persistence.pool()).await?.map(tool_call_from_row))
    }

    pub async fn update_tool_call(
        &self,
        tool_call_id: &str,
        state: AgentToolCallState,
        approval_id: Option<&str>,
        result_preview: Option<&str>,
        result_json: Option<&str>,
    ) -> Result<AgentToolCallSummary, HiveoryAgentStoreError> {
        let current = sqlx::query("SELECT state FROM hiveory_agent_tool_calls WHERE id=?")
            .bind(tool_call_id)
            .fetch_optional(self.persistence.pool())
            .await?
            .ok_or(HiveoryAgentStoreError::NotFound)?;
        let current = tool_call_state_from_value(&current.get::<String, _>(0)).ok_or(
            HiveoryAgentStoreError::InvalidInput("unknown tool call state".to_owned()),
        )?;
        validate_tool_transition(current, state)
            .map_err(|value| HiveoryAgentStoreError::InvalidInput(value.to_string()))?;
        sqlx::query("UPDATE hiveory_agent_tool_calls SET state=?, approval_id=COALESCE(?, approval_id), result_preview=?, result_json=?, updated_at_unix_ms=? WHERE id=?").bind(tool_call_state_value(state)).bind(approval_id).bind(result_preview).bind(result_json).bind(now_ms()).bind(tool_call_id).execute(self.persistence.pool()).await?;
        Ok(sqlx::query("SELECT id, run_id, call_id, name, arguments_json, risk, state, approval_id, result_preview, created_at_unix_ms, updated_at_unix_ms FROM hiveory_agent_tool_calls WHERE id=?").bind(tool_call_id).fetch_one(self.persistence.pool()).await.map(tool_call_from_row)?)
    }

    #[allow(clippy::too_many_arguments)]
    pub async fn create_approval(
        &self,
        run_id: &str,
        tool_call_id: &str,
        tool_name: &str,
        target: &str,
        arguments_json: &str,
        fingerprint: &str,
        reversible: bool,
    ) -> Result<AgentApprovalSummary, HiveoryAgentStoreError> {
        let approval = AgentApprovalSummary {
            id: Uuid::now_v7().to_string(),
            run_id: run_id.to_owned(),
            tool_call_id: tool_call_id.to_owned(),
            tool_name: tool_name.to_owned(),
            target: target.to_owned(),
            arguments_json: arguments_json.to_owned(),
            fingerprint: fingerprint.to_owned(),
            reversible,
            state: "pending".to_owned(),
            created_at_unix_ms: now_ms(),
            resolved_at_unix_ms: None,
        };
        sqlx::query("INSERT INTO hiveory_agent_approvals (id, run_id, tool_call_id, tool_name, target, arguments_json, fingerprint, reversible, state, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)").bind(&approval.id).bind(run_id).bind(tool_call_id).bind(tool_name).bind(target).bind(arguments_json).bind(fingerprint).bind(if reversible { 1 } else { 0 }).bind(approval.created_at_unix_ms).execute(self.persistence.pool()).await?;
        Ok(approval)
    }

    pub async fn approval(
        &self,
        approval_id: &str,
    ) -> Result<Option<AgentApprovalSummary>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT id, run_id, tool_call_id, tool_name, target, arguments_json, fingerprint, reversible, state, created_at_unix_ms, resolved_at_unix_ms FROM hiveory_agent_approvals WHERE id=?").bind(approval_id).fetch_optional(self.persistence.pool()).await?.map(approval_from_row))
    }

    pub async fn pending_approvals(
        &self,
    ) -> Result<Vec<AgentApprovalSummary>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT id, run_id, tool_call_id, tool_name, target, arguments_json, fingerprint, reversible, state, created_at_unix_ms, resolved_at_unix_ms FROM hiveory_agent_approvals WHERE state='pending' ORDER BY created_at_unix_ms").fetch_all(self.persistence.pool()).await?.into_iter().map(approval_from_row).collect())
    }

    pub async fn resolve_approval(
        &self,
        approval_id: &str,
        fingerprint: &str,
        decision: AgentApprovalDecision,
        comment: Option<&str>,
    ) -> Result<AgentApprovalSummary, HiveoryAgentStoreError> {
        let approval = self
            .approval(approval_id)
            .await?
            .ok_or(HiveoryAgentStoreError::NotFound)?;
        if approval.state != "pending" || approval.fingerprint != fingerprint {
            return Err(HiveoryAgentStoreError::Conflict);
        }
        let state = match decision {
            AgentApprovalDecision::Approve => "approved",
            AgentApprovalDecision::Deny => "denied",
        };
        sqlx::query("UPDATE hiveory_agent_approvals SET state=?, comment=?, resolved_at_unix_ms=? WHERE id=? AND state='pending'").bind(state).bind(comment).bind(now_ms()).bind(approval_id).execute(self.persistence.pool()).await?;
        self.approval(approval_id)
            .await?
            .ok_or(HiveoryAgentStoreError::NotFound)
    }

    pub async fn save_continuation(
        &self,
        run_id: &str,
        input_items: &[Value],
        pending_call_id: Option<&str>,
    ) -> Result<(), HiveoryAgentStoreError> {
        sqlx::query("INSERT INTO hiveory_agent_continuations (run_id, input_items_json, pending_call_id, updated_at_unix_ms) VALUES (?, ?, ?, ?) ON CONFLICT(run_id) DO UPDATE SET input_items_json=excluded.input_items_json, pending_call_id=excluded.pending_call_id, updated_at_unix_ms=excluded.updated_at_unix_ms").bind(run_id).bind(serde_json::to_string(input_items)?).bind(pending_call_id).bind(now_ms()).execute(self.persistence.pool()).await?;
        Ok(())
    }

    pub async fn load_continuation(
        &self,
        run_id: &str,
    ) -> Result<Option<(Vec<Value>, Option<String>)>, HiveoryAgentStoreError> {
        let Some(row) = sqlx::query("SELECT input_items_json, pending_call_id FROM hiveory_agent_continuations WHERE run_id=?").bind(run_id).fetch_optional(self.persistence.pool()).await? else { return Ok(None); };
        Ok(Some((
            serde_json::from_str(&row.get::<String, _>(0))?,
            row.get(1),
        )))
    }

    pub async fn append_event(
        &self,
        run_id: &str,
        kind: AgentEventKind,
        step: u32,
        tool_call_id: Option<&str>,
        payload: &str,
    ) -> Result<AgentEventEnvelope, HiveoryAgentStoreError> {
        let mut transaction = self.persistence.pool().begin().await?;
        let next: i64 =
            sqlx::query("SELECT next_event_sequence FROM hiveory_agent_runs WHERE id=?")
                .bind(run_id)
                .fetch_optional(&mut *transaction)
                .await?
                .ok_or(HiveoryAgentStoreError::NotFound)?
                .get(0);
        sqlx::query(
            "UPDATE hiveory_agent_runs SET next_event_sequence=?, updated_at_unix_ms=? WHERE id=?",
        )
        .bind(next + 1)
        .bind(now_ms())
        .bind(run_id)
        .execute(&mut *transaction)
        .await?;
        let event = AgentEventEnvelope {
            run_id: run_id.to_owned(),
            sequence: u64::try_from(next).unwrap_or(0),
            event_id: Uuid::now_v7().to_string(),
            kind,
            step,
            tool_call_id: tool_call_id.map(str::to_owned),
            payload: payload.to_owned(),
            emitted_at_unix_ms: now_ms(),
        };
        sqlx::query("INSERT INTO hiveory_agent_events (run_id, sequence, event_id, kind, step, tool_call_id, payload, emitted_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(run_id).bind(next).bind(&event.event_id).bind(event_kind_value(event.kind)).bind(i64::from(step)).bind(&event.tool_call_id).bind(&event.payload).bind(event.emitted_at_unix_ms).execute(&mut *transaction).await?;
        transaction.commit().await?;
        Ok(event)
    }

    pub async fn events(
        &self,
        query: &AgentEventsQuery,
    ) -> Result<Vec<AgentEventEnvelope>, HiveoryAgentStoreError> {
        let limit = i64::from(query.limit.unwrap_or(200).clamp(1, 500));
        Ok(sqlx::query("SELECT run_id, sequence, event_id, kind, step, tool_call_id, payload, emitted_at_unix_ms FROM hiveory_agent_events WHERE run_id=? AND sequence>? ORDER BY sequence ASC LIMIT ?").bind(&query.run_id).bind(i64::try_from(query.after_sequence).unwrap_or(i64::MAX)).bind(limit).fetch_all(self.persistence.pool()).await?.into_iter().map(event_from_row).collect())
    }

    pub async fn memory(
        &self,
        query: &AgentMemoryQuery,
    ) -> Result<Vec<AgentMemorySummary>, HiveoryAgentStoreError> {
        self.ensure_agent(&query.agent_id).await?;
        let limit = i64::from(query.limit.unwrap_or(100).clamp(1, 200));
        let search = query
            .search
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        let rows = if let Some(fts_query) = search.and_then(memory_fts_query) {
            match query.class {
                Some(class) => sqlx::query("SELECT m.id, m.agent_id, m.class, m.content, m.source_type, m.source_id, m.enabled, m.created_at_unix_ms, m.updated_at_unix_ms FROM hiveory_agent_memory m JOIN hiveory_agent_memory_fts f ON f.memory_id=m.id WHERE m.agent_id=? AND m.enabled=1 AND m.class=? AND f.content MATCH ? ORDER BY m.updated_at_unix_ms DESC LIMIT ?")
                    .bind(&query.agent_id)
                    .bind(memory_class_value(class))
                    .bind(fts_query)
                    .bind(limit)
                    .fetch_all(self.persistence.pool())
                    .await?,
                None => sqlx::query("SELECT m.id, m.agent_id, m.class, m.content, m.source_type, m.source_id, m.enabled, m.created_at_unix_ms, m.updated_at_unix_ms FROM hiveory_agent_memory m JOIN hiveory_agent_memory_fts f ON f.memory_id=m.id WHERE m.agent_id=? AND m.enabled=1 AND f.content MATCH ? ORDER BY m.updated_at_unix_ms DESC LIMIT ?")
                    .bind(&query.agent_id)
                    .bind(fts_query)
                    .bind(limit)
                    .fetch_all(self.persistence.pool())
                    .await?,
            }
        } else {
            match (query.class, search) {
                (Some(class), Some(search)) => sqlx::query("SELECT id, agent_id, class, content, source_type, source_id, enabled, created_at_unix_ms, updated_at_unix_ms FROM hiveory_agent_memory WHERE agent_id=? AND enabled=1 AND class=? AND content LIKE ? ESCAPE '\\' ORDER BY updated_at_unix_ms DESC LIMIT ?")
                    .bind(&query.agent_id)
                    .bind(memory_class_value(class))
                    .bind(format!("%{}%", search.replace('%', "\\%").replace('_', "\\_")))
                    .bind(limit)
                    .fetch_all(self.persistence.pool())
                    .await?,
                (Some(class), None) => sqlx::query("SELECT id, agent_id, class, content, source_type, source_id, enabled, created_at_unix_ms, updated_at_unix_ms FROM hiveory_agent_memory WHERE agent_id=? AND enabled=1 AND class=? ORDER BY updated_at_unix_ms DESC LIMIT ?")
                    .bind(&query.agent_id)
                    .bind(memory_class_value(class))
                    .bind(limit)
                    .fetch_all(self.persistence.pool())
                    .await?,
                (None, Some(search)) => sqlx::query("SELECT id, agent_id, class, content, source_type, source_id, enabled, created_at_unix_ms, updated_at_unix_ms FROM hiveory_agent_memory WHERE agent_id=? AND enabled=1 AND content LIKE ? ESCAPE '\\' ORDER BY updated_at_unix_ms DESC LIMIT ?")
                    .bind(&query.agent_id)
                    .bind(format!("%{}%", search.replace('%', "\\%").replace('_', "\\_")))
                    .bind(limit)
                    .fetch_all(self.persistence.pool())
                    .await?,
                (None, None) => sqlx::query("SELECT id, agent_id, class, content, source_type, source_id, enabled, created_at_unix_ms, updated_at_unix_ms FROM hiveory_agent_memory WHERE agent_id=? AND enabled=1 ORDER BY updated_at_unix_ms DESC LIMIT ?")
                    .bind(&query.agent_id)
                    .bind(limit)
                    .fetch_all(self.persistence.pool())
                    .await?,
            }
        };
        Ok(rows.into_iter().map(memory_from_row).collect())
    }

    pub async fn upsert_memory(
        &self,
        request: &AgentMemoryMutationRequest,
    ) -> Result<AgentMemorySummary, HiveoryAgentStoreError> {
        self.ensure_agent(&request.agent_id).await?;
        let id = request
            .memory_id
            .clone()
            .unwrap_or_else(|| Uuid::now_v7().to_string());
        let now = now_ms();
        sqlx::query("INSERT INTO hiveory_agent_memory (id, agent_id, class, content, source_type, source_id, enabled, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET class=excluded.class, content=excluded.content, source_type=excluded.source_type, source_id=excluded.source_id, enabled=excluded.enabled, updated_at_unix_ms=excluded.updated_at_unix_ms")
            .bind(&id).bind(&request.agent_id).bind(memory_class_value(request.class)).bind(&request.content).bind(&request.source_type).bind(&request.source_id).bind(if request.enabled { 1 } else { 0 }).bind(now).bind(now).execute(self.persistence.pool()).await?;
        sqlx::query("DELETE FROM hiveory_agent_memory_fts WHERE memory_id=?")
            .bind(&id)
            .execute(self.persistence.pool())
            .await?;
        sqlx::query("INSERT INTO hiveory_agent_memory_fts (memory_id, agent_id, class, content) VALUES (?, ?, ?, ?)").bind(&id).bind(&request.agent_id).bind(memory_class_value(request.class)).bind(&request.content).execute(self.persistence.pool()).await?;
        Ok(sqlx::query("SELECT id, agent_id, class, content, source_type, source_id, enabled, created_at_unix_ms, updated_at_unix_ms FROM hiveory_agent_memory WHERE id=?").bind(id).fetch_one(self.persistence.pool()).await.map(memory_from_row)?)
    }

    pub async fn delete_memory(
        &self,
        agent_id: &str,
        memory_id: &str,
    ) -> Result<(), HiveoryAgentStoreError> {
        sqlx::query("DELETE FROM hiveory_agent_memory_fts WHERE memory_id=?")
            .bind(memory_id)
            .execute(self.persistence.pool())
            .await?;
        let result = sqlx::query("DELETE FROM hiveory_agent_memory WHERE id=? AND agent_id=?")
            .bind(memory_id)
            .bind(agent_id)
            .execute(self.persistence.pool())
            .await?;
        if result.rows_affected() == 0 {
            return Err(HiveoryAgentStoreError::NotFound);
        }
        Ok(())
    }

    pub async fn record_memory_retrieval(
        &self,
        run_id: &str,
        memory_id: &str,
        rank: u32,
        reason: &str,
    ) -> Result<(), HiveoryAgentStoreError> {
        sqlx::query("INSERT INTO hiveory_agent_memory_retrievals (id, run_id, memory_id, rank, reason, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(run_id, memory_id) DO UPDATE SET rank=excluded.rank, reason=excluded.reason, created_at_unix_ms=excluded.created_at_unix_ms").bind(Uuid::now_v7().to_string()).bind(run_id).bind(memory_id).bind(i64::from(rank)).bind(reason).bind(now_ms()).execute(self.persistence.pool()).await?;
        Ok(())
    }

    pub async fn insert_artifact(
        &self,
        artifact: &AgentArtifactSummary,
    ) -> Result<(), HiveoryAgentStoreError> {
        sqlx::query("INSERT INTO hiveory_agent_artifacts (id, run_id, name, kind, relative_path, bytes, sha256, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(&artifact.id).bind(&artifact.run_id).bind(&artifact.name).bind(artifact_kind_value(artifact.kind)).bind(&artifact.relative_path).bind(i64::try_from(artifact.bytes).unwrap_or(i64::MAX)).bind(&artifact.sha256).bind(artifact.created_at_unix_ms).execute(self.persistence.pool()).await?;
        Ok(())
    }

    pub async fn artifacts(
        &self,
        run_id: &str,
    ) -> Result<Vec<AgentArtifactSummary>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT id, run_id, name, kind, relative_path, bytes, sha256, created_at_unix_ms FROM hiveory_agent_artifacts WHERE run_id=? ORDER BY created_at_unix_ms DESC").bind(run_id).fetch_all(self.persistence.pool()).await?.into_iter().map(artifact_from_row).collect())
    }

    pub async fn run_detail(&self, run_id: &str) -> Result<AgentRunDetail, HiveoryAgentStoreError> {
        let summary = self
            .run(run_id)
            .await?
            .ok_or(HiveoryAgentStoreError::NotFound)?;
        let agent = self.detail(&summary.agent_id).await?;
        let child_runs = self.child_runs(&summary.id, 20).await?;
        let events = self
            .events(&AgentEventsQuery {
                run_id: run_id.to_owned(),
                after_sequence: 0,
                limit: Some(500),
            })
            .await?;
        Ok(AgentRunDetail {
            summary,
            messages: self.messages(run_id).await?,
            tool_calls: self.tool_calls(run_id).await?,
            approvals: self.approvals(run_id).await?,
            skills: agent.skills,
            memories: self
                .memory(&AgentMemoryQuery {
                    agent_id: agent.summary.id,
                    search: None,
                    class: None,
                    limit: Some(100),
                })
                .await?,
            artifacts: self.artifacts(run_id).await?,
            child_runs,
            event_cursor: events.last().map(|item| item.sequence).unwrap_or(0),
        })
    }

    async fn tool_calls(
        &self,
        run_id: &str,
    ) -> Result<Vec<AgentToolCallSummary>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT id, run_id, call_id, name, arguments_json, risk, state, approval_id, result_preview, created_at_unix_ms, updated_at_unix_ms FROM hiveory_agent_tool_calls WHERE run_id=? ORDER BY created_at_unix_ms ASC").bind(run_id).fetch_all(self.persistence.pool()).await?.into_iter().map(tool_call_from_row).collect())
    }
    async fn approvals(
        &self,
        run_id: &str,
    ) -> Result<Vec<AgentApprovalSummary>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT id, run_id, tool_call_id, tool_name, target, arguments_json, fingerprint, reversible, state, created_at_unix_ms, resolved_at_unix_ms FROM hiveory_agent_approvals WHERE run_id=? ORDER BY created_at_unix_ms ASC").bind(run_id).fetch_all(self.persistence.pool()).await?.into_iter().map(approval_from_row).collect())
    }

    pub async fn dashboard(&self) -> Result<AgentDashboard, HiveoryAgentStoreError> {
        Ok(AgentDashboard {
            agents: self.list().await?,
            active_runs: self
                .runs(None, None, 100)
                .await?
                .into_iter()
                .filter(|run| {
                    matches!(
                        run.state,
                        AgentRunState::Queued
                            | AgentRunState::Preparing
                            | AgentRunState::Running
                            | AgentRunState::AwaitingApproval
                            | AgentRunState::AwaitingInput
                            | AgentRunState::Interrupted
                    )
                })
                .collect(),
            pending_approvals: self.pending_approvals().await?,
            recent_runs: self.runs(None, None, 20).await?,
        })
    }

    async fn ensure_agent(&self, agent_id: &str) -> Result<(), HiveoryAgentStoreError> {
        if self.agent_row(agent_id).await?.is_some() {
            Ok(())
        } else {
            Err(HiveoryAgentStoreError::NotFound)
        }
    }
    async fn agent_row(&self, agent_id: &str) -> Result<Option<SqliteRow>, HiveoryAgentStoreError> {
        Ok(sqlx::query("SELECT id, name, description, avatar_color, provider_account_id, model, archived, current_version, created_at_unix_ms, updated_at_unix_ms, (SELECT state FROM hiveory_agent_runs r WHERE r.agent_id=hiveory_agents.id AND r.state IN ('queued','preparing','running','awaiting_approval','awaiting_input','interrupted') ORDER BY r.updated_at_unix_ms DESC LIMIT 1), (SELECT COUNT(*) FROM hiveory_agent_skills s WHERE s.agent_id=hiveory_agents.id AND s.enabled=1), (SELECT COUNT(*) FROM hiveory_agent_tools t WHERE t.agent_id=hiveory_agents.id AND t.enabled=1), (SELECT COUNT(*) FROM hiveory_agent_folders f WHERE f.agent_id=hiveory_agents.id) FROM hiveory_agents WHERE id=?").bind(agent_id).fetch_optional(self.persistence.pool()).await?)
    }
}

fn default_limits() -> AgentRuntimeLimits {
    hiveory_agent_domain::default_runtime_limits()
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn memory_fts_query(search: &str) -> Option<String> {
    let terms = search
        .split_whitespace()
        .take(8)
        .filter_map(|term| {
            let normalized = term
                .chars()
                .filter(|character| character.is_alphanumeric())
                .take(64)
                .collect::<String>();
            (!normalized.is_empty()).then(|| format!("\"{normalized}\""))
        })
        .collect::<Vec<_>>();
    (!terms.is_empty()).then(|| terms.join(" AND "))
}

fn summary_from_row(row: SqliteRow) -> AgentSummary {
    AgentSummary {
        id: row.get(0),
        name: row.get(1),
        description: row.get(2),
        avatar_color: row.get(3),
        provider_account_id: row.get(4),
        model: row.get(5),
        version: row.get::<i64, _>(6).max(1) as u32,
        archived: row.get::<i64, _>(7) != 0,
        active_run_state: row
            .get::<Option<String>, _>(10)
            .and_then(|value| run_state_from_value(&value)),
        enabled_skill_count: row.get::<i64, _>(11).max(0) as u32,
        enabled_tool_count: row.get::<i64, _>(12).max(0) as u32,
        folder_grant_count: row.get::<i64, _>(13).max(0) as u32,
        created_at_unix_ms: row.get(8),
        updated_at_unix_ms: row.get(9),
    }
}
fn run_from_row(row: SqliteRow) -> AgentRunSummary {
    AgentRunSummary {
        id: row.get(0),
        agent_id: row.get(1),
        agent_version: row.get::<i64, _>(2).max(1) as u32,
        conversation_id: row.get(3),
        state: run_state_from_value(&row.get::<String, _>(4)).unwrap_or(AgentRunState::Failed),
        prompt_preview: row.get(5),
        background: row.get::<i64, _>(6) != 0,
        step_count: row.get::<i64, _>(7).max(0) as u32,
        tool_call_count: row.get::<i64, _>(8).max(0) as u32,
        pending_approval_id: row.get(9),
        lease_generation: row.get::<i64, _>(10).max(0) as u64,
        input_tokens: row
            .get::<Option<i64>, _>(11)
            .and_then(|value| u64::try_from(value).ok()),
        output_tokens: row
            .get::<Option<i64>, _>(12)
            .and_then(|value| u64::try_from(value).ok()),
        error: row.get(13),
        created_at_unix_ms: row.get(14),
        updated_at_unix_ms: row.get(15),
        completed_at_unix_ms: row.get(16),
    }
}
fn message_from_row(row: SqliteRow) -> AgentMessage {
    AgentMessage {
        id: row.get(0),
        run_id: row.get(1),
        role: row.get(2),
        kind: row.get(3),
        content: row.get(4),
        tool_call_id: row.get(5),
        created_at_unix_ms: row.get(6),
    }
}
fn tool_call_from_row(row: SqliteRow) -> AgentToolCallSummary {
    AgentToolCallSummary {
        id: row.get(0),
        run_id: row.get(1),
        call_id: row.get(2),
        name: row.get(3),
        arguments_json: row.get(4),
        risk: tool_risk_from_value(&row.get::<String, _>(5)).unwrap_or(AgentToolRisk::ReadOnly),
        state: tool_call_state_from_value(&row.get::<String, _>(6))
            .unwrap_or(AgentToolCallState::Failed),
        approval_id: row.get(7),
        result_preview: row.get(8),
        created_at_unix_ms: row.get(9),
        updated_at_unix_ms: row.get(10),
    }
}
fn approval_from_row(row: SqliteRow) -> AgentApprovalSummary {
    AgentApprovalSummary {
        id: row.get(0),
        run_id: row.get(1),
        tool_call_id: row.get(2),
        tool_name: row.get(3),
        target: row.get(4),
        arguments_json: row.get(5),
        fingerprint: row.get(6),
        reversible: row.get::<i64, _>(7) != 0,
        state: row.get(8),
        created_at_unix_ms: row.get(9),
        resolved_at_unix_ms: row.get(10),
    }
}
fn memory_from_row(row: SqliteRow) -> AgentMemorySummary {
    AgentMemorySummary {
        id: row.get(0),
        agent_id: row.get(1),
        class: memory_class_from_value(&row.get::<String, _>(2))
            .unwrap_or(AgentMemoryClass::AgentKnowledge),
        content: row.get(3),
        source_type: row.get(4),
        source_id: row.get(5),
        enabled: row.get::<i64, _>(6) != 0,
        created_at_unix_ms: row.get(7),
        updated_at_unix_ms: row.get(8),
    }
}
fn skill_from_row(row: SqliteRow) -> AgentSkillSummary {
    AgentSkillSummary {
        id: row.get(0),
        name: row.get(1),
        version: row.get(2),
        description: row.get(3),
        origin: skill_origin_from_value(&row.get::<String, _>(4))
            .unwrap_or(AgentSkillOrigin::ApplicationData),
        source_path: row.get(5),
        triggers: serde_json::from_str(&row.get::<String, _>(6)).unwrap_or_default(),
        permissions: serde_json::from_str(&row.get::<String, _>(7)).unwrap_or_default(),
        enabled: row.get::<i64, _>(10) != 0,
        valid: row.get::<i64, _>(8) != 0,
        validation_message: row.get(9),
    }
}
fn artifact_from_row(row: SqliteRow) -> AgentArtifactSummary {
    AgentArtifactSummary {
        id: row.get(0),
        run_id: row.get(1),
        name: row.get(2),
        kind: artifact_kind_from_value(&row.get::<String, _>(3)).unwrap_or(AgentArtifactKind::Text),
        relative_path: row.get(4),
        bytes: row.get::<i64, _>(5).max(0) as u64,
        sha256: row.get(6),
        created_at_unix_ms: row.get(7),
    }
}
fn event_from_row(row: SqliteRow) -> AgentEventEnvelope {
    AgentEventEnvelope {
        run_id: row.get(0),
        sequence: row.get::<i64, _>(1).max(0) as u64,
        event_id: row.get(2),
        kind: event_kind_from_value(&row.get::<String, _>(3))
            .unwrap_or(AgentEventKind::RunStateChanged),
        step: row.get::<i64, _>(4).max(0) as u32,
        tool_call_id: row.get(5),
        payload: row.get(6),
        emitted_at_unix_ms: row.get(7),
    }
}
fn event_kind_value(value: AgentEventKind) -> &'static str {
    match value {
        AgentEventKind::RunStateChanged => "run_state_changed",
        AgentEventKind::AssistantTextDelta => "assistant_text_delta",
        AgentEventKind::ReasoningSummary => "reasoning_summary",
        AgentEventKind::ToolCallProposed => "tool_call_proposed",
        AgentEventKind::ToolCallStarted => "tool_call_started",
        AgentEventKind::ToolCallCompleted => "tool_call_completed",
        AgentEventKind::ToolCallFailed => "tool_call_failed",
        AgentEventKind::ApprovalRequested => "approval_requested",
        AgentEventKind::ApprovalResolved => "approval_resolved",
        AgentEventKind::InputRequested => "input_requested",
        AgentEventKind::SkillLoaded => "skill_loaded",
        AgentEventKind::MemoryRetrieved => "memory_retrieved",
        AgentEventKind::ArtifactCreated => "artifact_created",
        AgentEventKind::ChildRunCreated => "child_run_created",
        AgentEventKind::CompactionCreated => "compaction_created",
        AgentEventKind::UsageRecorded => "usage_recorded",
    }
}
fn event_kind_from_value(value: &str) -> Option<AgentEventKind> {
    match value {
        "run_state_changed" => Some(AgentEventKind::RunStateChanged),
        "assistant_text_delta" => Some(AgentEventKind::AssistantTextDelta),
        "reasoning_summary" => Some(AgentEventKind::ReasoningSummary),
        "tool_call_proposed" => Some(AgentEventKind::ToolCallProposed),
        "tool_call_started" => Some(AgentEventKind::ToolCallStarted),
        "tool_call_completed" => Some(AgentEventKind::ToolCallCompleted),
        "tool_call_failed" => Some(AgentEventKind::ToolCallFailed),
        "approval_requested" => Some(AgentEventKind::ApprovalRequested),
        "approval_resolved" => Some(AgentEventKind::ApprovalResolved),
        "input_requested" => Some(AgentEventKind::InputRequested),
        "skill_loaded" => Some(AgentEventKind::SkillLoaded),
        "memory_retrieved" => Some(AgentEventKind::MemoryRetrieved),
        "artifact_created" => Some(AgentEventKind::ArtifactCreated),
        "child_run_created" => Some(AgentEventKind::ChildRunCreated),
        "compaction_created" => Some(AgentEventKind::CompactionCreated),
        "usage_recorded" => Some(AgentEventKind::UsageRecorded),
        _ => None,
    }
}
fn artifact_kind_value(value: AgentArtifactKind) -> &'static str {
    match value {
        AgentArtifactKind::Text => "text",
        AgentArtifactKind::Json => "json",
        AgentArtifactKind::Markdown => "markdown",
    }
}
fn artifact_kind_from_value(value: &str) -> Option<AgentArtifactKind> {
    match value {
        "text" => Some(AgentArtifactKind::Text),
        "json" => Some(AgentArtifactKind::Json),
        "markdown" => Some(AgentArtifactKind::Markdown),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use hiveory_agent_domain::default_runtime_limits;
    use hiveory_protocol::{AgentMemoryMutationRequest, AgentRunStartRequest};

    #[tokio::test]
    async fn agent_state_survives_database_reopen() {
        let path = std::env::temp_dir().join(format!("hiveory-agent-{}.sqlite3", Uuid::now_v7()));
        let persistence = super::super::HiveoryPersistence::open(&path)
            .await
            .expect("open database");
        let store = HiveoryAgentStore::new(persistence.clone());
        let request = AgentCreateRequest {
            name: "Release helper".to_owned(),
            description: "A bounded release assistant".to_owned(),
            operating_brief: "Stay inside explicitly granted folders.".to_owned(),
            avatar_color: "#22d3ee".to_owned(),
            provider_account_id: super::super::HIVEORY_DEFAULT_PROVIDER_ACCOUNT_ID.to_owned(),
            model: "gpt-5.6-mini".to_owned(),
            system_instructions: "Be concise and inspectable.".to_owned(),
            approval_policy: AgentApprovalPolicy::AskForMutations,
            memory_policy: AgentMemoryPolicy::ExplicitOnly,
            runtime_limits: default_runtime_limits(),
        };
        let detail = store.create(&request).await.expect("create agent");
        let run = store
            .create_run(&AgentRunStartRequest {
                agent_id: detail.summary.id.clone(),
                conversation_id: None,
                prompt: "Summarize the release state".to_owned(),
                background: false,
                routine_execution_id: None,
            })
            .await
            .expect("create run");
        store
            .save_continuation(
                &run.id,
                &[serde_json::json!({ "role": "user", "content": "Summarize the release state" })],
                None,
            )
            .await
            .expect("save continuation");
        let memory = store
            .upsert_memory(&AgentMemoryMutationRequest {
                agent_id: detail.summary.id.clone(),
                memory_id: None,
                class: AgentMemoryClass::AgentKnowledge,
                content: "The release branch requires a reviewed checklist.".to_owned(),
                source_type: "test".to_owned(),
                source_id: None,
                enabled: true,
            })
            .await
            .expect("save memory");
        assert_eq!(
            store
                .memory(&AgentMemoryQuery {
                    agent_id: detail.summary.id.clone(),
                    search: Some("reviewed".to_owned()),
                    class: None,
                    limit: Some(8)
                })
                .await
                .expect("search memory")
                .len(),
            1
        );
        drop(store);
        drop(persistence);

        let reopened = super::super::HiveoryPersistence::open(&path)
            .await
            .expect("reopen database");
        let reopened_store = HiveoryAgentStore::new(reopened.clone());
        assert_eq!(
            reopened_store
                .detail(&detail.summary.id)
                .await
                .expect("read agent")
                .summary
                .name,
            "Release helper"
        );
        assert_eq!(
            reopened_store
                .run(&run.id)
                .await
                .expect("read run")
                .expect("run exists")
                .state,
            AgentRunState::Queued
        );
        assert_eq!(
            reopened_store
                .memory(&AgentMemoryQuery {
                    agent_id: detail.summary.id,
                    search: None,
                    class: None,
                    limit: Some(8)
                })
                .await
                .expect("read memory")[0]
                .id,
            memory.id
        );
        drop(reopened_store);
        drop(reopened);
        let _ = std::fs::remove_file(&path);
        let _ = std::fs::remove_file(path.with_extension("sqlite3-shm"));
        let _ = std::fs::remove_file(path.with_extension("sqlite3-wal"));
    }
}
