//! Pure policy and validation for the Agent vertical slice.
//!
//! This crate deliberately has no database, filesystem, or provider access. It
//! keeps the rules that must be identical in the host, runtime, and tests in a
//! small dependency-free boundary.

use hiveory_protocol::{
    AgentApprovalPolicy, AgentCreateRequest, AgentMemoryClass, AgentMemoryPolicy, AgentRunState,
    AgentRuntimeLimits, AgentSkillOrigin, AgentSkillSummary, AgentToolCallState, AgentToolRisk,
    AgentUpdateRequest,
};
use serde::{Deserialize, Serialize};
use thiserror::Error;

pub const HIVEORY_DEFAULT_MAX_STEPS: u32 = 24;
pub const HIVEORY_DEFAULT_MAX_TOOL_CALLS: u32 = 32;
pub const HIVEORY_DEFAULT_MAX_DURATION_SECONDS: u32 = 30 * 60;
pub const HIVEORY_DEFAULT_MAX_CONTEXT_TOKENS: u32 = 128_000;
pub const HIVEORY_DEFAULT_MAX_SUBAGENT_DEPTH: u8 = 2;
pub const HIVEORY_DEFAULT_MAX_CONCURRENT_SUBAGENTS: u8 = 2;
pub const HIVEORY_MAX_SKILL_FILE_BYTES: usize = 512 * 1024;
pub const HIVEORY_MAX_MEMORY_BYTES: usize = 32 * 1024;
pub const HIVEORY_MAX_MEMORY_RETRIEVALS: u32 = 8;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum HiveoryAgentDomainError {
    #[error("{0} is required")]
    Required(&'static str),
    #[error("{0} is outside the supported range")]
    OutOfRange(&'static str),
    #[error("the agent run cannot transition from {from:?} to {to:?}")]
    InvalidRunTransition {
        from: AgentRunState,
        to: AgentRunState,
    },
    #[error("the tool call cannot transition from {from:?} to {to:?}")]
    InvalidToolTransition {
        from: AgentToolCallState,
        to: AgentToolCallState,
    },
    #[error("skill metadata is invalid: {0}")]
    InvalidSkill(String),
    #[error("memory content is not eligible for automatic storage")]
    SensitiveMemory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentSkillResource {
    pub name: String,
    pub content: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentSkillPackage {
    pub summary: AgentSkillSummary,
    pub instructions: String,
    pub resources: Vec<AgentSkillResource>,
}

pub fn default_runtime_limits() -> AgentRuntimeLimits {
    AgentRuntimeLimits {
        max_steps: HIVEORY_DEFAULT_MAX_STEPS,
        max_tool_calls: HIVEORY_DEFAULT_MAX_TOOL_CALLS,
        max_duration_seconds: HIVEORY_DEFAULT_MAX_DURATION_SECONDS,
        max_context_tokens: HIVEORY_DEFAULT_MAX_CONTEXT_TOKENS,
        max_subagent_depth: HIVEORY_DEFAULT_MAX_SUBAGENT_DEPTH,
        max_concurrent_subagents: HIVEORY_DEFAULT_MAX_CONCURRENT_SUBAGENTS,
    }
}

pub fn validate_agent_create(request: &AgentCreateRequest) -> Result<(), HiveoryAgentDomainError> {
    validate_agent_fields(
        &request.name,
        &request.description,
        &request.operating_brief,
        &request.avatar_color,
        &request.provider_account_id,
        &request.model,
        &request.system_instructions,
        &request.runtime_limits,
    )
}

pub fn validate_agent_update(request: &AgentUpdateRequest) -> Result<(), HiveoryAgentDomainError> {
    if request.agent_id.trim().is_empty() {
        return Err(HiveoryAgentDomainError::Required("agent_id"));
    }
    validate_agent_fields(
        &request.name,
        &request.description,
        &request.operating_brief,
        &request.avatar_color,
        &request.provider_account_id,
        &request.model,
        &request.system_instructions,
        &request.runtime_limits,
    )
}

#[allow(clippy::too_many_arguments)]
fn validate_agent_fields(
    name: &str,
    description: &str,
    operating_brief: &str,
    avatar_color: &str,
    provider_account_id: &str,
    model: &str,
    system_instructions: &str,
    limits: &AgentRuntimeLimits,
) -> Result<(), HiveoryAgentDomainError> {
    if name.trim().is_empty() {
        return Err(HiveoryAgentDomainError::Required("name"));
    }
    if name.chars().count() > 80 {
        return Err(HiveoryAgentDomainError::OutOfRange("name"));
    }
    if description.chars().count() > 400 {
        return Err(HiveoryAgentDomainError::OutOfRange("description"));
    }
    if operating_brief.chars().count() > 8_000 {
        return Err(HiveoryAgentDomainError::OutOfRange("operating_brief"));
    }
    if avatar_color.trim().is_empty() || avatar_color.chars().count() > 32 {
        return Err(HiveoryAgentDomainError::OutOfRange("avatar_color"));
    }
    if provider_account_id.trim().is_empty() {
        return Err(HiveoryAgentDomainError::Required("provider_account_id"));
    }
    if model.trim().is_empty() || model.chars().count() > 128 {
        return Err(HiveoryAgentDomainError::OutOfRange("model"));
    }
    if system_instructions.chars().count() > 32_000 {
        return Err(HiveoryAgentDomainError::OutOfRange("system_instructions"));
    }
    if limits.max_steps == 0 || limits.max_steps > 256 {
        return Err(HiveoryAgentDomainError::OutOfRange("max_steps"));
    }
    if limits.max_tool_calls == 0 || limits.max_tool_calls > 512 {
        return Err(HiveoryAgentDomainError::OutOfRange("max_tool_calls"));
    }
    if limits.max_duration_seconds == 0 || limits.max_duration_seconds > 24 * 60 * 60 {
        return Err(HiveoryAgentDomainError::OutOfRange("max_duration_seconds"));
    }
    if limits.max_context_tokens < 1_024 || limits.max_context_tokens > 1_000_000 {
        return Err(HiveoryAgentDomainError::OutOfRange("max_context_tokens"));
    }
    if limits.max_subagent_depth > 8 || limits.max_concurrent_subagents > 16 {
        return Err(HiveoryAgentDomainError::OutOfRange("subagent limits"));
    }
    Ok(())
}

pub fn validate_run_transition(
    from: AgentRunState,
    to: AgentRunState,
) -> Result<(), HiveoryAgentDomainError> {
    if from == to {
        return Ok(());
    }
    let valid = match from {
        AgentRunState::Queued => matches!(to, AgentRunState::Preparing | AgentRunState::Cancelled),
        AgentRunState::Preparing => matches!(
            to,
            AgentRunState::Running | AgentRunState::Interrupted | AgentRunState::Cancelled
        ),
        AgentRunState::Running => matches!(
            to,
            AgentRunState::AwaitingApproval
                | AgentRunState::AwaitingInput
                | AgentRunState::Interrupted
                | AgentRunState::Completed
                | AgentRunState::Failed
                | AgentRunState::Cancelled
        ),
        AgentRunState::AwaitingApproval => matches!(
            to,
            AgentRunState::Running
                | AgentRunState::Interrupted
                | AgentRunState::Completed
                | AgentRunState::Failed
                | AgentRunState::Cancelled
        ),
        AgentRunState::AwaitingInput => matches!(
            to,
            AgentRunState::Running
                | AgentRunState::Interrupted
                | AgentRunState::Completed
                | AgentRunState::Failed
                | AgentRunState::Cancelled
        ),
        AgentRunState::Interrupted => matches!(
            to,
            AgentRunState::Preparing | AgentRunState::Running | AgentRunState::Cancelled
        ),
        AgentRunState::Completed | AgentRunState::Failed | AgentRunState::Cancelled => false,
    };
    if valid {
        Ok(())
    } else {
        Err(HiveoryAgentDomainError::InvalidRunTransition { from, to })
    }
}

pub fn validate_tool_transition(
    from: AgentToolCallState,
    to: AgentToolCallState,
) -> Result<(), HiveoryAgentDomainError> {
    if from == to {
        return Ok(());
    }
    let valid = match from {
        AgentToolCallState::Proposed => matches!(
            to,
            AgentToolCallState::AwaitingApproval
                | AgentToolCallState::Approved
                | AgentToolCallState::Executing
                | AgentToolCallState::Cancelled
        ),
        AgentToolCallState::AwaitingApproval => matches!(
            to,
            AgentToolCallState::Approved
                | AgentToolCallState::Denied
                | AgentToolCallState::Cancelled
        ),
        AgentToolCallState::Approved => matches!(
            to,
            AgentToolCallState::Executing | AgentToolCallState::Cancelled
        ),
        AgentToolCallState::Executing => matches!(
            to,
            AgentToolCallState::Completed
                | AgentToolCallState::Failed
                | AgentToolCallState::Cancelled
        ),
        AgentToolCallState::Completed
        | AgentToolCallState::Denied
        | AgentToolCallState::Failed
        | AgentToolCallState::Cancelled => false,
    };
    if valid {
        Ok(())
    } else {
        Err(HiveoryAgentDomainError::InvalidToolTransition { from, to })
    }
}

pub fn tool_requires_approval(policy: AgentApprovalPolicy, risk: AgentToolRisk) -> bool {
    match policy {
        AgentApprovalPolicy::AlwaysAsk => true,
        AgentApprovalPolicy::AskForMutations => !matches!(risk, AgentToolRisk::ReadOnly),
        AgentApprovalPolicy::AllowWithinScope => {
            matches!(risk, AgentToolRisk::ExternallyVisible)
        }
        AgentApprovalPolicy::Deny => true,
    }
}

pub fn approval_is_allowed(policy: AgentApprovalPolicy, risk: AgentToolRisk) -> bool {
    !matches!(policy, AgentApprovalPolicy::Deny) && !tool_requires_approval(policy, risk)
}

pub fn memory_class_value(value: AgentMemoryClass) -> &'static str {
    match value {
        AgentMemoryClass::AgentKnowledge => "agent_knowledge",
        AgentMemoryClass::UserPreference => "user_preference",
        AgentMemoryClass::RunSummary => "run_summary",
        AgentMemoryClass::SkillObservation => "skill_observation",
    }
}

pub fn memory_class_from_value(value: &str) -> Option<AgentMemoryClass> {
    match value {
        "agent_knowledge" => Some(AgentMemoryClass::AgentKnowledge),
        "user_preference" => Some(AgentMemoryClass::UserPreference),
        "run_summary" => Some(AgentMemoryClass::RunSummary),
        "skill_observation" => Some(AgentMemoryClass::SkillObservation),
        _ => None,
    }
}

pub fn memory_is_eligible_for_explicit_storage(
    content: &str,
) -> Result<(), HiveoryAgentDomainError> {
    if content.trim().is_empty() {
        return Err(HiveoryAgentDomainError::Required("content"));
    }
    if content.len() > HIVEORY_MAX_MEMORY_BYTES {
        return Err(HiveoryAgentDomainError::OutOfRange("memory content"));
    }
    if looks_like_secret(content) {
        return Err(HiveoryAgentDomainError::SensitiveMemory);
    }
    Ok(())
}

fn looks_like_secret(content: &str) -> bool {
    let lower = content.to_ascii_lowercase();
    [
        "api_key=",
        "apikey=",
        "password=",
        "secret=",
        "access_token=",
        "refresh_token=",
        "sk-",
        "ghp_",
        "-----begin private key-----",
    ]
    .iter()
    .any(|marker| lower.contains(marker))
}

pub fn run_state_value(value: AgentRunState) -> &'static str {
    match value {
        AgentRunState::Queued => "queued",
        AgentRunState::Preparing => "preparing",
        AgentRunState::Running => "running",
        AgentRunState::AwaitingApproval => "awaiting_approval",
        AgentRunState::AwaitingInput => "awaiting_input",
        AgentRunState::Interrupted => "interrupted",
        AgentRunState::Completed => "completed",
        AgentRunState::Failed => "failed",
        AgentRunState::Cancelled => "cancelled",
    }
}

pub fn run_state_from_value(value: &str) -> Option<AgentRunState> {
    match value {
        "queued" => Some(AgentRunState::Queued),
        "preparing" => Some(AgentRunState::Preparing),
        "running" => Some(AgentRunState::Running),
        "awaiting_approval" => Some(AgentRunState::AwaitingApproval),
        "awaiting_input" => Some(AgentRunState::AwaitingInput),
        "interrupted" => Some(AgentRunState::Interrupted),
        "completed" => Some(AgentRunState::Completed),
        "failed" => Some(AgentRunState::Failed),
        "cancelled" => Some(AgentRunState::Cancelled),
        _ => None,
    }
}

pub fn tool_risk_value(value: AgentToolRisk) -> &'static str {
    match value {
        AgentToolRisk::ReadOnly => "read_only",
        AgentToolRisk::InternalMutation => "internal_mutation",
        AgentToolRisk::FilesystemMutation => "filesystem_mutation",
        AgentToolRisk::ExternallyVisible => "externally_visible",
    }
}

pub fn tool_risk_from_value(value: &str) -> Option<AgentToolRisk> {
    match value {
        "read_only" => Some(AgentToolRisk::ReadOnly),
        "internal_mutation" => Some(AgentToolRisk::InternalMutation),
        "filesystem_mutation" => Some(AgentToolRisk::FilesystemMutation),
        "externally_visible" => Some(AgentToolRisk::ExternallyVisible),
        _ => None,
    }
}

pub fn tool_call_state_value(value: AgentToolCallState) -> &'static str {
    match value {
        AgentToolCallState::Proposed => "proposed",
        AgentToolCallState::AwaitingApproval => "awaiting_approval",
        AgentToolCallState::Approved => "approved",
        AgentToolCallState::Executing => "executing",
        AgentToolCallState::Completed => "completed",
        AgentToolCallState::Denied => "denied",
        AgentToolCallState::Failed => "failed",
        AgentToolCallState::Cancelled => "cancelled",
    }
}

pub fn tool_call_state_from_value(value: &str) -> Option<AgentToolCallState> {
    match value {
        "proposed" => Some(AgentToolCallState::Proposed),
        "awaiting_approval" => Some(AgentToolCallState::AwaitingApproval),
        "approved" => Some(AgentToolCallState::Approved),
        "executing" => Some(AgentToolCallState::Executing),
        "completed" => Some(AgentToolCallState::Completed),
        "denied" => Some(AgentToolCallState::Denied),
        "failed" => Some(AgentToolCallState::Failed),
        "cancelled" => Some(AgentToolCallState::Cancelled),
        _ => None,
    }
}

pub fn policy_value(value: AgentApprovalPolicy) -> &'static str {
    match value {
        AgentApprovalPolicy::AlwaysAsk => "always_ask",
        AgentApprovalPolicy::AskForMutations => "ask_for_mutations",
        AgentApprovalPolicy::AllowWithinScope => "allow_within_scope",
        AgentApprovalPolicy::Deny => "deny",
    }
}

pub fn policy_from_value(value: &str) -> Option<AgentApprovalPolicy> {
    match value {
        "always_ask" => Some(AgentApprovalPolicy::AlwaysAsk),
        "ask_for_mutations" => Some(AgentApprovalPolicy::AskForMutations),
        "allow_within_scope" => Some(AgentApprovalPolicy::AllowWithinScope),
        "deny" => Some(AgentApprovalPolicy::Deny),
        _ => None,
    }
}

pub fn memory_policy_value(value: AgentMemoryPolicy) -> &'static str {
    match value {
        AgentMemoryPolicy::Disabled => "disabled",
        AgentMemoryPolicy::ExplicitOnly => "explicit_only",
        AgentMemoryPolicy::IncludeSummaries => "include_summaries",
    }
}

pub fn memory_policy_from_value(value: &str) -> Option<AgentMemoryPolicy> {
    match value {
        "disabled" => Some(AgentMemoryPolicy::Disabled),
        "explicit_only" => Some(AgentMemoryPolicy::ExplicitOnly),
        "include_summaries" => Some(AgentMemoryPolicy::IncludeSummaries),
        _ => None,
    }
}

pub fn skill_origin_value(value: AgentSkillOrigin) -> &'static str {
    match value {
        AgentSkillOrigin::Builtin => "builtin",
        AgentSkillOrigin::ApplicationData => "application_data",
        AgentSkillOrigin::ConfiguredDirectory => "configured_directory",
    }
}

pub fn skill_origin_from_value(value: &str) -> Option<AgentSkillOrigin> {
    match value {
        "builtin" => Some(AgentSkillOrigin::Builtin),
        "application_data" => Some(AgentSkillOrigin::ApplicationData),
        "configured_directory" => Some(AgentSkillOrigin::ConfiguredDirectory),
        _ => None,
    }
}

/// Parse the deliberately small, human-editable skill manifest format.
///
/// A skill is a Markdown file with YAML-style frontmatter. We parse only the
/// bounded scalar/list fields needed by the runtime; arbitrary YAML execution
/// or deserialization is intentionally not part of the trust boundary.
pub fn parse_skill_markdown(
    source_path: &str,
    source: &str,
    origin: AgentSkillOrigin,
) -> Result<AgentSkillPackage, HiveoryAgentDomainError> {
    if source.len() > HIVEORY_MAX_SKILL_FILE_BYTES {
        return Err(HiveoryAgentDomainError::OutOfRange("skill file"));
    }
    let mut sections = source.splitn(3, "---");
    let first = sections.next().unwrap_or_default().trim();
    if !first.is_empty() {
        return Err(HiveoryAgentDomainError::InvalidSkill(
            "frontmatter must start at the beginning of the file".to_owned(),
        ));
    }
    let frontmatter = sections.next().ok_or_else(|| {
        HiveoryAgentDomainError::InvalidSkill("frontmatter is missing".to_owned())
    })?;
    let body = sections.next().ok_or_else(|| {
        HiveoryAgentDomainError::InvalidSkill("skill instructions are missing".to_owned())
    })?;
    let mut values = std::collections::HashMap::<String, String>::new();
    for line in frontmatter.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let (key, value) = line.split_once(':').ok_or_else(|| {
            HiveoryAgentDomainError::InvalidSkill(format!("invalid metadata line: {line}"))
        })?;
        values.insert(key.trim().to_ascii_lowercase(), value.trim().to_owned());
    }
    let required = |key: &'static str| {
        values
            .get(key)
            .map(|value| unquote(value).to_owned())
            .filter(|value| !value.trim().is_empty())
            .ok_or(HiveoryAgentDomainError::Required(key))
    };
    let id = required("id")?;
    let name = required("name")?;
    let version = required("version")?;
    let description = required("description")?;
    if !is_safe_identifier(&id) {
        return Err(HiveoryAgentDomainError::InvalidSkill(
            "id must contain only lowercase letters, numbers, and hyphens".to_owned(),
        ));
    }
    if version.len() > 32 || name.len() > 80 || description.len() > 400 {
        return Err(HiveoryAgentDomainError::OutOfRange("skill metadata"));
    }
    let triggers = list_value(values.get("triggers"));
    let permissions = list_value(values.get("permissions"));
    if triggers.is_empty() {
        return Err(HiveoryAgentDomainError::Required("triggers"));
    }
    let summary = AgentSkillSummary {
        id,
        name,
        version,
        description,
        origin,
        source_path: source_path.to_owned(),
        triggers,
        permissions,
        enabled: false,
        valid: true,
        validation_message: None,
    };
    Ok(AgentSkillPackage {
        summary,
        instructions: body.trim().to_owned(),
        resources: Vec::new(),
    })
}

fn unquote(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .or_else(|| {
            value
                .strip_prefix('\'')
                .and_then(|value| value.strip_suffix('\''))
        })
        .unwrap_or(value)
}

fn list_value(value: Option<&String>) -> Vec<String> {
    value
        .map(|value| unquote(value).trim_matches(['[', ']']).to_owned())
        .unwrap_or_default()
        .split(',')
        .map(|item| unquote(item.trim()).to_owned())
        .filter(|item| !item.is_empty())
        .take(32)
        .collect()
}

fn is_safe_identifier(value: &str) -> bool {
    !value.is_empty()
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
}

pub fn builtin_skill_sources() -> [(&'static str, &'static str); 2] {
    [
        (
            "folder-brief",
            "---\nid: folder-brief\nname: Folder brief\nversion: 1.0.0\ndescription: Summarize a granted folder without changing it.\ntriggers: [brief, summarize folder]\npermissions: [folder.list, folder.read_text]\n---\nRead the granted folder, identify the important files, and return a concise brief with paths. Never write files.",
        ),
        (
            "decision-log",
            "---\nid: decision-log\nname: Decision log\nversion: 1.0.0\ndescription: Capture an explicit decision in durable agent memory.\ntriggers: [decision, record decision]\npermissions: [memory.remember]\n---\nWhen the user explicitly asks to remember a decision, capture the decision and its rationale using the memory tool. Do not store credentials or secrets.",
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use hiveory_protocol::{AgentApprovalPolicy, AgentRunState, AgentToolCallState, AgentToolRisk};

    #[test]
    fn mutation_tools_need_approval_under_default_policy() {
        assert!(!tool_requires_approval(
            AgentApprovalPolicy::AskForMutations,
            AgentToolRisk::ReadOnly
        ));
        assert!(tool_requires_approval(
            AgentApprovalPolicy::AskForMutations,
            AgentToolRisk::FilesystemMutation
        ));
    }

    #[test]
    fn restart_can_resume_interrupted_run() {
        assert!(
            validate_run_transition(AgentRunState::Interrupted, AgentRunState::Preparing).is_ok()
        );
        assert!(validate_run_transition(AgentRunState::Completed, AgentRunState::Running).is_err());
    }

    #[test]
    fn tool_calls_cannot_execute_after_denial() {
        assert!(validate_tool_transition(
            AgentToolCallState::Denied,
            AgentToolCallState::Executing
        )
        .is_err());
    }

    #[test]
    fn skill_frontmatter_is_bounded_and_typed() {
        let package = parse_skill_markdown(
            "builtin/brief/SKILL.md",
            builtin_skill_sources()[0].1,
            AgentSkillOrigin::Builtin,
        )
        .expect("valid skill");
        assert_eq!(package.summary.id, "folder-brief");
        assert!(package
            .summary
            .permissions
            .contains(&"folder.list".to_owned()));
    }

    #[test]
    fn secret_like_memory_is_rejected() {
        assert!(memory_is_eligible_for_explicit_storage("api_key=do-not-store").is_err());
        assert!(
            memory_is_eligible_for_explicit_storage("The user prefers concise summaries").is_ok()
        );
    }
}
