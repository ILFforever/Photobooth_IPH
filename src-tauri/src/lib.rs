use rand::Rng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri_plugin_dialog::DialogExt;
use google_drive3::{DriveHub, api::File};
use yup_oauth2::{InstalledFlowAuthenticator, InstalledFlowReturnMethod};
use hyper;
use hyper_rustls;
use std::sync::Mutex;
use tauri::{State, Manager, Emitter};
use base64::{Engine as _, engine::general_purpose};
use std::io::Cursor;

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
    x: f32,         // X position as percentage (0-100)
    y: f32,         // Y position as percentage (0-100)
    width: f32,     // Width as percentage (0-100)
    height: f32,    // Height as percentage (0-100)
    rotation: f32,  // Rotation in degrees
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

    let cache_path = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("tokencache_v2.json");
    let _ = std::fs::remove_file(cache_path);

    Ok(())
}

#[tauri::command]
async fn check_cached_account(app: tauri::AppHandle) -> Result<Option<GoogleAccount>, String> {
    let cache_path = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("tokencache_v2.json");

    if !cache_path.exists() {
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
async fn process_photos(
    _photos_path: String,
    file_list: Option<Vec<String>>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<ProcessResult, String> {
    println!("\n========================================");
    println!("🎬 PROCESS_PHOTOS CALLED");
    println!("========================================");

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
            async move {
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
    use image::Luma;
    let code = QrCode::new(url.as_bytes()).map_err(|e| e.to_string())?;
    let image = code.render::<Luma<u8>>().max_dimensions(400, 400).build();
    let mut buffer = Cursor::new(Vec::new());
    image.write_to(&mut buffer, image::ImageOutputFormat::Png).map_err(|e| e.to_string())?;
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
}

#[derive(Serialize, Deserialize)]
struct WorkingFolderInfo {
    path: String,
    images: Vec<WorkingImage>,
}

#[tauri::command]
async fn select_working_folder(app: tauri::AppHandle) -> Result<WorkingFolderInfo, String> {
    // Open folder picker
    let folder_path = app.dialog()
        .file()
        .set_title("Select Working Folder")
        .blocking_pick_folder()
        .ok_or("No folder selected")?;

    let folder_path_str = folder_path.to_string();

    // Scan folder for images
    let images = scan_folder_for_images(&folder_path_str, &app).await?;

    Ok(WorkingFolderInfo {
        path: folder_path_str,
        images,
    })
}

async fn scan_folder_for_images(folder_path: &str, app: &tauri::AppHandle) -> Result<Vec<WorkingImage>, String> {
    let path = PathBuf::from(folder_path);
    let mut images = Vec::new();

    let entries = fs::read_dir(&path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

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

        let size = fs::metadata(&file_path)
            .map(|m| m.len())
            .unwrap_or(0);

        let file_path_str = file_path.to_string_lossy().to_string();

        // Generate thumbnail for JPG/PNG (skip RAW for now)
        let thumbnail = if matches!(extension.as_str(), "jpg" | "jpeg" | "png") {
            match generate_thumbnail(&file_path_str, app).await {
                Ok(thumb) => thumb,
                Err(_) => String::new(),
            }
        } else {
            String::new() // RAW files don't get thumbnails for now
        };

        images.push(WorkingImage {
            path: file_path_str,
            filename,
            thumbnail,
            size,
            extension,
        });
    }

    Ok(images)
}

async fn generate_thumbnail(image_path: &str, app: &tauri::AppHandle) -> Result<String, String> {
    use image::imageops::FilterType;
    use image::ImageFormat;

    // Load image
    let img = image::open(image_path)
        .map_err(|e| format!("Failed to open image: {}", e))?;

    // Resize to thumbnail size (120x120 max, maintaining aspect ratio)
    let thumbnail = img.resize(120, 120, FilterType::Lanczos3);

    // Save to app data directory
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

    thumbnail.save_with_format(&thumbnail_path, ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to save thumbnail: {}", e))?;

    // Return as asset URL
    let asset_url = format!("asset://{}", thumbnail_path.to_string_lossy());
    Ok(asset_url)
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
fn initialize_default_frames(app: &tauri::AppHandle) -> Result<(), String> {
    let frames_dir = get_frames_dir(app)?;

    // Check if frames already exist
    if let Ok(entries) = fs::read_dir(&frames_dir) {
        if entries.count() > 0 {
            // Frames already exist, skip initialization
            return Ok(());
        }
    }

    // Create 3 default frames
    let default_frames = vec![
        Frame {
            id: "default-single".to_string(),
            name: "Single Photo".to_string(),
            description: "Classic single photo layout".to_string(),
            width: 1200,
            height: 1800,
            zones: vec![
                FrameZone {
                    id: "zone-1".to_string(),
                    x: 10.0,
                    y: 10.0,
                    width: 80.0,
                    height: 80.0,
                    rotation: 0.0,
                }
            ],
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Frame {
            id: "default-double".to_string(),
            name: "Side by Side".to_string(),
            description: "Two photos side by side".to_string(),
            width: 1200,
            height: 1800,
            zones: vec![
                FrameZone {
                    id: "zone-1".to_string(),
                    x: 5.0,
                    y: 25.0,
                    width: 42.0,
                    height: 50.0,
                    rotation: 0.0,
                },
                FrameZone {
                    id: "zone-2".to_string(),
                    x: 53.0,
                    y: 25.0,
                    width: 42.0,
                    height: 50.0,
                    rotation: 0.0,
                }
            ],
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Frame {
            id: "default-grid".to_string(),
            name: "Photo Grid".to_string(),
            description: "Four photos in a grid".to_string(),
            width: 1200,
            height: 1800,
            zones: vec![
                FrameZone {
                    id: "zone-1".to_string(),
                    x: 10.0,
                    y: 10.0,
                    width: 35.0,
                    height: 35.0,
                    rotation: 0.0,
                },
                FrameZone {
                    id: "zone-2".to_string(),
                    x: 55.0,
                    y: 10.0,
                    width: 35.0,
                    height: 35.0,
                    rotation: 0.0,
                },
                FrameZone {
                    id: "zone-3".to_string(),
                    x: 10.0,
                    y: 55.0,
                    width: 35.0,
                    height: 35.0,
                    rotation: 0.0,
                },
                FrameZone {
                    id: "zone-4".to_string(),
                    x: 55.0,
                    y: 55.0,
                    width: 35.0,
                    height: 35.0,
                    rotation: 0.0,
                }
            ],
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        }
    ];

    // Save default frames
    for frame in default_frames {
        let frame_path = frames_dir.join(format!("{}.json", frame.id));
        let json = serde_json::to_string_pretty(&frame)
            .map_err(|e| format!("Failed to serialize frame: {}", e))?;
        fs::write(frame_path, json)
            .map_err(|e| format!("Failed to write frame file: {}", e))?;
    }

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

// ==================== END FRAME SYSTEM ====================

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
        })
        .invoke_handler(tauri::generate_handler![
            google_login, google_logout, check_cached_account, get_account,
            list_drive_folders, create_drive_folder, delete_drive_folder,
            set_root_folder, get_root_folder, select_folder, select_file,
            get_file_info, process_photos, get_images_in_folder,
            get_images_with_metadata, save_dropped_image, clear_temp_images,
            remove_temp_image, get_history, clear_history,
            select_working_folder,
            save_frame, load_frames, delete_frame
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}