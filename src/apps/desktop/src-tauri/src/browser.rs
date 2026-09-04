use hiveory_persistence::HiveoryPersistence;
use hiveory_protocol::{CodePreviewState, CodePreviewSummary};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
};
use tauri::{
    webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, WebviewBuilder},
    AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, Webview, WebviewUrl,
};
use url::Url;

#[cfg(windows)]
use base64::{engine::general_purpose::STANDARD, Engine};

#[cfg(windows)]
use std::sync::mpsc;

#[cfg(windows)]
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};

#[cfg(windows)]
use webview2_com::{
    CallDevToolsProtocolMethodCompletedHandler, CapturePreviewCompletedHandler,
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_5, COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
        COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX, COREWEBVIEW2_COOKIE_SAME_SITE_KIND_NONE,
        COREWEBVIEW2_COOKIE_SAME_SITE_KIND_STRICT,
    },
    WebMessageReceivedEventHandler,
};

#[cfg(windows)]
use windows::{
    core::{Interface, HSTRING, PWSTR},
    Win32::{
        Foundation::{LocalFree, HLOCAL},
        Security::Cryptography::{CryptUnprotectData, CRYPT_INTEGER_BLOB},
        System::Com::{IStream, STATFLAG_DEFAULT, STATSTG, STREAM_SEEK_SET},
        UI::{
            Shell::{SHCreateMemStream, ShellExecuteW},
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    },
};

#[cfg(windows)]
use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions},
    Row,
};

pub(crate) const BROWSER_EVENT: &str = "hiveory-browser-event";
pub(crate) const BROWSER_CAPTURE_EVENT: &str = "hiveory-browser-capture-event";
pub(crate) const GOOGLE_HOME: &str = "https://www.google.com/";
const BROWSER_SETTINGS_KEY: &str = "browser.settings.v1";
const BROWSER_PROFILES_KEY: &str = "browser.profiles.v1";
const DEFAULT_PROFILE_ID: &str = "default";
const DEFAULT_VIEWPORT_ID: &str = "default";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserOpenRequest {
    pub browser_id: String,
    pub workspace_id: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserNavigationRequest {
    pub browser_id: String,
    pub url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserIdRequest {
    pub browser_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserBoundsRequest {
    pub browser_id: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub visible: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct BrowserProfile {
    pub id: String,
    pub name: String,
    pub built_in: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct BrowserSettings {
    pub home_url: String,
    pub search_engine: String,
    pub default_profile_id: String,
    pub default_viewport_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct BrowserConfiguration {
    pub profiles: Vec<BrowserProfile>,
    pub settings: BrowserSettings,
}

impl Default for BrowserConfiguration {
    fn default() -> Self {
        Self {
            profiles: vec![BrowserProfile {
                id: DEFAULT_PROFILE_ID.to_owned(),
                name: "Default".to_owned(),
                built_in: true,
            }],
            settings: BrowserSettings {
                home_url: GOOGLE_HOME.to_owned(),
                search_engine: "google".to_owned(),
                default_profile_id: DEFAULT_PROFILE_ID.to_owned(),
                default_viewport_id: DEFAULT_VIEWPORT_ID.to_owned(),
            },
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserProfileRequest {
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserProfileIdRequest {
    pub profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserSwitchProfileRequest {
    pub browser_id: String,
    pub profile_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserSettingsRequest {
    pub settings: BrowserSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserViewportRequest {
    pub browser_id: String,
    pub viewport_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserTouchEmulationRequest {
    pub browser_id: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserCaptureRequest {
    pub browser_id: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserClipboardRequest {
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserAnnotationSyncRequest {
    pub browser_id: String,
    #[serde(default)]
    pub annotations: Vec<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserCookieFileRequest {
    pub browser_id: String,
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserCookieSourceRequest {
    pub browser_id: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct BrowserCookie {
    pub name: String,
    pub value: String,
    pub domain: String,
    #[serde(default = "default_cookie_path")]
    pub path: String,
    #[serde(default, alias = "expirationDate", alias = "expires_utc")]
    pub expires: Option<f64>,
    #[serde(default, alias = "httpOnly")]
    pub http_only: bool,
    #[serde(default)]
    pub secure: bool,
    #[serde(default, alias = "sameSite")]
    pub same_site: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct BrowserImportReport {
    pub imported: usize,
    pub skipped: usize,
    pub source: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct BrowserFrame {
    pub png_base64: String,
    pub width: u32,
    pub height: u32,
}

#[derive(Debug, Clone, Copy)]
struct BrowserViewportPreset {
    id: &'static str,
    width: u32,
    height: u32,
    device_scale_factor: f64,
    mobile: bool,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct BrowserRuntimeState {
    pub browser_id: String,
    pub workspace_id: String,
    pub url: String,
    pub title: String,
    pub loading: bool,
    pub can_go_back: bool,
    pub can_go_forward: bool,
    pub error: Option<String>,
    pub profile_id: String,
    pub viewport_id: String,
    pub touch_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum BrowserEventKind {
    State,
    PopupRouted,
    DownloadStarted,
    DownloadFinished,
    Error,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct BrowserEvent {
    pub event: BrowserEventKind,
    pub state: BrowserRuntimeState,
    pub notice: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub(crate) struct BrowserCaptureEvent {
    pub browser_id: String,
    pub action: String,
    pub payload: Value,
}

#[derive(Debug, Clone, Copy)]
enum HistoryAction {
    Back,
    Forward,
}

struct BrowserEntry {
    workspace_id: String,
    preview_id: String,
    webview: Webview,
    profile_id: String,
    viewport_id: String,
    touch_enabled: bool,
    current_url: String,
    title: String,
    loading: bool,
    error: Option<String>,
    history: Vec<String>,
    history_index: usize,
    pending_history_action: Option<HistoryAction>,
    pending_history_url: Option<String>,
    active_interaction: Option<String>,
    annotation_channel: Option<String>,
    visible: bool,
}

struct BrowserManagerInner {
    legacy_profile_dir: PathBuf,
    profile_root: PathBuf,
    downloads_dir: PathBuf,
    persistence: HiveoryPersistence,
    configuration: Mutex<BrowserConfiguration>,
    entries: Mutex<HashMap<String, BrowserEntry>>,
}

#[derive(Clone)]
pub(crate) struct BrowserManager {
    inner: Arc<BrowserManagerInner>,
}

impl BrowserManager {
    pub(crate) fn new(
        legacy_profile_dir: PathBuf,
        profile_root: PathBuf,
        downloads_dir: PathBuf,
        persistence: HiveoryPersistence,
        configuration: BrowserConfiguration,
    ) -> Self {
        Self {
            inner: Arc::new(BrowserManagerInner {
                legacy_profile_dir,
                profile_root,
                downloads_dir,
                persistence,
                configuration: Mutex::new(configuration),
                entries: Mutex::new(HashMap::new()),
            }),
        }
    }

    pub(crate) fn open(
        &self,
        app: &AppHandle,
        request: &BrowserOpenRequest,
    ) -> Result<BrowserRuntimeState, String> {
        let url = normalize_browser_input(&request.url)?;

        if let Some(existing) = self.inner.snapshot(&request.browser_id)? {
            if existing.workspace_id != request.workspace_id {
                return Err("This browser resource belongs to another workspace.".to_owned());
            }
            // `open` is the lifecycle/reconnect operation for an existing pane.
            // Its URL is a snapshot supplied by the renderer and can be older
            // than the URL currently being loaded in the native WebView. An
            // explicit address-bar navigation goes through `navigate`; opening
            // an existing resource must never undo that newer navigation.
            self.inner.show(&request.browser_id)?;
            emit_event(
                app,
                BrowserEvent {
                    event: BrowserEventKind::State,
                    state: existing.clone(),
                    notice: None,
                },
            );
            return Ok(existing);
        }

        let profile_id = self.inner.default_profile_id()?;
        let viewport_id = self.inner.default_viewport_id()?;
        let viewport = viewport_preset(&viewport_id)
            .ok_or_else(|| "The default viewport size is not available.".to_owned())?;
        let profile_dir = self.inner.profile_path(&profile_id)?;
        fs::create_dir_all(&profile_dir)
            .map_err(|error| format!("The browser profile could not be created: {error}"))?;
        fs::create_dir_all(&self.inner.downloads_dir)
            .map_err(|error| format!("The download directory could not be created: {error}"))?;

        let browser_id = request.browser_id.clone();
        let workspace_id = request.workspace_id.clone();
        let preview_id = request.browser_id.clone();
        let webview = self.build_webview(app, &browser_id, &url, profile_dir)?;
        self.inner.apply_viewport(&webview, &viewport)?;
        webview
            .hide()
            .map_err(|error| format!("The embedded Browser could not be hidden: {error}"))?;

        let entry = BrowserEntry {
            workspace_id: workspace_id.clone(),
            preview_id,
            webview,
            profile_id: profile_id.clone(),
            viewport_id,
            touch_enabled: false,
            current_url: url.to_string(),
            title: String::new(),
            loading: true,
            error: None,
            history: vec![url.to_string()],
            history_index: 0,
            pending_history_action: None,
            pending_history_url: None,
            active_interaction: None,
            annotation_channel: None,
            visible: false,
        };
        let webview_for_messages = entry.webview.clone();
        self.inner
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?
            .insert(browser_id.clone(), entry);
        self.install_page_message_handler(&webview_for_messages, &browser_id, app.clone())?;

        let state = self
            .inner
            .snapshot(&browser_id)?
            .ok_or_else(|| "The Browser was created but its state was unavailable.".to_owned())?;
        emit_event(
            app,
            BrowserEvent {
                event: BrowserEventKind::State,
                state: state.clone(),
                notice: None,
            },
        );
        Ok(state)
    }

    pub(crate) fn navigate(
        &self,
        app: &AppHandle,
        request: &BrowserNavigationRequest,
    ) -> Result<BrowserRuntimeState, String> {
        let url = normalize_browser_input(&request.url)?;
        let state = self.inner.navigate(&request.browser_id, url)?;
        emit_event(
            app,
            BrowserEvent {
                event: BrowserEventKind::State,
                state: state.clone(),
                notice: None,
            },
        );
        Ok(state)
    }

    pub(crate) fn back(
        &self,
        app: &AppHandle,
        browser_id: &str,
    ) -> Result<BrowserRuntimeState, String> {
        let state = self.inner.history_action(browser_id, HistoryAction::Back)?;
        emit_event(
            app,
            BrowserEvent {
                event: BrowserEventKind::State,
                state: state.clone(),
                notice: None,
            },
        );
        Ok(state)
    }

    pub(crate) fn forward(
        &self,
        app: &AppHandle,
        browser_id: &str,
    ) -> Result<BrowserRuntimeState, String> {
        let state = self
            .inner
            .history_action(browser_id, HistoryAction::Forward)?;
        emit_event(
            app,
            BrowserEvent {
                event: BrowserEventKind::State,
                state: state.clone(),
                notice: None,
            },
        );
        Ok(state)
    }

    pub(crate) fn reload(
        &self,
        app: &AppHandle,
        browser_id: &str,
    ) -> Result<BrowserRuntimeState, String> {
        let state = self.inner.reload(browser_id)?;
        emit_event(
            app,
            BrowserEvent {
                event: BrowserEventKind::State,
                state: state.clone(),
                notice: None,
            },
        );
        Ok(state)
    }

    pub(crate) fn set_bounds(&self, request: &BrowserBoundsRequest) -> Result<(), String> {
        self.inner.set_bounds(request)
    }

    pub(crate) fn focus(&self, browser_id: &str) -> Result<(), String> {
        self.inner.focus(browser_id)
    }

    pub(crate) fn close(&self, browser_id: &str) -> Result<(), String> {
        self.inner.close(browser_id)
    }

    pub(crate) fn configuration(&self) -> Result<BrowserConfiguration, String> {
        self.inner
            .configuration
            .lock()
            .map_err(|_| "The browser configuration lock is unavailable.".to_owned())
            .map(|configuration| configuration.clone())
    }

    pub(crate) fn create_profile(
        &self,
        request: &BrowserProfileRequest,
    ) -> Result<BrowserConfiguration, String> {
        let name = validate_profile_name(&request.name)?;
        let configuration = {
            let mut configuration = self
                .inner
                .configuration
                .lock()
                .map_err(|_| "The browser configuration lock is unavailable.".to_owned())?;
            if configuration
                .profiles
                .iter()
                .any(|profile| profile.name.eq_ignore_ascii_case(&name))
            {
                return Err("A browser profile with that name already exists.".to_owned());
            }
            configuration.profiles.push(BrowserProfile {
                id: uuid::Uuid::now_v7().to_string(),
                name,
                built_in: false,
            });
            configuration.clone()
        };
        self.inner.persist_configuration(&configuration);
        Ok(configuration)
    }

    pub(crate) fn delete_profile(
        &self,
        request: &BrowserProfileIdRequest,
    ) -> Result<BrowserConfiguration, String> {
        let profile_id = request.profile_id.trim();
        if profile_id == DEFAULT_PROFILE_ID {
            return Err("The Default profile cannot be removed.".to_owned());
        }
        if self.inner.profile_is_active(profile_id)? {
            return Err("Switch away from this profile before removing it.".to_owned());
        }
        let profile_dir = self.inner.profile_path(profile_id)?;
        let configuration = {
            let mut configuration = self
                .inner
                .configuration
                .lock()
                .map_err(|_| "The browser configuration lock is unavailable.".to_owned())?;
            let before = configuration.profiles.len();
            configuration
                .profiles
                .retain(|profile| profile.id != profile_id);
            if configuration.profiles.len() == before {
                return Err("The browser profile was not found.".to_owned());
            }
            if configuration.settings.default_profile_id == profile_id {
                configuration.settings.default_profile_id = DEFAULT_PROFILE_ID.to_owned();
            }
            configuration.clone()
        };
        if profile_dir.exists() {
            fs::remove_dir_all(&profile_dir).map_err(|error| {
                format!("The browser profile data could not be removed: {error}")
            })?;
        }
        self.inner.persist_configuration(&configuration);
        Ok(configuration)
    }

    pub(crate) fn update_settings(
        &self,
        request: &BrowserSettingsRequest,
    ) -> Result<BrowserConfiguration, String> {
        let mut settings = request.settings.clone();
        settings.home_url = normalize_browser_input(&settings.home_url)?.to_string();
        if settings.search_engine != "google" {
            return Err("Google is the only supported search engine in this build.".to_owned());
        }
        viewport_preset(&settings.default_viewport_id)
            .ok_or_else(|| "The selected viewport size is not available.".to_owned())?;
        let configuration = {
            let mut configuration = self
                .inner
                .configuration
                .lock()
                .map_err(|_| "The browser configuration lock is unavailable.".to_owned())?;
            if !configuration
                .profiles
                .iter()
                .any(|profile| profile.id == settings.default_profile_id)
            {
                return Err("The selected browser profile was not found.".to_owned());
            }
            configuration.settings = settings;
            configuration.clone()
        };
        self.inner.persist_configuration(&configuration);
        Ok(configuration)
    }

    pub(crate) fn switch_profile(
        &self,
        app: &AppHandle,
        request: &BrowserSwitchProfileRequest,
    ) -> Result<BrowserRuntimeState, String> {
        self.inner.require_profile(&request.profile_id)?;
        let (workspace_id, url, viewport_id, touch_enabled) = {
            let entries = self
                .inner
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            let entry = entries
                .get(&request.browser_id)
                .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
            (
                entry.workspace_id.clone(),
                entry.current_url.clone(),
                entry.viewport_id.clone(),
                entry.touch_enabled,
            )
        };
        let url = normalize_browser_input(&url)?;
        let viewport = viewport_preset(&viewport_id)
            .ok_or_else(|| "The current viewport size is not available.".to_owned())?;
        let profile_dir = self.inner.profile_path(&request.profile_id)?;
        fs::create_dir_all(&profile_dir)
            .map_err(|error| format!("The browser profile could not be created: {error}"))?;
        let webview = self.build_webview(app, &request.browser_id, &url, profile_dir)?;
        self.inner.apply_viewport(&webview, &viewport)?;
        self.inner.apply_touch_emulation(&webview, touch_enabled)?;
        webview
            .hide()
            .map_err(|error| format!("The embedded Browser could not be hidden: {error}"))?;
        let replacement = BrowserEntry {
            workspace_id,
            preview_id: request.browser_id.clone(),
            webview,
            profile_id: request.profile_id.clone(),
            viewport_id,
            touch_enabled,
            current_url: url.to_string(),
            title: String::new(),
            loading: true,
            error: None,
            history: vec![url.to_string()],
            history_index: 0,
            pending_history_action: None,
            pending_history_url: None,
            active_interaction: None,
            annotation_channel: None,
            visible: false,
        };
        let message_webview = replacement.webview.clone();
        let previous = self
            .inner
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?
            .insert(request.browser_id.clone(), replacement);
        if let Some(previous) = previous {
            let _ = previous.webview.close();
        }
        self.install_page_message_handler(&message_webview, &request.browser_id, app.clone())?;
        let state = self
            .inner
            .snapshot(&request.browser_id)?
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
        emit_event(
            app,
            BrowserEvent {
                event: BrowserEventKind::State,
                state: state.clone(),
                notice: Some(
                    "Browser profile switched. The current page is loading again.".to_owned(),
                ),
            },
        );
        Ok(state)
    }

    pub(crate) fn start_capture(&self, request: &BrowserCaptureRequest) -> Result<bool, String> {
        if !matches!(request.action.as_str(), "grab" | "annotate") {
            return Err("This browser capture action is not available.".to_owned());
        }
        let nonce = uuid::Uuid::now_v7().to_string();
        let webview = self.inner.begin_interaction(&request.browser_id, &nonce)?;
        if let Err(error) = webview.eval(build_picker_script(&request.action, &nonce)) {
            let _ = self.inner.clear_interaction(&request.browser_id, &nonce);
            return Err(format!("The page picker could not start: {error}"));
        }
        Ok(true)
    }

    pub(crate) fn cancel_capture(&self, request: &BrowserIdRequest) -> Result<bool, String> {
        let webview = self.inner.clear_interaction(&request.browser_id, "")?;
        webview
            .eval("window.__hiveoryBrowserPickerCleanup?.();")
            .map_err(|error| format!("The page picker could not close: {error}"))?;
        Ok(true)
    }

    pub(crate) fn sync_annotations(
        &self,
        request: &BrowserAnnotationSyncRequest,
    ) -> Result<bool, String> {
        if request.annotations.len() > 20 {
            return Err("A Browser pane can keep at most 20 annotations.".to_owned());
        }
        let encoded = serde_json::to_string(&request.annotations)
            .map_err(|error| format!("Browser annotations could not be encoded: {error}"))?;
        if encoded.len() > 512 * 1024 {
            return Err("The Browser annotation payload is too large.".to_owned());
        }
        let nonce = uuid::Uuid::now_v7().to_string();
        let webview = {
            let mut entries = self
                .inner
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            let entry = entries
                .get_mut(&request.browser_id)
                .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
            entry.annotation_channel = if request.annotations.is_empty() {
                None
            } else {
                Some(nonce.clone())
            };
            entry.webview.clone()
        };
        webview
            .eval(build_annotation_overlay_script(&encoded, &nonce))
            .map_err(|error| format!("Browser annotations could not be displayed: {error}"))?;
        Ok(true)
    }

    pub(crate) fn capture_frame(&self, request: &BrowserIdRequest) -> Result<BrowserFrame, String> {
        self.inner.capture_frame(&request.browser_id)
    }

    pub(crate) fn set_viewport(
        &self,
        request: &BrowserViewportRequest,
    ) -> Result<BrowserRuntimeState, String> {
        let preset = viewport_preset(&request.viewport_id)
            .ok_or_else(|| "The selected viewport size is not available.".to_owned())?;
        let webview = self.inner.webview(&request.browser_id)?;
        self.inner.apply_viewport(&webview, &preset)?;
        self.inner
            .set_viewport_state(&request.browser_id, &request.viewport_id)?;
        self.inner
            .snapshot(&request.browser_id)?
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())
    }

    pub(crate) fn set_touch_emulation(
        &self,
        request: &BrowserTouchEmulationRequest,
    ) -> Result<BrowserRuntimeState, String> {
        let webview = self.inner.webview(&request.browser_id)?;
        self.inner
            .apply_touch_emulation(&webview, request.enabled)?;
        self.inner
            .set_touch_emulation_state(&request.browser_id, request.enabled)?;
        self.inner
            .snapshot(&request.browser_id)?
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())
    }

    pub(crate) fn open_devtools(&self, request: &BrowserIdRequest) -> Result<bool, String> {
        self.inner.open_devtools(&request.browser_id)
    }

    pub(crate) fn open_external(&self, request: &BrowserIdRequest) -> Result<bool, String> {
        let url = self
            .inner
            .snapshot(&request.browser_id)?
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?
            .url;
        open_url_external(&url)?;
        Ok(true)
    }

    pub(crate) fn open_external_url(&self, url: &str) -> Result<bool, String> {
        let parsed = Url::parse(url.trim())
            .map_err(|_| "The link is not a valid web address.".to_owned())?;
        let validated = validate_browser_url(&parsed)?;
        open_url_external(validated.as_str())?;
        Ok(true)
    }

    pub(crate) fn import_cookie_file(
        &self,
        request: &BrowserCookieFileRequest,
    ) -> Result<BrowserImportReport, String> {
        let path = PathBuf::from(request.path.trim());
        validate_cookie_file_path(&path)?;
        let metadata = fs::metadata(&path)
            .map_err(|error| format!("The cookie file could not be read: {error}"))?;
        if metadata.len() > 10 * 1024 * 1024 {
            return Err("Cookie files larger than 10 MB are not accepted.".to_owned());
        }
        let content = fs::read_to_string(&path)
            .map_err(|error| format!("The cookie file could not be read: {error}"))?;
        let cookies = parse_cookie_file(&content)?;
        self.inner.import_cookies(&request.browser_id, &cookies)
    }

    pub(crate) async fn import_cookie_source(
        &self,
        request: &BrowserCookieSourceRequest,
    ) -> Result<BrowserImportReport, String> {
        let source = request.source.trim().to_ascii_lowercase();
        if !matches!(source.as_str(), "chrome" | "edge" | "brave") {
            return Err("This browser cookie source is not available.".to_owned());
        }
        #[cfg(windows)]
        {
            let batch = read_browser_source_cookies(&source).await?;
            let mut report = self
                .inner
                .import_cookies(&request.browser_id, &batch.cookies)?;
            report.source = source.clone();
            report.skipped = batch.skipped;
            report.message = format!(
                "Imported {} cookies from {} into the active profile; {} were skipped.",
                report.imported,
                browser_source_label(&source),
                report.skipped
            );
            Ok(report)
        }
        #[cfg(not(windows))]
        {
            let _ = source;
            Err("Direct browser cookie import is currently available on Windows only.".to_owned())
        }
    }

    fn build_webview(
        &self,
        app: &AppHandle,
        browser_id: &str,
        url: &Url,
        profile_dir: PathBuf,
    ) -> Result<Webview, String> {
        let window = app
            .get_window("main")
            .ok_or_else(|| "The main application window is not available.".to_owned())?;
        let browser_id = browser_id.to_owned();
        let inner = Arc::clone(&self.inner);
        let app_for_load = app.clone();
        let inner_for_load = Arc::clone(&inner);
        let browser_id_for_load = browser_id.clone();
        let inner_for_navigation = Arc::clone(&inner);
        let browser_id_for_navigation = browser_id.clone();
        let app_for_title = app.clone();
        let inner_for_title = Arc::clone(&inner);
        let browser_id_for_title = browser_id.clone();
        let app_for_popup = app.clone();
        let inner_for_popup = Arc::clone(&inner);
        let browser_id_for_popup = browser_id.clone();
        let app_for_download = app.clone();
        let inner_for_download = Arc::clone(&inner);
        let browser_id_for_download = browser_id.clone();
        let downloads_dir = self.inner.downloads_dir.clone();

        let webview_builder = WebviewBuilder::new(
            format!("hiveory-browser-{}", uuid::Uuid::now_v7()),
            WebviewUrl::External(url.clone()),
        )
        .data_directory(profile_dir)
        .on_navigation(move |navigation_url| {
            if !is_allowed_browser_url(navigation_url) {
                return false;
            }
            let _ = inner_for_navigation
                .navigation_requested(&browser_id_for_navigation, navigation_url.to_string());
            true
        })
        .on_new_window(move |new_url, _features| {
            if !is_allowed_browser_url(&new_url) {
                if let Some(state) = inner_for_popup
                    .snapshot(&browser_id_for_popup)
                    .ok()
                    .flatten()
                {
                    emit_event(
                        &app_for_popup,
                        BrowserEvent {
                            event: BrowserEventKind::Error,
                            state,
                            notice: Some("This pop-up used an unsupported URL scheme.".to_owned()),
                        },
                    );
                }
                return NewWindowResponse::Deny;
            }

            let notice = match inner_for_popup.navigate(&browser_id_for_popup, new_url.clone()) {
                Ok(_) => format!("Opened {} in the current Browser pane.", new_url),
                Err(error) => error,
            };
            if let Some(state) = inner_for_popup
                .snapshot(&browser_id_for_popup)
                .ok()
                .flatten()
            {
                emit_event(
                    &app_for_popup,
                    BrowserEvent {
                        event: BrowserEventKind::PopupRouted,
                        state,
                        notice: Some(notice),
                    },
                );
            }
            NewWindowResponse::Deny
        })
        .on_page_load(move |_, payload| {
            let state = match payload.event() {
                PageLoadEvent::Started => inner_for_load
                    .page_load_started(&browser_id_for_load, payload.url().to_string()),
                PageLoadEvent::Finished => inner_for_load
                    .page_load_finished(&browser_id_for_load, payload.url().to_string()),
            };
            if let Ok(Some(state)) = state {
                emit_event(
                    &app_for_load,
                    BrowserEvent {
                        event: BrowserEventKind::State,
                        state,
                        notice: None,
                    },
                );
            }
        })
        .on_document_title_changed(move |_, title| {
            if let Ok(Some(state)) = inner_for_title.title_changed(&browser_id_for_title, title) {
                emit_event(
                    &app_for_title,
                    BrowserEvent {
                        event: BrowserEventKind::State,
                        state,
                        notice: None,
                    },
                );
            }
        })
        .on_download(move |_, event| {
            match event {
                DownloadEvent::Requested { url, destination } => {
                    let filename = download_filename(&url);
                    let target = unique_download_path(&downloads_dir, &filename);
                    *destination = target;
                    if let Ok(Some(state)) = inner_for_download.snapshot(&browser_id_for_download) {
                        emit_event(
                            &app_for_download,
                            BrowserEvent {
                                event: BrowserEventKind::DownloadStarted,
                                state,
                                notice: Some(format!("Downloading {filename}…")),
                            },
                        );
                    }
                }
                DownloadEvent::Finished { url, path, success } => {
                    if let Ok(Some(state)) = inner_for_download.snapshot(&browser_id_for_download) {
                        let notice = if success {
                            path.map(|path| format!("Downloaded {} to {}.", url, path.display()))
                                .or_else(|| Some(format!("Downloaded {}.", url)))
                        } else {
                            Some(format!("Download failed for {}.", url))
                        };
                        emit_event(
                            &app_for_download,
                            BrowserEvent {
                                event: BrowserEventKind::DownloadFinished,
                                state,
                                notice,
                            },
                        );
                    }
                }
                _ => {}
            }
            true
        });

        window
            .add_child(
                webview_builder,
                LogicalPosition::new(0.0, 0.0),
                LogicalSize::new(1.0, 1.0),
            )
            .map_err(|error| format!("The embedded Browser could not be created: {error}"))
    }

    fn install_page_message_handler(
        &self,
        webview: &Webview,
        browser_id: &str,
        app: AppHandle,
    ) -> Result<(), String> {
        #[cfg(windows)]
        {
            let inner = Arc::clone(&self.inner);
            let browser_id = browser_id.to_owned();
            let result = Arc::new(Mutex::new(None));
            let result_for_callback = Arc::clone(&result);
            let app_for_callback = app.clone();
            let inner_for_callback = Arc::clone(&inner);
            let browser_id_for_callback = browser_id.clone();
            webview
                .with_webview(move |platform| {
                    let outcome = unsafe {
                        let core = platform.controller().CoreWebView2().map_err(|error| {
                            format!("The page message channel is unavailable: {error}")
                        });
                        match core {
                            Ok(core) => {
                                let mut token = 0_i64;
                                let handler = WebMessageReceivedEventHandler::create(Box::new(
                                    move |_, args| {
                                        let Some(args) = args else {
                                            return Ok(());
                                        };
                                        let mut message = PWSTR::null();
                                        args.TryGetWebMessageAsString(&mut message)?;
                                        let message = webview2_com::take_pwstr(message);
                                        let Ok(value) = serde_json::from_str::<Value>(&message)
                                        else {
                                            return Ok(());
                                        };
                                        if value.get("kind").and_then(Value::as_str)
                                            != Some("hiveory-browser-selection")
                                        {
                                            return Ok(());
                                        }
                                        let action = value
                                            .get("action")
                                            .and_then(Value::as_str)
                                            .unwrap_or("grab")
                                            .to_owned();
                                        let annotation_control = matches!(
                                            action.as_str(),
                                            "annotation-copy"
                                                | "annotation-send"
                                                | "annotation-delete"
                                                | "annotation-clear"
                                        );
                                        if !annotation_control
                                            && !matches!(
                                                action.as_str(),
                                                "grab" | "annotate" | "cancel"
                                            )
                                        {
                                            return Ok(());
                                        }
                                        let nonce = value
                                            .get("nonce")
                                            .and_then(Value::as_str)
                                            .unwrap_or_default();
                                        let valid = inner_for_callback
                                            .entries
                                            .lock()
                                            .ok()
                                            .and_then(|mut entries| {
                                                let entry =
                                                    entries.get_mut(&browser_id_for_callback)?;
                                                if annotation_control {
                                                    if entry.annotation_channel.as_deref()
                                                        != Some(nonce)
                                                    {
                                                        return None;
                                                    }
                                                } else {
                                                    if entry.active_interaction.as_deref()
                                                        != Some(nonce)
                                                    {
                                                        return None;
                                                    }
                                                    entry.active_interaction = None;
                                                }
                                                Some(())
                                            })
                                            .is_some();
                                        if !valid {
                                            return Ok(());
                                        }
                                        let payload =
                                            value.get("payload").cloned().unwrap_or(Value::Null);
                                        emit_capture_event(
                                            &app_for_callback,
                                            BrowserCaptureEvent {
                                                browser_id: browser_id_for_callback.clone(),
                                                action,
                                                payload,
                                            },
                                        );
                                        Ok(())
                                    },
                                ));
                                core.add_WebMessageReceived(&handler, &mut token)
                                    .map_err(|error| {
                                        format!("The page message channel is unavailable: {error}")
                                    })
                            }
                            Err(error) => Err(error),
                        }
                    };
                    if let Ok(mut stored) = result_for_callback.lock() {
                        *stored = Some(outcome);
                    }
                })
                .map_err(|error| format!("The page message channel could not start: {error}"))?;
            return result
                .lock()
                .map_err(|_| "The page message channel lock is unavailable.".to_owned())?
                .take()
                .unwrap_or_else(|| Err("The page message channel did not start.".to_owned()));
        }

        #[cfg(not(windows))]
        {
            let _ = (webview, browser_id, app);
            Ok(())
        }
    }

    pub(crate) fn close_all(&self) {
        let entries = self
            .inner
            .entries
            .lock()
            .map(|mut entries| entries.drain().map(|(_, entry)| entry).collect::<Vec<_>>())
            .unwrap_or_default();
        for entry in entries {
            let _ = entry.webview.close();
        }
    }
}

impl BrowserManagerInner {
    fn configuration_snapshot(&self) -> Result<BrowserConfiguration, String> {
        self.configuration
            .lock()
            .map_err(|_| "The browser configuration lock is unavailable.".to_owned())
            .map(|configuration| configuration.clone())
    }

    fn default_profile_id(&self) -> Result<String, String> {
        Ok(self.configuration_snapshot()?.settings.default_profile_id)
    }

    fn default_viewport_id(&self) -> Result<String, String> {
        Ok(self.configuration_snapshot()?.settings.default_viewport_id)
    }

    fn require_profile(&self, profile_id: &str) -> Result<(), String> {
        if self
            .configuration_snapshot()?
            .profiles
            .iter()
            .any(|profile| profile.id == profile_id)
        {
            Ok(())
        } else {
            Err("The browser profile was not found.".to_owned())
        }
    }

    fn profile_path(&self, profile_id: &str) -> Result<PathBuf, String> {
        self.require_profile(profile_id)?;
        if profile_id.is_empty()
            || profile_id == "."
            || profile_id == ".."
            || profile_id.contains('/')
            || profile_id.contains('\\')
        {
            return Err("The browser profile identifier is invalid.".to_owned());
        }
        if profile_id == DEFAULT_PROFILE_ID {
            Ok(self.legacy_profile_dir.clone())
        } else {
            Ok(self.profile_root.join(profile_id))
        }
    }

    fn profile_is_active(&self, profile_id: &str) -> Result<bool, String> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        Ok(entries.values().any(|entry| entry.profile_id == profile_id))
    }

    fn persist_configuration(&self, configuration: &BrowserConfiguration) {
        let persistence = self.persistence.clone();
        let profiles = serde_json::to_string(&configuration.profiles);
        let settings = serde_json::to_string(&configuration.settings);
        if let (Ok(profiles), Ok(settings)) = (profiles, settings) {
            tauri::async_runtime::spawn(async move {
                let _ = persistence
                    .set_setting(BROWSER_PROFILES_KEY, &profiles)
                    .await;
                let _ = persistence
                    .set_setting(BROWSER_SETTINGS_KEY, &settings)
                    .await;
            });
        }
    }

    fn begin_interaction(&self, browser_id: &str, nonce: &str) -> Result<Webview, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        let entry = entries
            .get_mut(browser_id)
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
        entry.active_interaction = Some(nonce.to_owned());
        Ok(entry.webview.clone())
    }

    fn clear_interaction(&self, browser_id: &str, nonce: &str) -> Result<Webview, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        let entry = entries
            .get_mut(browser_id)
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
        if !nonce.is_empty() && entry.active_interaction.as_deref() != Some(nonce) {
            return Err("The page picker is no longer active.".to_owned());
        }
        entry.active_interaction = None;
        Ok(entry.webview.clone())
    }

    fn set_viewport_state(&self, browser_id: &str, viewport_id: &str) -> Result<Webview, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        let entry = entries
            .get_mut(browser_id)
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
        entry.viewport_id = viewport_id.to_owned();
        Ok(entry.webview.clone())
    }

    fn set_touch_emulation_state(
        &self,
        browser_id: &str,
        enabled: bool,
    ) -> Result<Webview, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        let entry = entries
            .get_mut(browser_id)
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
        entry.touch_enabled = enabled;
        Ok(entry.webview.clone())
    }

    fn webview(&self, browser_id: &str) -> Result<Webview, String> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        entries
            .get(browser_id)
            .map(|entry| entry.webview.clone())
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())
    }

    fn import_cookies(
        &self,
        browser_id: &str,
        cookies: &[BrowserCookie],
    ) -> Result<BrowserImportReport, String> {
        validate_cookies(cookies)?;
        #[cfg(windows)]
        {
            let webview = {
                let entries = self
                    .entries
                    .lock()
                    .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
                entries
                    .get(browser_id)
                    .map(|entry| entry.webview.clone())
                    .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?
            };
            import_cookies_windows(&webview, cookies)?;
            Ok(BrowserImportReport {
                imported: cookies.len(),
                skipped: 0,
                source: "file".to_owned(),
                message: format!(
                    "Imported {} cookies into the active profile.",
                    cookies.len()
                ),
            })
        }
        #[cfg(not(windows))]
        {
            let _ = (browser_id, cookies);
            Err("Cookie import is currently available on Windows only.".to_owned())
        }
    }

    fn capture_frame(&self, browser_id: &str) -> Result<BrowserFrame, String> {
        #[cfg(windows)]
        {
            let webview = {
                let entries = self
                    .entries
                    .lock()
                    .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
                entries
                    .get(browser_id)
                    .map(|entry| entry.webview.clone())
                    .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?
            };
            capture_frame_windows(&webview)
        }
        #[cfg(not(windows))]
        {
            let _ = browser_id;
            Err("Browser screenshots are currently available on Windows only.".to_owned())
        }
    }

    fn apply_viewport(
        &self,
        webview: &Webview,
        preset: &BrowserViewportPreset,
    ) -> Result<(), String> {
        #[cfg(windows)]
        {
            apply_viewport_windows(webview, preset)
        }
        #[cfg(not(windows))]
        {
            let _ = (webview, preset);
            Ok(())
        }
    }

    fn apply_touch_emulation(&self, webview: &Webview, enabled: bool) -> Result<(), String> {
        #[cfg(windows)]
        {
            apply_touch_emulation_windows(webview, enabled)
        }
        #[cfg(not(windows))]
        {
            let _ = (webview, enabled);
            Ok(())
        }
    }

    fn open_devtools(&self, browser_id: &str) -> Result<bool, String> {
        #[cfg(windows)]
        {
            let webview = {
                let entries = self
                    .entries
                    .lock()
                    .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
                entries
                    .get(browser_id)
                    .map(|entry| entry.webview.clone())
                    .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?
            };
            open_devtools_windows(&webview)
        }
        #[cfg(not(windows))]
        {
            let _ = browser_id;
            Err("Developer tools are currently available on Windows only.".to_owned())
        }
    }

    fn snapshot(&self, browser_id: &str) -> Result<Option<BrowserRuntimeState>, String> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        Ok(entries.get(browser_id).map(snapshot_from_entry))
    }

    fn navigate(&self, browser_id: &str, url: Url) -> Result<BrowserRuntimeState, String> {
        let webview = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            let entry = entries
                .get_mut(browser_id)
                .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
            entry.loading = true;
            entry.error = None;
            entry.pending_history_action = None;
            entry.pending_history_url = None;
            entry.current_url = url.to_string();
            entry.webview.clone()
        };
        webview
            .navigate(url)
            .map_err(|error| format!("The Browser could not navigate: {error}"))?;
        self.snapshot(browser_id)?
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())
    }

    fn history_action(
        &self,
        browser_id: &str,
        action: HistoryAction,
    ) -> Result<BrowserRuntimeState, String> {
        let webview = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            let entry = entries
                .get_mut(browser_id)
                .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
            let can_move = match action {
                HistoryAction::Back => entry.history_index > 0,
                HistoryAction::Forward => entry.history_index + 1 < entry.history.len(),
            };
            if !can_move {
                return Ok(snapshot_from_entry(entry));
            }
            entry.loading = true;
            entry.error = None;
            entry.pending_history_action = Some(action);
            let target_index = match action {
                HistoryAction::Back => entry.history_index.saturating_sub(1),
                HistoryAction::Forward => {
                    (entry.history_index + 1).min(entry.history.len().saturating_sub(1))
                }
            };
            entry.pending_history_url = entry.history.get(target_index).cloned();
            entry.webview.clone()
        };
        let script = match action {
            HistoryAction::Back => "history.back()",
            HistoryAction::Forward => "history.forward()",
        };
        webview
            .eval(script)
            .map_err(|error| format!("The Browser history action failed: {error}"))?;
        self.snapshot(browser_id)?
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())
    }

    fn reload(&self, browser_id: &str) -> Result<BrowserRuntimeState, String> {
        let webview = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            let entry = entries
                .get_mut(browser_id)
                .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
            entry.loading = true;
            entry.error = None;
            entry.webview.clone()
        };
        webview
            .reload()
            .map_err(|error| format!("The Browser could not reload: {error}"))?;
        self.snapshot(browser_id)?
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())
    }

    fn set_bounds(&self, request: &BrowserBoundsRequest) -> Result<(), String> {
        let should_be_visible = request.visible && request.width >= 1.0 && request.height >= 1.0;
        let (webview, was_visible) = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            let entry = entries
                .get_mut(&request.browser_id)
                .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
            let was_visible = entry.visible;
            entry.visible = should_be_visible;
            (entry.webview.clone(), was_visible)
        };
        if !should_be_visible {
            if was_visible {
                webview
                    .hide()
                    .map_err(|error| format!("The Browser could not be hidden: {error}"))?;
            }
            return Ok(());
        }
        webview
            .set_bounds(tauri::Rect {
                position: tauri::Position::Logical(LogicalPosition::new(request.x, request.y)),
                size: tauri::Size::Logical(LogicalSize::new(request.width, request.height)),
            })
            .map_err(|error| format!("The Browser could not be resized: {error}"))?;
        if !was_visible {
            webview
                .show()
                .map_err(|error| format!("The Browser could not be shown: {error}"))?;
        }
        Ok(())
    }

    fn focus(&self, browser_id: &str) -> Result<(), String> {
        let entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        entries
            .get(browser_id)
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?
            .webview
            .set_focus()
            .map_err(|error| format!("The Browser could not receive focus: {error}"))
    }

    fn close(&self, browser_id: &str) -> Result<(), String> {
        let entry = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?
            .remove(browser_id);
        if let Some(entry) = entry {
            entry
                .webview
                .close()
                .map_err(|error| format!("The Browser could not close: {error}"))?;
        }
        Ok(())
    }

    fn show(&self, browser_id: &str) -> Result<(), String> {
        let (webview, was_visible) = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            let entry = entries
                .get_mut(browser_id)
                .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?;
            let was_visible = entry.visible;
            entry.visible = true;
            (entry.webview.clone(), was_visible)
        };
        if was_visible {
            return Ok(());
        }
        webview
            .show()
            .map_err(|error| format!("The Browser could not be shown: {error}"))
    }

    fn page_load_started(
        &self,
        browser_id: &str,
        url: String,
    ) -> Result<Option<BrowserRuntimeState>, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        let Some(entry) = entries.get_mut(browser_id) else {
            return Ok(None);
        };
        if !accepts_browser_load_event(
            &entry.current_url,
            entry.pending_history_url.as_deref(),
            &url,
        ) {
            return Ok(None);
        }
        entry.loading = true;
        entry.error = None;
        Ok(Some(snapshot_from_entry(entry)))
    }

    fn page_load_finished(
        &self,
        browser_id: &str,
        url: String,
    ) -> Result<Option<BrowserRuntimeState>, String> {
        let (state, preview) = {
            let mut entries = self
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            let Some(entry) = entries.get_mut(browser_id) else {
                return Ok(None);
            };
            if !accepts_browser_load_event(
                &entry.current_url,
                entry.pending_history_url.as_deref(),
                &url,
            ) {
                return Ok(None);
            }
            entry.pending_history_url = None;
            match entry.pending_history_action.take() {
                Some(HistoryAction::Back) => {
                    entry.history_index = entry.history_index.saturating_sub(1);
                }
                Some(HistoryAction::Forward) => {
                    entry.history_index =
                        (entry.history_index + 1).min(entry.history.len().saturating_sub(1));
                }
                None => {
                    if entry.history.get(entry.history_index).map(String::as_str)
                        != Some(url.as_str())
                    {
                        entry.history.truncate(entry.history_index + 1);
                        entry.history.push(url.clone());
                        entry.history_index = entry.history.len().saturating_sub(1);
                    }
                }
            }
            entry.current_url = url.clone();
            entry.loading = false;
            entry.error = None;
            let state = snapshot_from_entry(entry);
            let preview = CodePreviewSummary {
                id: entry.preview_id.clone(),
                workspace_id: entry.workspace_id.clone(),
                url,
                origin: Url::parse(&state.url)
                    .map(|url| url.origin().ascii_serialization())
                    .unwrap_or_default(),
                state: CodePreviewState::Open,
            };
            (state, preview)
        };
        let persistence = self.persistence.clone();
        tauri::async_runtime::spawn(async move {
            let _ = persistence.save_code_preview(&preview, now_ms()).await;
        });
        Ok(Some(state))
    }

    fn navigation_requested(&self, browser_id: &str, url: String) -> Result<(), String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        let Some(entry) = entries.get_mut(browser_id) else {
            return Ok(());
        };
        entry.current_url = url.clone();
        entry.loading = true;
        entry.error = None;
        if entry.pending_history_action.is_some() {
            entry.pending_history_url = Some(url);
        }
        Ok(())
    }

    fn title_changed(
        &self,
        browser_id: &str,
        title: String,
    ) -> Result<Option<BrowserRuntimeState>, String> {
        let mut entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        let Some(entry) = entries.get_mut(browser_id) else {
            return Ok(None);
        };
        entry.title = title;
        Ok(Some(snapshot_from_entry(entry)))
    }
}

fn accepts_browser_load_event(
    current_url: &str,
    pending_history_url: Option<&str>,
    event_url: &str,
) -> bool {
    pending_history_url.unwrap_or(current_url) == event_url
}

fn snapshot_from_entry(entry: &BrowserEntry) -> BrowserRuntimeState {
    BrowserRuntimeState {
        browser_id: entry.preview_id.clone(),
        workspace_id: entry.workspace_id.clone(),
        url: entry.current_url.clone(),
        title: entry.title.clone(),
        loading: entry.loading,
        can_go_back: entry.history_index > 0,
        can_go_forward: entry.history_index + 1 < entry.history.len(),
        error: entry.error.clone(),
        profile_id: entry.profile_id.clone(),
        viewport_id: entry.viewport_id.clone(),
        touch_enabled: entry.touch_enabled,
    }
}

fn emit_event(app: &AppHandle, event: BrowserEvent) {
    let _ = app.emit_to("main", BROWSER_EVENT, event);
}

fn emit_capture_event(app: &AppHandle, event: BrowserCaptureEvent) {
    let _ = app.emit_to("main", BROWSER_CAPTURE_EVENT, event);
}

fn default_cookie_path() -> String {
    "/".to_owned()
}

pub(crate) async fn load_browser_configuration(
    persistence: &HiveoryPersistence,
) -> Result<BrowserConfiguration, String> {
    let mut configuration = BrowserConfiguration::default();
    if let Ok(Some(value)) = persistence.get_setting(BROWSER_PROFILES_KEY).await {
        if let Ok(profiles) = serde_json::from_str::<Vec<BrowserProfile>>(&value) {
            configuration.profiles = profiles;
        }
    }
    if let Ok(Some(value)) = persistence.get_setting(BROWSER_SETTINGS_KEY).await {
        if let Ok(settings) = serde_json::from_str::<BrowserSettings>(&value) {
            configuration.settings = settings;
        }
    }
    Ok(normalize_browser_configuration(configuration))
}

fn normalize_browser_configuration(
    mut configuration: BrowserConfiguration,
) -> BrowserConfiguration {
    configuration.profiles.retain(|profile| {
        !profile.id.trim().is_empty()
            && !profile.name.trim().is_empty()
            && profile.id.chars().count() <= 120
            && profile.id != "."
            && profile.id != ".."
            && !profile.id.contains('/')
            && !profile.id.contains('\\')
            && (profile.id == DEFAULT_PROFILE_ID || uuid::Uuid::parse_str(&profile.id).is_ok())
    });
    if !configuration
        .profiles
        .iter()
        .any(|profile| profile.id == DEFAULT_PROFILE_ID)
    {
        configuration.profiles.insert(
            0,
            BrowserProfile {
                id: DEFAULT_PROFILE_ID.to_owned(),
                name: "Default".to_owned(),
                built_in: true,
            },
        );
    }
    let mut seen = std::collections::HashSet::new();
    let mut seen_ids = std::collections::HashSet::new();
    configuration.profiles.retain(|profile| {
        seen.insert(profile.name.to_ascii_lowercase()) && seen_ids.insert(profile.id.clone())
    });
    if !configuration
        .profiles
        .iter()
        .any(|profile| profile.id == configuration.settings.default_profile_id)
    {
        configuration.settings.default_profile_id = DEFAULT_PROFILE_ID.to_owned();
    }
    if viewport_preset(&configuration.settings.default_viewport_id).is_none() {
        configuration.settings.default_viewport_id = DEFAULT_VIEWPORT_ID.to_owned();
    }
    if configuration.settings.search_engine != "google" {
        configuration.settings.search_engine = "google".to_owned();
    }
    configuration.settings.home_url = normalize_browser_input(&configuration.settings.home_url)
        .map(|url| url.to_string())
        .unwrap_or_else(|_| GOOGLE_HOME.to_owned());
    configuration
}

fn validate_profile_name(value: &str) -> Result<String, String> {
    let name = value.trim();
    if name.is_empty() {
        return Err("A browser profile needs a name.".to_owned());
    }
    if name.chars().count() > 80 || name.chars().any(char::is_control) {
        return Err("Browser profile names must be 80 characters or fewer.".to_owned());
    }
    Ok(name.to_owned())
}

fn validate_cookie_file_path(path: &Path) -> Result<(), String> {
    if !path
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("json"))
    {
        return Err("Choose a JSON cookie export file.".to_owned());
    }
    if !path.is_file() {
        return Err("The selected cookie file does not exist.".to_owned());
    }
    Ok(())
}

fn parse_cookie_file(value: &str) -> Result<Vec<BrowserCookie>, String> {
    let root = serde_json::from_str::<Value>(value)
        .map_err(|error| format!("The cookie file is not valid JSON: {error}"))?;
    let values = match root {
        Value::Array(items) => items,
        Value::Object(mut object) => object
            .remove("cookies")
            .and_then(|items| items.as_array().cloned())
            .ok_or_else(|| "The JSON file must contain a cookies array.".to_owned())?,
        _ => return Err("The JSON file must contain a cookie array.".to_owned()),
    };
    if values.len() > 50_000 {
        return Err("Cookie files may contain at most 50,000 cookies.".to_owned());
    }
    let mut cookies = Vec::with_capacity(values.len());
    for value in values {
        let cookie = serde_json::from_value::<BrowserCookie>(value)
            .map_err(|error| format!("A cookie entry could not be read: {error}"))?;
        cookies.push(cookie);
    }
    validate_cookies(&cookies)?;
    Ok(cookies)
}

fn validate_cookies(cookies: &[BrowserCookie]) -> Result<(), String> {
    for cookie in cookies {
        if cookie.name.is_empty() || cookie.name.chars().count() > 400 {
            return Err("Cookie names must be between 1 and 400 characters.".to_owned());
        }
        if cookie.domain.is_empty()
            || cookie.domain.chars().count() > 2048
            || cookie.domain.chars().any(char::is_whitespace)
            || cookie.domain.contains('/')
        {
            return Err("Cookie domains must be valid host names.".to_owned());
        }
        if !cookie.path.starts_with('/') || cookie.path.chars().count() > 2048 {
            return Err("Cookie paths must begin with /.".to_owned());
        }
        if cookie.value.chars().count() > 16_384 {
            return Err("Cookie values must be 16,384 characters or fewer.".to_owned());
        }
    }
    Ok(())
}

fn viewport_preset(id: &str) -> Option<BrowserViewportPreset> {
    let preset = match id {
        DEFAULT_VIEWPORT_ID => BrowserViewportPreset {
            id: DEFAULT_VIEWPORT_ID,
            width: 0,
            height: 0,
            device_scale_factor: 1.0,
            mobile: false,
        },
        "iphone-se" => BrowserViewportPreset {
            id: "iphone-se",
            width: 375,
            height: 667,
            device_scale_factor: 2.0,
            mobile: true,
        },
        "iphone-xr" => BrowserViewportPreset {
            id: "iphone-xr",
            width: 414,
            height: 896,
            device_scale_factor: 2.0,
            mobile: true,
        },
        "iphone-12-pro" => BrowserViewportPreset {
            id: "iphone-12-pro",
            width: 390,
            height: 844,
            device_scale_factor: 2.0,
            mobile: true,
        },
        "iphone-14-pro-max" => BrowserViewportPreset {
            id: "iphone-14-pro-max",
            width: 430,
            height: 932,
            device_scale_factor: 3.0,
            mobile: true,
        },
        "pixel-7" => BrowserViewportPreset {
            id: "pixel-7",
            width: 412,
            height: 915,
            device_scale_factor: 2.625,
            mobile: true,
        },
        "samsung-galaxy-s8-plus" => BrowserViewportPreset {
            id: "samsung-galaxy-s8-plus",
            width: 360,
            height: 740,
            device_scale_factor: 3.0,
            mobile: true,
        },
        "samsung-galaxy-s20-ultra" => BrowserViewportPreset {
            id: "samsung-galaxy-s20-ultra",
            width: 412,
            height: 915,
            device_scale_factor: 3.5,
            mobile: true,
        },
        "ipad-mini" => BrowserViewportPreset {
            id: "ipad-mini",
            width: 768,
            height: 1024,
            device_scale_factor: 2.0,
            mobile: true,
        },
        "ipad-air" => BrowserViewportPreset {
            id: "ipad-air",
            width: 820,
            height: 1180,
            device_scale_factor: 2.0,
            mobile: true,
        },
        "ipad-pro" => BrowserViewportPreset {
            id: "ipad-pro",
            width: 1024,
            height: 1366,
            device_scale_factor: 2.0,
            mobile: true,
        },
        "surface-pro-7" => BrowserViewportPreset {
            id: "surface-pro-7",
            width: 912,
            height: 1368,
            device_scale_factor: 2.0,
            mobile: true,
        },
        "surface-duo" => BrowserViewportPreset {
            id: "surface-duo",
            width: 540,
            height: 720,
            device_scale_factor: 2.0,
            mobile: true,
        },
        "galaxy-z-fold-5" => BrowserViewportPreset {
            id: "galaxy-z-fold-5",
            width: 344,
            height: 882,
            device_scale_factor: 2.625,
            mobile: true,
        },
        "asus-zenbook-fold" => BrowserViewportPreset {
            id: "asus-zenbook-fold",
            width: 853,
            height: 1280,
            device_scale_factor: 2.0,
            mobile: true,
        },
        "samsung-galaxy-a51-71" => BrowserViewportPreset {
            id: "samsung-galaxy-a51-71",
            width: 412,
            height: 914,
            device_scale_factor: 2.625,
            mobile: true,
        },
        "nest-hub" => BrowserViewportPreset {
            id: "nest-hub",
            width: 1024,
            height: 600,
            device_scale_factor: 1.0,
            mobile: true,
        },
        "nest-hub-max" => BrowserViewportPreset {
            id: "nest-hub-max",
            width: 1280,
            height: 800,
            device_scale_factor: 1.0,
            mobile: true,
        },
        "mobile-s" => BrowserViewportPreset {
            id: "mobile-s",
            width: 320,
            height: 568,
            device_scale_factor: 2.0,
            mobile: true,
        },
        "mobile-m" => BrowserViewportPreset {
            id: "mobile-m",
            width: 375,
            height: 667,
            device_scale_factor: 2.0,
            mobile: true,
        },
        "mobile-l" => BrowserViewportPreset {
            id: "mobile-l",
            width: 425,
            height: 812,
            device_scale_factor: 2.0,
            mobile: true,
        },
        "tablet" => BrowserViewportPreset {
            id: "tablet",
            width: 768,
            height: 1024,
            device_scale_factor: 2.0,
            mobile: true,
        },
        "laptop" => BrowserViewportPreset {
            id: "laptop",
            width: 1024,
            height: 768,
            device_scale_factor: 1.0,
            mobile: false,
        },
        "laptop-large" => BrowserViewportPreset {
            id: "laptop-large",
            width: 1440,
            height: 900,
            device_scale_factor: 1.0,
            mobile: false,
        },
        "desktop" => BrowserViewportPreset {
            id: "desktop",
            width: 1920,
            height: 1080,
            device_scale_factor: 1.0,
            mobile: false,
        },
        _ => return None,
    };
    Some(preset)
}

fn build_annotation_overlay_script(annotations: &str, nonce: &str) -> String {
    let nonce = serde_json::to_string(nonce).unwrap_or_else(|_| "\"\"".to_owned());
    r#"(() => {
  const annotations = __ANNOTATIONS__;
  const nonce = __NONCE__;
  window.__hiveoryBrowserAnnotationCleanup?.();
  if (!Array.isArray(annotations) || annotations.length === 0) return;
  const host = document.createElement('div');
  host.dataset.hiveoryBrowserLayer = 'annotations';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; position: fixed; inset: 0; z-index: 2147483645; pointer-events: none; color-scheme: dark; }
    * { box-sizing: border-box; }
    .marker { position: fixed; display: flex; width: 22px; height: 22px; align-items: center; justify-content: center; border: 2px solid rgba(255,255,255,.92); border-radius: 999px; background: #626262; color: white; box-shadow: 0 2px 9px rgba(0,0,0,.38); font: 700 11px/1 Segoe UI, sans-serif; pointer-events: none; transform: translate(-50%, -50%); }
    .tray { position: fixed; right: 12px; bottom: 12px; display: flex; width: min(320px, calc(100vw - 24px)); max-height: 45vh; flex-direction: column; overflow: hidden; border: 1px solid #38434d; border-radius: 9px; background: rgba(15,18,21,.97); color: #e8edf1; box-shadow: 0 12px 30px rgba(0,0,0,.42); pointer-events: auto; font: 12px/1.4 Segoe UI, sans-serif; }
    .head { display: flex; align-items: center; gap: 7px; min-height: 43px; padding: 7px 8px 7px 11px; border-bottom: 1px solid #303940; }
    .head strong { min-width: 0; flex: 1; font-size: 13px; }
    button { display: inline-flex; min-height: 28px; align-items: center; justify-content: center; border: 1px solid #494949; border-radius: 6px; padding: 4px 8px; background: #2f2f2f; color: #e8edf1; cursor: pointer; font: 600 11px/1 Segoe UI, sans-serif; }
    button:hover { background: #3b3b3b; }
    button:focus-visible { outline: 2px solid #b8b8b8; outline-offset: 1px; }
    button.icon { width: 28px; padding: 0; color: #aab6bf; }
    .list { min-height: 0; overflow: auto; padding: 6px; }
    .row { display: flex; gap: 8px; border-radius: 6px; padding: 7px 6px; }
    .row:hover { background: #22292f; }
    .number { display: flex; width: 20px; height: 20px; flex: 0 0 20px; align-items: center; justify-content: center; border-radius: 999px; background: #626262; color: white; font-weight: 700; }
    .body { min-width: 0; flex: 1; }
    .body strong, .body span, .body small { display: block; overflow: hidden; text-overflow: ellipsis; }
    .body strong { white-space: nowrap; font-size: 12px; }
    .body span { display: -webkit-box; margin-top: 2px; color: #aab6bf; -webkit-box-orient: vertical; -webkit-line-clamp: 2; }
    .body small { margin-top: 3px; color: #7f8c96; text-transform: capitalize; }
    .delete { align-self: start; opacity: 0; }
    .row:hover .delete, .delete:focus-visible { opacity: 1; }
  `;
  shadow.append(style);
  const send = (action, payload = {}) => window.chrome?.webview?.postMessage(JSON.stringify({ kind: 'hiveory-browser-selection', nonce, action, payload }));
  const markerItems = [];
  const clean = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
  annotations.forEach((annotation, index) => {
    const marker = document.createElement('div');
    marker.className = 'marker';
    marker.textContent = String(index + 1);
    marker.setAttribute('aria-hidden', 'true');
    shadow.append(marker);
    markerItems.push({ marker, payload: annotation.payload });
  });
  const tray = document.createElement('section');
  tray.className = 'tray';
  tray.setAttribute('aria-label', 'Browser annotations');
  const head = document.createElement('div');
  head.className = 'head';
  const title = document.createElement('strong');
  title.textContent = annotations.length === 1 ? '1 annotation' : annotations.length + ' annotations';
  const sendButton = document.createElement('button');
  sendButton.textContent = 'Send';
  sendButton.addEventListener('click', () => send('annotation-send'));
  const copyButton = document.createElement('button');
  copyButton.textContent = 'Copy';
  copyButton.addEventListener('click', () => send('annotation-copy'));
  const clearButton = document.createElement('button');
  clearButton.className = 'icon';
  clearButton.textContent = '×';
  clearButton.title = 'Clear annotations';
  clearButton.setAttribute('aria-label', 'Clear annotations');
  clearButton.addEventListener('click', () => send('annotation-clear'));
  head.append(title, sendButton, copyButton, clearButton);
  const list = document.createElement('div');
  list.className = 'list';
  annotations.forEach((annotation, index) => {
    const row = document.createElement('div');
    row.className = 'row';
    const number = document.createElement('div');
    number.className = 'number';
    number.textContent = String(index + 1);
    const body = document.createElement('div');
    body.className = 'body';
    const name = document.createElement('strong');
    const target = annotation.payload?.target || {};
    name.textContent = clean(target.accessibility?.label, clean(target.text, clean(target.tag, 'Element')));
    const comment = document.createElement('span');
    comment.textContent = clean(annotation.comment, 'No feedback');
    const intent = document.createElement('small');
    intent.textContent = clean(annotation.intent, 'change');
    body.append(name, comment, intent);
    const remove = document.createElement('button');
    remove.className = 'icon delete';
    remove.textContent = '×';
    remove.title = 'Delete annotation ' + (index + 1);
    remove.setAttribute('aria-label', remove.title);
    remove.addEventListener('click', () => send('annotation-delete', { id: annotation.id }));
    row.append(number, body, remove);
    list.append(row);
  });
  tray.append(head, list);
  shadow.append(tray);
  document.documentElement.append(host);
  const update = () => markerItems.forEach(({ marker, payload }) => {
    const target = payload?.target || {};
    const source = target.fixed ? target.rect : target.pageRect;
    if (!source) { marker.hidden = true; return; }
    const left = Number(source.x || 0) + Number(source.width || 0) - (target.fixed ? 0 : scrollX);
    const top = Number(source.y || 0) - (target.fixed ? 0 : scrollY);
    marker.style.left = left + 'px';
    marker.style.top = top + 'px';
    marker.hidden = left < -20 || top < -20 || left > innerWidth + 20 || top > innerHeight + 20;
  });
  let frame = 0;
  const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
  addEventListener('scroll', schedule, true);
  addEventListener('resize', schedule);
  update();
  const cleanup = () => {
    cancelAnimationFrame(frame);
    removeEventListener('scroll', schedule, true);
    removeEventListener('resize', schedule);
    host.remove();
    if (window.__hiveoryBrowserAnnotationCleanup === cleanup) delete window.__hiveoryBrowserAnnotationCleanup;
  };
  window.__hiveoryBrowserAnnotationCleanup = cleanup;
})()"#
        .replace("__ANNOTATIONS__", annotations)
        .replace("__NONCE__", &nonce)
}

fn build_picker_script(action: &str, nonce: &str) -> String {
    let action = serde_json::to_string(action).unwrap_or_else(|_| "\"grab\"".to_owned());
    let nonce = serde_json::to_string(nonce).unwrap_or_else(|_| "\"\"".to_owned());
    r#"(() => {
  const action = __ACTION__;
  const nonce = __NONCE__;
  window.__hiveoryBrowserPickerCleanup?.();
  const host = document.createElement('div');
  host.dataset.hiveoryBrowserLayer = 'picker';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; color-scheme: dark; }
    * { box-sizing: border-box; }
    .box { position: fixed; pointer-events: none; border: 2px solid rgba(255,255,255,.92); background: rgba(255,255,255,.08); border-radius: 3px; box-shadow: 0 0 0 1px rgba(0,0,0,.45) inset; transition: left 55ms linear, top 55ms linear, width 55ms linear, height 55ms linear; }
    .tag { position: fixed; max-width: min(360px, calc(100vw - 20px)); overflow: hidden; border-radius: 4px; padding: 4px 7px; background: #353535; color: white; box-shadow: 0 3px 10px rgba(0,0,0,.3); text-overflow: ellipsis; white-space: nowrap; font: 600 11px/1.2 ui-monospace, SFMono-Regular, Consolas, monospace; pointer-events: none; }
    .hint { position: fixed; top: 10px; left: 50%; display: flex; align-items: center; gap: 8px; transform: translateX(-50%); border: 1px solid #3c4650; border-radius: 7px; padding: 7px 10px; background: rgba(17,20,23,.96); color: #dbe4ea; box-shadow: 0 7px 20px rgba(0,0,0,.32); font: 12px/1 Segoe UI, sans-serif; pointer-events: none; }
    .hint b { color: white; font-weight: 650; }
    .hint kbd { border: 1px solid #4b5660; border-radius: 4px; padding: 2px 4px; background: #252b30; color: #b8c4cc; font: 10px/1 ui-monospace, Consolas, monospace; }
    .menu, .panel { position: fixed; border: 1px solid #3b454d; border-radius: 9px; background: rgba(15,18,21,.98); color: #e9eef2; box-shadow: 0 14px 36px rgba(0,0,0,.45); pointer-events: auto; font: 12px/1.4 Segoe UI, sans-serif; }
    .menu { min-width: 184px; padding: 5px; }
    .menu button { display: flex; width: 100%; min-height: 32px; align-items: center; justify-content: space-between; border: 0; border-radius: 5px; padding: 6px 8px; background: transparent; color: inherit; cursor: pointer; font: inherit; text-align: left; }
    .menu button:hover, .menu button:focus-visible { background: #2a3035; outline: none; }
    .menu button:last-child { margin-top: 4px; border-top: 1px solid #313940; border-radius: 0 0 5px 5px; color: #aeb9c1; }
    .menu kbd { color: #86949e; font: 10px/1 ui-monospace, Consolas, monospace; }
    .panel { width: min(352px, calc(100vw - 24px)); padding: 12px; }
    .panel strong { display: block; overflow: hidden; margin-bottom: 2px; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
    .panel small { display: block; overflow: hidden; margin-bottom: 9px; color: #96a4ae; text-overflow: ellipsis; white-space: nowrap; font: 10px/1.4 ui-monospace, Consolas, monospace; }
    .panel textarea { width: 100%; min-height: 84px; resize: none; border: 1px solid #3d4851; border-radius: 6px; padding: 8px 9px; color: #edf2f5; background: #0b0e10; outline: none; font: 12px/1.45 Segoe UI, sans-serif; }
    .panel textarea:focus { border-color: #a2a2a2; box-shadow: 0 0 0 2px rgba(162,162,162,.2); }
    .intent-label { display: block; margin: 8px 0 5px; color: #96a4ae; font-size: 11px; }
    .intents { display: grid; grid-template-columns: 1fr 1fr; gap: 5px; }
    .intents button, .actions button { min-height: 30px; border: 1px solid #3d4851; border-radius: 6px; padding: 5px 9px; color: #dce5ea; background: #20262b; cursor: pointer; font: 600 11px/1 Segoe UI, sans-serif; }
    .intents button.active { border-color: #777; background: #464646; color: white; }
    .actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 10px; }
    .actions button.primary { border-color: #d8d8d8; background: #d8d8d8; color: #171717; }
    button:focus-visible { outline: 2px solid #b8b8b8; outline-offset: 1px; }
  `;
  shadow.append(style);
  const highlight = document.createElement('div');
  highlight.className = 'box';
  highlight.hidden = true;
  const label = document.createElement('div');
  label.className = 'tag';
  label.hidden = true;
  shadow.append(highlight, label);
  let editor = null;
  let menu = null;
  let currentNode = null;
  const cleanup = () => {
    document.removeEventListener('pointermove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('contextmenu', onContextMenu, true);
    window.removeEventListener('keydown', onKeyDown, true);
    host.remove();
    if (window.__hiveoryBrowserPickerCleanup === cleanup) delete window.__hiveoryBrowserPickerCleanup;
  };
  window.__hiveoryBrowserPickerCleanup = cleanup;
  document.documentElement.append(host);
  const inTool = (event) => event.composedPath().includes(host);
  const text = (value, length) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, length);
  const secret = /(access[_-]?token|auth[_-]?token|api[_-]?key|client[_-]?secret|session[_-]?id|csrf|password|passwd|x-amz-)/i;
  const segment = (node, useNth) => {
    let value = node.tagName.toLowerCase();
    if (node.id) return value + '#' + CSS.escape(node.id).slice(0, 80);
    const classes = [...node.classList].filter(Boolean).slice(0, 2);
    if (classes.length) value += '.' + classes.map((item) => CSS.escape(item).slice(0, 40)).join('.');
    if (useNth && node.parentElement) {
      const siblings = [...node.parentElement.children].filter((item) => item.tagName === node.tagName);
      if (siblings.length > 1) value += ':nth-of-type(' + (siblings.indexOf(node) + 1) + ')';
    }
    return value;
  };
  const cssPath = (node, max = 7) => {
    const parts = [];
    let current = node;
    for (let index = 0; current && current.nodeType === 1 && index < max; index += 1, current = current.parentElement) {
      parts.unshift(segment(current, true));
      if (current.id) break;
    }
    return parts.join(' > ').slice(0, 1000);
  };
  const componentInfo = (node) => {
    const key = Object.keys(node).find((item) => item.startsWith('__reactFiber$'));
    let fiber = key ? node[key] : null;
    const names = [];
    let source = null;
    for (let index = 0; fiber && index < 18; index += 1, fiber = fiber.return) {
      const type = fiber.type;
      const name = typeof type === 'function' ? (type.displayName || type.name) : typeof type === 'object' && type ? type.displayName : null;
      if (name && !names.includes(name)) names.unshift(name);
      const debug = fiber._debugSource;
      if (!source && debug?.fileName) source = debug.fileName + (debug.lineNumber ? ':' + debug.lineNumber : '') + (debug.columnNumber ? ':' + debug.columnNumber : '');
    }
    return { path: names.length ? names.map((name) => '<' + name + '>').join(' ') : null, source };
  };
  const describe = (node) => {
    const rect = node.getBoundingClientRect();
    const styles = getComputedStyle(node);
    const attributes = {};
    const allowed = new Set(['id','class','name','type','role','href','src','alt','title','placeholder','for','action','method','data-testid']);
    for (const item of [...node.attributes]) {
      if (!allowed.has(item.name) && !item.name.startsWith('aria-')) continue;
      attributes[item.name] = secret.test(item.name) || secret.test(item.value) ? '[redacted]' : text(item.value, 400);
    }
    const ancestors = [];
    for (let parent = node.parentElement; parent && ancestors.length < 10; parent = parent.parentElement) ancestors.push(segment(parent, false));
    const nearby = [];
    const parent = node.parentElement;
    if (parent) for (const child of [...parent.children]) {
      if (child === node || nearby.length >= 10) continue;
      const value = text(child.innerText || child.textContent, 200);
      if (value && !nearby.includes(value)) nearby.push(value);
    }
    const nearbyElements = parent ? [...parent.children].filter((child) => child !== node).slice(0, 6).map((child) => segment(child, false) + (text(child.innerText || child.textContent, 80) ? ' "' + text(child.innerText || child.textContent, 80) + '"' : '')) : [];
    const components = componentInfo(node);
    const selected = String(getSelection?.()?.toString?.() || '');
    const selectedText = selected && (node.contains(getSelection()?.anchorNode) || node.contains(getSelection()?.focusNode)) ? text(selected, 500) : null;
    return {
      tag: node.tagName.toLowerCase(),
      selector: cssPath(node),
      fullPath: cssPath(node, 20),
      classes: text(node.className, 500),
      sourceFile: components.source,
      componentPath: components.path,
      selectedText,
      fixed: styles.position === 'fixed',
      attributes,
      accessibility: { role: text(node.getAttribute('role') || node.getAttribute('type'), 120) || null, label: text(node.getAttribute('aria-label') || node.getAttribute('alt') || node.getAttribute('title'), 240) || null },
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      pageRect: { x: Math.round(rect.x + scrollX), y: Math.round(rect.y + scrollY), width: Math.round(rect.width), height: Math.round(rect.height) },
      styles: { display: styles.display, position: styles.position, width: styles.width, height: styles.height, margin: styles.margin, padding: styles.padding, color: styles.color, backgroundColor: styles.backgroundColor, border: styles.border, borderRadius: styles.borderRadius, fontFamily: styles.fontFamily, fontSize: styles.fontSize, fontWeight: styles.fontWeight, lineHeight: styles.lineHeight, textAlign: styles.textAlign, zIndex: styles.zIndex },
      text: text(node.innerText || node.textContent, 4000),
      html: String(node.outerHTML || '').slice(0, 8000),
      nearbyElements,
      nearby,
      ancestors,
    };
  };
  const payloadFor = (node, delivery = 'text') => {
    const target = describe(node);
    const nearby = target.nearby;
    const ancestors = target.ancestors;
    delete target.nearby;
    delete target.ancestors;
    return { page: { url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY }, dpr: devicePixelRatio, capturedAt: new Date().toISOString() }, target, nearby, ancestors, delivery };
  };
  const send = (eventAction, payload) => {
    window.chrome?.webview?.postMessage(JSON.stringify({ kind: 'hiveory-browser-selection', nonce, action: eventAction, payload }));
    cleanup();
  };
  const cancel = () => send('cancel', {});
  const placeHighlight = (node) => {
    currentNode = node;
    const rect = node.getBoundingClientRect();
    highlight.hidden = false;
    highlight.style.left = rect.left + 'px';
    highlight.style.top = rect.top + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';
    label.hidden = false;
    label.textContent = node.tagName.toLowerCase() + '  ' + Math.round(rect.width) + ' × ' + Math.round(rect.height);
    label.style.left = Math.max(5, Math.min(innerWidth - 220, rect.left)) + 'px';
    label.style.top = Math.max(5, rect.top > 25 ? rect.top - 24 : rect.bottom + 4) + 'px';
  };
  const showEditor = (payload) => {
    highlight.style.background = 'rgba(255,255,255,.14)';
    let intent = 'change';
    editor = document.createElement('div');
    editor.className = 'panel';
    const rect = payload.target.rect;
    const panelTop = rect.y + rect.height + 330 < innerHeight ? rect.y + rect.height + 10 : Math.max(12, rect.y - 314);
    editor.style.left = Math.max(12, Math.min(innerWidth - 364, rect.x + rect.width / 2 - 176)) + 'px';
    editor.style.top = panelTop + 'px';
    const title = document.createElement('strong');
    title.textContent = payload.target.accessibility.label || payload.target.text || payload.target.tag;
    const detail = document.createElement('small');
    detail.textContent = payload.target.selector;
    const input = document.createElement('textarea');
    input.maxLength = 2000;
    input.placeholder = 'Describe what the agent should change here…';
    const intentLabel = document.createElement('span');
    intentLabel.className = 'intent-label';
    intentLabel.textContent = 'Intent';
    const intents = document.createElement('div');
    intents.className = 'intents';
    const change = document.createElement('button');
    const question = document.createElement('button');
    change.className = 'active';
    change.textContent = 'Change';
    question.textContent = 'Question';
    const choose = (value) => { intent = value; change.classList.toggle('active', value === 'change'); question.classList.toggle('active', value === 'question'); };
    change.addEventListener('click', () => choose('change'));
    question.addEventListener('click', () => choose('question'));
    intents.append(change, question);
    const actions = document.createElement('div');
    actions.className = 'actions';
    const cancel = document.createElement('button');
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => send('cancel', {}));
    const add = document.createElement('button');
    add.className = 'primary';
    add.textContent = 'Add';
    const submit = () => { const comment = input.value.trim(); if (comment) send('annotate', { ...payload, comment, intent }); };
    add.addEventListener('click', submit);
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); submit(); } });
    actions.append(cancel, add);
    editor.append(title, detail, input, intentLabel, intents, actions);
    shadow.append(editor);
    input.focus();
  };
  const showMenu = (event, node) => {
    menu?.remove();
    menu = document.createElement('div');
    menu.className = 'menu';
    menu.style.left = Math.max(8, Math.min(innerWidth - 196, event.clientX)) + 'px';
    menu.style.top = Math.max(8, Math.min(innerHeight - 116, event.clientY)) + 'px';
    const copy = document.createElement('button');
    copy.innerHTML = '<span>Copy Contents</span><kbd>C</kbd>';
    copy.addEventListener('click', () => send('grab', payloadFor(node, 'text')));
    const screenshot = document.createElement('button');
    screenshot.innerHTML = '<span>Copy Screenshot</span><kbd>S</kbd>';
    screenshot.addEventListener('click', () => send('grab', payloadFor(node, 'screenshot')));
    const stop = document.createElement('button');
    stop.textContent = 'Cancel';
    stop.addEventListener('click', cancel);
    menu.append(copy, screenshot, stop);
    shadow.append(menu);
    copy.focus();
  };
  const onMove = (event) => {
    if (editor || menu || inTool(event)) return;
    const node = document.elementFromPoint(event.clientX, event.clientY);
    if (!node || node === host || node === document.documentElement || node === document.body) return;
    placeHighlight(node);
  };
  const onClick = (event) => {
    if (editor || menu || inTool(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const node = document.elementFromPoint(event.clientX, event.clientY);
    if (!node || node === host) return;
    placeHighlight(node);
    const payload = payloadFor(node);
    if (action === 'annotate') showEditor(payload); else send('grab', payload);
  };
  const onContextMenu = (event) => {
    if (action !== 'grab' || editor || inTool(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const node = document.elementFromPoint(event.clientX, event.clientY) || currentNode;
    if (!node || node === host) return;
    placeHighlight(node);
    showMenu(event, node);
  };
  const onKeyDown = (event) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); return; }
    if (action !== 'grab' || editor || menu || !currentNode || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = String(event.key || '').toLowerCase();
    const code = String(event.code || '');
    if (key === 'c' || code === 'KeyC' || key === 's' || code === 'KeyS') {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      send('grab', payloadFor(currentNode, key === 's' || code === 'KeyS' ? 'screenshot' : 'text'));
    }
  };
  document.addEventListener('pointermove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('contextmenu', onContextMenu, true);
  window.addEventListener('keydown', onKeyDown, true);
})();"#
        .replace("__ACTION__", &action)
        .replace("__NONCE__", &nonce)
}

#[cfg(windows)]
fn call_devtools_protocol_method_windows(
    webview: &Webview,
    method: &'static str,
    parameters: String,
    context: &'static str,
) -> Result<(), String> {
    let (sender, receiver) = mpsc::channel::<Result<(), String>>();
    webview
        .with_webview(move |platform| unsafe {
            let outcome = (|| -> Result<(), String> {
                let core = platform
                    .controller()
                    .CoreWebView2()
                    .map_err(|error| format!("The {context} controller is unavailable: {error}"))?;
                let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                    move |_, _| Ok(()),
                ));
                let method = HSTRING::from(method);
                let parameters = HSTRING::from(parameters);
                core.CallDevToolsProtocolMethod(&method, &parameters, &handler)
                    .map_err(|error| format!("The {context} setting could not be applied: {error}"))
            })();
            let _ = sender.send(outcome);
        })
        .map_err(|error| format!("The {context} controller could not start: {error}"))?;
    receiver
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| format!("The {context} controller did not respond."))?
}

#[cfg(windows)]
fn apply_viewport_windows(webview: &Webview, preset: &BrowserViewportPreset) -> Result<(), String> {
    let method = if preset.id == DEFAULT_VIEWPORT_ID {
        "Emulation.clearDeviceMetricsOverride"
    } else {
        "Emulation.setDeviceMetricsOverride"
    };
    let parameters = if preset.id == DEFAULT_VIEWPORT_ID {
        "{}".to_owned()
    } else {
        serde_json::json!({
            "width": preset.width,
            "height": preset.height,
            "deviceScaleFactor": preset.device_scale_factor,
            "mobile": preset.mobile,
        })
        .to_string()
    };
    call_devtools_protocol_method_windows(webview, method, parameters, "viewport")
}

#[cfg(windows)]
fn apply_touch_emulation_windows(webview: &Webview, enabled: bool) -> Result<(), String> {
    call_devtools_protocol_method_windows(
        webview,
        "Emulation.setTouchEmulationEnabled",
        serde_json::json!({
            "enabled": enabled,
            "maxTouchPoints": if enabled { 1 } else { 0 },
        })
        .to_string(),
        "touch emulation",
    )?;
    call_devtools_protocol_method_windows(
        webview,
        "Emulation.setEmitTouchEventsForMouse",
        serde_json::json!({
            "enabled": enabled,
            "configuration": "mobile",
        })
        .to_string(),
        "touch input",
    )
}

#[cfg(windows)]
fn open_devtools_windows(webview: &Webview) -> Result<bool, String> {
    let result = Arc::new(Mutex::new(None));
    let result_for_callback = Arc::clone(&result);
    webview
        .with_webview(move |platform| {
            let outcome = unsafe {
                platform
                    .controller()
                    .CoreWebView2()
                    .and_then(|core| core.OpenDevToolsWindow())
                    .map(|_| true)
                    .map_err(|error| format!("Developer tools could not open: {error}"))
            };
            if let Ok(mut stored) = result_for_callback.lock() {
                *stored = Some(outcome);
            }
        })
        .map_err(|error| format!("Developer tools could not start: {error}"))?;
    let outcome = result
        .lock()
        .map_err(|_| "The developer tools result lock is unavailable.".to_owned())?
        .take()
        .unwrap_or_else(|| Err("Developer tools did not respond.".to_owned()));
    outcome
}

#[cfg(windows)]
fn capture_frame_windows(webview: &Webview) -> Result<BrowserFrame, String> {
    let (sender, receiver) = mpsc::channel::<Result<Vec<u8>, String>>();
    let sender_for_call = sender.clone();
    webview
        .with_webview(move |platform| {
            let outcome = (|| -> Result<(), String> {
                unsafe {
                    let stream = SHCreateMemStream(None)
                        .ok_or_else(|| "A screenshot stream could not be created.".to_owned())?;
                    let stream_for_callback = stream.clone();
                    let core = platform.controller().CoreWebView2().map_err(|error| {
                        format!("The screenshot controller is unavailable: {error}")
                    })?;
                    let handler = CapturePreviewCompletedHandler::create(Box::new(move |status| {
                        let result = match status {
                            Ok(()) => read_stream(&stream_for_callback),
                            Err(error) => {
                                Err(format!("The screenshot could not be captured: {error}"))
                            }
                        };
                        let _ = sender.send(result);
                        Ok(())
                    }));
                    core.CapturePreview(
                        COREWEBVIEW2_CAPTURE_PREVIEW_IMAGE_FORMAT_PNG,
                        &stream,
                        &handler,
                    )
                    .map_err(|error| format!("The screenshot could not start: {error}"))
                }
            })();
            if let Err(error) = outcome {
                let _ = sender_for_call.send(Err(error));
            }
        })
        .map_err(|error| format!("The screenshot controller could not start: {error}"))?;
    let bytes = receiver
        .recv_timeout(std::time::Duration::from_secs(15))
        .map_err(|_| "The screenshot capture timed out.".to_owned())??;
    if bytes.len() > 20 * 1024 * 1024 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("The browser returned an invalid screenshot.".to_owned());
    }
    let (width, height) = png_dimensions(&bytes)
        .ok_or_else(|| "The screenshot dimensions could not be read.".to_owned())?;
    Ok(BrowserFrame {
        png_base64: STANDARD.encode(bytes),
        width,
        height,
    })
}

#[cfg(windows)]
fn read_stream(stream: &IStream) -> Result<Vec<u8>, String> {
    unsafe {
        stream
            .Seek(0, STREAM_SEEK_SET, None)
            .map_err(|error| format!("The screenshot stream could not be read: {error}"))?;
        let mut stats = STATSTG::default();
        stream
            .Stat(&mut stats, STATFLAG_DEFAULT)
            .map_err(|error| format!("The screenshot stream size could not be read: {error}"))?;
        let size = usize::try_from(stats.cbSize)
            .map_err(|_| "The screenshot is too large to process.".to_owned())?;
        if size == 0 || size > 20 * 1024 * 1024 {
            return Err("The screenshot is outside the supported size limit.".to_owned());
        }
        let mut bytes = vec![0_u8; size];
        let mut offset = 0_usize;
        while offset < size {
            let remaining = u32::try_from(size - offset).unwrap_or(u32::MAX);
            let mut read = 0_u32;
            stream
                .Read(
                    bytes[offset..].as_mut_ptr() as *mut _,
                    remaining,
                    Some(&mut read),
                )
                .ok()
                .map_err(|error| format!("The screenshot stream could not be read: {error}"))?;
            if read == 0 {
                bytes.truncate(offset);
                break;
            }
            offset += read as usize;
        }
        Ok(bytes)
    }
}

fn png_dimensions(bytes: &[u8]) -> Option<(u32, u32)> {
    if bytes.len() < 24 || !bytes.starts_with(b"\x89PNG\r\n\x1a\n") || &bytes[12..16] != b"IHDR" {
        return None;
    }
    Some((
        u32::from_be_bytes(bytes[16..20].try_into().ok()?),
        u32::from_be_bytes(bytes[20..24].try_into().ok()?),
    ))
}

#[cfg(windows)]
struct BrowserCookieBatch {
    cookies: Vec<BrowserCookie>,
    skipped: usize,
}

#[cfg(windows)]
fn browser_source_label(source: &str) -> &'static str {
    match source {
        "chrome" => "Google Chrome",
        "edge" => "Microsoft Edge",
        "brave" => "Brave",
        _ => "the selected browser",
    }
}

#[cfg(windows)]
async fn read_browser_source_cookies(source: &str) -> Result<BrowserCookieBatch, String> {
    let root = browser_source_root(source)?;
    let master_key = chromium_master_key(&root)?;
    let profiles = chromium_profile_directories(&root)?;
    let mut batch = BrowserCookieBatch {
        cookies: Vec::new(),
        skipped: 0,
    };
    let mut database_count = 0_usize;
    let mut last_error = None;

    for profile in profiles {
        let Some(database) = chromium_cookie_database(&profile) else {
            continue;
        };
        database_count += 1;
        let copied_database = match copy_chromium_cookie_database(&database) {
            Ok(path) => path,
            Err(error) => {
                last_error = Some(error);
                continue;
            }
        };
        let result = read_chromium_cookie_database(&copied_database, &master_key).await;
        remove_chromium_cookie_database_copy(&copied_database);
        match result {
            Ok(profile_batch) => {
                batch.cookies.extend(profile_batch.cookies);
                batch.skipped += profile_batch.skipped;
            }
            Err(error) => last_error = Some(error),
        }
    }

    if database_count == 0 {
        return Err(format!(
            "No cookie database was found for {}.",
            browser_source_label(source)
        ));
    }
    if batch.cookies.is_empty() && batch.skipped == 0 {
        return Err(last_error.unwrap_or_else(|| {
            format!(
                "No readable cookies were found for {}.",
                browser_source_label(source)
            )
        }));
    }
    Ok(batch)
}

#[cfg(windows)]
fn browser_source_root(source: &str) -> Result<PathBuf, String> {
    let local_app_data = std::env::var_os("LOCALAPPDATA")
        .ok_or_else(|| "The Windows local application data directory is unavailable.".to_owned())?;
    let relative = match source {
        "chrome" => Path::new("Google").join("Chrome").join("User Data"),
        "edge" => Path::new("Microsoft").join("Edge").join("User Data"),
        "brave" => Path::new("BraveSoftware")
            .join("Brave-Browser")
            .join("User Data"),
        _ => return Err("This browser cookie source is not available.".to_owned()),
    };
    Ok(PathBuf::from(local_app_data).join(relative))
}

#[cfg(windows)]
fn chromium_profile_directories(root: &Path) -> Result<Vec<PathBuf>, String> {
    if !root.is_dir() {
        return Err("The selected browser does not have a readable profile directory.".to_owned());
    }
    let mut profiles = fs::read_dir(root)
        .map_err(|error| format!("The browser profile directory could not be read: {error}"))?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let is_directory = entry.file_type().ok()?.is_dir();
            if !is_directory {
                return None;
            }
            let name = entry.file_name();
            let name = name.to_str()?;
            if name == "Default" || name.starts_with("Profile ") {
                Some(entry.path())
            } else {
                None
            }
        })
        .collect::<Vec<_>>();
    profiles.sort_by(|left, right| left.file_name().cmp(&right.file_name()));
    profiles.truncate(20);
    Ok(profiles)
}

#[cfg(windows)]
fn chromium_master_key(root: &Path) -> Result<Vec<u8>, String> {
    let state_path = root.join("Local State");
    let state = fs::read_to_string(&state_path)
        .map_err(|error| format!("The browser encryption settings could not be read: {error}"))?;
    let state = serde_json::from_str::<Value>(&state)
        .map_err(|error| format!("The browser encryption settings are invalid: {error}"))?;
    let encoded = state
        .get("os_crypt")
        .and_then(|value| value.get("encrypted_key"))
        .and_then(Value::as_str)
        .ok_or_else(|| "The browser encryption key was not found.".to_owned())?;
    let encoded = STANDARD
        .decode(encoded)
        .map_err(|_| "The browser encryption key could not be decoded.".to_owned())?;
    let protected = encoded.strip_prefix(b"DPAPI").unwrap_or(&encoded);
    let key = dpapi_unprotect(protected)
        .ok_or_else(|| "The browser encryption key could not be unlocked by Windows.".to_owned())?;
    if key.len() != 32 {
        return Err("The browser encryption key has an unsupported size.".to_owned());
    }
    Ok(key)
}

#[cfg(windows)]
fn chromium_cookie_database(profile: &Path) -> Option<PathBuf> {
    let network_database = profile.join("Network").join("Cookies");
    if network_database.is_file() {
        return Some(network_database);
    }
    let legacy_database = profile.join("Cookies");
    legacy_database.is_file().then_some(legacy_database)
}

#[cfg(windows)]
fn copy_chromium_cookie_database(source: &Path) -> Result<PathBuf, String> {
    let destination =
        std::env::temp_dir().join(format!("hiveory-cookie-{}.db", uuid::Uuid::now_v7()));
    fs::copy(source, &destination)
        .map_err(|error| format!("The browser cookie database could not be copied: {error}"))?;
    for suffix in ["-wal", "-shm"] {
        let source_sidecar = chromium_cookie_sidecar(source, suffix);
        if source_sidecar.is_file() {
            let destination_sidecar = chromium_cookie_sidecar(&destination, suffix);
            if let Err(error) = fs::copy(&source_sidecar, &destination_sidecar) {
                remove_chromium_cookie_database_copy(&destination);
                return Err(format!(
                    "The browser cookie database sidecar could not be copied: {error}"
                ));
            }
        }
    }
    Ok(destination)
}

#[cfg(windows)]
fn chromium_cookie_sidecar(database: &Path, suffix: &str) -> PathBuf {
    let file_name = database
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("Cookies");
    database.with_file_name(format!("{file_name}{suffix}"))
}

#[cfg(windows)]
fn remove_chromium_cookie_database_copy(database: &Path) {
    let _ = fs::remove_file(database);
    for suffix in ["-wal", "-shm"] {
        let _ = fs::remove_file(chromium_cookie_sidecar(database, suffix));
    }
}

#[cfg(windows)]
async fn read_chromium_cookie_database(
    database: &Path,
    master_key: &[u8],
) -> Result<BrowserCookieBatch, String> {
    let options = SqliteConnectOptions::new()
        .filename(database)
        .read_only(true)
        .create_if_missing(false);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(|error| format!("The browser cookie database could not be opened: {error}"))?;
    let rows = sqlx::query(
        "SELECT host_key, name, value, path, expires_utc, is_httponly, is_secure, samesite, encrypted_value FROM cookies",
    )
    .fetch_all(&pool)
    .await;
    pool.close().await;
    let rows =
        rows.map_err(|error| format!("The browser cookie database could not be read: {error}"))?;

    let mut batch = BrowserCookieBatch {
        cookies: Vec::with_capacity(rows.len()),
        skipped: 0,
    };
    for row in rows {
        let host = match row.try_get::<String, _>("host_key") {
            Ok(value) => value,
            Err(_) => {
                batch.skipped += 1;
                continue;
            }
        };
        let name = match row.try_get::<String, _>("name") {
            Ok(value) => value,
            Err(_) => {
                batch.skipped += 1;
                continue;
            }
        };
        let value = match row.try_get::<String, _>("value") {
            Ok(value) => value,
            Err(_) => {
                batch.skipped += 1;
                continue;
            }
        };
        let path = match row.try_get::<String, _>("path") {
            Ok(value) => value,
            Err(_) => {
                batch.skipped += 1;
                continue;
            }
        };
        let expires_utc = match row.try_get::<i64, _>("expires_utc") {
            Ok(value) => value,
            Err(_) => {
                batch.skipped += 1;
                continue;
            }
        };
        let http_only = match row.try_get::<i64, _>("is_httponly") {
            Ok(value) => value != 0,
            Err(_) => {
                batch.skipped += 1;
                continue;
            }
        };
        let secure = match row.try_get::<i64, _>("is_secure") {
            Ok(value) => value != 0,
            Err(_) => {
                batch.skipped += 1;
                continue;
            }
        };
        let same_site = match row.try_get::<i64, _>("samesite") {
            Ok(value) => chromium_same_site(value),
            Err(_) => {
                batch.skipped += 1;
                continue;
            }
        };
        let encrypted = match row.try_get::<Option<Vec<u8>>, _>("encrypted_value") {
            Ok(Some(value)) => value,
            Ok(None) => Vec::new(),
            Err(_) => {
                batch.skipped += 1;
                continue;
            }
        };
        let value = if encrypted.is_empty() {
            value
        } else if let Some(decrypted) = decrypt_chromium_cookie(&encrypted, master_key) {
            decrypted
        } else {
            batch.skipped += 1;
            continue;
        };
        let cookie = BrowserCookie {
            name,
            value,
            domain: host,
            path,
            expires: chromium_expiration(expires_utc),
            http_only,
            secure,
            same_site,
        };
        if validate_cookies(std::slice::from_ref(&cookie)).is_err() {
            batch.skipped += 1;
            continue;
        }
        batch.cookies.push(cookie);
    }
    Ok(batch)
}

#[cfg(windows)]
fn chromium_same_site(value: i64) -> Option<String> {
    match value {
        0 => Some("none".to_owned()),
        1 => Some("lax".to_owned()),
        2 => Some("strict".to_owned()),
        _ => None,
    }
}

#[cfg(windows)]
fn chromium_expiration(value: i64) -> Option<f64> {
    if value <= 0 {
        return None;
    }
    let seconds = value as f64 / 1_000_000.0 - 11_644_473_600.0;
    (seconds.is_finite() && seconds > 0.0).then_some(seconds)
}

#[cfg(windows)]
fn decrypt_chromium_cookie(encrypted: &[u8], master_key: &[u8]) -> Option<String> {
    if encrypted.starts_with(b"v10") || encrypted.starts_with(b"v11") {
        if encrypted.len() < 31 || master_key.len() != 32 {
            return None;
        }
        let cipher = Aes256Gcm::new_from_slice(master_key).ok()?;
        let nonce = Nonce::from_slice(&encrypted[3..15]);
        let plain = cipher.decrypt(nonce, &encrypted[15..]).ok()?;
        return String::from_utf8(plain).ok();
    }
    if encrypted.starts_with(b"v20") {
        return None;
    }
    String::from_utf8(dpapi_unprotect(encrypted)?).ok()
}

#[cfg(windows)]
fn dpapi_unprotect(data: &[u8]) -> Option<Vec<u8>> {
    if data.is_empty() || data.len() > u32::MAX as usize {
        return None;
    }
    let input = CRYPT_INTEGER_BLOB {
        cbData: u32::try_from(data.len()).ok()?,
        pbData: data.as_ptr() as *mut u8,
    };
    let mut output = CRYPT_INTEGER_BLOB::default();
    let result =
        unsafe { CryptUnprotectData(&input, None, None, None, None, 0, &mut output).is_ok() };
    if !result || output.pbData.is_null() || output.cbData == 0 {
        if !output.pbData.is_null() {
            unsafe {
                let _ = LocalFree(Some(HLOCAL(output.pbData as *mut std::ffi::c_void)));
            }
        }
        return None;
    }
    if output.cbData > 16 * 1024 * 1024 {
        unsafe {
            let _ = LocalFree(Some(HLOCAL(output.pbData as *mut std::ffi::c_void)));
        }
        return None;
    }
    let plain =
        unsafe { std::slice::from_raw_parts(output.pbData, output.cbData as usize).to_vec() };
    unsafe {
        let _ = LocalFree(Some(HLOCAL(output.pbData as *mut std::ffi::c_void)));
    }
    Some(plain)
}

#[cfg(windows)]
fn import_cookies_windows(webview: &Webview, cookies: &[BrowserCookie]) -> Result<(), String> {
    let result = Arc::new(Mutex::new(None));
    let result_for_callback = Arc::clone(&result);
    let cookies = cookies.to_owned();
    webview
        .with_webview(move |platform| {
            let outcome = (|| -> Result<(), String> {
                unsafe {
                    let core = platform
                        .controller()
                        .CoreWebView2()
                        .map_err(|error| format!("The cookie store is unavailable: {error}"))?;
                    let core = core.cast::<ICoreWebView2_5>().map_err(|error| {
                        format!("This WebView2 runtime cannot import cookies: {error}")
                    })?;
                    let manager = core
                        .CookieManager()
                        .map_err(|error| format!("The cookie store is unavailable: {error}"))?;
                    for item in cookies {
                        let name = HSTRING::from(item.name);
                        let value = HSTRING::from(item.value);
                        let domain = HSTRING::from(item.domain);
                        let path = HSTRING::from(item.path);
                        let cookie = manager
                            .CreateCookie(&name, &value, &domain, &path)
                            .map_err(|error| format!("A cookie could not be created: {error}"))?;
                        if let Some(expires) = item
                            .expires
                            .filter(|expires| expires.is_finite() && *expires > 0.0)
                        {
                            cookie.SetExpires(expires).map_err(|error| {
                                format!("A cookie expiry could not be set: {error}")
                            })?;
                        }
                        cookie.SetIsHttpOnly(item.http_only).map_err(|error| {
                            format!("A cookie HTTP-only flag could not be set: {error}")
                        })?;
                        cookie.SetIsSecure(item.secure).map_err(|error| {
                            format!("A cookie secure flag could not be set: {error}")
                        })?;
                        let same_site = match item
                            .same_site
                            .as_deref()
                            .unwrap_or("lax")
                            .to_ascii_lowercase()
                            .as_str()
                        {
                            "strict" => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_STRICT,
                            "none" => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_NONE,
                            _ => COREWEBVIEW2_COOKIE_SAME_SITE_KIND_LAX,
                        };
                        cookie.SetSameSite(same_site).map_err(|error| {
                            format!("A cookie same-site flag could not be set: {error}")
                        })?;
                        manager
                            .AddOrUpdateCookie(&cookie)
                            .map_err(|error| format!("A cookie could not be imported: {error}"))?;
                    }
                    Ok(())
                }
            })();
            if let Ok(mut stored) = result_for_callback.lock() {
                *stored = Some(outcome);
            }
        })
        .map_err(|error| format!("The cookie store could not start: {error}"))?;
    let outcome = result
        .lock()
        .map_err(|_| "The cookie result lock is unavailable.".to_owned())?
        .take()
        .unwrap_or_else(|| Err("The cookie store did not respond.".to_owned()));
    outcome
}

fn open_url_external(url: &str) -> Result<(), String> {
    #[cfg(windows)]
    {
        let operation = HSTRING::from("open");
        let target = HSTRING::from(url);
        let instance =
            unsafe { ShellExecuteW(None, &operation, &target, None, None, SW_SHOWNORMAL) };
        if instance.0 as usize <= 32 {
            return Err("The system could not open the page in the default browser.".to_owned());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Err("Opening the default browser is currently available on Windows only.".to_owned())
    }
}

pub(crate) fn normalize_browser_input(value: &str) -> Result<Url, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Url::parse(GOOGLE_HOME).map_err(|error| error.to_string());
    }

    if trimmed.contains("://") || trimmed.starts_with("//") {
        let url = Url::parse(trimmed)
            .map_err(|_| "Browser address must be a valid URL or search text.".to_owned())?;
        return validate_browser_url(&url);
    }

    if let Some(candidate) = bare_host_candidate(trimmed) {
        let scheme = if is_local_host(&candidate) {
            "http"
        } else {
            "https"
        };
        return validate_browser_url(
            &Url::parse(&format!("{scheme}://{candidate}"))
                .map_err(|_| "Browser address must be a valid URL or search text.".to_owned())?,
        );
    }

    if let Ok(url) = Url::parse(trimmed) {
        return validate_browser_url(&url);
    }

    let mut search = Url::parse("https://www.google.com/search")
        .map_err(|error| format!("Google search URL could not be created: {error}"))?;
    search.query_pairs_mut().append_pair("q", trimmed);
    Ok(search)
}

fn bare_host_candidate(value: &str) -> Option<String> {
    if value.chars().any(char::is_whitespace) || value.contains('\\') {
        return None;
    }
    if value.contains("://") || value.starts_with("//") {
        return None;
    }
    let candidate = value.trim_end_matches('/');
    if candidate.is_empty() || candidate.contains('#') || candidate.contains('?') {
        return None;
    }
    let host = candidate
        .split_once('/')
        .map(|(host, _)| host)
        .unwrap_or(candidate);
    if host.contains('@') {
        return None;
    }
    if host.eq_ignore_ascii_case("localhost")
        || host.to_ascii_lowercase().starts_with("localhost:")
        || host.starts_with("127.0.0.1:")
        || host.starts_with("[::1]")
        || host.parse::<std::net::IpAddr>().is_ok()
        || host.contains('.')
        || host.contains(':')
    {
        Some(candidate.to_owned())
    } else {
        None
    }
}

fn is_local_host(value: &str) -> bool {
    let host_port = value
        .split_once('/')
        .map(|(host, _)| host)
        .unwrap_or(value)
        .trim();
    let host = if let Some((host, _)) = host_port
        .strip_prefix('[')
        .and_then(|value| value.split_once(']'))
    {
        host
    } else {
        host_port.split(':').next().unwrap_or(host_port)
    };
    host.eq_ignore_ascii_case("localhost")
        || host
            .parse::<std::net::IpAddr>()
            .map(|ip| ip.is_loopback())
            .unwrap_or(false)
}

pub(crate) fn is_allowed_browser_url(url: &Url) -> bool {
    validate_browser_url(url).is_ok()
}

fn validate_browser_url(url: &Url) -> Result<Url, String> {
    if !matches!(url.scheme(), "http" | "https") {
        return Err("Browser supports only HTTP and HTTPS URLs.".to_owned());
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Browser URLs cannot contain embedded credentials.".to_owned());
    }
    if url.host_str().is_none() {
        return Err("Browser URL must include a host.".to_owned());
    }
    Ok(url.clone())
}

fn download_filename(url: &Url) -> String {
    let name = url
        .path_segments()
        .and_then(|mut segments| segments.next_back())
        .filter(|value| !value.is_empty())
        .unwrap_or("download");
    sanitize_filename(name)
}

fn sanitize_filename(value: &str) -> String {
    let sanitized: String = value
        .chars()
        .map(|character| {
            if character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
            {
                '_'
            } else {
                character
            }
        })
        .collect();
    let sanitized = sanitized.trim().trim_matches('.');
    if sanitized.is_empty() {
        "download".to_owned()
    } else {
        sanitized.chars().take(120).collect()
    }
}

fn unique_download_path(directory: &Path, filename: &str) -> PathBuf {
    let candidate = directory.join(filename);
    if !candidate.exists() {
        return candidate;
    }
    let stem = candidate
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("download");
    let extension = candidate.extension().and_then(|value| value.to_str());
    for index in 1..10_000 {
        let name = match extension {
            Some(extension) => format!("{stem} ({index}).{extension}"),
            None => format!("{stem} ({index})"),
        };
        let candidate = directory.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    directory.join(format!("{stem}-{}", uuid::Uuid::now_v7()))
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

#[cfg(test)]
mod tests {
    use super::{
        accepts_browser_load_event, build_annotation_overlay_script, build_picker_script,
        is_allowed_browser_url, normalize_browser_input,
    };

    #[test]
    fn plain_text_uses_google_search() {
        let url = normalize_browser_input("rust tauri webview").unwrap();
        assert_eq!(url.scheme(), "https");
        assert_eq!(url.host_str(), Some("www.google.com"));
        assert_eq!(url.query(), Some("q=rust+tauri+webview"));
    }

    #[test]
    fn local_hosts_default_to_http() {
        let url = normalize_browser_input("localhost:5173/dashboard").unwrap();
        assert_eq!(url.as_str(), "http://localhost:5173/dashboard");
        let url = normalize_browser_input("LOCALHOST/dashboard").unwrap();
        assert_eq!(url.as_str(), "http://localhost/dashboard");
    }

    #[test]
    fn hostname_defaults_to_https() {
        let url = normalize_browser_input("example.com/docs").unwrap();
        assert_eq!(url.as_str(), "https://example.com/docs");
    }

    #[test]
    fn unsafe_schemes_are_rejected() {
        let url = url::Url::parse("javascript:alert(1)").unwrap();
        assert!(!is_allowed_browser_url(&url));
        assert!(normalize_browser_input("file:///tmp/index.html").is_err());
    }

    #[test]
    fn credentials_are_rejected() {
        let url = url::Url::parse("https://user:pass@example.com").unwrap();
        assert!(!is_allowed_browser_url(&url));
        assert!(normalize_browser_input("mailto:user@example.com").is_err());
    }

    #[test]
    fn stale_page_load_events_cannot_replace_a_newer_navigation() {
        assert!(accepts_browser_load_event(
            "https://new.example/",
            None,
            "https://new.example/"
        ));
        assert!(!accepts_browser_load_event(
            "https://new.example/",
            None,
            "https://old.example/"
        ));
        assert!(accepts_browser_load_event(
            "https://old.example/",
            Some("https://history.example/"),
            "https://history.example/"
        ));
        assert!(!accepts_browser_load_event(
            "https://old.example/",
            Some("https://history.example/"),
            "https://stale.example/"
        ));
    }

    #[test]
    fn picker_script_contains_bounded_selection_controls() {
        let script = build_picker_script("grab", "nonce-value");
        assert!(script.contains("Copy Contents"));
        assert!(script.contains("Copy Screenshot"));
        assert!(script.contains("contextmenu"));
        assert!(script.contains("window.addEventListener('keydown'"));
        assert!(script.contains("code === 'KeyC'"));
        assert!(!script.contains("editable(event.target)"));
        assert!(script.contains("'[redacted]'"));
        assert!(script.contains("nonce-value"));
        assert!(!script.contains("__ACTION__"));
        assert!(!script.contains("__NONCE__"));
    }

    #[test]
    fn annotation_overlay_embeds_only_supplied_data_and_channel() {
        let annotations = r#"[{"id":"note-1","comment":"Review this","payload":{}}]"#;
        let script = build_annotation_overlay_script(annotations, "annotation-channel");
        assert!(script.contains("Review this"));
        assert!(script.contains("annotation-channel"));
        assert!(script.contains("annotation-send"));
        assert!(script.contains("annotation-delete"));
        assert!(!script.contains("__ANNOTATIONS__"));
    }
}
