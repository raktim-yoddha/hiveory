use hiveory_persistence::HiveoryPersistence;
use hiveory_platform_process::configure_background_command;
use hiveory_protocol::{
    CodeHostedAuthState, CodeHostedIssue, CodeHostedIssueAction, CodeHostedIssueState,
    CodeHostedOperationResult, CodeHostedPullRequest, CodeHostedPullRequestAction,
    CodeHostedRepository, CodeHostedTracking,
};
use serde_json::Value;
use std::{
    path::Path,
    process::Stdio,
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{
    process::Command,
    time::{timeout, Duration},
};
use url::Url;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(12);
const MAX_JSON_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug)]
pub(crate) enum HostedCommandError {
    MissingCli,
    NotAuthenticated,
    NoRepository,
    Offline,
    RateLimited,
    Failed,
}

pub(crate) async fn create_issue(
    workspace_id: &str,
    root: &Path,
    title: &str,
    body: &str,
    labels: &[String],
) -> Result<CodeHostedOperationResult, HostedCommandError> {
    let title = validate_text(title, "issue title")?;
    let body = body.trim();
    let mut args = vec![
        "issue".to_owned(),
        "create".to_owned(),
        "--title".to_owned(),
        title,
        "--body".to_owned(),
        body.to_owned(),
    ];
    for label in labels {
        let label = validate_text(label, "issue label")?;
        args.extend(["--label".to_owned(), label]);
    }
    let output = run_text(root, &args).await?;
    let url = first_url(&output);
    Ok(hosted_result(
        workspace_id,
        "issue_create",
        command_message(output, "Issue created."),
        url,
    ))
}

pub(crate) async fn update_issue(
    workspace_id: &str,
    root: &Path,
    number: u64,
    title: Option<&str>,
    body: Option<&str>,
    state: Option<CodeHostedIssueState>,
) -> Result<CodeHostedOperationResult, HostedCommandError> {
    let number = number.to_string();
    let mut output = String::new();
    if title.is_some() || body.is_some() {
        let mut args = vec!["issue".to_owned(), "edit".to_owned(), number.clone()];
        if let Some(title) = title {
            args.extend(["--title".to_owned(), validate_text(title, "issue title")?]);
        }
        if let Some(body) = body {
            args.extend(["--body".to_owned(), body.trim().to_owned()]);
        }
        output = run_text(root, &args).await?;
    }
    if let Some(state) = state {
        let verb = match state {
            CodeHostedIssueState::Open => "reopen",
            CodeHostedIssueState::Closed => "close",
        };
        output = run_text(root, &["issue".to_owned(), verb.to_owned(), number.clone()]).await?;
    }
    Ok(hosted_result(
        workspace_id,
        "issue_update",
        command_message(output, "Issue updated."),
        None,
    ))
}

pub(crate) async fn issue_action(
    workspace_id: &str,
    root: &Path,
    number: u64,
    action: CodeHostedIssueAction,
) -> Result<CodeHostedOperationResult, HostedCommandError> {
    let verb = match action {
        CodeHostedIssueAction::Close => "close",
        CodeHostedIssueAction::Reopen => "reopen",
    };
    let output = run_text(
        root,
        &["issue".to_owned(), verb.to_owned(), number.to_string()],
    )
    .await?;
    Ok(hosted_result(
        workspace_id,
        "issue_action",
        command_message(output, "Issue state updated."),
        None,
    ))
}

pub(crate) async fn create_pull_request(
    workspace_id: &str,
    root: &Path,
    title: &str,
    body: &str,
    base_branch: Option<&str>,
    draft: bool,
) -> Result<CodeHostedOperationResult, HostedCommandError> {
    let title = validate_text(title, "pull request title")?;
    let mut args = vec![
        "pr".to_owned(),
        "create".to_owned(),
        "--title".to_owned(),
        title,
        "--body".to_owned(),
        body.trim().to_owned(),
    ];
    if let Some(base_branch) = base_branch.map(str::trim).filter(|value| !value.is_empty()) {
        args.extend(["--base".to_owned(), validate_branch(base_branch)?]);
    }
    if draft {
        args.push("--draft".to_owned());
    }
    let output = run_text(root, &args).await?;
    let url = first_url(&output);
    Ok(hosted_result(
        workspace_id,
        "pull_request_create",
        command_message(output, "Pull request created."),
        url,
    ))
}

pub(crate) async fn pull_request_action(
    workspace_id: &str,
    root: &Path,
    number: u64,
    action: CodeHostedPullRequestAction,
) -> Result<CodeHostedOperationResult, HostedCommandError> {
    let number = number.to_string();
    let args = match action {
        CodeHostedPullRequestAction::Close => {
            vec!["pr".to_owned(), "close".to_owned(), number]
        }
        CodeHostedPullRequestAction::Reopen => {
            vec!["pr".to_owned(), "reopen".to_owned(), number]
        }
        CodeHostedPullRequestAction::Merge => vec![
            "pr".to_owned(),
            "merge".to_owned(),
            number,
            "--merge".to_owned(),
        ],
    };
    let output = run_text(root, &args).await?;
    Ok(hosted_result(
        workspace_id,
        "pull_request_action",
        command_message(output, "Pull request updated."),
        None,
    ))
}

pub async fn load_tracking(
    persistence: &HiveoryPersistence,
    workspace_id: &str,
    root: &Path,
) -> CodeHostedTracking {
    let refreshed_at_unix_ms = now_ms();
    let repository = match run_json(root, &["repo", "view", "--json", "nameWithOwner,url"]).await {
        Ok(value) => match parse_repository(&value) {
            Some(repository) => repository,
            None => {
                return empty_tracking(
                    workspace_id,
                    CodeHostedAuthState::NoRepository,
                    Some("The current repository has no hosted remote."),
                    refreshed_at_unix_ms,
                )
            }
        },
        Err(error) => {
            if let Ok(Some(mut cached)) = persistence.hosted_tracking_cache(workspace_id).await {
                cached.auth_state = error.auth_state();
                cached.message = Some(format!("Showing cached source data. {}", error.message()));
                cached.stale = true;
                return cached;
            }
            return empty_tracking(
                workspace_id,
                error.auth_state(),
                Some(error.message()),
                refreshed_at_unix_ms,
            );
        }
    };

    let mut auth_state = CodeHostedAuthState::Ready;
    let mut messages = Vec::new();
    let issues = match run_json(
        root,
        &[
            "issue",
            "list",
            "--state",
            "all",
            "--limit",
            "50",
            "--json",
            "number,title,state,url,author,labels,updatedAt",
        ],
    )
    .await
    {
        Ok(value) => parse_issues(&value),
        Err(error) => {
            auth_state = error.auth_state();
            messages.push(format!("Issues: {}", error.message()));
            Vec::new()
        }
    };
    let pull_requests = match run_json(
        root,
        &[
            "pr",
            "list",
            "--state",
            "all",
            "--limit",
            "50",
            "--json",
            "number,title,state,isDraft,url,headRefName,baseRefName,author,reviewDecision,statusCheckRollup,updatedAt",
        ],
    )
    .await
    {
        Ok(value) => parse_pull_requests(&value),
        Err(error) => {
            if auth_state == CodeHostedAuthState::Ready {
                auth_state = error.auth_state();
            }
            messages.push(format!("Pull requests: {}", error.message()));
            Vec::new()
        }
    };

    let tracking = CodeHostedTracking {
        workspace_id: workspace_id.to_owned(),
        repository: Some(repository),
        auth_state,
        message: (!messages.is_empty()).then(|| messages.join(" ")),
        issues,
        pull_requests,
        refreshed_at_unix_ms,
        stale: false,
    };
    let _ = persistence.save_hosted_tracking(&tracking).await;
    tracking
}

async fn run_json(root: &Path, args: &[&str]) -> Result<Value, HostedCommandError> {
    let mut command = Command::new("gh");
    configure_background_command(command.as_std_mut());
    let result = timeout(
        COMMAND_TIMEOUT,
        command
            .args(args)
            .current_dir(root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await;
    let output = match result {
        Ok(Ok(output)) => output,
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(HostedCommandError::MissingCli)
        }
        Ok(Err(_)) => return Err(HostedCommandError::Offline),
        Err(_) => return Err(HostedCommandError::Offline),
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(classify_error(&stderr));
    }
    if output.stdout.len() > MAX_JSON_BYTES {
        return Err(HostedCommandError::Failed);
    }
    serde_json::from_slice(&output.stdout).map_err(|_| HostedCommandError::Failed)
}

async fn run_text(root: &Path, args: &[String]) -> Result<String, HostedCommandError> {
    let mut command = Command::new("gh");
    configure_background_command(command.as_std_mut());
    let result = timeout(
        COMMAND_TIMEOUT,
        command
            .args(args)
            .current_dir(root)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output(),
    )
    .await;
    let output = match result {
        Ok(Ok(output)) => output,
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(HostedCommandError::MissingCli)
        }
        Ok(Err(_)) => return Err(HostedCommandError::Offline),
        Err(_) => return Err(HostedCommandError::Offline),
    };
    if !output.status.success() {
        return Err(classify_error(&String::from_utf8_lossy(&output.stderr)));
    }
    if output.stdout.len() > MAX_JSON_BYTES {
        return Err(HostedCommandError::Failed);
    }
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
}

fn hosted_result(
    workspace_id: &str,
    operation: &str,
    message: String,
    url: Option<String>,
) -> CodeHostedOperationResult {
    CodeHostedOperationResult {
        workspace_id: workspace_id.to_owned(),
        operation: operation.to_owned(),
        message,
        url,
    }
}

fn validate_text(value: &str, field: &str) -> Result<String, HostedCommandError> {
    let value = value.trim();
    if value.is_empty() || value.chars().any(char::is_control) {
        return Err(HostedCommandError::Failed);
    }
    if value.len() > 5000 {
        return Err(HostedCommandError::Failed);
    }
    let _ = field;
    Ok(value.to_owned())
}

fn validate_branch(value: &str) -> Result<String, HostedCommandError> {
    let value = value.trim();
    if value.is_empty()
        || value.len() > 240
        || value.starts_with('-')
        || value.contains("..")
        || value.contains(['~', '^', ':', '\\', '?', '[', '*'])
        || value.ends_with('.')
        || value.ends_with('/')
    {
        return Err(HostedCommandError::Failed);
    }
    Ok(value.to_owned())
}

fn first_url(value: &str) -> Option<String> {
    value
        .split_whitespace()
        .find(|part| part.starts_with("https://") || part.starts_with("http://"))
        .map(ToOwned::to_owned)
}

fn command_message(output: String, fallback: &str) -> String {
    let output = output.trim();
    if output.is_empty() {
        fallback.to_owned()
    } else {
        output.chars().take(6000).collect()
    }
}

fn parse_repository(value: &Value) -> Option<CodeHostedRepository> {
    let name_with_owner = value
        .get("nameWithOwner")
        .or_else(|| value.get("name_with_owner"))
        .and_then(Value::as_str)?;
    let (owner, name) = name_with_owner.split_once('/')?;
    if owner.trim().is_empty() || name.trim().is_empty() {
        return None;
    }
    let url = value
        .get("url")
        .and_then(Value::as_str)
        .filter(|url| !url.trim().is_empty())
        .unwrap_or("https://github.com");
    let host = Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(ToOwned::to_owned))
        .unwrap_or_else(|| "github.com".to_owned());
    Some(CodeHostedRepository {
        host,
        owner: owner.to_owned(),
        name: name.to_owned(),
        url: url.to_owned(),
    })
}

fn parse_issues(value: &Value) -> Vec<CodeHostedIssue> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(CodeHostedIssue {
                number: item.get("number")?.as_u64()?,
                title: string_value(item, "title").unwrap_or_else(|| "Untitled issue".to_owned()),
                state: string_value(item, "state").unwrap_or_else(|| "UNKNOWN".to_owned()),
                url: string_value(item, "url").unwrap_or_default(),
                author: nested_string(item, "author", "login"),
                labels: item
                    .get("labels")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|label| label.get("name").and_then(Value::as_str))
                    .map(ToOwned::to_owned)
                    .collect(),
                updated_at: string_value(item, "updatedAt"),
            })
        })
        .collect()
}

fn parse_pull_requests(value: &Value) -> Vec<CodeHostedPullRequest> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(CodeHostedPullRequest {
                number: item.get("number")?.as_u64()?,
                title: string_value(item, "title")
                    .unwrap_or_else(|| "Untitled pull request".to_owned()),
                state: string_value(item, "state").unwrap_or_else(|| "UNKNOWN".to_owned()),
                draft: item
                    .get("isDraft")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                url: string_value(item, "url").unwrap_or_default(),
                head_branch: string_value(item, "headRefName").unwrap_or_default(),
                base_branch: string_value(item, "baseRefName").unwrap_or_default(),
                author: nested_string(item, "author", "login"),
                review_decision: string_value(item, "reviewDecision"),
                check_state: check_state(item.get("statusCheckRollup")),
                updated_at: string_value(item, "updatedAt"),
            })
        })
        .collect()
}

fn check_state(value: Option<&Value>) -> String {
    let Some(checks) = value.and_then(Value::as_array) else {
        return "unknown".to_owned();
    };
    if checks.is_empty() {
        return "none".to_owned();
    }
    let mut failed = false;
    let mut pending = false;
    for check in checks {
        let state = check
            .get("state")
            .or_else(|| check.get("status"))
            .or_else(|| check.get("conclusion"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_ascii_lowercase();
        if matches!(state.as_str(), "failure" | "failed" | "error" | "cancelled") {
            failed = true;
        } else if !matches!(
            state.as_str(),
            "success" | "successful" | "completed" | "skipped" | "neutral"
        ) {
            pending = true;
        }
    }
    if failed {
        "failed".to_owned()
    } else if pending {
        "pending".to_owned()
    } else {
        "passed".to_owned()
    }
}

fn string_value(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .map(ToOwned::to_owned)
}

fn nested_string(value: &Value, parent: &str, child: &str) -> Option<String> {
    value
        .get(parent)
        .and_then(|nested| nested.get(child))
        .and_then(Value::as_str)
        .filter(|text| !text.trim().is_empty())
        .map(ToOwned::to_owned)
}

fn classify_error(stderr: &str) -> HostedCommandError {
    let message = stderr.to_ascii_lowercase();
    if message.contains("not logged in")
        || message.contains("not authenticated")
        || message.contains("authentication required")
    {
        HostedCommandError::NotAuthenticated
    } else if message.contains("rate limit") || message.contains("api rate") {
        HostedCommandError::RateLimited
    } else if message.contains("not a git repository")
        || message.contains("could not resolve to a repository")
        || message.contains("no git remotes")
    {
        HostedCommandError::NoRepository
    } else if message.contains("network")
        || message.contains("connection")
        || message.contains("timed out")
        || message.contains("could not resolve host")
    {
        HostedCommandError::Offline
    } else {
        HostedCommandError::Failed
    }
}

fn empty_tracking(
    workspace_id: &str,
    auth_state: CodeHostedAuthState,
    message: Option<&str>,
    refreshed_at_unix_ms: i64,
) -> CodeHostedTracking {
    CodeHostedTracking {
        workspace_id: workspace_id.to_owned(),
        repository: None,
        auth_state,
        message: message.map(ToOwned::to_owned),
        issues: Vec::new(),
        pull_requests: Vec::new(),
        refreshed_at_unix_ms,
        stale: false,
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis().min(i64::MAX as u128) as i64)
        .unwrap_or_default()
}

impl HostedCommandError {
    pub(crate) fn auth_state(&self) -> CodeHostedAuthState {
        match self {
            Self::MissingCli => CodeHostedAuthState::MissingCli,
            Self::NotAuthenticated => CodeHostedAuthState::NotAuthenticated,
            Self::NoRepository => CodeHostedAuthState::NoRepository,
            Self::Offline => CodeHostedAuthState::Offline,
            Self::RateLimited => CodeHostedAuthState::RateLimited,
            Self::Failed => CodeHostedAuthState::Error,
        }
    }

    pub(crate) fn message(&self) -> &'static str {
        match self {
            Self::MissingCli => "The hosted-source CLI is not installed or is not on PATH.",
            Self::NotAuthenticated => {
                "Sign in with the hosted-source CLI to load issues and pull requests."
            }
            Self::NoRepository => "No hosted repository could be resolved for this workspace.",
            Self::Offline => "The hosted source is unavailable. Check the network and try again.",
            Self::RateLimited => "The hosted source rate limit was reached. Try again later.",
            Self::Failed => "The hosted-source request failed. Refresh to try again.",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_repository_identity_without_exposing_credentials() {
        let repository = parse_repository(&json!({
            "nameWithOwner": "acme/widget",
            "url": "https://code.example.test/acme/widget"
        }))
        .expect("repository should parse");
        assert_eq!(repository.host, "code.example.test");
        assert_eq!(repository.owner, "acme");
        assert_eq!(repository.name, "widget");
    }

    #[test]
    fn parses_issue_labels_and_pull_request_check_state() {
        let issues = parse_issues(&json!([{
            "number": 7,
            "title": "Improve sync",
            "state": "OPEN",
            "url": "https://code.example.test/acme/widget/issues/7",
            "author": {"login": "maintainer"},
            "labels": [{"name": "enhancement"}],
            "updatedAt": "2026-08-29T10:00:00Z"
        }]));
        assert_eq!(issues[0].labels, vec!["enhancement"]);
        assert_eq!(issues[0].author.as_deref(), Some("maintainer"));

        let pull_requests = parse_pull_requests(&json!([{
            "number": 8,
            "title": "Add tracking",
            "state": "OPEN",
            "isDraft": false,
            "url": "https://code.example.test/acme/widget/pull/8",
            "headRefName": "feature/tracking",
            "baseRefName": "main",
            "author": {"login": "contributor"},
            "reviewDecision": "APPROVED",
            "statusCheckRollup": [{"state": "SUCCESS"}],
            "updatedAt": "2026-08-29T10:00:00Z"
        }]));
        assert_eq!(pull_requests[0].check_state, "passed");
        assert_eq!(
            pull_requests[0].review_decision.as_deref(),
            Some("APPROVED")
        );
    }

    #[test]
    fn failed_checks_win_over_pending_checks() {
        assert_eq!(
            check_state(Some(&json!([
                {"state": "IN_PROGRESS"},
                {"conclusion": "FAILURE"}
            ]))),
            "failed"
        );
        assert_eq!(check_state(Some(&json!([]))), "none");
        assert_eq!(check_state(None), "unknown");
    }

    #[test]
    fn classifies_actionable_host_errors() {
        assert!(matches!(
            classify_error("You are not logged in"),
            HostedCommandError::NotAuthenticated
        ));
        assert!(matches!(
            classify_error("API rate limit exceeded"),
            HostedCommandError::RateLimited
        ));
        assert!(matches!(
            classify_error("Could not resolve host"),
            HostedCommandError::Offline
        ));
    }
}
