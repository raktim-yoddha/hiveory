//! Public Agent receiver. The execution engine lives in hiveory-private.
#![allow(unused_imports, unused_variables)]

use hiveory_agent_domain::{builtin_skill_sources, parse_skill_markdown};
use hiveory_artifact_store::HiveoryArtifactStore;
use hiveory_model_gateway::HiveoryModelProvider;
use hiveory_persistence::agent::{HiveoryAgentStore, HiveoryAgentStoreError};
use hiveory_protocol::{
    AgentApprovalDecisionRequest, AgentConversationCreateRequest, AgentConversationDetail,
    AgentConversationQuery, AgentCreateRequest, AgentDashboard, AgentDetail, AgentEventEnvelope,
    AgentEventsQuery, AgentExportRequest, AgentFolderGrant, AgentFolderGrantDeleteRequest,
    AgentFolderGrantRequest, AgentInputRequest, AgentMemoryDeleteRequest,
    AgentMemoryMutationRequest, AgentMemoryQuery, AgentMemorySummary, AgentRunControlRequest,
    AgentRunDetail, AgentRunStartRequest, AgentRunSummary, AgentSkillCatalog,
    AgentSkillConflictResolutionRequest, AgentSkillIdRequest, AgentSkillToggleRequest,
    AgentUpdateRequest,
};
use hiveory_tool_runtime::{HiveoryAuditLog, HiveoryExternalToolProvider};
use std::{fs, path::PathBuf, sync::Arc};
use thiserror::Error;
use tokio::sync::broadcast;

#[derive(Debug, Error)]
pub enum HiveoryAgentRuntimeError {
    #[error("agent store failure: {0}")]
    Store(#[from] HiveoryAgentStoreError),
    #[error("agent provider failure: {0}")]
    Provider(String),
    #[error("agent artifact failure: {0}")]
    Artifact(String),
    #[error("agent request is invalid: {0}")]
    InvalidInput(String),
    #[error("agent run was cancelled")]
    Cancelled,
}

#[derive(Clone)]
pub struct HiveoryAgentRuntime {
    store: HiveoryAgentStore,
    skill_root: PathBuf,
    events: broadcast::Sender<AgentEventEnvelope>,
}

impl HiveoryAgentRuntime {
    pub fn new(
        store: HiveoryAgentStore,
        provider: Arc<dyn HiveoryModelProvider>,
        artifacts: HiveoryArtifactStore,
        audit: HiveoryAuditLog,
        skill_root: PathBuf,
    ) -> Self {
        let (events, _) = broadcast::channel(1);
        Self {
            store,
            skill_root,
            events,
        }
    }

    pub fn set_external_tool_provider(&self, provider: Arc<dyn HiveoryExternalToolProvider>) {}

    pub fn store(&self) -> &HiveoryAgentStore {
        &self.store
    }

    pub fn subscribe(&self) -> broadcast::Receiver<AgentEventEnvelope> {
        self.events.subscribe()
    }

    pub async fn initialize(&self) -> Result<(), HiveoryAgentRuntimeError> {
        for (id, source) in builtin_skill_sources() {
            let package = parse_skill_markdown(
                &format!("builtin/{id}/SKILL.md"),
                source,
                hiveory_protocol::AgentSkillOrigin::Builtin,
            )
            .map_err(|error| HiveoryAgentRuntimeError::InvalidInput(error.to_string()))?;
            self.store.upsert_skill(&package).await?;
        }
        fs::create_dir_all(&self.skill_root)
            .map_err(|error| HiveoryAgentRuntimeError::InvalidInput(error.to_string()))?;
        let entries = fs::read_dir(&self.skill_root)
            .map_err(|error| HiveoryAgentRuntimeError::InvalidInput(error.to_string()))?;
        for entry in entries.flatten().take(100) {
            let path = entry.path().join("SKILL.md");
            if !path.is_file() {
                continue;
            }
            let Ok(source) = fs::read_to_string(&path) else {
                continue;
            };
            if let Ok(package) = parse_skill_markdown(
                &path.to_string_lossy(),
                &source,
                hiveory_protocol::AgentSkillOrigin::ApplicationData,
            ) {
                self.store.upsert_skill(&package).await?;
            }
        }
        Ok(())
    }

    pub async fn recover(&self) -> Result<usize, HiveoryAgentRuntimeError> {
        Ok(self.store.interrupt_active_runs().await?)
    }

    pub async fn dashboard(&self) -> Result<AgentDashboard, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn list_agents(
        &self,
    ) -> Result<Vec<hiveory_protocol::AgentSummary>, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn agent_detail(
        &self,
        agent_id: &str,
    ) -> Result<AgentDetail, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn create_agent(
        &self,
        request: &AgentCreateRequest,
    ) -> Result<AgentDetail, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn update_agent(
        &self,
        request: &AgentUpdateRequest,
    ) -> Result<AgentDetail, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn archive_agent(
        &self,
        agent_id: &str,
        archived: bool,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn delete_agent(&self, agent_id: &str) -> Result<(), HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn add_folder(
        &self,
        request: &AgentFolderGrantRequest,
    ) -> Result<AgentFolderGrant, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn delete_folder(
        &self,
        request: &AgentFolderGrantDeleteRequest,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn set_skill(
        &self,
        request: &AgentSkillToggleRequest,
    ) -> Result<AgentDetail, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn set_skill_conflict(
        &self,
        request: &AgentSkillConflictResolutionRequest,
    ) -> Result<AgentDetail, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn skill_catalog(&self) -> Result<AgentSkillCatalog, HiveoryAgentRuntimeError> {
        Ok(AgentSkillCatalog {
            skills: self.store.catalog().await?,
            conflicts: Vec::new(),
        })
    }

    pub async fn install_skill_markdown(
        &self,
        source: &str,
    ) -> Result<hiveory_protocol::AgentSkillSummary, HiveoryAgentRuntimeError> {
        if source.len() > 256 * 1024 {
            return Err(HiveoryAgentRuntimeError::InvalidInput(
                "skill source exceeds 256 KiB".to_owned(),
            ));
        }
        let preview = parse_skill_markdown(
            "import/SKILL.md",
            source,
            hiveory_protocol::AgentSkillOrigin::ApplicationData,
        )
        .map_err(|error| HiveoryAgentRuntimeError::InvalidInput(error.to_string()))?;
        let skill_dir = self.skill_root.join(&preview.summary.id);
        if skill_dir.exists() {
            return Err(HiveoryAgentRuntimeError::InvalidInput(format!(
                "a custom skill with id '{}' is already installed",
                preview.summary.id
            )));
        }
        fs::create_dir_all(&self.skill_root)
            .map_err(|error| HiveoryAgentRuntimeError::InvalidInput(error.to_string()))?;
        fs::create_dir(&skill_dir)
            .map_err(|error| HiveoryAgentRuntimeError::InvalidInput(error.to_string()))?;
        let skill_path = skill_dir.join("SKILL.md");
        if let Err(error) = fs::write(&skill_path, source) {
            let _ = fs::remove_dir(&skill_dir);
            return Err(HiveoryAgentRuntimeError::InvalidInput(error.to_string()));
        }
        let package = parse_skill_markdown(
            &skill_path.to_string_lossy(),
            source,
            hiveory_protocol::AgentSkillOrigin::ApplicationData,
        )
        .map_err(|error| HiveoryAgentRuntimeError::InvalidInput(error.to_string()))?;
        if let Err(error) = self.store.upsert_skill(&package).await {
            let _ = fs::remove_dir_all(&skill_dir);
            return Err(error.into());
        }
        Ok(package.summary)
    }

    pub async fn delete_application_skill(
        &self,
        request: &AgentSkillIdRequest,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        let skill_id = request.skill_id.trim();
        if skill_id.is_empty()
            || skill_id.contains(['/', '\\'])
            || skill_id == "."
            || skill_id == ".."
        {
            return Err(HiveoryAgentRuntimeError::InvalidInput(
                "A valid Hiveory-managed skill is required.".to_owned(),
            ));
        }
        let Some((summary, _)) = self.store.skill_package(skill_id).await? else {
            return Err(HiveoryAgentRuntimeError::InvalidInput(
                "The skill was not found.".to_owned(),
            ));
        };
        if summary.origin != hiveory_protocol::AgentSkillOrigin::ApplicationData {
            return Err(HiveoryAgentRuntimeError::InvalidInput(
                "Only Hiveory-managed skills can be deleted.".to_owned(),
            ));
        }
        let skill_dir = self.skill_root.join(skill_id);
        let skill_path = skill_dir.join("SKILL.md");
        if !skill_path.is_file() {
            return Err(HiveoryAgentRuntimeError::InvalidInput(
                "The managed skill files are unavailable; deletion was not started.".to_owned(),
            ));
        }
        let staged_dir = self.skill_root.join(format!(".{skill_id}.deleting"));
        if staged_dir.exists() {
            return Err(HiveoryAgentRuntimeError::InvalidInput(
                "A previous deletion is still being recovered; try again.".to_owned(),
            ));
        }
        fs::rename(&skill_dir, &staged_dir)
            .map_err(|error| HiveoryAgentRuntimeError::InvalidInput(error.to_string()))?;
        if let Err(error) = self.store.delete_application_skill(skill_id).await {
            let _ = fs::rename(&staged_dir, &skill_dir);
            return Err(error.into());
        }
        if let Err(error) = fs::remove_dir_all(&staged_dir) {
            return Err(HiveoryAgentRuntimeError::InvalidInput(format!(
                "Skill data was removed from the catalog but could not be cleaned up: {error}"
            )));
        }
        Ok(())
    }

    pub async fn memory(
        &self,
        query: &AgentMemoryQuery,
    ) -> Result<Vec<AgentMemorySummary>, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn remember(
        &self,
        request: &AgentMemoryMutationRequest,
    ) -> Result<AgentMemorySummary, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn delete_memory(
        &self,
        request: &AgentMemoryDeleteRequest,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn conversations(
        &self,
        query: &AgentConversationQuery,
    ) -> Result<Vec<hiveory_protocol::AgentConversationSummary>, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn create_conversation(
        &self,
        request: &AgentConversationCreateRequest,
    ) -> Result<AgentConversationDetail, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn conversation(
        &self,
        conversation_id: &str,
    ) -> Result<AgentConversationDetail, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn run_detail(
        &self,
        run_id: &str,
    ) -> Result<AgentRunDetail, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn runs(
        &self,
        query: &hiveory_protocol::AgentRunsQuery,
    ) -> Result<Vec<AgentRunSummary>, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn events(
        &self,
        query: &AgentEventsQuery,
    ) -> Result<Vec<AgentEventEnvelope>, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn start_run(
        &self,
        request: &AgentRunStartRequest,
    ) -> Result<AgentRunSummary, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn resume_run(
        &self,
        request: &AgentRunControlRequest,
    ) -> Result<AgentRunSummary, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn cancel_run(
        &self,
        request: &AgentRunControlRequest,
    ) -> Result<AgentRunSummary, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn decide_approval(
        &self,
        request: &AgentApprovalDecisionRequest,
    ) -> Result<AgentRunSummary, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn submit_input(
        &self,
        request: &AgentInputRequest,
    ) -> Result<AgentRunSummary, HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }

    pub async fn export_agent(
        &self,
        request: &AgentExportRequest,
    ) -> Result<(), HiveoryAgentRuntimeError> {
        Err(HiveoryAgentRuntimeError::InvalidInput(
            "Agent mode is unavailable in this build".to_owned(),
        ))
    }
}
