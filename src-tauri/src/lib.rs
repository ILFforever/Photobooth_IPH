use rand::Rng;
use serde::{Deserialize, Serialize, Deserializer};
use std::fs;
use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;
use google_drive3::{DriveHub, api::File};
use yup_oauth2::{InstalledFlowAuthenticator, InstalledFlowReturnMethod};
use hyper;
use hyper_rustls;
use std::sync::{Mutex, Arc, atomic::{AtomicBool, Ordering}};
use tauri::{State, Manager, Emitter};
use base64::{Engine as _, engine::general_purpose};
use std::io::Cursor;

// USB Camera management module
mod usb_camera;
use usb_camera::{UsbCamera, AttachedCamera, list_usb_cameras, attach_usb_camera, detach_usb_camera, get_attached_cameras, is_camera_attached, cleanup_all_cameras, attach_all_cameras, ensure_usb_filters};

// HDMI capture via FFmpeg sidecar
mod hdmi_capture;
use hdmi_capture::{list_capture_devices, start_hdmi_capture, stop_hdmi_capture};

// Custom deserializer helper to accept both int and float for Option<u32>
fn deserialize_optional_u32_or_float<'de, D>(deserializer: D) -> Result<Option<u32>, D::Error>
where
    D: Deserializer<'de>,
{
    use serde::de::Error;

    // Try to deserialize as a number (either i64 or f64)
    let value = match Option::<serde_json::Number>::deserialize(deserializer) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };

    match value {
        Some(num) => {
            // Try as i64 first, then as f64
            if let Some(i) = num.as_i64() {
                if i >= 0 && i <= u32::MAX as i64 {
                    Ok(Some(i as u32))
                } else {
                    Err(Error::custom(format!("value {} out of range for u32", i)))
                }
            } else if let Some(f) = num.as_f64() {
                if f >= 0.0 && f.fract() == 0.0 && f <= u32::MAX as f64 {
                    Ok(Some(f as u32))
                } else {
                    Err(Error::custom(format!("value {} is not a valid integer for u32", f)))
                }
            } else {
                Err(Error::custom("invalid number format"))
            }
        }
        None => Ok(None),
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct ProcessResult {
    folder_name: String,
    link: String,
    qr_data: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct UploadProgress {
    step: String,
    current: usize,
    total: usize,
    message: String,
}

#[derive(Serialize, Deserialize, Clone)]
struct ThumbnailLoadProgress {
    current: usize,
    total: usize,
    image: WorkingImage,
}

#[derive(Serialize, Deserialize, Clone)]
struct GoogleAccount {
    email: String,
    name: String,
    picture: Option<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct DriveFolder {
    id: String,
    name: String,
    #[serde(default)]
    is_shared_drive: bool,
}

// Frame system structures
#[derive(Serialize, Deserialize, Clone, Debug)]
struct FrameZone {
    id: String,
    // Fixed positioning system - all in pixels
    x: i32,         // X position in pixels from left edge
    y: i32,         // Y position in pixels from top edge
    width: u32,     // Width in pixels (fixed size)
    height: u32,    // Height in pixels (fixed size)
    rotation: f32,  // Rotation in degrees
    // Shape type for the zone
    shape: String,  // "rectangle", "circle", "rounded_rect", "ellipse", "pill"
    #[serde(rename = "borderRadius", default, deserialize_with = "deserialize_optional_u32_or_float")]
    border_radius: Option<u32>, // Border radius in pixels (for rounded_rect shape)
    // Optional spacing properties for distance calculations
    #[serde(rename = "marginRight", default)]
    margin_right: Option<u32>,  // Distance to next zone on right (in pixels)
    #[serde(rename = "marginBottom", default)]
    margin_bottom: Option<u32>, // Distance to next zone below (in pixels)
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct Frame {
    id: String,
    name: String,
    description: String,
    width: u32,     // Canvas width in pixels (1200)
    height: u32,    // Canvas height in pixels (1800)
    zones: Vec<FrameZone>,
    thumbnail: Option<String>, // Base64 thumbnail or path
    is_default: bool,
    created_at: String,
}

type Auth = yup_oauth2::authenticator::Authenticator<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>;

struct AppState {
    auth: Mutex<Option<Auth>>,
    account: Mutex<Option<GoogleAccount>>,
    root_folder: Mutex<Option<DriveFolder>>,
    upload_cancelled: Arc<AtomicBool>,
}

async fn load_client_secret(_app: &tauri::AppHandle) -> Result<yup_oauth2::ApplicationSecret, String> {
    // Embed the client_secret.json at compile time
    const CLIENT_SECRET_JSON: &str = include_str!("../client_secret.json");

    let json_value: serde_json::Value = serde_json::from_str(CLIENT_SECRET_JSON)
        .map_err(|e| format!("Failed to parse embedded client_secret.json: {}", e))?;

    // Extract the "installed" field and parse it as ApplicationSecret
    let installed = json_value.get("installed")
        .ok_or("Missing 'installed' field in client_secret.json")?;

    serde_json::from_value(installed.clone())
        .map_err(|e| format!("Failed to parse ApplicationSecret: {}", e))
}

#[tauri::command]
async fn google_login(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<GoogleAccount, String> {
    let secret = load_client_secret(&app).await?;

    struct BrowserOpenerDelegate;
    impl yup_oauth2::authenticator_delegate::InstalledFlowDelegate for BrowserOpenerDelegate {
        fn present_user_url<'a>(
            &'a self,
            url: &'a str,
            need_code: bool,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send + 'a>> {
            Box::pin(async move {
                let _ = open::that(url);
                if need_code {
                    yup_oauth2::authenticator_delegate::DefaultInstalledFlowDelegate.present_user_url(url, need_code).await
                } else {
                    Ok(String::new())
                }
            })
        }
    }

    let cache_path = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("tokencache_v2.json");

    if let Some(parent) = cache_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }

    let auth = InstalledFlowAuthenticator::builder(
        secret,
        InstalledFlowReturnMethod::HTTPRedirect,
    )
    .persist_tokens_to_disk(cache_path)
    .flow_delegate(Box::new(BrowserOpenerDelegate))
    .build()
    .await
    .map_err(|e| format!("Failed to create authenticator: {}", e))?;
    
    //Dont fucking touch scopes
    let all_scopes = &[
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/drive.meet.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
    ];
    let token = auth
        .token(all_scopes)
        .await
        .map_err(|e| format!("Failed to get token: {}", e))?;

    let client = reqwest::Client::new();
    let token_str = token.token().ok_or("No token available")?;

    let response = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(token_str)
        .send()
        .await
        .map_err(|e| format!("Failed to get user info: {}", e))?;

    if !response.status().is_success() {
        return Err("Failed to get user info".to_string());
    }

    let user_info: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let account = GoogleAccount {
        email: user_info["email"].as_str().unwrap_or("").to_string(),
        name: user_info["name"].as_str().unwrap_or("User").to_string(),
        picture: user_info["picture"].as_str().map(|s| s.to_string()),
    };

    *state.auth.lock().unwrap() = Some(auth);
    *state.account.lock().unwrap() = Some(account.clone());

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }

    Ok(account)
}

#[tauri::command]
async fn google_logout(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    *state.auth.lock().unwrap() = None;
    *state.account.lock().unwrap() = None;

    let app_data_dir = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Remove ALL token cache files (the library may create multiple files)
    let token_cache_files = [
        "tokencache_v2.json",
        "tokenhcache_v2.json", // Old typo version that might exist
    ];

    for filename in token_cache_files {
        let cache_path = app_data_dir.join(filename);
        if cache_path.exists() {
            let _ = std::fs::remove_file(&cache_path);
        }
    }

    // Also check for any yup-oauth2 storage directory
    let oauth_storage_dir = app_data_dir.join("oauth_storage");
    if oauth_storage_dir.exists() && oauth_storage_dir.is_dir() {
        let _ = std::fs::remove_dir_all(&oauth_storage_dir);
    }

    Ok(())
}

#[tauri::command]
async fn check_cached_account(app: tauri::AppHandle) -> Result<Option<GoogleAccount>, String> {
    let app_data_dir = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let cache_path = app_data_dir.join("tokencache_v2.json");

    if !cache_path.exists() {
        // Also check for the old typo version
        let old_cache_path = app_data_dir.join("tokenhcache_v2.json");
        if old_cache_path.exists() {
            return Ok(None); // Don't use the old cache
        }
        return Ok(None);
    }

    let secret = load_client_secret(&app).await?;

    let auth = InstalledFlowAuthenticator::builder(
        secret,
        InstalledFlowReturnMethod::HTTPRedirect,
    )
    .persist_tokens_to_disk(&cache_path)
    .build()
    .await
    .map_err(|e| format!("Failed to create authenticator: {}", e))?;

    let all_scopes = &[
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
    ];

    let token = match auth.token(all_scopes).await {
        Ok(t) => t,
        Err(_) => return Ok(None),
    };

    let client = reqwest::Client::new();
    let token_str = token.token().ok_or("No token available")?;

    let response = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(token_str)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user info: {}", e))?;

    if !response.status().is_success() {
        return Ok(None);
    }

    let user_info: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;

    let account = GoogleAccount {
        email: user_info["email"].as_str().unwrap_or("").to_string(),
        name: user_info["name"].as_str().unwrap_or("Unknown").to_string(),
        picture: user_info["picture"].as_str().map(|s| s.to_string()),
    };

    Ok(Some(account))
}

#[tauri::command]
async fn get_account(state: State<'_, AppState>) -> Result<Option<GoogleAccount>, String> {
    Ok(state.account.lock().unwrap().clone())
}

#[tauri::command]
async fn list_drive_folders(
    state: State<'_, AppState>,
    parent_id: Option<String>,
) -> Result<Vec<DriveFolder>, String> {
    let auth = {
        let auth_guard = state.auth.lock().unwrap();
        auth_guard.as_ref().ok_or("Not logged in")?.clone()
    };

    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|e| format!("HTTPS error: {}", e))?
        .https_or_http()
        .enable_http1()
        .build();

    let client = hyper::Client::builder().build(https);
    let hub = DriveHub::new(client, auth);

    let mut all_items = Vec::new();

    if let Some(pid) = parent_id {
        let query = format!("'{}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false", pid);
        let result = hub.files()
            .list()
            .q(&query)
            .supports_all_drives(true)
            .include_items_from_all_drives(true)
            .param("fields", "files(id, name)")
            .doit()
            .await;

        if let Ok(res) = result {
            if let Some(files) = res.1.files {
                for file in files {
                    if let (Some(id), Some(name)) = (file.id, file.name) {
                        all_items.push(DriveFolder { id, name, is_shared_drive: false });
                    }
                }
            }
        }
    } else {
        let drives_result = hub.drives().list().doit().await;
        if let Ok(res) = drives_result {
            if let Some(drives) = res.1.drives {
                for drive in drives {
                    if let (Some(id), Some(name)) = (drive.id, drive.name) {
                        all_items.push(DriveFolder { id, name, is_shared_drive: true });
                    }
                }
            }
        }

        let root_result = hub.files()
            .list()
            .q("'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false")
            .doit()
            .await;

        if let Ok(res) = root_result {
            if let Some(files) = res.1.files {
                for file in files {
                    if let (Some(id), Some(name)) = (file.id, file.name) {
                        all_items.push(DriveFolder { id, name, is_shared_drive: false });
                    }
                }
            }
        }
    }

    all_items.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(all_items)
}

#[tauri::command]
async fn create_drive_folder(
    folder_name: String,
    parent_id: Option<String>,
    state: State<'_, AppState>
) -> Result<DriveFolder, String> {
    let auth = {
        let auth_guard = state.auth.lock().unwrap();
        auth_guard.as_ref().ok_or("Not logged in")?.clone()
    };

    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|e| format!("HTTPS error: {}", e))?
        .https_or_http()
        .enable_http1()
        .build();

    let client = hyper::Client::builder().build(https);
    let hub = DriveHub::new(client, auth);

    let mut folder_metadata = File {
        name: Some(folder_name.clone()),
        mime_type: Some("application/vnd.google-apps.folder".to_string()),
        ..Default::default()
    };

    if let Some(pid) = parent_id {
        folder_metadata.parents = Some(vec![pid]);
    }

    let empty_body: &[u8] = &[];
    let (_response, created_folder) = hub
        .files()
        .create(folder_metadata)
        .supports_all_drives(true)
        .upload(std::io::Cursor::new(empty_body), "application/vnd.google-apps.folder".parse().unwrap())
        .await
        .map_err(|e| format!("Failed to create folder: {}", e))?;

    Ok(DriveFolder {
        id: created_folder.id.ok_or("No ID")?,
        name: folder_name,
        is_shared_drive: false,
    })
}

#[tauri::command]
async fn set_root_folder(folder: DriveFolder, state: State<'_, AppState>) -> Result<(), String> {
    *state.root_folder.lock().unwrap() = Some(folder);
    Ok(())
}

#[tauri::command]
async fn get_root_folder(state: State<'_, AppState>) -> Result<Option<DriveFolder>, String> {
    Ok(state.root_folder.lock().unwrap().clone())
}

#[tauri::command]
async fn delete_drive_folder(folder_id: String, state: State<'_, AppState>) -> Result<(), String> {
    let auth = {
        let auth_guard = state.auth.lock().unwrap();
        auth_guard.as_ref().ok_or("Not logged in")?.clone()
    };

    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|e| format!("HTTPS error: {}", e))?
        .https_or_http()
        .enable_http1()
        .build();

    let client = hyper::Client::builder().build(https);
    let hub = DriveHub::new(client, auth);

    hub.files().delete(&folder_id).supports_all_drives(true).doit().await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
async fn select_folder(app: tauri::AppHandle) -> Result<String, String> {
    let folder = app.dialog().file().set_title("Select Photos Folder").blocking_pick_folder();
    match folder {
        Some(path) => Ok(path.to_string()),
        None => Err("Cancelled".to_string()),
    }
}

#[tauri::command]
async fn select_file(app: tauri::AppHandle) -> Result<String, String> {
    let file = app.dialog().file().set_title("Select Image File").blocking_pick_file();
    match file {
        Some(path) => Ok(path.to_string()),
        None => Err("Cancelled".to_string()),
    }
}

#[derive(serde::Serialize)]
struct FileInfo { size: u64 }

#[tauri::command]
async fn get_file_info(file_path: String) -> Result<FileInfo, String> {
    let metadata = fs::metadata(&file_path).map_err(|e| e.to_string())?;
    Ok(FileInfo { size: metadata.len() })
}

fn generate_random_name() -> String {
    let mut rng = rand::thread_rng();
    let random_string: String = (0..8).map(|_| {
        let idx = rng.gen_range(0..36);
        if idx < 26 { (b'A' + idx) as char } else { (b'0' + (idx - 26)) as char }
    }).collect();
    format!("PhotoBooth_{}", random_string)
}

#[tauri::command]
fn cancel_upload(state: State<'_, AppState>) {
    state.upload_cancelled.store(true, Ordering::SeqCst);
    println!("❌ Upload cancelled by user");
}

#[tauri::command]
async fn process_photos(
    _photos_path: String,
    file_list: Option<Vec<String>>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<ProcessResult, String> {
    println!("\n========================================");
    println!("🎬 PROCESS_PHOTOS CALLED");
    println!("========================================");

    // Reset cancelled flag at start
    state.upload_cancelled.store(false, Ordering::SeqCst);

    // Clone the Arc for use in async closures
    let cancelled_flag = state.upload_cancelled.clone();

    println!("🔐 Checking authentication...");
    let auth = {
        let auth_guard = state.auth.lock().unwrap();
        auth_guard.as_ref().ok_or("Not logged in")?.clone()
    };
    println!("✅ Authentication verified");

    println!("📂 Checking root folder...");
    let root_folder = {
        let folder_guard = state.root_folder.lock().unwrap();
        folder_guard.as_ref().ok_or("No root folder")?.clone()
    };
    println!("✅ Root folder: {} (ID: {})", root_folder.name, root_folder.id);

    println!("🔌 Setting up HTTPS connector...");
    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|e| format!("HTTPS error: {}", e))?
        .https_or_http()
        .enable_http1()
        .build();

    println!("🌐 Creating Google Drive client...");
    let client = hyper::Client::builder().build(https);
    let hub = DriveHub::new(client, auth);
    println!("✅ Drive client ready");

    let folder_name = generate_random_name();
    println!("\n========================================");
    println!("🚀 STARTING UPLOAD PROCESS");
    println!("========================================");
    println!("📁 Generated folder name: {}", folder_name);
    println!("📁 Parent folder ID: {}", root_folder.id);

    let _ = app.emit("upload-progress", UploadProgress {
        step: "starting".to_string(),
        current: 0,
        total: 0,
        message: "Starting...".to_string(),
    });
    println!("📡 Emitted 'starting' progress event");

    println!("\n📁 Creating Drive folder...");

    // Retry folder creation in case of 503 or other transient errors
    let max_folder_retries = 5;
    let mut folder_id = String::new();
    let mut last_folder_error = String::new();

    for attempt in 1..=max_folder_retries {
        if attempt > 1 {
            println!("   🔄 Retry folder creation attempt {}/{}", attempt, max_folder_retries);
            tokio::time::sleep(tokio::time::Duration::from_secs(3_u64.pow(attempt - 1))).await;
        }

        let folder_metadata = File {
            name: Some(folder_name.clone()),
            mime_type: Some("application/vnd.google-apps.folder".to_string()),
            parents: Some(vec![root_folder.id.clone()]),
            ..Default::default()
        };

        println!("🌐 Sending folder creation request to Google Drive... (attempt {})", attempt);
        match hub
            .files()
            .create(folder_metadata)
            .supports_all_drives(true)
            .upload(std::io::Cursor::new(&[]), "application/vnd.google-apps.folder".parse().unwrap())
            .await
        {
            Ok((_response, folder)) => {
                folder_id = folder.id.ok_or("No folder ID returned")?;
                println!("✅ Folder created successfully!");
                println!("   Folder ID: {}", folder_id);
                println!("   Folder Name: {}", folder_name);
                break;
            }
            Err(e) => {
                last_folder_error = e.to_string();
                println!("   ⚠️  Folder creation attempt {} FAILED: {}", attempt, last_folder_error);

                // Check if it's a retryable error (503, 500, network errors)
                if last_folder_error.contains("503") ||
                   last_folder_error.contains("500") ||
                   last_folder_error.contains("502") ||
                   last_folder_error.contains("504") ||
                   last_folder_error.contains("Service Unavailable") ||
                   last_folder_error.contains("10054") ||
                   last_folder_error.contains("connection") ||
                   last_folder_error.contains("timed out") {
                    println!("   ℹ️  Transient error detected (Google server issue), will retry...");
                    if attempt == max_folder_retries {
                        println!("   ❌ All {} retry attempts exhausted for folder creation", max_folder_retries);
                        return Err(format!("Failed to create folder after {} attempts. Google Drive may be experiencing issues. Last error: {}", max_folder_retries, last_folder_error));
                    }
                    continue;
                } else {
                    // Non-retryable error
                    println!("   ❌ Non-retryable error during folder creation: {}", last_folder_error);
                    return Err(last_folder_error);
                }
            }
        }
    }

    if folder_id.is_empty() {
        return Err(format!("Failed to create folder: {}", last_folder_error));
    }
    println!("\n========================================");
    println!("📋 PROCESSING FILE LIST");
    println!("========================================");

    let mut image_files = Vec::new();

    if let Some(files) = file_list {
        println!("📝 Received {} files from frontend", files.len());
        for (idx, f) in files.iter().enumerate() {
            println!("  [{}] Checking: {}", idx + 1, f);
            let p = PathBuf::from(&f);
            if p.exists() {
                if let Some(ext) = p.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if matches!(ext_str.as_str(), "jpg" | "jpeg" | "png") {
                        let metadata = fs::metadata(&p).map_err(|e| e.to_string())?;
                        println!("      ✅ Valid image - {} ({} bytes)", ext_str.to_uppercase(), metadata.len());
                        image_files.push((p, ext_str));
                    } else {
                        println!("      ⚠️  Skipped - unsupported extension: {}", ext_str);
                    }
                } else {
                    println!("      ⚠️  Skipped - no extension");
                }
            } else {
                println!("      ❌ File does not exist!");
            }
        }
    } else {
        println!("⚠️  No file list provided");
    }

    let total_files = image_files.len();
    println!("\n📸 Summary: {} valid images ready to upload", total_files);

    if total_files == 0 {
        println!("⚠️  WARNING: No files to upload!");
    }

    // Check for cancellation before starting uploads
    if cancelled_flag.load(Ordering::SeqCst) {
        println!("❌ Upload cancelled before starting");
        return Err("Upload cancelled".to_string());
    }

    println!("\n========================================");
    println!("📤 STARTING FILE UPLOADS");
    println!("========================================");

    use futures::stream::{self, StreamExt};
    let indexed_files: Vec<_> = image_files.into_iter().enumerate().collect();

    let upload_results: Vec<Result<(), String>> = stream::iter(indexed_files)
        .map(|(index, (path, ext_str))| {
            let hub = hub.clone();
            let folder_id = folder_id.clone();
            let app = app.clone();
            let cancelled = cancelled_flag.clone();
            async move {
                // Check for cancellation at start of each file upload
                if cancelled.load(Ordering::SeqCst) {
                    println!("❌ Upload cancelled during upload [{}]", index + 1);
                    return Err("Upload cancelled".to_string());
                }
                let name = path.file_name().unwrap().to_string_lossy().to_string();
                println!("\n📤 [{}/{}] Starting upload: {}", index + 1, total_files, name);
                println!("   Path: {}", path.display());

                let _ = app.emit("upload-progress", UploadProgress {
                    step: "uploading".to_string(),
                    current: index + 1,
                    total: total_files,
                    message: format!("Uploading {}", name),
                });
                println!("   📡 Emitted progress event");

                let mime = if ext_str == "png" { "image/png" } else { "image/jpeg" };
                println!("   📋 MIME type: {}", mime);

                println!("   📖 Reading file data...");
                let data = fs::read(&path).map_err(|e| {
                    println!("   ❌ Failed to read file: {}", e);
                    e.to_string()
                })?;
                println!("   ✅ Read {} bytes", data.len());

                // Retry logic for network errors
                let max_retries = 3;
                let mut last_error = String::new();

                for attempt in 1..=max_retries {
                    if attempt > 1 {
                        println!("   🔄 Retry attempt {}/{} for: {}", attempt, max_retries, name);
                        // Wait before retrying (exponential backoff)
                        tokio::time::sleep(tokio::time::Duration::from_secs(2_u64.pow(attempt - 1))).await;
                    }

                    let meta = File { name: Some(name.clone()), parents: Some(vec![folder_id.clone()]), ..Default::default() };

                    println!("   🌐 Uploading to Drive (folder_id: {})... attempt {}", folder_id, attempt);
                    match hub.files().create(meta).supports_all_drives(true)
                        .upload(std::io::Cursor::new(data.clone()), mime.parse().unwrap()).await {
                        Ok(_) => {
                            println!("   ✅ Upload SUCCESS: {}", name);
                            return Ok(());
                        }
                        Err(e) => {
                            last_error = e.to_string();
                            println!("   ⚠️  Upload attempt {} FAILED: {}", attempt, last_error);

                            // Check if it's a network error that we should retry
                            if last_error.contains("10054") ||
                               last_error.contains("connection") ||
                               last_error.contains("timed out") ||
                               last_error.contains("broken pipe") {
                                println!("   ℹ️  Network error detected, will retry...");
                                continue;
                            } else {
                                // Non-retryable error, fail immediately
                                println!("   ❌ Non-retryable error, aborting: {}", last_error);
                                return Err(last_error);
                            }
                        }
                    }
                }

                println!("   ❌ All {} retry attempts exhausted for: {}", max_retries, name);
                Err(format!("Failed after {} attempts: {}", max_retries, last_error))
            }
        })
        .buffer_unordered(2)  // Reduced from 5 to 2 to avoid overwhelming the connection
        .collect()
        .await;

    println!("\n========================================");
    println!("📊 CHECKING UPLOAD RESULTS");
    println!("========================================");

    let mut success_count = 0;
    let mut failed_count = 0;

    for (idx, r) in upload_results.iter().enumerate() {
        match r {
            Ok(_) => {
                success_count += 1;
                println!("  [{}] ✅ Success", idx + 1);
            }
            Err(e) => {
                failed_count += 1;
                println!("  [{}] ❌ Failed: {}", idx + 1, e);
            }
        }
    }

    println!("\nResults: {} succeeded, {} failed", success_count, failed_count);

    for r in upload_results { r?; }

    println!("✅ All uploads completed successfully");

    println!("\n========================================");
    println!("🔓 SETTING FOLDER PERMISSIONS");
    println!("========================================");
    println!("Making folder public (anyone with link can view)...");

    let permission = google_drive3::api::Permission {
        role: Some("reader".to_string()),
        type_: Some("anyone".to_string()),
        ..Default::default()
    };

    hub.permissions().create(permission, &folder_id).doit().await
        .map_err(|e| {
            println!("❌ Permission setting FAILED: {}", e);
            e.to_string()
        })?;
    println!("✅ Folder is now publicly accessible");

    println!("\n========================================");
    println!("📱 GENERATING QR CODE");
    println!("========================================");

    let link = format!("https://drive.google.com/drive/folders/{}", folder_id);
    println!("🔗 Link: {}", link);

    println!("Generating QR code image...");
    let qr_data = generate_qr_code_base64(&link)?;
    println!("✅ QR code generated (base64 length: {} bytes)", qr_data.len());

    println!("\n📡 Emitting 'complete' progress event...");
    let _ = app.emit("upload-progress", UploadProgress {
        step: "complete".to_string(),
        current: total_files,
        total: total_files,
        message: "Done".to_string(),
    });

    println!("💾 Saving to history...");
    let _ = append_history_entry(&app, HistoryItem {
        timestamp: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs().to_string(),
        folder_name: folder_name.clone(),
        link: link.clone(),
        qr_data: qr_data.clone(),
    });
    println!("✅ History entry saved");

    println!("\n========================================");
    println!("✅ PROCESS COMPLETE!");
    println!("========================================");
    println!("Folder: {}", folder_name);
    println!("Files uploaded: {}", total_files);
    println!("Link: {}", link);
    println!("========================================\n");

    Ok(ProcessResult { folder_name, link, qr_data })
}

fn generate_qr_code_base64(url: &str) -> Result<String, String> {
    use qrcode::QrCode;
    use image::{ImageEncoder, Luma};
    use image::codecs::png::PngEncoder;

    let code = QrCode::new(url.as_bytes()).map_err(|e| e.to_string())?;
    let qr_image = code.render::<Luma<u8>>().max_dimensions(400, 400).build();

    // Get the raw pixel data and dimensions
    let width = qr_image.width();
    let height = qr_image.height();
    let raw_data = qr_image.into_raw();

    // Encode to PNG buffer
    let mut buffer = Cursor::new(Vec::new());
    let encoder = PngEncoder::new(&mut buffer);
    encoder.write_image(
        &raw_data,
        width,
        height,
        image::ExtendedColorType::L8,
    ).map_err(|e: image::error::ImageError| e.to_string())?;

    Ok(general_purpose::STANDARD.encode(buffer.get_ref()))
}

#[derive(Serialize, Deserialize)]
struct ImageFileInfo { path: String, size: u64, extension: String }

#[tauri::command]
async fn get_images_in_folder(folder_path: String) -> Result<Vec<String>, String> {
    let mut paths = Vec::new();
    if let Ok(entries) = fs::read_dir(folder_path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Some(ext) = p.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if matches!(ext_str.as_str(), "jpg" | "jpeg" | "png") {
                    paths.push(p.to_string_lossy().to_string());
                }
            }
        }
    }
    Ok(paths)
}

#[tauri::command]
async fn get_images_with_metadata(folder_path: String) -> Result<Vec<ImageFileInfo>, String> {
    let mut files = Vec::new();
    if let Ok(entries) = fs::read_dir(folder_path) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Some(ext) = p.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if matches!(ext_str.as_str(), "jpg" | "jpeg" | "png") {
                    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
                    files.push(ImageFileInfo { path: p.to_string_lossy().to_string(), size: meta.len(), extension: ext_str });
                }
            }
        }
    }
    Ok(files)
}

#[tauri::command]
async fn save_dropped_image(image_data: String, filename: String, app: tauri::AppHandle) -> Result<String, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("dropped_images");
    let _ = fs::create_dir_all(&dir);
    let parts: Vec<&str> = image_data.split(',').collect();
    let bytes = general_purpose::STANDARD.decode(parts[1]).map_err(|e| e.to_string())?;
    let path = dir.join(&filename);
    fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().to_string())
}

/// Generate cached thumbnail for a single image (used by QR view and Working Folder)
#[tauri::command]
async fn generate_cached_thumbnail(image_path: String, app: tauri::AppHandle) -> Result<String, String> {
    println!("=== CACHED THUMBNAIL GENERATION ===");
    println!("Mode: HIGH RESOLUTION");
    println!("Settings: 400px max, 1/2 JPEG scale, Lanczos3 filter");
    println!("Input: {}", image_path);

    // Use the high-res thumbnail function (400px, 1/2 scale, Lanczos3 filter)
    let result = generate_cached_thumbnail_high_res(&image_path, &app).await?;

    println!("✓ Cached thumbnail generated: {}", result.thumbnail);
    println!("===================================");
    Ok(result.thumbnail)
}

#[derive(Serialize, Deserialize)]
struct CachedThumbnailResult {
    original_path: String,
    thumbnail_url: String,
}

/// Generate cached thumbnails for multiple images in parallel (used by QR view and Working Folder)
#[tauri::command]
async fn generate_cached_thumbnails_batch(image_paths: Vec<String>, app: tauri::AppHandle) -> Result<Vec<CachedThumbnailResult>, String> {
    println!("Generating {} cached thumbnails in batch...", image_paths.len());

    let total_files = image_paths.len();

    // Limit concurrent thumbnail generation
    let max_concurrent_tasks = std::cmp::min(8, total_files);
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(max_concurrent_tasks));

    // Use JoinSet for concurrent processing
    let mut join_set = tokio::task::JoinSet::new();

    // Spawn tasks for thumbnail generation
    for (index, image_path) in image_paths.into_iter().enumerate() {
        let app_clone = app.clone();
        let semaphore_clone = semaphore.clone();
        let path_clone = image_path.clone();

        join_set.spawn_blocking(move || {
            tokio::runtime::Handle::current().block_on(async {
                // Acquire semaphore permit to limit concurrency
                let _permit = semaphore_clone.acquire().await.unwrap();

                let result = generate_thumbnail_cached(&path_clone, &app_clone, index).await;
                (path_clone, result)
            })
        });
    }

    // Collect results as they complete
    let mut results = Vec::new();
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok((original_path, thumb_result)) => {
                if let Ok(thumb) = thumb_result {
                    results.push(CachedThumbnailResult {
                        original_path,
                        thumbnail_url: thumb.thumbnail,
                    });
                } else {
                    eprintln!("Failed to generate thumbnail for: {}", original_path);
                }
            }
            Err(e) => {
                eprintln!("Join error: {}", e);
            }
        }
    }

    println!("Batch thumbnail generation complete: {} thumbnails", results.len());
    Ok(results)
}

/// Generate higher resolution cached thumbnail (400px instead of 200px)
/// Uses the same algorithm as generate_thumbnail_cached but with higher quality settings
async fn generate_cached_thumbnail_high_res(image_path: &str, app: &tauri::AppHandle) -> Result<ThumbnailResult, String> {
    generate_thumbnail_with_settings(image_path, app, 400, 2, image::imageops::FilterType::Lanczos3, "cached_thumbnails", "cached_thumb").await
}

/// Internal function for thumbnail generation with configurable settings
async fn generate_thumbnail_with_settings(
    image_path: &str,
    app: &tauri::AppHandle,
    max_dimension: u32,
    jpeg_scale: u8, // 1=full, 2=1/2, 4=1/4, 8=1/8
    resize_filter: image::imageops::FilterType,
    cache_dir_name: &str,
    thumb_prefix: &str
) -> Result<ThumbnailResult, String> {
    // Get thumbnail path
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let thumbnails_dir = app_data_dir.join(cache_dir_name);
    fs::create_dir_all(&thumbnails_dir)
        .map_err(|e| format!("Failed to create {} dir: {}", cache_dir_name, e))?;

    let path_buf = PathBuf::from(image_path);
    let filename = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?;

    let thumbnail_path = thumbnails_dir.join(format!("{}_{}", thumb_prefix, filename));

    // Check if thumbnail and metadata already exist and are newer than source
    let metadata_path = thumbnails_dir.join(format!("{}_{}.meta", thumb_prefix, filename));

    if thumbnail_path.exists() && metadata_path.exists() {
        if let Ok(source_mtime) = fs::metadata(&path_buf).and_then(|m| m.modified()) {
            if let Ok(thumb_mtime) = fs::metadata(&thumbnail_path).and_then(|m| m.modified()) {
                if thumb_mtime > source_mtime {
                    // Thumbnail exists and is newer, load dimensions from metadata file
                    let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
                    let asset_url = format!("asset://{}", path_str);
                    let dimensions = fs::read_to_string(&metadata_path)
                        .ok()
                        .and_then(|meta| {
                            let parts: Vec<&str> = meta.split('x').collect();
                            if parts.len() == 2 {
                                let width = parts[0].parse::<u32>().ok()?;
                                let height = parts[1].parse::<u32>().ok()?;
                                Some(ImageDimensions { width, height })
                            } else {
                                None
                            }
                        });

                    return Ok(ThumbnailResult { thumbnail: asset_url, dimensions });
                }
            }
        }
    }

    // Check if this is a JPEG file
    let is_jpeg = path_buf
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg"))
        .unwrap_or(false);

    if is_jpeg {
        // Read JPEG file once
        let jpeg_data = fs::read(image_path)
            .map_err(|e| format!("Failed to read JPEG file: {}", e))?;

        // Get dimensions from mozjpeg header
        let decompress_dims = mozjpeg::Decompress::new_mem(&jpeg_data)
            .map_err(|e| format!("Failed to create mozjpeg decompressor: {}", e))?;

        let stored_width = decompress_dims.width() as u32;
        let stored_height = decompress_dims.height() as u32;

        // Read EXIF orientation
        let exif_orientation_value = rexif::parse_file(image_path)
            .ok()
            .and_then(|exif_data| {
                for entry in &exif_data.entries {
                    if entry.tag == rexif::ExifTag::Orientation {
                        if let rexif::TagValue::U16(ref shorts) = entry.value {
                            return shorts.first().copied();
                        }
                    }
                }
                None
            });

        // Check if dimensions need to be swapped for display
        let needs_dimension_swap = matches!(exif_orientation_value, Some(5) | Some(6) | Some(7) | Some(8));

        let (img_width, img_height) = if needs_dimension_swap {
            (stored_height, stored_width)
        } else {
            (stored_width, stored_height)
        };

        let dimensions = ImageDimensions {
            width: img_width,
            height: img_height,
        };

        // Fast decode with configurable scale
        let mut decompress = mozjpeg::Decompress::new_mem(&jpeg_data)
            .map_err(|e| format!("Failed to create mozjpeg decompressor: {}", e))?;

        decompress.scale(jpeg_scale);

        let mut image = decompress.rgb()
            .map_err(|e| format!("Failed to decompress JPEG: {}", e))?;

        let scaled_width = image.width();
        let scaled_height = image.height();

        // Convert mozjpeg data to RGB image
        let img_data = image.read_scanlines()
            .map_err(|e| format!("Failed to read scanlines: {}", e))?;

        let rgb_img = image::RgbImage::from_raw(
            scaled_width as u32,
            scaled_height as u32,
            img_data
        ).ok_or("Failed to create image buffer")?;

        let mut dynamic_img = image::DynamicImage::ImageRgb8(rgb_img);

        // Apply EXIF rotation
        if let Some(orientation) = exif_orientation_value {
            if orientation != 1 {
                dynamic_img = match orientation {
                    2 => {
                        image::DynamicImage::ImageRgb8(
                            image::imageops::flip_horizontal(&dynamic_img.to_rgb8())
                        )
                    }
                    3 => dynamic_img.rotate180(),
                    4 => {
                        image::DynamicImage::ImageRgb8(
                            image::imageops::flip_vertical(&dynamic_img.to_rgb8())
                        )
                    }
                    5 => {
                        let flipped = image::imageops::flip_horizontal(&dynamic_img.to_rgb8());
                        image::DynamicImage::ImageRgb8(flipped).rotate270()
                    }
                    6 => dynamic_img.rotate90(),
                    7 => {
                        let flipped = image::imageops::flip_horizontal(&dynamic_img.to_rgb8());
                        image::DynamicImage::ImageRgb8(flipped).rotate90()
                    }
                    8 => dynamic_img.rotate270(),
                    _ => dynamic_img
                };
            }
        }

        // Resize to configurable max dimension with configurable filter
        let thumbnail = if dynamic_img.width() > max_dimension || dynamic_img.height() > max_dimension {
            let scale = max_dimension as f32 / (dynamic_img.width().max(dynamic_img.height()) as f32);
            let new_width = (dynamic_img.width() as f32 * scale).round() as u32;
            let new_height = (dynamic_img.height() as f32 * scale).round() as u32;
            dynamic_img.resize(new_width, new_height, resize_filter)
        } else {
            dynamic_img
        };

        // Save thumbnail with higher quality
        thumbnail.save_with_format(&thumbnail_path, image::ImageFormat::Jpeg)
            .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

        // Save dimensions to metadata
        let metadata_content = format!("{}x{}", dimensions.width, dimensions.height);
        let _ = fs::write(&metadata_path, metadata_content);

        let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
        let asset_url = format!("asset://{}", path_str);
        return Ok(ThumbnailResult { thumbnail: asset_url, dimensions: Some(dimensions) });
    }

    // Fallback for non-JPEG images (PNG, etc.)
    let img = image::ImageReader::open(image_path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to guess format: {}", e))?
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let dimensions = ImageDimensions {
        width: img.width(),
        height: img.height(),
    };

    // Resize to configurable max dimension with configurable filter
    let thumbnail = if dimensions.width > max_dimension || dimensions.height > max_dimension {
        let scale = max_dimension as f32 / dimensions.width.max(dimensions.height) as f32;
        let new_width = (dimensions.width as f32 * scale).round() as u32;
        let new_height = (dimensions.height as f32 * scale).round() as u32;
        img.resize(new_width, new_height, resize_filter)
    } else {
        img
    };

    thumbnail.save_with_format(&thumbnail_path, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    // Save dimensions to metadata
    let metadata_content = format!("{}x{}", dimensions.width, dimensions.height);
    let _ = fs::write(&metadata_path, metadata_content);

    let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
    let asset_url = format!("asset://{}", path_str);
    Ok(ThumbnailResult { thumbnail: asset_url, dimensions: Some(dimensions) })
}

#[tauri::command]
async fn clear_temp_images(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?.join("dropped_images");
    let _ = fs::remove_dir_all(dir);
    Ok(())
}

#[tauri::command]
async fn remove_temp_image(filename: String, app: tauri::AppHandle) -> Result<(), String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("dropped_images").join(filename);
    let _ = fs::remove_file(path);
    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct HistoryItem { timestamp: String, folder_name: String, link: String, qr_data: String }

#[tauri::command]
async fn get_history(app: tauri::AppHandle) -> Result<Vec<HistoryItem>, String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("history.json");
    if !path.exists() { return Ok(Vec::new()); }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut history: Vec<HistoryItem> = serde_json::from_str(&content).map_err(|e| e.to_string())?;
    history.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(history)
}

#[tauri::command]
async fn clear_history(app: tauri::AppHandle) -> Result<(), String> {
    let path = app.path().app_data_dir().map_err(|e| e.to_string())?.join("history.json");
    let _ = fs::remove_file(path);
    Ok(())
}

fn append_history_entry(app: &tauri::AppHandle, item: HistoryItem) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("history.json");
    let mut history: Vec<HistoryItem> = if path.exists() {
        serde_json::from_str(&fs::read_to_string(&path).unwrap_or_default()).unwrap_or_default()
    } else { Vec::new() };
    history.push(item);
    fs::write(path, serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// WORKING FOLDER COMMANDS (for collage maker)
// ============================================================================

#[derive(Serialize, Deserialize, Clone)]
struct WorkingImage {
    path: String,
    filename: String,
    thumbnail: String,
    size: u64,
    extension: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    dimensions: Option<ImageDimensions>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct ImageDimensions {
    width: u32,
    height: u32,
}

#[derive(Serialize, Deserialize)]
struct WorkingFolderInfo {
    path: String,
    images: Vec<WorkingImage>,
}

#[tauri::command]
async fn select_working_folder(app: tauri::AppHandle) -> Result<WorkingFolderInfo, String> {
    println!("=== SELECT WORKING FOLDER START ===");

    // Open folder picker
    let folder_path = app.dialog()
        .file()
        .set_title("Select Working Folder")
        .blocking_pick_folder()
        .ok_or("No folder selected")?;

    let folder_path_str = folder_path.to_string();
    println!("Selected folder: {}", folder_path_str);

    // Scan folder for images
    println!("Starting folder scan...");
    let images = scan_folder_for_images(&folder_path_str, &app).await?;
    println!("Folder scan complete. Found {} images", images.len());

    println!("=== SELECT WORKING FOLDER END ===");
    Ok(WorkingFolderInfo {
        path: folder_path_str,
        images,
    })
}

async fn scan_folder_for_images(folder_path: &str, app: &tauri::AppHandle) -> Result<Vec<WorkingImage>, String> {
    println!("Scanning folder: {}", folder_path);

    let path = PathBuf::from(folder_path);
    let mut images = Vec::new();

    let entries = fs::read_dir(&path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    // Collect all valid image files first
    let mut image_files = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
        let file_path = entry.path();

        if !file_path.is_file() {
            continue;
        }

        let extension = file_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_lowercase();

        // Support common image formats
        if !matches!(extension.as_str(), "jpg" | "jpeg" | "png" | "raw" | "cr2" | "nef" | "arw") {
            continue;
        }

        let filename = file_path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        let metadata = fs::metadata(&file_path)
            .map_err(|e| format!("Failed to read metadata: {}", e))?;

        let size = metadata.len();
        let modified = metadata.modified()
            .map_err(|e| format!("Failed to read modified time: {}", e))?;

        let file_path_str = file_path.to_string_lossy().to_string();

        image_files.push((file_path_str, filename, size, extension, modified));
    }

    // Sort by modification time, newest first
    image_files.sort_by(|a, b| b.4.cmp(&a.4));

    let total_files = image_files.len();
    println!("Found {} image files (sorted newest first)", total_files);

    // Emit total count first so frontend can show correct skeleton count
    let _ = app.emit("thumbnail-total-count", total_files);

    // Limit concurrent thumbnail generation to avoid overwhelming CPU
    let max_concurrent_tasks = std::cmp::min(8, total_files); // Max 8 concurrent thumbnails
    let semaphore = std::sync::Arc::new(tokio::sync::Semaphore::new(max_concurrent_tasks));

    // Use JoinSet for concurrent processing
    let mut join_set = tokio::task::JoinSet::new();

    // Spawn tasks for thumbnail generation
    for (index, (file_path, filename, size, extension, _modified)) in image_files.into_iter().enumerate() {
        if matches!(extension.as_str(), "jpg" | "jpeg" | "png") {
            let file_path_clone = file_path.clone();
            let filename_clone = filename.clone();
            let extension_clone = extension.clone();
            let app_clone = app.clone();
            let semaphore_clone = semaphore.clone();

            join_set.spawn_blocking(move || {
                tokio::runtime::Handle::current().block_on(async {
                    // Acquire semaphore permit to limit concurrency
                    let _permit = semaphore_clone.acquire().await.unwrap();

                    let result = generate_thumbnail_cached(&file_path_clone, &app_clone, index).await;
                    (index, result, file_path_clone, filename_clone, size, extension_clone)
                })
            });
        } else {
            // RAW files - emit immediately without thumbnail
            let working_image = WorkingImage {
                path: file_path.clone(),
                filename: filename.clone(),
                thumbnail: String::new(),
                size,
                extension,
                dimensions: None,
            };

            images.push(working_image.clone());

            let _ = app.emit("thumbnail-loaded", ThumbnailLoadProgress {
                current: index + 1,
                total: total_files,
                image: working_image,
            });
        }
    }

    // Collect results as they complete
    let mut results = Vec::new();
    while let Some(result) = join_set.join_next().await {
        match result {
            Ok((index, thumb_result, file_path, filename, size, extension)) => {
                let (thumbnail, dimensions) = match thumb_result {
                    Ok(r) => (Some(r.thumbnail), r.dimensions),
                    Err(_) => (None, None),
                };

                let working_image = WorkingImage {
                    path: file_path,
                    filename,
                    thumbnail: thumbnail.unwrap_or_default(),
                    size,
                    extension,
                    dimensions,
                };

                // Emit immediately as each completes
                let _ = app.emit("thumbnail-loaded", ThumbnailLoadProgress {
                    current: index + 1,
                    total: total_files,
                    image: working_image.clone(),
                });

                results.push((index, working_image));
            }
            _ => {}
        }
    }

    // Sort results by original index and add to images
    results.sort_by_key(|(index, _)| *index);
    for (_, image) in results {
        images.push(image);
    }

    println!("Scan complete: {} images", images.len());
    Ok(images)
}

#[derive(Clone)]
struct ThumbnailResult {
    thumbnail: String,
    dimensions: Option<ImageDimensions>,
}

async fn generate_thumbnail_cached(image_path: &str, app: &tauri::AppHandle, _task_id: usize) -> Result<ThumbnailResult, String> {

    // Get thumbnail path
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let thumbnails_dir = app_data_dir.join("thumbnails");
    fs::create_dir_all(&thumbnails_dir)
        .map_err(|e| format!("Failed to create thumbnails dir: {}", e))?;

    let path_buf = PathBuf::from(image_path);
    let filename = path_buf
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?;

    let thumbnail_path = thumbnails_dir.join(format!("thumb_{}", filename));

    // Check if thumbnail and metadata already exist and are newer than source
    let metadata_path = thumbnails_dir.join(format!("thumb_{}.meta", filename));

    if thumbnail_path.exists() && metadata_path.exists() {
        if let Ok(source_mtime) = fs::metadata(&path_buf).and_then(|m| m.modified()) {
            if let Ok(thumb_mtime) = fs::metadata(&thumbnail_path).and_then(|m| m.modified()) {
                if thumb_mtime > source_mtime {
                    // Thumbnail exists and is newer, load dimensions from metadata file
                    let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
                    let asset_url = format!("asset://{}", path_str);
                    let dimensions = fs::read_to_string(&metadata_path)
                        .ok()
                        .and_then(|meta| {
                            let parts: Vec<&str> = meta.split('x').collect();
                            if parts.len() == 2 {
                                let width = parts[0].parse::<u32>().ok()?;
                                let height = parts[1].parse::<u32>().ok()?;
                                Some(ImageDimensions { width, height })
                            } else {
                                None
                            }
                        });

                    // OPTIMIZATION: Verify EXIF DateTimeOriginal matches cached thumbnail
                    // If the photo was re-taken/re-edited, we need to regenerate the thumbnail
                    let cached_datetime_valid = if dimensions.is_some() {
                        let current_datetime: Option<String> = rexif::parse_file(image_path)
                            .ok()
                            .and_then(|exif_data| {
                                for entry in &exif_data.entries {
                                    if entry.tag == rexif::ExifTag::DateTimeOriginal {
                                        if let rexif::TagValue::Ascii(ref datetime_str) = entry.value {
                                            return Some(datetime_str.clone());
                                        }
                                    }
                                }
                                None::<String>
                            });

                        // Read cached datetime from thumbnail metadata
                        let cached_datetime_path = thumbnail_path.with_extension("jpg.datetime");
                        let cached_datetime: Option<String> = fs::read_to_string(&cached_datetime_path)
                            .ok();

                        // Check if datetimes match
                        let datetime_match = current_datetime == cached_datetime;
                        datetime_match
                    } else {
                        true // No dimension info means no check possible
                    };

                    if cached_datetime_valid {
                        return Ok(ThumbnailResult { thumbnail: asset_url, dimensions });
                    } else {
                        // Fall through to regenerate thumbnail
                    }
                }
            }
        }
    }

    // Check if this is a JPEG file
    let is_jpeg = path_buf
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg"))
        .unwrap_or(false);

    if is_jpeg {
        // OPTIMIZATION 1: Read JPEG file once
        let jpeg_data = fs::read(image_path)
            .map_err(|e| format!("Failed to read JPEG file: {}", e))?;

        // OPTIMIZATION 2: Get dimensions from mozjpeg header (no decoding needed)
        let decompress_dims = mozjpeg::Decompress::new_mem(&jpeg_data)
            .map_err(|e| format!("Failed to create mozjpeg decompressor: {}", e))?;

        // Get original dimensions directly from JPEG header (stored dimensions)
        let stored_width = decompress_dims.width() as u32;
        let stored_height = decompress_dims.height() as u32;

        // OPTIMIZATION 3: Read EXIF orientation from JPEG headers
        // We need this to determine if width/height should be swapped for display
        let exif_orientation_value = rexif::parse_file(image_path)
            .ok()
            .and_then(|exif_data| {
                for entry in &exif_data.entries {
                    if entry.tag == rexif::ExifTag::Orientation {
                        if let rexif::TagValue::U16(ref shorts) = entry.value {
                            return shorts.first().copied();
                        }
                    }
                }
                None
            });

        // EXIF orientations 5, 6, 7, 8 require swapping width/height for display dimensions
        // 5 = transpose, 6 = rotate 90 CW, 7 = transverse, 8 = rotate 270 CW
        let needs_dimension_swap = matches!(exif_orientation_value, Some(5) | Some(6) | Some(7) | Some(8));

        let (img_width, img_height) = if needs_dimension_swap {
            (stored_height, stored_width) // Swap for display
        } else {
            (stored_width, stored_height) // Use as-is
        };

        let dimensions = ImageDimensions {
            width: img_width,
            height: img_height,
        };

        // Step 4: Now do the actual fast decode with scaling
        let mut decompress = mozjpeg::Decompress::new_mem(&jpeg_data)
            .map_err(|e| format!("Failed to create mozjpeg decompressor: {}", e))?;

        let scale_num = 4; // 1/4 scale for faster processing
        decompress.scale(scale_num);

        let mut image = decompress.rgb()
            .map_err(|e| format!("Failed to decompress JPEG: {}", e))?;

        let scaled_width = image.width();
        let scaled_height = image.height();

        // Convert mozjpeg data to RGB image
        let img_data = image.read_scanlines()
            .map_err(|e| format!("Failed to read scanlines: {}", e))?;

        let rgb_img = image::RgbImage::from_raw(
            scaled_width as u32,
            scaled_height as u32,
            img_data
        ).ok_or("Failed to create image buffer")?;

        let mut dynamic_img = image::DynamicImage::ImageRgb8(rgb_img);

        // Apply EXIF rotation if needed (for proper thumbnails)
        if let Some(orientation) = exif_orientation_value {
            if orientation != 1 { // Only rotate if not normal
                dynamic_img = match orientation {
                    2 => {
                        // Flip horizontal
                        image::DynamicImage::ImageRgb8(
                            image::imageops::flip_horizontal(&dynamic_img.to_rgb8())
                        )
                    }
                    3 => dynamic_img.rotate180(),
                    4 => {
                        // Flip vertical
                        image::DynamicImage::ImageRgb8(
                            image::imageops::flip_vertical(&dynamic_img.to_rgb8())
                        )
                    }
                    5 => {
                        // Flip horizontal then rotate 270
                        let flipped = image::imageops::flip_horizontal(&dynamic_img.to_rgb8());
                        image::DynamicImage::ImageRgb8(flipped).rotate270()
                    }
                    6 => dynamic_img.rotate90(),  // 90° CW - common for portrait photos
                    7 => {
                        // Flip horizontal then rotate 90
                        let flipped = image::imageops::flip_horizontal(&dynamic_img.to_rgb8());
                        image::DynamicImage::ImageRgb8(flipped).rotate90()
                    }
                    8 => dynamic_img.rotate270(), // 90° CCW
                    _ => dynamic_img
                };
            }
        }

        // Resize to thumbnail size (200px max dimension)
        let max_dim = 200;
        let thumbnail = if dynamic_img.width() > max_dim || dynamic_img.height() > max_dim {
            let scale = max_dim as f32 / (dynamic_img.width().max(dynamic_img.height()) as f32);
            let new_width = (dynamic_img.width() as f32 * scale).round() as u32;
            let new_height = (dynamic_img.height() as f32 * scale).round() as u32;
            dynamic_img.resize(new_width, new_height, image::imageops::FilterType::Nearest)
        } else {
            dynamic_img
        };

        // Save thumbnail
        thumbnail.save_with_format(&thumbnail_path, image::ImageFormat::Jpeg)
            .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

        // Save dimensions to metadata
        let metadata_content = format!("{}x{}", dimensions.width, dimensions.height);
        let _ = fs::write(&metadata_path, metadata_content);

        // Save EXIF DateTimeOriginal for cache validation
        let datetime_original: Option<String> = rexif::parse_file(image_path)
            .ok()
            .and_then(|exif_data| {
                for entry in &exif_data.entries {
                    if entry.tag == rexif::ExifTag::DateTimeOriginal {
                        if let rexif::TagValue::Ascii(ref datetime_str) = entry.value {
                            return Some(datetime_str.clone());
                        }
                    }
                }
                None::<String>
            });

        if let Some(datetime) = datetime_original {
            let datetime_path = thumbnail_path.with_extension("jpg.datetime");
            let _ = fs::write(&datetime_path, datetime.clone());
        }

        let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
        let asset_url = format!("asset://{}", path_str);
        return Ok(ThumbnailResult { thumbnail: asset_url, dimensions: Some(dimensions) });
    }

    // Fallback for non-JPEG images (PNG, etc.)

    let img = image::ImageReader::open(image_path)
        .map_err(|e| format!("Failed to open image: {}", e))?
        .with_guessed_format()
        .map_err(|e| format!("Failed to guess format: {}", e))?
        .decode()
        .map_err(|e| format!("Failed to decode image: {}", e))?;

    let dimensions = ImageDimensions {
        width: img.width(),
        height: img.height(),
    };

    // Resize to thumbnail size (200px max dimension)
    let max_dim = 200;
    let thumbnail = if dimensions.width > max_dim || dimensions.height > max_dim {
        let scale = max_dim as f32 / dimensions.width.max(dimensions.height) as f32;
        let new_width = (dimensions.width as f32 * scale).round() as u32;
        let new_height = (dimensions.height as f32 * scale).round() as u32;
        img.resize(new_width, new_height, image::imageops::FilterType::Nearest) // Use Nearest for speed
    } else {
        img
    };

    thumbnail.save_with_format(&thumbnail_path, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    // Save dimensions to metadata
    let metadata_content = format!("{}x{}", dimensions.width, dimensions.height);
    let _ = fs::write(&metadata_path, metadata_content);

    let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
    let asset_url = format!("asset://{}", path_str);
    Ok(ThumbnailResult { thumbnail: asset_url, dimensions: Some(dimensions) })
}

// ==================== FRAME SYSTEM ====================

/// Get the frames directory path
fn get_frames_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let frames_dir = app_data_dir.join("frames");
    fs::create_dir_all(&frames_dir)
        .map_err(|e| format!("Failed to create frames dir: {}", e))?;

    Ok(frames_dir)
}

/// Initialize default frames on first run
fn initialize_default_frames(_app: &tauri::AppHandle) -> Result<(), String> {
    // No default frames - user creates their own
    Ok(())
}

/// Save a frame to disk
#[tauri::command]
async fn save_frame(app: tauri::AppHandle, frame: Frame) -> Result<Frame, String> {
    let frames_dir = get_frames_dir(&app)?;

    // Create frame with timestamp if not provided
    let frame_to_save = Frame {
        created_at: if frame.created_at.is_empty() {
            chrono::Utc::now().to_rfc3339()
        } else {
            frame.created_at
        },
        ..frame
    };

    let frame_path = frames_dir.join(format!("{}.json", frame_to_save.id));
    let json = serde_json::to_string_pretty(&frame_to_save)
        .map_err(|e| format!("Failed to serialize frame: {}", e))?;

    fs::write(frame_path, json)
        .map_err(|e| format!("Failed to write frame file: {}", e))?;

    Ok(frame_to_save)
}

/// Load all frames from disk
#[tauri::command]
async fn load_frames(app: tauri::AppHandle) -> Result<Vec<Frame>, String> {
    // Initialize default frames if needed
    initialize_default_frames(&app)?;

    let frames_dir = get_frames_dir(&app)?;
    let mut frames = Vec::new();

    let entries = fs::read_dir(frames_dir)
        .map_err(|e| format!("Failed to read frames directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let content = fs::read_to_string(&path)
                .map_err(|e| format!("Failed to read frame file: {}", e))?;

            let frame: Frame = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse frame JSON: {}", e))?;

            frames.push(frame);
        }
    }

    // Sort frames: default frames first, then by creation date
    frames.sort_by(|a, b| {
        match (a.is_default, b.is_default) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => b.created_at.cmp(&a.created_at),
        }
    });

    Ok(frames)
}

/// Delete a frame from disk
#[tauri::command]
async fn delete_frame(app: tauri::AppHandle, frame_id: String) -> Result<(), String> {
    let frames_dir = get_frames_dir(&app)?;
    let frame_path = frames_dir.join(format!("{}.json", frame_id));

    if !frame_path.exists() {
        return Err(format!("Frame not found: {}", frame_id));
    }

    fs::remove_file(frame_path)
        .map_err(|e| format!("Failed to delete frame: {}", e))?;

    Ok(())
}

/// Duplicate a frame (create a copy with a new ID)
#[tauri::command]
async fn duplicate_frame(app: tauri::AppHandle, frame_id: String) -> Result<Frame, String> {
    let frames_dir = get_frames_dir(&app)?;
    let frame_path = frames_dir.join(format!("{}.json", frame_id));

    if !frame_path.exists() {
        return Err(format!("Frame not found: {}", frame_id));
    }

    // Load the original frame
    let frame_content = fs::read_to_string(&frame_path)
        .map_err(|e| format!("Failed to read frame file: {}", e))?;
    let original: Frame = serde_json::from_str(&frame_content)
        .map_err(|e| format!("Failed to parse frame JSON: {}", e))?;

    // Create a new frame with a unique ID and is_default = false
    let duplicated = Frame {
        id: format!("custom-{}-{}",
            chrono::Utc::now().timestamp(),
            uuid::Uuid::new_v4().to_string().chars().take(8).collect::<String>()
        ),
        name: format!("{} (Copy)", original.name),
        description: original.description.clone(),
        width: original.width,
        height: original.height,
        zones: original.zones,
        thumbnail: original.thumbnail,
        is_default: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    // Save the duplicated frame
    let duplicated_path = frames_dir.join(format!("{}.json", duplicated.id));
    let json = serde_json::to_string_pretty(&duplicated)
        .map_err(|e| format!("Failed to serialize frame: {}", e))?;

    fs::write(duplicated_path, json)
        .map_err(|e| format!("Failed to write frame file: {}", e))?;

    Ok(duplicated)
}

// ==================== END FRAME SYSTEM ====================

// ==================== BACKGROUND SYSTEM ====================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Background {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub background_type: String, // "color", "gradient", "image"
    pub value: String, // hex color, gradient CSS, or asset path
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub created_at: String,
}

/// Get backgrounds directory in app data
fn get_backgrounds_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let backgrounds_dir = app_data_dir.join("backgrounds");
    fs::create_dir_all(&backgrounds_dir)
        .map_err(|e| format!("Failed to create backgrounds dir: {}", e))?;
    Ok(backgrounds_dir)
}

/// Initialize default backgrounds
fn initialize_default_backgrounds(app: &tauri::AppHandle) -> Result<(), String> {
    let backgrounds_dir = get_backgrounds_dir(&app)?;

    // Check if already initialized
    if backgrounds_dir.exists() && backgrounds_dir.read_dir().map_or(false, |mut entries| entries.next().is_some()) {
        return Ok(());
    }

    let default_backgrounds = vec![
        Background {
            id: "bg-white".to_string(),
            name: "Pure White".to_string(),
            description: "Clean white background".to_string(),
            background_type: "color".to_string(),
            value: "#ffffff".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Background {
            id: "bg-black".to_string(),
            name: "Pure Black".to_string(),
            description: "Solid black background".to_string(),
            background_type: "color".to_string(),
            value: "#000000".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Background {
            id: "bg-gray-light".to_string(),
            name: "Light Gray".to_string(),
            description: "Subtle light gray background".to_string(),
            background_type: "color".to_string(),
            value: "#f5f5f5".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Background {
            id: "bg-gray-dark".to_string(),
            name: "Dark Gray".to_string(),
            description: "Dark gray background".to_string(),
            background_type: "color".to_string(),
            value: "#2a2a2a".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Background {
            id: "bg-sunset".to_string(),
            name: "Sunset Gradient".to_string(),
            description: "Warm sunset gradient".to_string(),
            background_type: "gradient".to_string(),
            value: "linear-gradient(135deg, #ff6b6b 0%, #feca57 100%)".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Background {
            id: "bg-ocean".to_string(),
            name: "Ocean Gradient".to_string(),
            description: "Cool ocean gradient".to_string(),
            background_type: "gradient".to_string(),
            value: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Background {
            id: "bg-forest".to_string(),
            name: "Forest Gradient".to_string(),
            description: "Natural forest gradient".to_string(),
            background_type: "gradient".to_string(),
            value: "linear-gradient(135deg, #11998e 0%, #38ef7d 100%)".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
    ];

    // Save default backgrounds
    for bg in default_backgrounds {
        let bg_path = backgrounds_dir.join(format!("{}.json", bg.id));
        let json = serde_json::to_string_pretty(&bg)
            .map_err(|e| format!("Failed to serialize background: {}", e))?;
        fs::write(bg_path, json)
            .map_err(|e| format!("Failed to write background file: {}", e))?;
    }

    Ok(())
}

/// Save a background to disk
#[tauri::command]
async fn save_background(app: tauri::AppHandle, background: Background) -> Result<Background, String> {
    let backgrounds_dir = get_backgrounds_dir(&app)?;

    // Create background with timestamp if not provided
    let bg_to_save = Background {
        created_at: if background.created_at.is_empty() {
            chrono::Utc::now().to_rfc3339()
        } else {
            background.created_at
        },
        ..background
    };

    let bg_path = backgrounds_dir.join(format!("{}.json", bg_to_save.id));
    let json = serde_json::to_string_pretty(&bg_to_save)
        .map_err(|e| format!("Failed to serialize background: {}", e))?;

    fs::write(bg_path, json)
        .map_err(|e| format!("Failed to write background file: {}", e))?;

    Ok(bg_to_save)
}

/// Load all backgrounds from disk
#[tauri::command]
async fn load_backgrounds(app: tauri::AppHandle) -> Result<Vec<Background>, String> {
    // Initialize default backgrounds if needed
    initialize_default_backgrounds(&app)?;

    let backgrounds_dir = get_backgrounds_dir(&app)?;
    let mut backgrounds = Vec::new();

    let entries = fs::read_dir(backgrounds_dir)
        .map_err(|e| format!("Failed to read backgrounds directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        let json = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read background file: {}", e))?;

        let background: Background = serde_json::from_str(&json)
            .map_err(|e| format!("Failed to parse background file: {}", e))?;

        backgrounds.push(background);
    }

    // Sort: defaults first, then by date
    backgrounds.sort_by(|a, b| {
        match (a.is_default, b.is_default) {
            (true, false) => std::cmp::Ordering::Less,
            (false, true) => std::cmp::Ordering::Greater,
            _ => b.created_at.cmp(&a.created_at),
        }
    });

    Ok(backgrounds)
}

/// Delete a background from disk
#[tauri::command]
async fn delete_background(app: tauri::AppHandle, background_id: String) -> Result<(), String> {
    let backgrounds_dir = get_backgrounds_dir(&app)?;
    let bg_path = backgrounds_dir.join(format!("{}.json", background_id));

    if !bg_path.exists() {
        return Err(format!("Background not found: {}", background_id));
    }

    // Prevent deleting default backgrounds
    let json = fs::read_to_string(&bg_path)
        .map_err(|e| format!("Failed to read background file: {}", e))?;
    let background: Background = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse background file: {}", e))?;

    if background.is_default {
        return Err("Cannot delete default backgrounds".to_string());
    }

    // Delete the image file if it's an imported image
    if background.background_type == "image" && background.value.starts_with("asset://") {
        // Convert asset:// URL back to file path
        let image_path_str = background.value.trim_start_matches("asset://");
        let image_path = std::path::PathBuf::from(image_path_str);

        if image_path.exists() {
            fs::remove_file(&image_path)
                .map_err(|e| format!("Failed to delete background image: {}", e))?;
        }

        // Delete the thumbnail if it exists
        if let Some(thumbnail_url) = &background.thumbnail {
            if thumbnail_url.starts_with("asset://") {
                let thumb_path_str = thumbnail_url.trim_start_matches("asset://");
                let thumb_path = std::path::PathBuf::from(thumb_path_str);

                if thumb_path.exists() {
                    fs::remove_file(&thumb_path)
                        .map_err(|e| format!("Failed to delete background thumbnail: {}", e))?;
                }
            }
        }
    }

    // Delete the JSON metadata file
    fs::remove_file(bg_path)
        .map_err(|e| format!("Failed to delete background metadata: {}", e))?;

    Ok(())
}

/// Import a background from a file
#[tauri::command]
async fn import_background(app: tauri::AppHandle, file_path: String, name: String) -> Result<Background, String> {
    use image::ImageFormat;

    let path_buf = std::path::PathBuf::from(&file_path);
    let extension = path_buf.extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Generate unique ID
    let id = format!("bg-{}", uuid::Uuid::new_v4());

    // Copy image to backgrounds directory
    let backgrounds_dir = get_backgrounds_dir(&app)?;
    let dest_filename = format!("{}.{}", id, extension);
    let dest_path = backgrounds_dir.join(&dest_filename);

    fs::copy(&path_buf, &dest_path)
        .map_err(|e| format!("Failed to copy background image: {}", e))?;

    // Generate thumbnail
    let thumbnail_path = backgrounds_dir.join(format!("thumb_{}", dest_filename));
    if let Ok(img) = image::open(&dest_path) {
        let thumbnail = img.resize(200, 200, image::imageops::FilterType::Lanczos3);
        thumbnail.save_with_format(&thumbnail_path, ImageFormat::Jpeg)
            .ok();
    }

    let path_str = dest_path.to_string_lossy().replace('\\', "/");
    let thumb_str = thumbnail_path.to_string_lossy().replace('\\', "/");
    let asset_url = format!("asset://{}", path_str);
    let thumbnail_url = format!("asset://{}", thumb_str);

    let background = Background {
        id: id.clone(),
        name: name.clone(),
        description: format!("Imported from {}", path_buf.file_name().and_then(|n| n.to_str()).unwrap_or("unknown")),
        background_type: "image".to_string(),
        value: asset_url,
        thumbnail: Some(thumbnail_url),
        is_default: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    // Save metadata
    let bg_meta_path = backgrounds_dir.join(format!("{}.json", id));
    let json = serde_json::to_string_pretty(&background)
        .map_err(|e| format!("Failed to serialize background: {}", e))?;
    fs::write(bg_meta_path, json)
        .map_err(|e| format!("Failed to write background metadata: {}", e))?;

    Ok(background)
}

// ==================== END BACKGROUND SYSTEM ====================

// ==================== CUSTOM CANVAS SIZE SYSTEM ====================

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct CustomCanvasSize {
    pub width: u32,
    pub height: u32,
    pub name: String,
    #[serde(default)]
    pub created_at: u64, // Unix timestamp
}

/// Get custom canvas sizes directory in app data
fn get_custom_canvases_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let canvases_dir = app_data_dir.join("custom_canvases");
    fs::create_dir_all(&canvases_dir)
        .map_err(|e| format!("Failed to create custom canvases dir: {}", e))?;
    Ok(canvases_dir)
}

/// Save a custom canvas size to disk
#[tauri::command]
async fn save_custom_canvas_size(app: tauri::AppHandle, canvas: CustomCanvasSize) -> Result<CustomCanvasSize, String> {
    let canvases_dir = get_custom_canvases_dir(&app)?;

    // Create canvas with timestamp if not provided
    let canvas_to_save = CustomCanvasSize {
        created_at: if canvas.created_at == 0 {
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|e| format!("Failed to get timestamp: {}", e))?
                .as_secs()
        } else {
            canvas.created_at
        },
        ..canvas
    };

    let canvas_path = canvases_dir.join(format!("{}.json", canvas_to_save.name));
    let json = serde_json::to_string_pretty(&canvas_to_save)
        .map_err(|e| format!("Failed to serialize canvas: {}", e))?;

    fs::write(canvas_path, json)
        .map_err(|e| format!("Failed to write canvas file: {}", e))?;

    Ok(canvas_to_save)
}

/// Get all custom canvas sizes from disk
#[tauri::command]
async fn get_custom_canvas_sizes(app: tauri::AppHandle) -> Result<Vec<CustomCanvasSize>, String> {
    let canvases_dir = get_custom_canvases_dir(&app)?;
    let mut canvases = Vec::new();

    if !canvases_dir.exists() {
        return Ok(canvases);
    }

    let entries = fs::read_dir(canvases_dir)
        .map_err(|e| format!("Failed to read custom canvases directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        let json = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read canvas file: {}", e))?;

        let canvas: CustomCanvasSize = serde_json::from_str(&json)
            .map_err(|e| format!("Failed to parse canvas file: {}", e))?;

        canvases.push(canvas);
    }

    // Sort by creation date (newest first)
    canvases.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(canvases)
}

/// Delete a custom canvas size from disk
#[tauri::command]
async fn delete_custom_canvas_size(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let canvases_dir = get_custom_canvases_dir(&app)?;
    let canvas_path = canvases_dir.join(format!("{}.json", name));

    if !canvas_path.exists() {
        return Err(format!("Custom canvas not found: {}", name));
    }

    fs::remove_file(canvas_path)
        .map_err(|e| format!("Failed to delete canvas: {}", e))?;

    Ok(())
}

// ==================== END CUSTOM CANVAS SIZE SYSTEM ====================

// ==================== APP SETTINGS SYSTEM ====================

/// Get app settings directory in app data
fn get_settings_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data_dir)
}

/// Save an app setting (key-value pair stored as a JSON file)
#[tauri::command]
async fn save_app_setting(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let settings_dir = get_settings_dir(&app)?;
    let setting_path = settings_dir.join(format!("setting_{}.json", key));

    let setting_data = serde_json::json!({ "value": value });
    let json = serde_json::to_string_pretty(&setting_data)
        .map_err(|e| format!("Failed to serialize setting: {}", e))?;

    fs::write(setting_path, json)
        .map_err(|e| format!("Failed to write setting file: {}", e))?;

    Ok(())
}

/// Get an app setting by key (returns null if not found)
#[tauri::command]
async fn get_app_setting(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let settings_dir = get_settings_dir(&app)?;
    let setting_path = settings_dir.join(format!("setting_{}.json", key));

    if !setting_path.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(setting_path)
        .map_err(|e| format!("Failed to read setting file: {}", e))?;

    let setting_data: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse setting file: {}", e))?;

    let value = setting_data.get("value")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(value)
}

// ==================== END APP SETTINGS SYSTEM ====================

// ==================== PHOTOBOOTH SESSION SYSTEM ====================

/// Individual photobooth session info
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct PhotoboothSessionInfo {
    id: String,
    name: String,
    folder_name: String,
    shot_count: u32,
    created_at: String,
    last_used_at: String,
    thumbnails: Vec<String>, // Thumbnail URLs for the session's photos
}

/// Photo entry in the .ptb session file
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct PtbPhoto {
    filename: String,
    original_path: String,
    camera_path: String,
    captured_at: String,
}

/// Session data in the .ptb file
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct PtbSessionData {
    id: String,
    name: String,
    folder_name: String,
    created_at: String,
    last_used_at: String,
    shot_count: u32,
    photos: Vec<PtbPhoto>,
}

/// Root .ptb file structure - stored at working folder root
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
struct PtbWorkspace {
    name: String,
    created_at: String,
    last_used_at: String,
    current_session_id: Option<String>,
    sessions: Vec<PtbSessionData>,
}

/// Scan for existing session folders on disk and import them into the workspace
/// Session folders are named like: {base_name}_001, {base_name}_002, etc.
fn scan_existing_sessions(folder_path: &str) -> Vec<PtbSessionData> {
    let mut sessions = Vec::new();

    let folder = std::path::Path::new(folder_path);
    let base_name = folder.file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Session");

    // Read all entries in the folder
    if let Ok(entries) = fs::read_dir(folder) {
        for entry in entries.flatten() {
            let path = entry.path();

            // Skip if not a directory or if it's hidden (starts with .)
            if !path.is_dir() || path.file_name()
                .and_then(|n| n.to_str())
                .map(|s| s.starts_with('.'))
                .unwrap_or(false) {
                continue;
            }

            // Check if folder name matches the pattern {base_name}_XXX
            if let Some(folder_name) = path.file_name().and_then(|n| n.to_str()) {
                if folder_name.starts_with(&format!("{}_", base_name)) {
                    // Extract the number part
                    if let Some(num_str) = folder_name.split('_').last() {
                        if num_str.parse::<u32>().is_ok() {
                            // This looks like a session folder, try to load its session data
                            let session_json_path = path.join(".session.json");

                            let session_data = if session_json_path.exists() {
                                // Load from .session.json if it exists
                                fs::read_to_string(&session_json_path)
                                    .ok()
                                    .and_then(|content| serde_json::from_str::<PtbSessionData>(&content).ok())
                            } else {
                                // Create minimal session data from folder metadata
                                path.metadata().ok().and_then(|metadata| {
                                    Some(PtbSessionData {
                                        id: folder_name.to_string(),
                                        name: format!("Session {}", num_str),
                                        folder_name: folder_name.to_string(),
                                        created_at: metadata.created()
                                            .ok()
                                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                            .and_then(|d| {
                                                chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                                                    .map(|dt| dt.to_rfc3339())
                                            })
                                            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                                        last_used_at: metadata.modified()
                                            .ok()
                                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                            .and_then(|d| {
                                                chrono::DateTime::from_timestamp(d.as_secs() as i64, 0)
                                                    .map(|dt| dt.to_rfc3339())
                                            })
                                            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                                        shot_count: 0,
                                        photos: Vec::new(),
                                    })
                                })
                            };

                            if let Some(data) = session_data {
                                println!("[scan_existing_sessions] Found existing session: {}", folder_name);
                                sessions.push(data);
                            }
                        }
                    }
                }
            }
        }
    }

    // Sort by folder name (which includes the number)
    sessions.sort_by(|a, b| a.folder_name.cmp(&b.folder_name));

    sessions
}

/// Load or create .ptb workspace file at root level
/// Returns (workspace, was_created) where was_created indicates if a new file was created
async fn load_ptb_workspace_internal(folder_path: String) -> Result<(PtbWorkspace, bool), String> {
    let ptb_path = std::path::Path::new(&folder_path).join(".ptb");

    if ptb_path.exists() {
        let content = fs::read_to_string(&ptb_path)
            .map_err(|e| format!("Failed to read .ptb file: {}", e))?;
        let workspace: PtbWorkspace = serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse .ptb file: {}", e))?;
        println!("[load_ptb_workspace_internal] Loaded existing .ptb file with {} sessions", workspace.sessions.len());
        for session in &workspace.sessions {
            println!("[load_ptb_workspace_internal] - Session: id={}, folderName={}", session.id, session.folder_name);
        }
        Ok((workspace, false))
    } else {
        // Create a new workspace, but first scan for existing session folders
        let existing_sessions = scan_existing_sessions(&folder_path);

        let now = chrono::Utc::now().to_rfc3339();
        let workspace = PtbWorkspace {
            name: "Photobooth Workspace".to_string(),
            created_at: now.clone(),
            last_used_at: now,
            current_session_id: existing_sessions.first().map(|s| s.id.clone()),
            sessions: existing_sessions,
        };

        // Save the new workspace to disk
        let json = serde_json::to_string_pretty(&workspace)
            .map_err(|e| format!("Failed to serialize .ptb workspace: {}", e))?;
        fs::write(&ptb_path, json)
            .map_err(|e| format!("Failed to write .ptb file: {}", e))?;

        println!("[load_ptb_workspace_internal] Created new .ptb file at: {:?} with {} existing sessions",
                 ptb_path, workspace.sessions.len());
        Ok((workspace, true))
    }
}

/// Load or create .ptb workspace file at root level (Tauri command wrapper)
#[tauri::command]
async fn load_ptb_workspace(folder_path: String) -> Result<PtbWorkspace, String> {
    load_ptb_workspace_internal(folder_path).await.map(|(w, _)| w)
}

/// Save .ptb workspace file at root level
#[tauri::command]
async fn save_ptb_workspace(folder_path: String, workspace: PtbWorkspace) -> Result<(), String> {
    let ptb_path = std::path::Path::new(&folder_path).join(".ptb");

    let workspace_to_save = PtbWorkspace {
        last_used_at: chrono::Utc::now().to_rfc3339(),
        ..workspace
    };

    let json = serde_json::to_string_pretty(&workspace_to_save)
        .map_err(|e| format!("Failed to serialize .ptb workspace: {}", e))?;

    fs::write(&ptb_path, json)
        .map_err(|e| format!("Failed to write .ptb file: {}", e))?;

    Ok(())
}

/// Convert PtbSessionData to PhotoboothSessionInfo (without thumbnails - for internal use)
fn ptb_session_to_info(session: &PtbSessionData) -> PhotoboothSessionInfo {
    PhotoboothSessionInfo {
        id: session.id.clone(),
        name: session.name.clone(),
        folder_name: session.folder_name.clone(),
        shot_count: session.shot_count,
        created_at: session.created_at.clone(),
        last_used_at: session.last_used_at.clone(),
        thumbnails: Vec::new(), // Empty thumbnails for simple conversion
    }
}

/// Convert PtbSessionData to PhotoboothSessionInfo with thumbnail generation
async fn ptb_session_to_info_with_thumbnails(
    session: &PtbSessionData,
    folder_path: &str,
    app: &tauri::AppHandle,
) -> PhotoboothSessionInfo {
    // Generate thumbnails for each photo
    let mut thumbnails = Vec::new();

    // If photos array is empty but shotCount > 0, scan the session folder for images
    // This handles sessions created before photo tracking was implemented
    let photo_entries = if session.photos.is_empty() && session.shot_count > 0 {
        let session_folder = std::path::PathBuf::from(folder_path).join(&session.folder_name);

        // Scan for image files in the session folder
        let mut found_photos = Vec::new();
        if let Ok(entries) = fs::read_dir(&session_folder) {
            let mut image_files: Vec<(String, std::path::PathBuf)> = Vec::new();

            for entry in entries.filter_map(|e| e.ok()) {
                let path = entry.path();
                let is_image = path.extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| {
                        ext.eq_ignore_ascii_case("jpg") ||
                        ext.eq_ignore_ascii_case("jpeg") ||
                        ext.eq_ignore_ascii_case("png")
                    })
                    .unwrap_or(false);

                if is_image {
                    if let Some(filename) = path.file_name().and_then(|n| n.to_str()) {
                        image_files.push((filename.to_string(), path.clone()));
                    }
                }
            }

            // Sort by filename to ensure consistent ordering
            image_files.sort_by(|a, b| a.0.cmp(&b.0));

            for (filename, _) in image_files {
                found_photos.push(filename);
            }
        }
        found_photos
    } else {
        session.photos.iter().map(|p| p.filename.clone()).collect()
    };

    // Generate thumbnails for each photo entry
    for filename in &photo_entries {
        let full_path = format!("{}/{}/{}", folder_path, session.folder_name, filename);
        match generate_cached_thumbnail_high_res(&full_path, app).await {
            Ok(result) => thumbnails.push(result.thumbnail),
            Err(_) => {
                // If thumbnail generation fails, use the original path as fallback
                // Prefix with asset:// to match the format from successful thumbnail generation
                let fallback_path = full_path.replace('\\', "/");
                thumbnails.push(format!("asset://{}", fallback_path));
            }
        }
    }

    PhotoboothSessionInfo {
        id: session.id.clone(),
        name: session.name.clone(),
        folder_name: session.folder_name.clone(),
        shot_count: session.shot_count,
        created_at: session.created_at.clone(),
        last_used_at: session.last_used_at.clone(),
        thumbnails,
    }
}

/// List all sessions from the .ptb file with thumbnails
/// Returns (sessions, was_ptb_created) where was_ptb_created indicates if a new .ptb file was created
#[tauri::command]
async fn list_photobooth_sessions(folder_path: String, app: tauri::AppHandle) -> Result<(Vec<PhotoboothSessionInfo>, bool), String> {
    let (workspace, was_created) = load_ptb_workspace_internal(folder_path.clone()).await?;

    // Convert sessions to info format with thumbnails (in parallel for performance)
    let sessions_futures: Vec<_> = workspace.sessions
        .iter()
        .map(|session| ptb_session_to_info_with_thumbnails(session, &folder_path, &app))
        .collect();

    // Wait for all thumbnail generation to complete
    let sessions = futures::future::join_all(sessions_futures).await;

    // Sort by creation date (newest first)
    let mut sorted_sessions = sessions;
    sorted_sessions.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok((sorted_sessions, was_created))
}

/// Create a new photobooth session folder
/// Session folders are named like: Myshoot_001, Myshoot_002, etc.
#[tauri::command]
async fn create_photobooth_session(
    folder_path: String,
    session_name: String,
) -> Result<PhotoboothSessionInfo, String> {
    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    // Get the base name from the working folder (e.g., "Myshoot" from "C:\Photos\Myshoot")
    let base_name = std::path::Path::new(&folder_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Session");

    // Find the next available session number
    let mut next_num = 1;
    println!("[create_photobooth_session] Looking for sessions starting with '{}_'", base_name);
    println!("[create_photobooth_session] Total sessions in workspace: {}", workspace.sessions.len());
    for session in &workspace.sessions {
        println!("[create_photobooth_session] Checking session: folder_name='{}'", session.folder_name);
        if session.folder_name.starts_with(&format!("{}_", base_name)) {
            // Extract number from folder name like "Myshoot_001"
            if let Some(num_str) = session.folder_name.split('_').last() {
                println!("[create_photobooth_session] Found number part: '{}'", num_str);
                if let Ok(num) = num_str.parse::<u32>() {
                    println!("[create_photobooth_session] Parsed number: {}, current next_num: {}", num, next_num);
                    if num >= next_num {
                        next_num = num + 1;
                        println!("[create_photobooth_session] Updated next_num to: {}", next_num);
                    }
                }
            }
        }
    }
    println!("[create_photobooth_session] Final next_num: {}, will create session: {}", next_num, format!("{}_{:03}", base_name, next_num));

    let session_id = format!("{}_{:03}", base_name, next_num);

    // Create session folder
    let session_folder = std::path::Path::new(&folder_path).join(&session_id);
    fs::create_dir_all(&session_folder)
        .map_err(|e| format!("Failed to create session folder: {}", e))?;

    // Create session data
    let now = chrono::Utc::now().to_rfc3339();
    let session_data = PtbSessionData {
        id: session_id.clone(),
        name: session_name.clone(),
        folder_name: session_id.clone(),
        created_at: now.clone(),
        last_used_at: now.clone(),
        shot_count: 0,
        photos: Vec::new(),
    };

    // Create session info
    let session_info = ptb_session_to_info(&session_data);

    // Add to workspace and save
    workspace.sessions.push(session_data);
    workspace.current_session_id = Some(session_info.id.clone());
    save_ptb_workspace(folder_path, workspace).await?;

    Ok(session_info)
}

/// Get the current active session
#[tauri::command]
async fn get_current_session(folder_path: String) -> Result<Option<PhotoboothSessionInfo>, String> {
    let (workspace, _) = load_ptb_workspace_internal(folder_path).await?;

    if let Some(session_id) = workspace.current_session_id {
        if let Some(session) = workspace.sessions.iter().find(|s| s.id == session_id) {
            return Ok(Some(ptb_session_to_info(session)));
        }
    }

    // If no current session, get the most recent one
    if let Some(session) = workspace.sessions.first() {
        Ok(Some(ptb_session_to_info(session)))
    } else {
        Ok(None)
    }
}

/// Set the current active session
#[tauri::command]
async fn set_current_session(folder_path: String, session_id: String) -> Result<(), String> {
    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    // Verify session exists
    if workspace.sessions.iter().any(|s| s.id == session_id) {
        workspace.current_session_id = Some(session_id);
        save_ptb_workspace(folder_path, workspace).await?;
        Ok(())
    } else {
        Err(format!("Session not found: {}", session_id))
    }
}

/// Get full session data including photos
#[tauri::command]
async fn get_session_data(folder_path: String, session_id: String) -> Result<PtbSessionData, String> {
    let (workspace, _) = load_ptb_workspace_internal(folder_path).await?;

    if let Some(session) = workspace.sessions.iter().find(|s| s.id == session_id) {
        Ok(session.clone())
    } else {
        Err(format!("Session not found: {}", session_id))
    }
}

// ==================== END PHOTOBOOTH SESSION SYSTEM ====================

// ==================== PHOTO SAVING FUNCTIONS ====================

/// Save photo data to session folder and update root .ptb file
/// Photos are saved to: {working_folder}/{session_id}/{filename}
#[tauri::command]
async fn save_photo_to_working_folder(
    folder_path: String,
    session_id: String,
    filename: String,
    photo_data: Vec<u8>,
    camera_path: String,
    original_daemon_path: String,
) -> Result<PtbSessionData, String> {
    // Build the session folder path
    let session_folder = std::path::Path::new(&folder_path).join(&session_id);

    // Ensure session folder exists
    if !session_folder.exists() {
        fs::create_dir_all(&session_folder)
            .map_err(|e| format!("Failed to create session folder: {}", e))?;
    }

    // Save the photo file in the session folder
    let photo_path = session_folder.join(&filename);
    fs::write(&photo_path, &photo_data)
        .map_err(|e| format!("Failed to write photo file: {}", e))?;

    // Load workspace, update session, and save
    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    // Find and update the session
    let updated_session = if let Some(session) = workspace.sessions.iter_mut().find(|s| s.id == session_id) {
        let photo_entry = PtbPhoto {
            filename: filename.clone(),
            original_path: original_daemon_path,
            camera_path,
            captured_at: chrono::Utc::now().to_rfc3339(),
        };
        session.photos.push(photo_entry);
        session.shot_count = session.photos.len() as u32;
        session.last_used_at = chrono::Utc::now().to_rfc3339();

        Some(session.clone())
    } else {
        return Err(format!("Session not found: {}", session_id));
    };

    // Save updated workspace
    save_ptb_workspace(folder_path, workspace).await?;

    Ok(updated_session.unwrap())
}

/// Download photo directly from daemon and save to session folder
/// This is much faster than passing binary data through JS/IPC
/// Photos are saved to: {working_folder}/{session_id}/{filename}
#[tauri::command]
async fn download_photo_from_daemon(
    daemon_url: String,
    folder_path: String,
    session_id: String,
    filename: String,
    camera_path: String,
    original_daemon_path: String,
    photo_naming_scheme: String,
) -> Result<PtbSessionData, String> {
    println!("[Rust::download_photo_from_daemon] START");
    println!("[Rust::download_photo_from_daemon] daemon_url: {}", daemon_url);
    println!("[Rust::download_photo_from_daemon] folder_path: {}", folder_path);
    println!("[Rust::download_photo_from_daemon] session_id: {}", session_id);
    println!("[Rust::download_photo_from_daemon] filename: {}", filename);
    println!("[Rust::download_photo_from_daemon] camera_path: {}", camera_path);
    println!("[Rust::download_photo_from_daemon] original_daemon_path: {}", original_daemon_path);
    println!("[Rust::download_photo_from_daemon] photo_naming_scheme: {}", photo_naming_scheme);

    // Download photo directly from daemon
    let photo_url = format!("{}/api/photo/{}", daemon_url, filename);
    println!("[Rust::download_photo_from_daemon] photo_url: {}", photo_url);

    let client = reqwest::Client::new();
    let response = client.get(&photo_url)
        .send()
        .await
        .map_err(|e| {
            println!("[Rust::download_photo_from_daemon] ERROR: Failed to fetch photo from daemon: {}", e);
            format!("Failed to fetch photo from daemon: {}", e)
        })?;

    println!("[Rust::download_photo_from_daemon] response status: {}", response.status());

    if !response.status().is_success() {
        println!("[Rust::download_photo_from_daemon] ERROR: Daemon returned non-success status");
        return Err(format!("Daemon returned error: {}", response.status()));
    }

    let photo_data = response.bytes()
        .await
        .map_err(|e| {
            println!("[Rust::download_photo_from_daemon] ERROR: Failed to read photo data: {}", e);
            format!("Failed to read photo data: {}", e)
        })?;

    println!("[Rust::download_photo_from_daemon] photo_data size: {} bytes", photo_data.len());

    // Load workspace first to determine the next photo number
    println!("[Rust::download_photo_from_daemon] Loading workspace to determine photo number");
    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;
    println!("[Rust::download_photo_from_daemon] Workspace loaded, sessions count: {}", workspace.sessions.len());

    // Find the session and determine the next photo number
    let (next_photo_num, session_folder) = if let Some(session) = workspace.sessions.iter().find(|s| s.id == session_id) {
        let next_num = session.photos.len() + 1;
        let folder = std::path::Path::new(&folder_path).join(&session.folder_name);
        println!("[Rust::download_photo_from_daemon] Session found: {}, next photo number: {}", session.name, next_num);
        (next_num, folder)
    } else {
        println!("[Rust::download_photo_from_daemon] ERROR: Session not found: {}", session_id);
        return Err(format!("Session not found: {}", session_id));
    };

    // Ensure session folder exists
    if !session_folder.exists() {
        println!("[Rust::download_photo_from_daemon] Creating session folder");
        fs::create_dir_all(&session_folder)
            .map_err(|e| format!("Failed to create session folder: {}", e))?;
    }

    // Generate custom filename using the naming scheme
    // Default to "photo_{number}" if scheme is empty
    let scheme = if photo_naming_scheme.is_empty() {
        "photo_{number}"
    } else {
        photo_naming_scheme.as_str()
    };

    let extension = std::path::Path::new(&filename)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("jpg");

    // Replace {number} placeholder with 4-digit zero-padded number
    let custom_filename = scheme.replace("{number}", &format!("{:04}", next_photo_num));

    // Add extension if not already present in the scheme
    let custom_filename = if custom_filename.contains('.') {
        custom_filename
    } else {
        format!("{}.{}", custom_filename, extension)
    };

    println!("[Rust::download_photo_from_daemon] Generated custom filename: {}", custom_filename);

    // Save the photo file with the custom name
    let custom_photo_path = session_folder.join(&custom_filename);
    fs::write(&custom_photo_path, &photo_data)
        .map_err(|e| {
            println!("[Rust::download_photo_from_daemon] ERROR: Failed to write photo file: {}", e);
            format!("Failed to write photo file: {}", e)
        })?;
    println!("[Rust::download_photo_from_daemon] Photo file written with custom name: {:?}", custom_photo_path);

    // Find and update the session
    let updated_session = if let Some(session) = workspace.sessions.iter_mut().find(|s| s.id == session_id) {
        println!("[Rust::download_photo_from_daemon] Found session, adding photo entry");
        let photo_entry = PtbPhoto {
            filename: custom_filename.clone(),
            original_path: original_daemon_path,
            camera_path,
            captured_at: chrono::Utc::now().to_rfc3339(),
        };
        session.photos.push(photo_entry);
        session.shot_count = session.photos.len() as u32;
        session.last_used_at = chrono::Utc::now().to_rfc3339();
        println!("[Rust::download_photo_from_daemon] Session updated, shot_count: {}", session.shot_count);

        Some(session.clone())
    } else {
        println!("[Rust::download_photo_from_daemon] ERROR: Session not found: {}", session_id);
        return Err(format!("Session not found: {}", session_id));
    };

    // Save updated workspace
    println!("[Rust::download_photo_from_daemon] Saving workspace");
    save_ptb_workspace(folder_path, workspace).await?;
    println!("[Rust::download_photo_from_daemon] Workspace saved successfully");

    // Delete photo from daemon after successful download to prevent duplicate filename conflicts on camera restart
    let delete_url = format!("{}/api/photo/{}", daemon_url, filename);
    match client.delete(&delete_url).send().await {
        Ok(resp) if resp.status().is_success() => {
            println!("[Rust::download_photo_from_daemon] Deleted photo from daemon: {}", filename);
        }
        Ok(resp) => {
            eprintln!("[Rust::download_photo_from_daemon] WARN: Failed to delete photo from daemon (status {}): {}", resp.status(), filename);
        }
        Err(e) => {
            eprintln!("[Rust::download_photo_from_daemon] WARN: Failed to delete photo from daemon: {} - {}", filename, e);
        }
    }

    println!("[Rust::download_photo_from_daemon] END - returning session");
    Ok(updated_session.unwrap())
}

// ==================== VM LOGS ====================

#[derive(Serialize, Deserialize)]
pub struct VmLogsResponse {
    pub logs: Vec<String>,
    #[serde(alias = "lineCount")]
    pub line_count: usize,
}

/// Read the VM console log file
/// In dev mode, reads from linux-build/vbox-console.log
/// In prod mode, path will be configured via app settings
#[tauri::command]
async fn get_vm_logs(lines: Option<usize>) -> Result<VmLogsResponse, String> {
    let num_lines = lines.unwrap_or(100).min(1000); // Max 1000 lines

    // Get the current executable's directory to resolve relative paths
    let exe_dir = std::env::current_dir()
        .map_err(|e| format!("Failed to get current directory: {}", e))?;

    // Try to find the log file in multiple possible locations
    let mut possible_paths: Vec<PathBuf> = vec![
        // Dev mode: in the linux-build folder (relative to exe dir)
        exe_dir.join("linux-build").join("vbox-console.log"),
        exe_dir.join("../linux-build").join("vbox-console.log"),
        // Also try parent directory (for dev builds)
        exe_dir.join("../../linux-build").join("vbox-console.log"),
    ];

    // In development, also try the project root (up from src-tauri/target/debug)
    if cfg!(debug_assertions) {
        if let Ok(mut path) = std::env::current_exe() {
            // Go up from target/debug to project root
            path.pop(); // debug
            path.pop(); // target
            possible_paths.push(path.join("linux-build").join("vbox-console.log"));
            // Also try from src-tauri
            path.pop(); // src-tauri
            possible_paths.push(path.join("linux-build").join("vbox-console.log"));
        }
    }

    // Try to find and read the log file
    let mut log_content: Option<String> = None;
    let mut found_path = None;

    for path in &possible_paths {
        if path.exists() {
            match fs::read_to_string(&path) {
                Ok(content) => {
                    log_content = Some(content);
                    found_path = Some(path.clone());
                    break;
                }
                Err(e) => {
                    eprintln!("[get_vm_logs] Found path but failed to read {:?}: {}", path, e);
                    continue;
                }
            }
        }
    }

    let log_content = match log_content {
        Some(content) => content,
        None => {
            // If no log file found, return helpful error message with searched paths
            let paths_str: Vec<String> = possible_paths.iter()
                .map(|p| p.display().to_string())
                .collect();
            eprintln!("[get_vm_logs] No log file found. Searched paths:");
            for p in &paths_str {
                eprintln!("  - {}", p);
            }
            return Ok(VmLogsResponse {
                logs: vec![
                    "No log file found. The VM may not be running.".to_string(),
                    format!("Current directory: {:?}", exe_dir.display()),
                    format!("Searched {} possible locations.", possible_paths.len()),
                ],
                line_count: 0,
            });
        }
    };

    // Get the last N lines
    let log_lines: Vec<String> = log_content
        .lines()
        .rev()
        .take(num_lines)
        .map(|s: &str| s.to_string())
        .collect();

    // Reverse back to original order
    let mut log_lines: Vec<String> = log_lines.into_iter().rev().collect();
    let line_count = log_lines.len();

    Ok(VmLogsResponse {
        logs: log_lines,
        line_count,
    })
}

/// Check if the VM is online by pinging the health endpoint
/// Returns true if the VM daemon is responding
#[tauri::command]
async fn check_vm_online() -> Result<bool, String> {
    const DAEMON_URL: &str = "http://localhost:58321/api/health";
    const HEALTH_TIMEOUT_MS: u64 = 2000; // 2 second timeout

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(HEALTH_TIMEOUT_MS))
        .build()
        .map_err(|e| format!("Failed to create HTTP client: {}", e))?;

    let response = client
        .get(DAEMON_URL)
        .send()
        .await;

    match response {
        Ok(resp) => {
            let is_online = resp.status().is_success();
            Ok(is_online)
        }
        Err(e) => {
            Ok(false)
        }
    }
}

/// Restart the VirtualBox VM
/// Force stops the VM immediately and starts it again in headless mode
#[tauri::command]
async fn restart_vm() -> Result<String, String> {
    use std::process::Command;
    use tokio::time::{sleep, Duration};

    const VM_NAME: &str = "PhotoboothLinux";
    const VBOX_MANAGE: &str = r"C:\Program Files\Oracle\VirtualBox\VBoxManage.exe";

    // Check if VBoxManage exists
    if !std::path::Path::new(VBOX_MANAGE).exists() {
        return Err("VBoxManage.exe not found. Is VirtualBox installed?".to_string());
    }

    // Step 1: Check if VM exists
    let list_output = Command::new(VBOX_MANAGE)
        .args(&["list", "vms"])
        .output()
        .map_err(|e| format!("Failed to list VMs: {}", e))?;

    let vms_list = String::from_utf8_lossy(&list_output.stdout);
    if !vms_list.contains(VM_NAME) {
        return Err(format!("VM '{}' not found", VM_NAME));
    }

    // Step 2: Check if VM is running
    let showvminfo_output = Command::new(VBOX_MANAGE)
        .args(&["showvminfo", VM_NAME])
        .output()
        .map_err(|e| format!("Failed to get VM info: {}", e))?;

    let vm_info = String::from_utf8_lossy(&showvminfo_output.stdout);
    let is_running = vm_info.contains("State:") && vm_info.contains("running");

    if !is_running {
        // VM is not running, just start it
        Command::new(VBOX_MANAGE)
            .args(&["startvm", VM_NAME, "--type", "headless"])
            .output()
            .map_err(|e| format!("Failed to start VM: {}", e))?;

        return Ok("VM was not running. Started successfully.".to_string());
    }

    // Step 3: Force power off the VM immediately
    Command::new(VBOX_MANAGE)
        .args(&["controlvm", VM_NAME, "poweroff"])
        .output()
        .map_err(|e| format!("Failed to power off VM: {}", e))?;

    // Wait briefly to ensure the VM has fully stopped
    sleep(Duration::from_secs(2)).await;

    // Step 4: Optimize AHCI port count before starting (reduces startup time)
    let _ = Command::new(VBOX_MANAGE)
        .args(&["storagectl", VM_NAME, "--name", "SATA", "--portcount", "2"])
        .output(); // Ignore errors as this is an optimization

    // Step 5: Start the VM in headless mode
    let start_output = Command::new(VBOX_MANAGE)
        .args(&["startvm", VM_NAME, "--type", "headless"])
        .output()
        .map_err(|e| format!("Failed to start VM: {}", e))?;

    if !start_output.status.success() {
        let error_msg = String::from_utf8_lossy(&start_output.stderr);
        return Err(format!("Failed to start VM: {}", error_msg));
    }

    Ok("VM restarted successfully".to_string())
}

// ==================== END PHOTO SAVING FUNCTIONS ====================

// ==================== CUSTOM SETS SYSTEM ====================

// Overlay layer types for custom sets
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OverlayTransform {
    pub x: f64,
    pub y: f64,
    pub scale: f64,
    pub rotation: f64,
    #[serde(alias = "flipHorizontal")]
    pub flip_horizontal: bool,
    #[serde(alias = "flipVertical")]
    pub flip_vertical: bool,
    pub opacity: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OverlayLayer {
    pub id: String,
    pub name: String,
    #[serde(alias = "sourcePath")]
    pub source_path: String,
    pub thumbnail: Option<String>,
    pub position: String,
    #[serde(alias = "layerOrder")]
    pub layer_order: i32,
    pub transform: OverlayTransform,
    #[serde(alias = "blendMode")]
    pub blend_mode: String,
    pub visible: bool,
    #[serde(alias = "createdAt")]
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundTransform {
    pub scale: f64,
    #[serde(alias = "offset_x")]
    pub offsetX: f64,
    #[serde(alias = "offset_y")]
    pub offsetY: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CanvasSize {
    pub width: u32,
    pub height: u32,
    pub name: String,
    #[serde(alias = "is_custom")]
    pub isCustom: Option<bool>,
    #[serde(alias = "created_at")]
    pub createdAt: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomSet {
    pub id: String,
    pub name: String,
    pub description: String,

    // Canvas configuration
    #[serde(alias = "canvas_size")]
    pub canvasSize: CanvasSize,
    #[serde(alias = "auto_match_background")]
    pub autoMatchBackground: bool,

    // Background configuration
    pub background: Background,
    #[serde(alias = "background_transform")]
    pub backgroundTransform: BackgroundTransform,

    // Layout/Frame
    pub frame: Frame,

    // Overlays
    #[serde(default, alias = "overlays")]
    pub overlays: Vec<OverlayLayer>,

    // Metadata
    pub thumbnail: Option<String>,
    #[serde(alias = "created_at")]
    pub createdAt: String,
    #[serde(alias = "modified_at")]
    pub modifiedAt: String,
    #[serde(alias = "is_default")]
    pub isDefault: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CustomSetPreview {
    pub id: String,
    pub name: String,
    pub description: String,
    pub thumbnail: Option<String>,
    #[serde(alias = "created_at")]
    pub createdAt: String,
}

/// Get custom sets directory in app data
fn get_custom_sets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let sets_dir = app_data_dir.join("custom_sets");
    fs::create_dir_all(&sets_dir)
        .map_err(|e| format!("Failed to create custom sets dir: {}", e))?;
    Ok(sets_dir)
}

/// Copy background image resource to custom set directory
fn copy_background_resource(
    app: &tauri::AppHandle,
    set_id: &str,
    background: &Background,
) -> Result<Background, String> {
    if background.background_type != "image" {
        // No need to copy colors or gradients
        return Ok(background.clone());
    }

    let sets_dir = get_custom_sets_dir(app)?;
    let set_resources_dir = sets_dir.join(&set_id);
    fs::create_dir_all(&set_resources_dir)
        .map_err(|e| format!("Failed to create set resources dir: {}", e))?;

    // Check if value starts with "asset://" protocol
    let source_path = if background.value.starts_with("asset://") {
        PathBuf::from(&background.value.trim_start_matches("asset://"))
    } else {
        PathBuf::from(&background.value)
    };

    if !source_path.exists() {
        return Err(format!("Background source file not found: {:?}", source_path));
    }

    let file_name = source_path
        .file_name()
        .ok_or("Invalid background file path")?
        .to_string_lossy()
        .to_string();

    let dest_path = set_resources_dir.join(&file_name);
    fs::copy(&source_path, &dest_path)
        .map_err(|e| format!("Failed to copy background resource: {}", e))?;

    // Copy thumbnail if it exists
    let thumbnail_result = if let Some(thumb) = &background.thumbnail {
        let thumb_path = if thumb.starts_with("asset://") {
            PathBuf::from(thumb.trim_start_matches("asset://"))
        } else {
            PathBuf::from(thumb)
        };

        if thumb_path.exists() {
            let thumb_name = thumb_path
                .file_name()
                .ok_or("Invalid thumbnail path")?
                .to_string_lossy()
                .to_string();
            let thumb_dest = set_resources_dir.join(&thumb_name);
            fs::copy(&thumb_path, &thumb_dest).ok();
            // Convert backslashes to forward slashes for asset:// protocol
            let thumb_path_str = thumb_dest.to_string_lossy().replace('\\', "/");
            Some(format!("asset://{}", thumb_path_str))
        } else {
            None
        }
    } else {
        None
    };

    // Convert backslashes to forward slashes for asset:// protocol
    let dest_path_str = dest_path.to_string_lossy().replace('\\', "/");
    Ok(Background {
        value: format!("asset://{}", dest_path_str),
        thumbnail: thumbnail_result,
        ..background.clone()
    })
}

/// Save a custom set to disk
#[tauri::command]
async fn save_custom_set(app: tauri::AppHandle, mut custom_set: CustomSet) -> Result<CustomSet, String> {
    let sets_dir = get_custom_sets_dir(&app)?;

    // Generate ID if not provided
    if custom_set.id.is_empty() {
        custom_set.id = format!("set-{}", uuid::Uuid::new_v4());
    }

    // Set timestamps
    let now = chrono::Utc::now().to_rfc3339();
    if custom_set.createdAt.is_empty() {
        custom_set.createdAt = now.clone();
    }
    custom_set.modifiedAt = now;

    // Copy background resource to appdata if it's an image
    custom_set.background = copy_background_resource(&app, &custom_set.id, &custom_set.background)?;

    // Save frame to set directory (copy it so it's preserved)
    let set_resources_dir = sets_dir.join(&custom_set.id);
    fs::create_dir_all(&set_resources_dir)
        .map_err(|e| format!("Failed to create set resources dir: {}", e))?;

    let frame_path = set_resources_dir.join("frame.json");
    let frame_json = serde_json::to_string_pretty(&custom_set.frame)
        .map_err(|e| format!("Failed to serialize frame: {}", e))?;
    fs::write(frame_path, frame_json)
        .map_err(|e| format!("Failed to write frame file: {}", e))?;

    // Save thumbnail if provided (convert data URL to file)
    if let Some(thumbnail_data) = &custom_set.thumbnail {
        if thumbnail_data.starts_with("data:image") {
            // Extract base64 data from data URL
            if let Some(comma_pos) = thumbnail_data.find(',') {
                let base64_data = &thumbnail_data[comma_pos + 1..];

                // Decode base64
                if let Ok(image_data) = general_purpose::STANDARD.decode(base64_data) {
                    let thumbnail_path = set_resources_dir.join("thumbnail.jpg");
                    if fs::write(&thumbnail_path, image_data).is_ok() {
                        // Update thumbnail to point to file path (convert backslashes to forward slashes)
                        let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
                        custom_set.thumbnail = Some(format!("asset://{}", path_str));
                    }
                }
            }
        }
    }

    // Copy overlay images to set directory and update paths
    let overlays_dir = set_resources_dir.join("overlays");
    fs::create_dir_all(&overlays_dir)
        .map_err(|e| format!("Failed to create overlays dir: {}", e))?;

    for (index, overlay) in custom_set.overlays.iter_mut().enumerate() {
        // Skip if the overlay source is already in the set directory
        if overlay.source_path.contains(&format!("custom_sets/{}/overlays", custom_set.id)) {
            continue;
        }

        // Get the original file path (remove asset:// prefix if present)
        let original_path = overlay.source_path.replace("asset://", "").replace("asset:////", "//");

        // Check if it's a data URL
        if original_path.starts_with("data:image/png;base64,") {
            if let Some(comma_pos) = original_path.find(',') {
                let base64_data = &original_path[comma_pos + 1..];
                if let Ok(image_data) = general_purpose::STANDARD.decode(base64_data) {
                    let filename = format!("overlay_{}.png", index);
                    let overlay_path = overlays_dir.join(&filename);
                    if fs::write(&overlay_path, image_data).is_ok() {
                        let path_str = overlay_path.to_string_lossy().replace('\\', "/");
                        overlay.source_path = format!("asset://{}", path_str);
                    }
                }
            }
        } else {
            // Try to copy from file path
            let src_path = PathBuf::from(&original_path);
            if src_path.exists() {
                let filename = src_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("overlay.png");
                let overlay_path = overlays_dir.join(format!("{}_{}", index, filename));

                if fs::copy(&src_path, &overlay_path).is_ok() {
                    let path_str = overlay_path.to_string_lossy().replace('\\', "/");
                    overlay.source_path = format!("asset://{}", path_str);
                }
            }
        }
    }

    // Save custom set metadata
    let set_path = sets_dir.join(format!("{}.json", custom_set.id));
    let json = serde_json::to_string_pretty(&custom_set)
        .map_err(|e| format!("Failed to serialize custom set: {}", e))?;

    fs::write(set_path, json)
        .map_err(|e| format!("Failed to write custom set file: {}", e))?;

    Ok(custom_set)
}

/// Load all custom sets from disk (preview only)
#[tauri::command]
async fn load_custom_sets(app: tauri::AppHandle) -> Result<Vec<CustomSetPreview>, String> {
    let sets_dir = get_custom_sets_dir(&app)?;
    let mut sets = Vec::new();

    if !sets_dir.exists() {
        return Ok(sets);
    }

    let entries = fs::read_dir(&sets_dir)
        .map_err(|e| format!("Failed to read custom sets directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        let json = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read custom set file: {}", e))?;

        let custom_set: CustomSet = serde_json::from_str(&json)
            .map_err(|e| format!("Failed to parse custom set file: {}", e))?;

        sets.push(CustomSetPreview {
            id: custom_set.id,
            name: custom_set.name,
            description: custom_set.description,
            thumbnail: custom_set.thumbnail,
            createdAt: custom_set.createdAt,
        });
    }

    // Sort by creation date (newest first)
    sets.sort_by(|a, b| b.createdAt.cmp(&a.createdAt));

    Ok(sets)
}

/// Get a specific custom set by ID
#[tauri::command]
async fn get_custom_set(app: tauri::AppHandle, set_id: String) -> Result<CustomSet, String> {
    let sets_dir = get_custom_sets_dir(&app)?;
    let set_path = sets_dir.join(format!("{}.json", set_id));

    if !set_path.exists() {
        return Err(format!("Custom set not found: {}", set_id));
    }

    let json = fs::read_to_string(&set_path)
        .map_err(|e| format!("Failed to read custom set file: {}", e))?;

    let custom_set: CustomSet = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse custom set file: {}", e))?;

    Ok(custom_set)
}

/// Delete a custom set from disk
#[tauri::command]
async fn delete_custom_set(app: tauri::AppHandle, set_id: String) -> Result<(), String> {
    let sets_dir = get_custom_sets_dir(&app)?;
    let set_path = sets_dir.join(format!("{}.json", set_id));

    if !set_path.exists() {
        return Err(format!("Custom set not found: {}", set_id));
    }

    // Delete the JSON file
    fs::remove_file(&set_path)
        .map_err(|e| format!("Failed to delete custom set file: {}", e))?;

    // Delete the resources directory if it exists
    let resources_dir = sets_dir.join(&set_id);
    if resources_dir.exists() {
        fs::remove_dir_all(&resources_dir)
            .map_err(|e| format!("Failed to delete custom set resources: {}", e))?;
    }

    Ok(())
}

/// Duplicate a custom set (create a copy with a new ID)
#[tauri::command]
async fn duplicate_custom_set(app: tauri::AppHandle, set_id: String) -> Result<CustomSet, String> {
    let original = get_custom_set(app.clone(), set_id).await?;

    let duplicated = CustomSet {
        id: format!("set-{}", uuid::Uuid::new_v4()),
        name: format!("{} (Copy)", original.name),
        description: original.description,
        canvasSize: original.canvasSize,
        autoMatchBackground: original.autoMatchBackground,
        background: original.background,
        backgroundTransform: original.backgroundTransform,
        frame: original.frame,
        overlays: original.overlays,
        thumbnail: original.thumbnail,
        createdAt: chrono::Utc::now().to_rfc3339(),
        modifiedAt: chrono::Utc::now().to_rfc3339(),
        isDefault: false,
    };

    save_custom_set(app, duplicated).await
}

// ==================== END CUSTOM SETS SYSTEM ====================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState {
            auth: Mutex::new(None),
            account: Mutex::new(None),
            root_folder: Mutex::new(None),
            upload_cancelled: Arc::new(AtomicBool::new(false)),
        })
        .invoke_handler(tauri::generate_handler![
            google_login, google_logout, check_cached_account, get_account,
            list_drive_folders, create_drive_folder, delete_drive_folder,
            set_root_folder, get_root_folder, select_folder, select_file,
            get_file_info, process_photos, cancel_upload, get_images_in_folder,
            get_images_with_metadata, save_dropped_image, generate_cached_thumbnail, generate_cached_thumbnails_batch, clear_temp_images,
            remove_temp_image, get_history, clear_history,
            select_working_folder,
            save_frame, load_frames, delete_frame, duplicate_frame,
            save_background, load_backgrounds, delete_background, import_background,
            save_custom_canvas_size, get_custom_canvas_sizes, delete_custom_canvas_size,
            save_app_setting, get_app_setting,
            save_custom_set, load_custom_sets, get_custom_set, delete_custom_set, duplicate_custom_set,
            load_ptb_workspace, save_ptb_workspace,
            create_photobooth_session, list_photobooth_sessions, get_current_session, set_current_session, get_session_data,
            save_photo_to_working_folder, download_photo_from_daemon,
            list_usb_cameras, attach_usb_camera, detach_usb_camera, get_attached_cameras, is_camera_attached, cleanup_all_cameras, attach_all_cameras, ensure_usb_filters,
            get_vm_logs, check_vm_online, restart_vm,
            list_capture_devices, start_hdmi_capture, stop_hdmi_capture
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}