use async_trait::async_trait;
use hiveory_persistence::HiveoryPersistence;
use hiveory_protocol::AgentToolDefinition;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HiveoryApprovalPolicy {
    AlwaysAsk,
    AskForMutations,
    AllowWithinScope,
    Deny,
}

pub fn hiveory_approval_fingerprint(action: &str, target: &str, arguments: &str) -> String {
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
pub trait HiveoryExternalToolProvider: Send + Sync {
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
pub struct HiveoryAuditLog {
    persistence: HiveoryPersistence,
}
impl HiveoryAuditLog {
    pub fn new(persistence: HiveoryPersistence) -> Self {
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
    use super::hiveory_approval_fingerprint;

    #[test]
    fn approval_fingerprint_is_stable_and_input_specific() {
        let expected = hiveory_approval_fingerprint("write", "workspace/file.txt", "{}");
        assert_eq!(
            expected,
            hiveory_approval_fingerprint("write", "workspace/file.txt", "{}")
        );
        assert_ne!(
            expected,
            hiveory_approval_fingerprint("write", "workspace/file.txt", "{\"force\":true}")
        );
    }
}
