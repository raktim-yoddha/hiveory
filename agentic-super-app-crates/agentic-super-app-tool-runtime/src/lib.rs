use agentic_super_app_persistence::AgenticSuperAppPersistence;
use agentic_super_app_protocol::AgentToolDefinition;
use async_trait::async_trait;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AgenticSuperAppApprovalPolicy {
    AlwaysAsk,
    AskForMutations,
    AllowWithinScope,
    Deny,
}

pub fn agentic_super_app_approval_fingerprint(
    action: &str,
    target: &str,
    arguments: &str,
) -> String {
    format!(
        "{:x}",
        Sha256::digest(format!("{action}\n{target}\n{arguments}"))
    )
}

/// Extension point used by the Agent loop for capabilities that are not
/// implemented by the built-in local tools. The provider owns its own
/// permission and secret boundary; the Agent runtime only sees tool schemas
/// and redacted results.
#[async_trait]
pub trait AgenticSuperAppExternalToolProvider: Send + Sync {
    async fn definitions(&self, agent_id: &str) -> Result<Vec<AgentToolDefinition>, String>;

    async fn execute(
        &self,
        run_id: &str,
        agent_id: &str,
        name: &str,
        arguments_json: &str,
    ) -> Result<String, String>;
}

#[derive(Clone)]
pub struct AgenticSuperAppAuditLog {
    persistence: AgenticSuperAppPersistence,
}
impl AgenticSuperAppAuditLog {
    pub fn new(persistence: AgenticSuperAppPersistence) -> Self {
        Self { persistence }
    }
    pub async fn record(
        &self,
        action: &str,
        outcome: &str,
        severity: &str,
        target: Option<&str>,
        redacted_context: Option<&str>,
    ) -> Result<(), sqlx::Error> {
        self.persistence
            .audit(action, outcome, severity, target, redacted_context)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::agentic_super_app_approval_fingerprint;

    #[test]
    fn approval_fingerprint_is_stable_and_input_specific() {
        let expected = agentic_super_app_approval_fingerprint("write", "workspace/file.txt", "{}");
        assert_eq!(
            expected,
            agentic_super_app_approval_fingerprint("write", "workspace/file.txt", "{}")
        );
        assert_ne!(
            expected,
            agentic_super_app_approval_fingerprint(
                "write",
                "workspace/file.txt",
                "{\"force\":true}"
            )
        );
    }
}
