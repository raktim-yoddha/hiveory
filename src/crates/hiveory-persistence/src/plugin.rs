use hiveory_protocol::{
    AgentPluginGrant, AgentPluginGrantRequest, PluginAdapterKind, PluginCatalogEntry,
    PluginConnectionCreateRequest, PluginConnectionKind, PluginConnectionSummary,
    PluginConnectionUpdateRequest, PluginInstallRequest, PluginInvocationSummary, PluginManifest,
};
use sqlx::{sqlite::SqliteRow, Row};
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Error)]
pub enum HiveoryPluginStoreError {
    #[error("plugin was not found")]
    NotFound,
    #[error("plugin input is invalid: {0}")]
    InvalidInput(String),
    #[error("plugin conflicts with existing durable state")]
    Conflict,
    #[error("database failure: {0}")]
    Database(#[from] sqlx::Error),
    #[error("serialization failure: {0}")]
    Serialization(#[from] serde_json::Error),
}

#[derive(Clone)]
pub struct HiveoryPluginStore {
    persistence: super::HiveoryPersistence,
}

impl HiveoryPluginStore {
    pub fn new(persistence: super::HiveoryPersistence) -> Self {
        Self { persistence }
    }

    pub fn persistence(&self) -> &super::HiveoryPersistence {
        &self.persistence
    }

    pub async fn upsert_manifest(
        &self,
        manifest: &PluginManifest,
    ) -> Result<(), HiveoryPluginStoreError> {
        validate_manifest(manifest)?;
        let now = now_ms();
        sqlx::query("INSERT INTO hiveory_plugin_manifests (id, publisher, version, name, description, adapter, manifest_json, content_hash, installed, enabled, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?, ?) ON CONFLICT(id) DO UPDATE SET publisher=excluded.publisher, version=excluded.version, name=excluded.name, description=excluded.description, adapter=excluded.adapter, manifest_json=excluded.manifest_json, content_hash=excluded.content_hash, updated_at_unix_ms=excluded.updated_at_unix_ms")
            .bind(&manifest.id)
            .bind(&manifest.publisher)
            .bind(&manifest.version)
            .bind(&manifest.name)
            .bind(&manifest.description)
            .bind(adapter_value(manifest.adapter))
            .bind(serde_json::to_string(manifest)?)
            .bind(&manifest.content_hash)
            .bind(now)
            .bind(now)
            .execute(self.persistence.pool())
            .await?;
        Ok(())
    }

    pub async fn catalog(&self) -> Result<Vec<PluginCatalogEntry>, HiveoryPluginStoreError> {
        let rows = sqlx::query("SELECT m.manifest_json, m.installed, m.enabled, (SELECT COUNT(*) FROM hiveory_plugin_connections c WHERE c.plugin_id=m.id), (SELECT COUNT(*) FROM hiveory_agent_plugin_grants g WHERE g.plugin_id=m.id AND g.enabled=1) FROM hiveory_plugin_manifests m ORDER BY m.name")
            .fetch_all(self.persistence.pool())
            .await?;
        rows.into_iter()
            .map(|row| {
                Ok(PluginCatalogEntry {
                    manifest: serde_json::from_str(&row.get::<String, _>(0))?,
                    installed: row.get::<i64, _>(1) != 0,
                    enabled: row.get::<i64, _>(2) != 0,
                    connection_count: row.get::<i64, _>(3).max(0) as u32,
                    assigned_agent_count: row.get::<i64, _>(4).max(0) as u32,
                })
            })
            .collect()
    }

    pub async fn set_installed(
        &self,
        request: &PluginInstallRequest,
    ) -> Result<(), HiveoryPluginStoreError> {
        let result = sqlx::query("UPDATE hiveory_plugin_manifests SET installed=?, enabled=?, updated_at_unix_ms=? WHERE id=?")
            .bind(if request.enabled { 1 } else { 0 })
            .bind(if request.enabled { 1 } else { 0 })
            .bind(now_ms())
            .bind(&request.plugin_id)
            .execute(self.persistence.pool())
            .await?;
        if result.rows_affected() == 0 {
            return Err(HiveoryPluginStoreError::NotFound);
        }
        Ok(())
    }

    pub async fn manifest(
        &self,
        plugin_id: &str,
    ) -> Result<PluginManifest, HiveoryPluginStoreError> {
        let row = sqlx::query(
            "SELECT manifest_json FROM hiveory_plugin_manifests WHERE id=? AND installed=1",
        )
        .bind(plugin_id)
        .fetch_optional(self.persistence.pool())
        .await?
        .ok_or(HiveoryPluginStoreError::NotFound)?;
        Ok(serde_json::from_str(&row.get::<String, _>(0))?)
    }

    pub async fn connections(
        &self,
        plugin_id: Option<&str>,
    ) -> Result<Vec<PluginConnectionSummary>, HiveoryPluginStoreError> {
        let rows = if let Some(plugin_id) = plugin_id {
            sqlx::query("SELECT id, plugin_id, name, origin, kind, api_key_header, secret_ref, validated_at_unix_ms, created_at_unix_ms, updated_at_unix_ms FROM hiveory_plugin_connections WHERE plugin_id=? ORDER BY name")
                .bind(plugin_id)
                .fetch_all(self.persistence.pool())
                .await?
        } else {
            sqlx::query("SELECT id, plugin_id, name, origin, kind, api_key_header, secret_ref, validated_at_unix_ms, created_at_unix_ms, updated_at_unix_ms FROM hiveory_plugin_connections ORDER BY plugin_id, name")
                .fetch_all(self.persistence.pool())
                .await?
        };
        rows.iter().map(connection_from_row).collect()
    }

    pub async fn connection(
        &self,
        connection_id: &str,
    ) -> Result<Option<PluginConnectionSummary>, HiveoryPluginStoreError> {
        sqlx::query("SELECT id, plugin_id, name, origin, kind, api_key_header, secret_ref, validated_at_unix_ms, created_at_unix_ms, updated_at_unix_ms FROM hiveory_plugin_connections WHERE id=?")
            .bind(connection_id)
            .fetch_optional(self.persistence.pool())
            .await?
            .as_ref()
            .map(connection_from_row)
            .transpose()
    }

    pub async fn connection_with_secret(
        &self,
        connection_id: &str,
    ) -> Result<Option<(PluginConnectionSummary, Option<String>)>, HiveoryPluginStoreError> {
        let row = sqlx::query("SELECT id, plugin_id, name, origin, kind, api_key_header, secret_ref, validated_at_unix_ms, created_at_unix_ms, updated_at_unix_ms FROM hiveory_plugin_connections WHERE id=?")
            .bind(connection_id)
            .fetch_optional(self.persistence.pool())
            .await?;
        row.as_ref()
            .map(|row| Ok((connection_from_row(row)?, row.get(6))))
            .transpose()
    }

    pub async fn create_connection(
        &self,
        request: &PluginConnectionCreateRequest,
        secret_ref: Option<&str>,
    ) -> Result<PluginConnectionSummary, HiveoryPluginStoreError> {
        self.validate_plugin(&request.plugin_id).await?;
        validate_origin(&request.origin)?;
        validate_connection_input(
            request.name.as_str(),
            request.api_key_header.as_deref(),
            request.kind,
        )?;
        let id = Uuid::now_v7().to_string();
        let now = now_ms();
        let result = sqlx::query("INSERT INTO hiveory_plugin_connections (id, plugin_id, name, origin, kind, api_key_header, secret_ref, created_at_unix_ms, updated_at_unix_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
            .bind(&id)
            .bind(&request.plugin_id)
            .bind(request.name.trim())
            .bind(request.origin.trim_end_matches('/'))
            .bind(connection_kind_value(request.kind))
            .bind(request.api_key_header.as_deref())
            .bind(secret_ref)
            .bind(now)
            .bind(now)
            .execute(self.persistence.pool())
            .await;
        match result {
            Ok(_) => self
                .connection(&id)
                .await?
                .ok_or(HiveoryPluginStoreError::NotFound),
            Err(sqlx::Error::Database(error)) if error.message().contains("UNIQUE") => {
                Err(HiveoryPluginStoreError::Conflict)
            }
            Err(error) => Err(error.into()),
        }
    }

    pub async fn update_connection(
        &self,
        request: &PluginConnectionUpdateRequest,
        secret_ref: Option<&str>,
    ) -> Result<PluginConnectionSummary, HiveoryPluginStoreError> {
        let Some(existing) = self.connection(&request.connection_id).await? else {
            return Err(HiveoryPluginStoreError::NotFound);
        };
        validate_origin(&request.origin)?;
        validate_connection_input(
            request.name.as_str(),
            request.api_key_header.as_deref(),
            existing.kind,
        )?;
        let result = sqlx::query("UPDATE hiveory_plugin_connections SET name=?, origin=?, api_key_header=?, secret_ref=COALESCE(?, secret_ref), validated_at_unix_ms=NULL, updated_at_unix_ms=? WHERE id=?")
            .bind(request.name.trim())
            .bind(request.origin.trim_end_matches('/'))
            .bind(request.api_key_header.as_deref())
            .bind(secret_ref)
            .bind(now_ms())
            .bind(&request.connection_id)
            .execute(self.persistence.pool())
            .await?;
        if result.rows_affected() == 0 {
            return Err(HiveoryPluginStoreError::NotFound);
        }
        self.connection(&request.connection_id)
            .await?
            .ok_or(HiveoryPluginStoreError::NotFound)
    }

    pub async fn delete_connection(
        &self,
        connection_id: &str,
    ) -> Result<(), HiveoryPluginStoreError> {
        let result = sqlx::query("DELETE FROM hiveory_plugin_connections WHERE id=?")
            .bind(connection_id)
            .execute(self.persistence.pool())
            .await?;
        if result.rows_affected() == 0 {
            return Err(HiveoryPluginStoreError::NotFound);
        }
        Ok(())
    }

    pub async fn mark_connection_validated(
        &self,
        connection_id: &str,
    ) -> Result<(), HiveoryPluginStoreError> {
        sqlx::query("UPDATE hiveory_plugin_connections SET validated_at_unix_ms=?, updated_at_unix_ms=? WHERE id=?")
            .bind(now_ms())
            .bind(now_ms())
            .bind(connection_id)
            .execute(self.persistence.pool())
            .await?;
        Ok(())
    }

    pub async fn grants_for_agent(
        &self,
        agent_id: &str,
    ) -> Result<Vec<AgentPluginGrant>, HiveoryPluginStoreError> {
        let rows = sqlx::query("SELECT agent_id, plugin_id, connection_id, tool_names_json, enabled FROM hiveory_agent_plugin_grants WHERE agent_id=? ORDER BY plugin_id, connection_id")
            .bind(agent_id)
            .fetch_all(self.persistence.pool())
            .await?;
        rows.into_iter().map(grant_from_row).collect()
    }

    pub async fn set_grant(
        &self,
        request: &AgentPluginGrantRequest,
    ) -> Result<AgentPluginGrant, HiveoryPluginStoreError> {
        self.ensure_agent(&request.agent_id).await?;
        let connection = self
            .connection(&request.connection_id)
            .await?
            .ok_or(HiveoryPluginStoreError::NotFound)?;
        if connection.plugin_id != request.plugin_id {
            return Err(HiveoryPluginStoreError::Conflict);
        }
        self.manifest(&request.plugin_id).await?;
        sqlx::query("INSERT INTO hiveory_agent_plugin_grants (agent_id, plugin_id, connection_id, tool_names_json, enabled) VALUES (?, ?, ?, ?, ?) ON CONFLICT(agent_id, plugin_id, connection_id) DO UPDATE SET tool_names_json=excluded.tool_names_json, enabled=excluded.enabled")
            .bind(&request.agent_id)
            .bind(&request.plugin_id)
            .bind(&request.connection_id)
            .bind(serde_json::to_string(&request.tool_names)?)
            .bind(if request.enabled { 1 } else { 0 })
            .execute(self.persistence.pool())
            .await?;
        Ok(AgentPluginGrant {
            agent_id: request.agent_id.clone(),
            plugin_id: request.plugin_id.clone(),
            connection_id: request.connection_id.clone(),
            tool_names: request.tool_names.clone(),
            enabled: request.enabled,
        })
    }

    pub async fn insert_invocation(
        &self,
        run_id: Option<&str>,
        plugin_id: &str,
        connection_id: &str,
        tool_name: &str,
        target: &str,
        request_preview: &str,
    ) -> Result<PluginInvocationSummary, HiveoryPluginStoreError> {
        let id = Uuid::now_v7().to_string();
        let now = now_ms();
        sqlx::query("INSERT INTO hiveory_plugin_invocations (id, run_id, plugin_id, connection_id, tool_name, state, target, request_preview, created_at_unix_ms) VALUES (?, ?, ?, ?, ?, 'executing', ?, ?, ?)")
            .bind(&id)
            .bind(run_id)
            .bind(plugin_id)
            .bind(connection_id)
            .bind(tool_name)
            .bind(target)
            .bind(request_preview)
            .bind(now)
            .execute(self.persistence.pool())
            .await?;
        self.invocation(&id).await
    }

    pub async fn finish_invocation(
        &self,
        invocation_id: &str,
        state: &str,
        response_preview: Option<&str>,
        error: Option<&str>,
    ) -> Result<(), HiveoryPluginStoreError> {
        sqlx::query("UPDATE hiveory_plugin_invocations SET state=?, response_preview=?, error=?, completed_at_unix_ms=? WHERE id=?")
            .bind(state)
            .bind(response_preview)
            .bind(error)
            .bind(now_ms())
            .bind(invocation_id)
            .execute(self.persistence.pool())
            .await?;
        Ok(())
    }

    pub async fn invocations_for_run(
        &self,
        run_id: &str,
        limit: u32,
    ) -> Result<Vec<PluginInvocationSummary>, HiveoryPluginStoreError> {
        let rows = sqlx::query("SELECT id, run_id, plugin_id, connection_id, tool_name, state, target, request_preview, response_preview, error, created_at_unix_ms, completed_at_unix_ms FROM hiveory_plugin_invocations WHERE run_id=? ORDER BY created_at_unix_ms DESC LIMIT ?")
            .bind(run_id)
            .bind(i64::from(limit.clamp(1, 200)))
            .fetch_all(self.persistence.pool())
            .await?;
        rows.into_iter().map(invocation_from_row).collect()
    }

    async fn invocation(
        &self,
        invocation_id: &str,
    ) -> Result<PluginInvocationSummary, HiveoryPluginStoreError> {
        let row = sqlx::query("SELECT id, run_id, plugin_id, connection_id, tool_name, state, target, request_preview, response_preview, error, created_at_unix_ms, completed_at_unix_ms FROM hiveory_plugin_invocations WHERE id=?")
            .bind(invocation_id)
            .fetch_optional(self.persistence.pool())
            .await?
            .ok_or(HiveoryPluginStoreError::NotFound)?;
        invocation_from_row(row)
    }

    async fn validate_plugin(&self, plugin_id: &str) -> Result<(), HiveoryPluginStoreError> {
        self.manifest(plugin_id).await.map(|_| ())
    }

    async fn ensure_agent(&self, agent_id: &str) -> Result<(), HiveoryPluginStoreError> {
        let exists = sqlx::query("SELECT 1 FROM hiveory_agents WHERE id=? AND archived=0")
            .bind(agent_id)
            .fetch_optional(self.persistence.pool())
            .await?
            .is_some();
        if exists {
            Ok(())
        } else {
            Err(HiveoryPluginStoreError::NotFound)
        }
    }
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), HiveoryPluginStoreError> {
    if manifest.id.trim().is_empty() || manifest.id.len() > 80 || manifest.tools.is_empty() {
        return Err(HiveoryPluginStoreError::InvalidInput(
            "plugin id and at least one tool are required".to_owned(),
        ));
    }
    if manifest
        .allowed_hosts
        .iter()
        .any(|host| host.trim().is_empty())
    {
        return Err(HiveoryPluginStoreError::InvalidInput(
            "plugin hosts cannot be empty".to_owned(),
        ));
    }
    for tool in &manifest.tools {
        if tool.name.trim().is_empty() {
            return Err(HiveoryPluginStoreError::InvalidInput(
                "plugin tools require valid names and JSON schemas".to_owned(),
            ));
        }
        let input_schema = serde_json::from_str::<serde_json::Value>(&tool.input_schema_json)
            .map_err(|_| {
                HiveoryPluginStoreError::InvalidInput(
                    "plugin tools require valid names and JSON schemas".to_owned(),
                )
            })?;
        let output_schema = serde_json::from_str::<serde_json::Value>(&tool.output_schema_json)
            .map_err(|_| {
                HiveoryPluginStoreError::InvalidInput(
                    "plugin tools require valid names and JSON schemas".to_owned(),
                )
            })?;
        if !strict_object_schema(&input_schema) || !output_schema.is_object() {
            return Err(HiveoryPluginStoreError::InvalidInput(
                "plugin input schemas must be strict JSON objects".to_owned(),
            ));
        }
    }
    Ok(())
}

fn strict_object_schema(schema: &serde_json::Value) -> bool {
    schema.get("type") == Some(&serde_json::Value::String("object".to_owned()))
        && schema
            .get("properties")
            .is_some_and(serde_json::Value::is_object)
        && schema
            .get("required")
            .is_some_and(serde_json::Value::is_array)
        && schema.get("additionalProperties") == Some(&serde_json::Value::Bool(false))
}

fn validate_origin(origin: &str) -> Result<(), HiveoryPluginStoreError> {
    let parsed = url::Url::parse(origin.trim()).map_err(|_| {
        HiveoryPluginStoreError::InvalidInput("connection origin must be a valid URL".to_owned())
    })?;
    if parsed.scheme() != "https"
        || parsed.host_str().is_none()
        || parsed.username() != ""
        || parsed.password().is_some()
        || (parsed.path() != "" && parsed.path() != "/")
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err(HiveoryPluginStoreError::InvalidInput(
            "connection origin must be an HTTPS origin without embedded credentials".to_owned(),
        ));
    }
    Ok(())
}

fn validate_connection_input(
    name: &str,
    api_key_header: Option<&str>,
    kind: PluginConnectionKind,
) -> Result<(), HiveoryPluginStoreError> {
    if name.trim().is_empty() || name.len() > 80 {
        return Err(HiveoryPluginStoreError::InvalidInput(
            "connection name must be between 1 and 80 characters".to_owned(),
        ));
    }
    if matches!(kind, PluginConnectionKind::ApiKeyHeader)
        && api_key_header
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .is_none()
    {
        return Err(HiveoryPluginStoreError::InvalidInput(
            "an API key connection requires a header name".to_owned(),
        ));
    }
    if api_key_header
        .map(|value| value.len() > 100)
        .unwrap_or(false)
    {
        return Err(HiveoryPluginStoreError::InvalidInput(
            "API key header name is too long".to_owned(),
        ));
    }
    Ok(())
}

fn connection_from_row(
    row: &SqliteRow,
) -> Result<PluginConnectionSummary, HiveoryPluginStoreError> {
    Ok(PluginConnectionSummary {
        id: row.get(0),
        plugin_id: row.get(1),
        name: row.get(2),
        origin: row.get(3),
        kind: connection_kind_from_value(&row.get::<String, _>(4)),
        api_key_header: row.get(5),
        secret_configured: row.get::<Option<String>, _>(6).is_some(),
        validated_at_unix_ms: row.get(7),
        created_at_unix_ms: row.get(8),
        updated_at_unix_ms: row.get(9),
    })
}

fn grant_from_row(row: SqliteRow) -> Result<AgentPluginGrant, HiveoryPluginStoreError> {
    Ok(AgentPluginGrant {
        agent_id: row.get(0),
        plugin_id: row.get(1),
        connection_id: row.get(2),
        tool_names: serde_json::from_str(&row.get::<String, _>(3))?,
        enabled: row.get::<i64, _>(4) != 0,
    })
}

fn invocation_from_row(row: SqliteRow) -> Result<PluginInvocationSummary, HiveoryPluginStoreError> {
    Ok(PluginInvocationSummary {
        id: row.get(0),
        run_id: row.get(1),
        plugin_id: row.get(2),
        connection_id: row.get(3),
        tool_name: row.get(4),
        state: row.get(5),
        target: row.get(6),
        request_preview: row.get(7),
        response_preview: row.get(8),
        error: row.get(9),
        created_at_unix_ms: row.get(10),
        completed_at_unix_ms: row.get(11),
    })
}

fn adapter_value(value: PluginAdapterKind) -> &'static str {
    match value {
        PluginAdapterKind::JsonHttpGet => "json_http_get",
        PluginAdapterKind::JsonHttpPost => "json_http_post",
    }
}
fn connection_kind_value(value: PluginConnectionKind) -> &'static str {
    match value {
        PluginConnectionKind::None => "none",
        PluginConnectionKind::ApiKeyHeader => "api_key_header",
    }
}
fn connection_kind_from_value(value: &str) -> PluginConnectionKind {
    match value {
        "api_key_header" => PluginConnectionKind::ApiKeyHeader,
        _ => PluginConnectionKind::None,
    }
}
fn now_ms() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
