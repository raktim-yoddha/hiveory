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
pub(crate) struct BrowserCaptureRequest {
    pub browser_id: String,
    pub action: String,
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
    current_url: String,
    title: String,
    loading: bool,
    error: Option<String>,
    history: Vec<String>,
    history_index: usize,
    pending_history_action: Option<HistoryAction>,
    active_interaction: Option<String>,
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
            if existing.url != url.as_str() {
                let state = self.navigate(
                    app,
                    &BrowserNavigationRequest {
                        browser_id: request.browser_id.clone(),
                        url: url.to_string(),
                    },
                )?;
                return Ok(state);
            }
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
            current_url: url.to_string(),
            title: String::new(),
            loading: true,
            error: None,
            history: vec![url.to_string()],
            history_index: 0,
            pending_history_action: None,
            active_interaction: None,
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
        let (workspace_id, url, viewport_id) = {
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
        webview
            .hide()
            .map_err(|error| format!("The embedded Browser could not be hidden: {error}"))?;
        let replacement = BrowserEntry {
            workspace_id,
            preview_id: request.browser_id.clone(),
            webview,
            profile_id: request.profile_id.clone(),
            viewport_id,
            current_url: url.to_string(),
            title: String::new(),
            loading: true,
            error: None,
            history: vec![url.to_string()],
            history_index: 0,
            pending_history_action: None,
            active_interaction: None,
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
        .on_navigation(is_allowed_browser_url)
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
                                        if !matches!(
                                            action.as_str(),
                                            "grab" | "annotate" | "cancel"
                                        ) {
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
                                                if entry.active_interaction.as_deref()
                                                    != Some(nonce)
                                                {
                                                    return None;
                                                }
                                                entry.active_interaction = None;
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
        let webview = {
            let entries = self
                .entries
                .lock()
                .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
            entries
                .get(&request.browser_id)
                .map(|entry| entry.webview.clone())
                .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?
        };
        if !request.visible || request.width < 1.0 || request.height < 1.0 {
            return webview
                .hide()
                .map_err(|error| format!("The Browser could not be hidden: {error}"));
        }
        webview
            .set_bounds(tauri::Rect {
                position: tauri::Position::Logical(LogicalPosition::new(request.x, request.y)),
                size: tauri::Size::Logical(LogicalSize::new(request.width, request.height)),
            })
            .map_err(|error| format!("The Browser could not be resized: {error}"))?;
        webview
            .show()
            .map_err(|error| format!("The Browser could not be shown: {error}"))
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
        let entries = self
            .entries
            .lock()
            .map_err(|_| "The Browser state lock is unavailable.".to_owned())?;
        entries
            .get(browser_id)
            .ok_or_else(|| "The Browser pane is no longer open.".to_owned())?
            .webview
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
        entry.current_url = url;
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

fn build_picker_script(action: &str, nonce: &str) -> String {
    let action = serde_json::to_string(action).unwrap_or_else(|_| "\"grab\"".to_owned());
    let nonce = serde_json::to_string(nonce).unwrap_or_else(|_| "\"\"".to_owned());
    r#"(() => {
  const action = __ACTION__;
  const nonce = __NONCE__;
  const previous = window.__hiveoryBrowserPickerCleanup;
  if (typeof previous === 'function') previous();
  const host = document.createElement('div');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .box { position: fixed; z-index: 2147483647; pointer-events: none; box-sizing: border-box; border: 2px solid #69b7ff; background: rgba(105,183,255,.12); border-radius: 4px; transition: all 80ms ease-out; }
    .panel { position: fixed; right: 18px; bottom: 18px; width: min(360px, calc(100vw - 36px)); padding: 14px; box-sizing: border-box; border: 1px solid #3f4c58; border-radius: 10px; background: #11161b; color: #e9f3f8; box-shadow: 0 14px 42px rgba(0,0,0,.42); pointer-events: auto; font: 13px/1.4 Segoe UI, sans-serif; }
    .panel strong { display: block; margin-bottom: 5px; font-size: 13px; }
    .panel small { display: block; margin-bottom: 9px; color: #a4b6c3; font-size: 11px; }
    .panel textarea { width: 100%; min-height: 74px; box-sizing: border-box; resize: vertical; border: 1px solid #3f4c58; border-radius: 6px; padding: 8px; color: #e9f3f8; background: #0a0e12; outline: none; font: inherit; }
    .panel textarea:focus { border-color: #69b7ff; box-shadow: 0 0 0 2px rgba(105,183,255,.18); }
    .actions { display: flex; justify-content: flex-end; gap: 7px; margin-top: 9px; }
    button { border: 1px solid #45657d; border-radius: 6px; padding: 6px 10px; color: #e9f3f8; background: #21445e; cursor: pointer; font: inherit; }
    button.secondary { color: #b5c5cf; background: #202930; border-color: #3f4c58; }
  `;
  shadow.append(style);
  const highlight = document.createElement('div');
  highlight.className = 'box';
  highlight.hidden = true;
  shadow.append(highlight);
  let editor = null;
  let selected = null;
  const cleanup = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    host.remove();
    if (window.__hiveoryBrowserPickerCleanup === cleanup) delete window.__hiveoryBrowserPickerCleanup;
  };
  window.__hiveoryBrowserPickerCleanup = cleanup;
  document.documentElement.append(host);
  const inTool = (event) => event.composedPath().includes(host);
  const text = (value, length) => String(value || '').replace(/\s+/g, ' ').trim().slice(0, length);
  const cssPath = (node) => {
    const parts = [];
    let current = node;
    for (let index = 0; current && current.nodeType === 1 && index < 7; index += 1, current = current.parentElement) {
      let part = current.tagName.toLowerCase();
      if (current.id) part += '#' + CSS.escape(current.id).slice(0, 80);
      else {
        const classes = [...current.classList].filter(Boolean).slice(0, 2);
        if (classes.length) part += '.' + classes.map((item) => CSS.escape(item).slice(0, 40)).join('.');
        const siblings = current.parentElement ? [...current.parentElement.children].filter((item) => item.tagName === current.tagName) : [];
        if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')';
      }
      parts.unshift(part);
    }
    return parts.join(' > ').slice(0, 1000);
  };
  const describe = (node) => {
    const rect = node.getBoundingClientRect();
    const styles = getComputedStyle(node);
    const attributes = {};
    for (const name of ['id', 'role', 'name', 'type', 'placeholder', 'aria-label', 'aria-labelledby', 'data-testid']) {
      const value = node.getAttribute(name);
      if (value) attributes[name] = text(value, 240);
    }
    return {
      tag: node.tagName.toLowerCase(),
      selector: cssPath(node),
      attributes,
      accessibility: { role: text(node.getAttribute('role'), 120), label: text(node.getAttribute('aria-label'), 240) },
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      styles: { display: styles.display, color: styles.color, backgroundColor: styles.backgroundColor, fontSize: styles.fontSize },
      text: text(node.innerText || node.textContent, 4000),
      html: String(node.outerHTML || '').slice(0, 8000),
      nearby: text(node.parentElement && node.parentElement.innerText, 1200),
    };
  };
  const send = (payload) => {
    window.chrome?.webview?.postMessage(JSON.stringify({ kind: 'hiveory-browser-selection', nonce, action, payload }));
    cleanup();
  };
  const showEditor = (payload) => {
    selected = payload;
    editor = document.createElement('div');
    editor.className = 'panel';
    const title = document.createElement('strong');
    title.textContent = 'Annotate selected element';
    const detail = document.createElement('small');
    detail.textContent = payload.target.tag + (payload.target.attributes.id ? ' #' + payload.target.attributes.id : '') + ' · add a short note';
    const input = document.createElement('textarea');
    input.maxLength = 2000;
    input.placeholder = 'What should be changed, checked, or remembered?';
    const actions = document.createElement('div');
    actions.className = 'actions';
    const cancel = document.createElement('button');
    cancel.className = 'secondary';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => { window.chrome?.webview?.postMessage(JSON.stringify({ kind: 'hiveory-browser-selection', nonce, action: 'cancel', payload: {} })); cleanup(); });
    const save = document.createElement('button');
    save.textContent = 'Save note';
    save.addEventListener('click', () => { const comment = input.value.trim(); if (comment) send({ ...selected, comment }); });
    actions.append(cancel, save);
    editor.append(title, detail, input, actions);
    shadow.append(editor);
    input.focus();
  };
  const onMove = (event) => {
    if (editor || inTool(event)) return;
    const node = document.elementFromPoint(event.clientX, event.clientY);
    if (!node || node === host || node === document.documentElement || node === document.body) return;
    const rect = node.getBoundingClientRect();
    highlight.hidden = false;
    highlight.style.left = rect.left + 'px';
    highlight.style.top = rect.top + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';
  };
  const onClick = (event) => {
    if (editor || inTool(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const node = document.elementFromPoint(event.clientX, event.clientY);
    if (!node || node === host) return;
    const payload = { page: { url: location.href, title: document.title, viewport: { width: innerWidth, height: innerHeight }, scroll: { x: scrollX, y: scrollY }, dpr: devicePixelRatio, capturedAt: new Date().toISOString() }, target: describe(node) };
    if (action === 'annotate') showEditor(payload); else send(payload);
  };
  const onKeyDown = (event) => { if (event.key === 'Escape') { event.preventDefault(); window.chrome?.webview?.postMessage(JSON.stringify({ kind: 'hiveory-browser-selection', nonce, action: 'cancel', payload: {} })); cleanup(); } };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeyDown, true);
})();"#
        .replace("__ACTION__", &action)
        .replace("__NONCE__", &nonce)
}

#[cfg(windows)]
fn apply_viewport_windows(webview: &Webview, preset: &BrowserViewportPreset) -> Result<(), String> {
    let (sender, receiver) = mpsc::channel::<Result<(), String>>();
    let sender_for_call = sender.clone();
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
    webview
        .with_webview(move |platform| {
            let outcome = (|| -> Result<(), String> {
                unsafe {
                    let core = platform.controller().CoreWebView2().map_err(|error| {
                        format!("The viewport controller is unavailable: {error}")
                    })?;
                    let sender_for_callback = sender.clone();
                    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(
                        move |status, _| {
                            let result = status.map_err(|error| {
                                format!("The viewport could not be applied: {error}")
                            });
                            let _ = sender_for_callback.send(result);
                            Ok(())
                        },
                    ));
                    let method = HSTRING::from(method);
                    let parameters = HSTRING::from(parameters);
                    core.CallDevToolsProtocolMethod(&method, &parameters, &handler)
                        .map_err(|error| format!("The viewport could not be applied: {error}"))
                }
            })();
            if let Err(error) = outcome {
                let _ = sender_for_call.send(Err(error));
            }
        })
        .map_err(|error| format!("The viewport controller could not start: {error}"))?;
    receiver
        .recv_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "The viewport controller did not respond.".to_owned())?
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
    use super::{is_allowed_browser_url, normalize_browser_input};

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
}
