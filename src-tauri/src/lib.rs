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
use futures::stream::{self, StreamExt};

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

// Fixed type alias to match what google_drive3 expects
type Auth = yup_oauth2::authenticator::Authenticator<hyper_rustls::HttpsConnector<hyper::client::HttpConnector>>;

struct AppState {
    auth: Mutex<Option<Auth>>,
    account: Mutex<Option<GoogleAccount>>,
    root_folder: Mutex<Option<DriveFolder>>,
}

// Helper function to load client_secret.json from various locations
async fn load_client_secret(app: &tauri::AppHandle) -> Result<yup_oauth2::ApplicationSecret, String> {
    // 1. Try current directory first (common in dev mode)
    if let Ok(secret) = yup_oauth2::read_application_secret("client_secret.json").await {
        return Ok(secret);
    }
    
    // 2. Try src-tauri directory (alternative dev mode location)
    if let Ok(secret) = yup_oauth2::read_application_secret("src-tauri/client_secret.json").await {
        return Ok(secret);
    }
    
    // 3. Try app resource directory (required for bundled/production app)
    if let Ok(resource_path) = app.path().resource_dir() {
        let secret_path = resource_path.join("client_secret.json");
        if let Ok(secret) = yup_oauth2::read_application_secret(&secret_path).await {
            return Ok(secret);
        }
    }
    
    Err("Could not find client_secret.json. Please ensure it is present in the application directory or configured as a resource in tauri.conf.json.".to_string())
}

#[tauri::command]
async fn google_login(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<GoogleAccount, String> {
    // Load OAuth2 credentials dynamically from file
    let secret = load_client_secret(&app).await?;

    use yup_oauth2::authenticator_delegate::InstalledFlowDelegate;

    // Custom delegate that opens the browser
    struct BrowserOpenerDelegate {
        #[allow(dead_code)]
        app_handle: tauri::AppHandle,
    }

    impl InstalledFlowDelegate for BrowserOpenerDelegate {
        fn present_user_url<'a>(
            &'a self,
            url: &'a str,
            _need_code: bool,
        ) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<String, String>> + Send + 'a>> {
            Box::pin(async move {
                // Open the URL in the default browser
                if let Err(e) = open::that(url) {
                    eprintln!("Failed to open browser: {}", e);
                    // Fallback: Ask user to copy paste
                    println!("Please visit this URL manually: {}", url);
                }
                // For HTTPRedirect flow - just return empty string, server will handle it
                Ok(String::new())
            })
        }
    }

    // Store token cache in app data directory
    let cache_path = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("tokencache_v2.json");

    // Ensure the directory exists
    if let Some(parent) = cache_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create cache directory: {}", e))?;
    }

    let auth = InstalledFlowAuthenticator::builder(
        secret,
        InstalledFlowReturnMethod::HTTPRedirect,
    )
    .persist_tokens_to_disk(cache_path)
    .flow_delegate(Box::new(BrowserOpenerDelegate {
        app_handle: app.clone(),
    }))
    .build()
    .await
    .map_err(|e| format!("Failed to create authenticator: {}", e))?;

    // Request access token with Drive and UserInfo scopes
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
        .map_err(|e| format!("Failed to get token: {}\nPlease make sure the OAuth consent screen has the required scopes configured.", e))?;

    // Get user info using the access token
    let client = reqwest::Client::new();
    let token_str = token.token().ok_or("No token available")?;

    println!("Fetching user info with token...");
    let response = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(token_str)
        .send()
        .await
        .map_err(|e| format!("Failed to get user info: {}", e))?;

    let status = response.status();
    println!("User info response status: {}", status);

    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(format!("Failed to get user info ({}): {}", status, error_text));
    }

    let user_info: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse user info: {}", e))?;

    println!("User info received: {:?}", user_info);

    let account = GoogleAccount {
        email: user_info["email"].as_str().unwrap_or("").to_string(),
        name: user_info["name"].as_str().unwrap_or("User").to_string(),
        picture: user_info["picture"].as_str().map(|s| s.to_string()),
    };

    println!("Created account: email={}, name={}", account.email, account.name);

    // Store auth and account in state
    *state.auth.lock().unwrap() = Some(auth);
    *state.account.lock().unwrap() = Some(account.clone());

    // Bring window back to front after OAuth completes
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.set_focus();
    }

    Ok(account)
}

#[tauri::command]
async fn google_logout(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    *state.auth.lock().unwrap() = None;
    *state.account.lock().unwrap() = None;

    // Remove cached tokens from app data directory
    let cache_path = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("tokencache_v2.json");
        
    let _ = std::fs::remove_file(cache_path);

    Ok(())
}

#[tauri::command]
async fn check_cached_account(app: tauri::AppHandle) -> Result<Option<GoogleAccount>, String> {
    // Check if token cache exists
    let cache_path = app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?
        .join("tokencache_v2.json");

    if !cache_path.exists() {
        return Ok(None);
    }

    // Load OAuth2 credentials from file
    let secret = load_client_secret(&app).await?;

    let auth = InstalledFlowAuthenticator::builder(
        secret,
        InstalledFlowReturnMethod::HTTPRedirect,
    )
    .persist_tokens_to_disk(&cache_path)
    .build()
    .await
    .map_err(|e| format!("Failed to create authenticator: {}", e))?;

    // Try to get a token (this will use cached token if available)
    let all_scopes = &[
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/userinfo.email",
    ];

    let token = match auth.token(all_scopes).await {
        Ok(t) => t,
        Err(_) => return Ok(None), // Cache is invalid or expired
    };

    // Get user info using the access token
    let client = reqwest::Client::new();
    let token_str = token.token().ok_or("No token available")?;

    let response = client
        .get("https://www.googleapis.com/oauth2/v2/userinfo")
        .bearer_auth(token_str)
        .send()
        .await
        .map_err(|e| format!("Failed to fetch user info: {}", e))?;

    if !response.status().is_success() {
        return Ok(None); // Token is invalid
    }

    let user_info: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse user info: {}", e))?;

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
    parent_id: Option<String>
) -> Result<Vec<DriveFolder>, String> {
    println!("=== list_drive_folders called (parent: {:?}) ===", parent_id);

    // Get authenticator from state
    let auth = {
        let auth_guard = state.auth.lock().unwrap();
        let auth_ref = auth_guard
            .as_ref()
            .ok_or("Not logged in. Please sign in with Google first.")?;
        auth_ref.clone()
    };

    // Create Drive hub
    // Fixed with .map_err() and ?
    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|e| format!("Failed to load native roots: {}", e))?
        .https_or_http()
        .enable_http1()
        .build();

    let client = hyper::Client::builder().build(https);
    let hub = DriveHub::new(client, auth);

    let mut all_items = Vec::new();

    if let Some(pid) = parent_id {
        // === LIST CHILDREN OF A SPECIFIC FOLDER ===
        println!("Listing children of folder: {}", pid);
        
        let query = format!("'{}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false", pid);
        
        let result = hub.files()
            .list()
            .q(&query)
            .page_size(100)
            .order_by("name")
            .supports_all_drives(true)
            .include_items_from_all_drives(true)
            .param("fields", "files(id, name)")
            .doit()
            .await;

        match result {
            Ok(res) => {
                if let Some(files) = res.1.files {
                    for file in files {
                        if let (Some(id), Some(name)) = (file.id, file.name) {
                            all_items.push(DriveFolder { 
                                id,
                                name,
                                is_shared_drive: false 
                            });
                        }
                    }
                }
            },
            Err(e) => return Err(format!("Failed to list folder contents: {}", e)),
        }
    } else {
        // === LIST ROOT LEVEL (My Drive + Shared Drives) ===
        println!("Listing Root Level (My Drive + Shared Drives)");

        // 1. Fetch Shared Drives
        println!("Fetching Shared Drives...");
        let drives_result = hub.drives()
            .list()
            .page_size(50)
            .doit()
            .await;

        match drives_result {
            Ok(res) => {
                if let Some(drives) = res.1.drives {
                    println!("Found {} Shared Drives", drives.len());
                    for drive in drives {
                        if let (Some(id), Some(name)) = (drive.id, drive.name) {
                            all_items.push(DriveFolder { 
                                id,
                                name,
                                is_shared_drive: true 
                            });
                        }
                    }
                }
            },
            Err(e) => println!("Warning: Failed to list shared drives: {}", e),
        }

        // 2. Fetch My Drive Root Folders
        println!("Fetching My Drive root folders...");
        let root_result = hub.files()
            .list()
            .q("'root' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false")
            .page_size(100)
            .order_by("name")
            .doit()
            .await;

        match root_result {
            Ok(res) => {
                if let Some(files) = res.1.files {
                    println!("Found {} root folders", files.len());
                    for file in files {
                        if let (Some(id), Some(name)) = (file.id, file.name) {
                            all_items.push(DriveFolder { 
                                id,
                                name,
                                is_shared_drive: false 
                            });
                        }
                    }
                }
            },
            Err(e) => println!("Warning: Failed to list root folders: {}", e),
        }
    }

    // Sort: Shared Drives first, then alphabetical by name
    all_items.sort_by(|a, b| {
        if a.is_shared_drive != b.is_shared_drive {
            b.is_shared_drive.cmp(&a.is_shared_drive) // true (Shared) comes first
        } else {
            a.name.to_lowercase().cmp(&b.name.to_lowercase())
        }
    });

    println!("Returning {} items", all_items.len());
    Ok(all_items)
}

#[tauri::command]
async fn create_drive_folder(
    folder_name: String,
    parent_id: Option<String>,
    state: State<'_, AppState>
) -> Result<DriveFolder, String> {
    // Get authenticator from state
    let auth = {
        let auth_guard = state.auth.lock().unwrap();
        auth_guard
            .as_ref()
            .ok_or("Not logged in. Please sign in with Google first.")?
            .clone()
    };

    // Create Drive hub
    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|e| format!("Failed to load native roots: {}", e))?
        .https_or_http()
        .enable_http1()
        .build();

    let client = hyper::Client::builder().build(https);
    let hub = DriveHub::new(client, auth);

    // Create new folder
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
        .upload(
            std::io::Cursor::new(empty_body),
            "application/vnd.google-apps.folder".parse().unwrap()
        )
        .await
        .map_err(|e| format!("Failed to create folder: {}", e))?;

    let folder = DriveFolder {
        id: created_folder.id.ok_or("No folder ID returned")?,
        name: folder_name,
        is_shared_drive: false,
    };

    Ok(folder)
}

#[tauri::command]
async fn set_root_folder(
    folder: DriveFolder,
    state: State<'_, AppState>
) -> Result<(), String> {
    *state.root_folder.lock().unwrap() = Some(folder);
    Ok(())
}

#[tauri::command]
async fn get_root_folder(state: State<'_, AppState>) -> Result<Option<DriveFolder>, String> {
    Ok(state.root_folder.lock().unwrap().clone())
}

#[tauri::command]
async fn delete_drive_folder(
    folder_id: String,
    state: State<'_, AppState>
) -> Result<(), String> {
    // Get authenticator from state
    let auth = {
        let auth_guard = state.auth.lock().unwrap();
        auth_guard
            .as_ref()
            .ok_or("Not logged in. Please sign in with Google first.")?
            .clone()
    };

    // Create Drive hub
    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|e| format!("Failed to load native roots: {}", e))?
        .https_or_http()
        .enable_http1()
        .build();

    let client = hyper::Client::builder().build(https);
    let hub = DriveHub::new(client, auth);

    // Delete the folder
    hub.files()
        .delete(&folder_id)
        .supports_all_drives(true)
        .doit()
        .await
        .map_err(|e| format!("Failed to delete folder: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn select_folder(app: tauri::AppHandle) -> Result<String, String> {
    println!("Opening folder selector...");
    let folder = app.dialog()
        .file()
        .set_title("Select Photos Folder")
        .blocking_pick_folder();

    match folder {
        Some(path) => {
            let path_str = path.to_string();
            println!("Folder selected: {}", path_str);
            Ok(path_str)
        },
        None => {
            println!("Folder selection cancelled");
            Err("No folder selected".to_string())
        },
    }
}

#[tauri::command]
async fn select_file(app: tauri::AppHandle) -> Result<String, String> {
    println!("Opening file selector...");
    let file = app.dialog()
        .file()
        .set_title("Select Image File")
        .add_filter("Images", &["png", "jpg", "jpeg", "raw", "raf", "cr2", "nef", "arw", "dng", "orf", "rw2", "pef", "srw"])
        .blocking_pick_file();

    match file {
        Some(path) => {
            let path_str = path.to_string();
            println!("File selected: {}", path_str);
            Ok(path_str)
        },
        None => {
            println!("File selection cancelled");
            Err("No file selected".to_string())
        },
    }
}

#[derive(serde::Serialize)]
struct FileInfo {
    size: u64,
}

#[tauri::command]
async fn get_file_info(file_path: String) -> Result<FileInfo, String> {
    use std::fs;

    let metadata = fs::metadata(&file_path)
        .map_err(|e| format!("Failed to get file info: {}", e))?;

    Ok(FileInfo {
        size: metadata.len(),
    })
}

fn generate_random_name() -> String {
    let mut rng = rand::thread_rng();
    let random_string: String = (0..8)
        .map(|_| {
            let idx = rng.gen_range(0..36);
            if idx < 26 {
                (b'A' + idx) as char
            } else {
                (b'0' + (idx - 26)) as char
            }
        })
        .collect();
    format!("PhotoBooth_{}", random_string)
}

#[tauri::command]
async fn process_photos(
    photos_path: String,
    file_list: Option<Vec<String>>,
    state: State<'_, AppState>,
    app: tauri::AppHandle,
) -> Result<ProcessResult, String> {
    // Get authenticator from state
    let auth = {
        let auth_guard = state.auth.lock().unwrap();
        auth_guard
            .as_ref()
            .ok_or("Not logged in. Please sign in with Google first.")?
            .clone()
    };

    // Get root folder from state
    let root_folder = {
        let folder_guard = state.root_folder.lock().unwrap();
        folder_guard
            .as_ref()
            .ok_or("No root folder selected. Please select a Drive folder first.")?
            .clone()
    };

    // Create Drive hub with the authenticator
    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|e| format!("Failed to load native roots: {}", e))?
        .https_or_http()
        .enable_http1()
        .build();

    let client = hyper::Client::builder().build(https);

    let hub = DriveHub::new(client, auth);

    let folder_name = generate_random_name();
    println!("📁 Creating folder: {}", folder_name);

    // Emit progress: Starting
    let _ = app.emit("upload-progress", UploadProgress {
        step: "starting".to_string(),
        current: 0,
        total: 0,
        message: "Starting upload process...".to_string(),
    });

    // Create folder inside the root folder on Google Drive
    let folder_metadata = File {
        name: Some(folder_name.clone()),
        mime_type: Some("application/vnd.google-apps.folder".to_string()),
        parents: Some(vec![root_folder.id.clone()]),
        ..Default::default()
    };

    // For folder creation, use upload with empty body
    let empty_body: &[u8] = &[];
    println!("🔄 Sending folder creation request to Google Drive...");
    let folder_create_start = std::time::Instant::now();

    // Emit progress: Creating folder
    let _ = app.emit("upload-progress", UploadProgress {
        step: "creating_folder".to_string(),
        current: 0,
        total: 0,
        message: format!("Creating folder '{}'...", folder_name),
    });

    let (_response, folder) = hub
        .files()
        .create(folder_metadata)
        .supports_all_drives(true)
        .upload(
            std::io::Cursor::new(empty_body),
            "application/vnd.google-apps.folder".parse().unwrap()
        )
        .await
        .map_err(|e| format!("Failed to create folder on Drive: {}", e))?;

    let folder_id = folder.id.ok_or("No folder ID returned")?;
    println!("✅ Folder created in {:.2}s - ID: {}", folder_create_start.elapsed().as_secs_f64(), folder_id);

    // Upload photos to the folder in parallel
    // Note: futures::stream is imported at top level now

    let source_path = PathBuf::from(&photos_path);

    // Collect all image files first
    println!("📂 Scanning folder: {}", source_path.display());
    let mut image_files = Vec::new();

    if let Some(files) = file_list {
        // Use the provided file list (specific files to upload)
        println!("Using provided file list: {} files", files.len());
        for file_path_str in files {
            let path = PathBuf::from(&file_path_str);
            if path.exists() {
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if matches!(ext_str.as_str(), "jpg" | "jpeg" | "png" | "raw" | "raf") {
                        image_files.push((path, ext_str));
                    }
                }
            } else {
                println!("⚠️ File not found: {}", file_path_str);
            }
        }
    } else {
        // Scan the entire folder (legacy behavior)
        for entry in fs::read_dir(&source_path)
            .map_err(|e| format!("Failed to read source folder: {}", e))? 
        {
            let entry = entry.map_err(|e| format!("Failed to read entry: {}", e))?;
            let path = entry.path();

            if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if matches!(ext_str.as_str(), "jpg" | "jpeg" | "png" | "raw" | "raf") {
                    image_files.push((path, ext_str));
                }
            }
        }
    }

    let total_files = image_files.len();
    println!("📸 Found {} image files to upload", total_files);
    println!("🚀 Starting parallel upload (2 concurrent uploads)...");
    let upload_start = std::time::Instant::now();

    // Emit progress: Scanning complete
    let _ = app.emit("upload-progress", UploadProgress {
        step: "scanning".to_string(),
        current: total_files,
        total: total_files,
        message: format!("Found {} images to upload", total_files),
    });

    // Create indexed list for tracking progress
    let indexed_files: Vec<_> = image_files.into_iter().enumerate().collect();

    // Upload files in parallel (5 concurrent uploads)
    let upload_results: Vec<Result<(), String>> = stream::iter(indexed_files)
        .map(|(index, (path, ext_str))| {
            let hub = hub.clone();
            let folder_id = folder_id.clone();
            let app = app.clone();

            async move {
                let file_name = path.file_name().unwrap().to_string_lossy().to_string();
                let file_start = std::time::Instant::now();

                println!("📤 [{}/{}] Uploading: {}", index + 1, total_files, file_name);

                // Emit progress for this file
                let _ = app.emit("upload-progress", UploadProgress {
                    step: "uploading".to_string(),
                    current: index + 1,
                    total: total_files,
                    message: format!("Uploading {} ({}/{})", file_name, index + 1, total_files),
                });

                let mime_type = match ext_str.as_str() {
                    "jpg" | "jpeg" => "image/jpeg",
                    "png" => "image/png",
                    _ => "application/octet-stream",
                };

                let file_metadata = File {
                    name: Some(file_name.clone()),
                    parents: Some(vec![folder_id.clone()]),
                    ..Default::default()
                };

                let file_content = fs::read(&path)
                    .map_err(|e| format!("Failed to read file {}: {}", file_name, e))?;

                let file_size = file_content.len();
                println!("   📊 File size: {:.2} MB", file_size as f64 / 1_048_576.0);

                hub.files()
                    .create(file_metadata)
                    .supports_all_drives(true)
                    .upload(
                        std::io::Cursor::new(file_content),
                        mime_type.parse().unwrap()
                    )
                    .await
                    .map_err(|e| format!("Failed to upload file {}: {}", file_name, e))?;

                println!("   ✅ Uploaded in {:.2}s", file_start.elapsed().as_secs_f64());
                Ok::<(), String>(())
            }
        })
        .buffer_unordered(5) // Process 5 uploads concurrently
        .collect()
        .await;

    // Check if any uploads failed
    for result in upload_results {
        result?;
    }

    let upload_duration = upload_start.elapsed().as_secs_f64();
    println!("✅ All {} files uploaded in {:.2}s ({:.2} files/sec)",
             total_files, upload_duration, total_files as f64 / upload_duration);

    // Make folder publicly accessible
    println!("🔓 Setting folder permissions to public...");
    let permission_start = std::time::Instant::now();

    // Emit progress: Setting permissions
    let _ = app.emit("upload-progress", UploadProgress {
        step: "permissions".to_string(),
        current: 0,
        total: 0,
        message: "Setting folder permissions...".to_string(),
    });

    let permission = google_drive3::api::Permission {
        role: Some("reader".to_string()),
        type_: Some("anyone".to_string()),
        ..Default::default()
    };

    let _permission_result = hub.permissions()
        .create(permission, &folder_id)
        .doit()
        .await
        .map_err(|e| format!("Failed to set permissions: {}", e))?;

    println!("✅ Permissions set in {:.2}s", permission_start.elapsed().as_secs_f64());

    // Create shareable link
    let link = format!("https://drive.google.com/drive/folders/{}", folder_id);
    println!("🔗 Shareable link: {}", link);

    // Generate QR code as Base64
    println!("📱 Generating QR code...");
    let qr_start = std::time::Instant::now();

    // Emit progress: Generating QR code
    let _ = app.emit("upload-progress", UploadProgress {
        step: "qr_code".to_string(),
        current: 0,
        total: 0,
        message: "Generating QR code...".to_string(),
    });

    let qr_data = generate_qr_code_base64(&link)?;
    println!("✅ QR code generated in {:.2}s", qr_start.elapsed().as_secs_f64());

    // Emit progress: Complete
    let _ = app.emit("upload-progress", UploadProgress {
        step: "complete".to_string(),
        current: total_files,
        total: total_files,
        message: "Upload complete!".to_string(),
    });

    println!("🎉 Process complete!");

    // Save to history
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string();

    let history_item = HistoryItem {
        timestamp,
        folder_name: folder_name.clone(),
        link: link.clone(),
        qr_data: qr_data.clone(),
    };

    if let Err(e) = append_history_entry(&app, history_item) {
        println!("⚠️ Failed to save history: {}", e);
    }

    Ok(ProcessResult {
        folder_name,
        link,
        qr_data,
    })
}

fn generate_qr_code_base64(url: &str) -> Result<String, String> {
    use qrcode::QrCode;
    use image::Luma;

    let code = QrCode::new(url.as_bytes())
        .map_err(|e| format!("Failed to generate QR code: {}", e))?;

    let image = code.render::<Luma<u8>>()
        .max_dimensions(400, 400)
        .build();

    let mut buffer = Cursor::new(Vec::new());
    image.write_to(&mut buffer, image::ImageOutputFormat::Png)
        .map_err(|e| format!("Failed to encode QR image: {}", e))?;

    let base64_string = general_purpose::STANDARD.encode(buffer.get_ref());
    Ok(base64_string)
}

#[derive(Serialize, Deserialize)]
struct ImageFileInfo {
    path: String,
    size: u64,
    extension: String,
}

#[tauri::command]
async fn get_images_in_folder(folder_path: String) -> Result<Vec<String>, String> {
    let mut image_paths = Vec::new();
    let path = PathBuf::from(&folder_path);

    if path.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if matches!(ext_str.as_str(), "jpg" | "jpeg" | "png" | "raw" | "raf" | "cr2" | "nef" | "arw" | "dng" | "orf" | "rw2" | "pef" | "srw") {
                     // Convert to file URL for display in frontend
                    let path_str = path.to_string_lossy().to_string();
                    image_paths.push(path_str);
                }
            }
        }
    }
    Ok(image_paths)
}

#[tauri::command]
async fn get_images_with_metadata(folder_path: String) -> Result<Vec<ImageFileInfo>, String> {
    let mut image_files = Vec::new();
    let path = PathBuf::from(&folder_path);

    if path.is_dir() {
        for entry in fs::read_dir(path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            if let Some(ext) = path.extension() {
                let ext_str = ext.to_string_lossy().to_lowercase();
                if matches!(ext_str.as_str(), "jpg" | "jpeg" | "png" | "raw" | "raf" | "cr2" | "nef" | "arw" | "dng" | "orf" | "rw2" | "pef" | "srw") {
                    let path_str = path.to_string_lossy().to_string();
                    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
                    let size = metadata.len();

                    image_files.push(ImageFileInfo {
                        path: path_str,
                        size,
                        extension: ext_str,
                    });
                }
            }
        }
    }
    Ok(image_files)
}

#[tauri::command]
async fn save_dropped_image(
    image_data: String,
    filename: String,
    app: tauri::AppHandle,
) -> Result<String, String> {
    // Get app data directory
    let app_data_dir = app.path().app_data_dir() 
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // Create temp folder for dropped images
    let temp_dir = app_data_dir.join("dropped_images");
    fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("Failed to create temp directory: {}", e))?;

    // Parse data URL (format: data:image/png;base64,...)
    let parts: Vec<&str> = image_data.split(',').collect();
    if parts.len() != 2 {
        return Err("Invalid data URL format".to_string());
    }

    let base64_data = parts[1];
    let image_bytes = general_purpose::STANDARD
        .decode(base64_data)
        .map_err(|e| format!("Failed to decode base64: {}", e))?;

    // Save to temp file
    let file_path = temp_dir.join(&filename);
    fs::write(&file_path, image_bytes)
        .map_err(|e| format!("Failed to write image file: {}", e))?;

    // Return the file path as string
    file_path.to_str()
        .ok_or("Failed to convert path to string".to_string())
        .map(|s| s.to_string())
}

#[tauri::command]
async fn clear_temp_images(app: tauri::AppHandle) -> Result<(), String> {
    // Get app data directory
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let temp_dir = app_data_dir.join("dropped_images");

    // Remove the entire directory if it exists
    if temp_dir.exists() {
        fs::remove_dir_all(&temp_dir)
            .map_err(|e| format!("Failed to remove temp directory: {}", e))?;
        println!("🗑️ Cleared temp images directory");
    }

    Ok(())
}

#[tauri::command]
async fn remove_temp_image(
    filename: String,
    app: tauri::AppHandle,
) -> Result<(), String> {
    // Get app data directory
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    let temp_dir = app_data_dir.join("dropped_images");
    let file_path = temp_dir.join(&filename);

    // Remove the file if it exists
    if file_path.exists() {
        fs::remove_file(&file_path)
            .map_err(|e| format!("Failed to remove file: {}", e))?;
        println!("🗑️ Removed temp image: {}", filename);
    }

    Ok(())
}

#[derive(Serialize, Deserialize, Clone, Debug)]
struct HistoryItem {
    timestamp: String,
    folder_name: String,
    link: String,
    qr_data: String,
}

#[tauri::command]
async fn get_history(app: tauri::AppHandle) -> Result<Vec<HistoryItem>, String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    
    let history_path = app_data_dir.join("history.json");

    if !history_path.exists() {
        return Ok(Vec::new());
    }

    let content = fs::read_to_string(history_path)
        .map_err(|e| format!("Failed to read history file: {}", e))?;

    let history: Vec<HistoryItem> = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse history: {}", e))?;

    // Sort by timestamp descending (newest first)
    // Assuming ISO string format which sorts correctly lexicographically
    let mut history = history;
    history.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));

    Ok(history)
}

#[tauri::command]
async fn clear_history(app: tauri::AppHandle) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;
    
    let history_path = app_data_dir.join("history.json");

    if history_path.exists() {
        fs::remove_file(history_path)
            .map_err(|e| format!("Failed to delete history file: {}", e))?;
    }

    Ok(())
}

// Helper to append history
fn append_history_entry(app: &tauri::AppHandle, item: HistoryItem) -> Result<(), String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))?;

    // Ensure directory exists
    if !app_data_dir.exists() {
        fs::create_dir_all(&app_data_dir)
             .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    }
    
    let history_path = app_data_dir.join("history.json");

    let mut history: Vec<HistoryItem> = if history_path.exists() {
        let content = fs::read_to_string(&history_path)
            .map_err(|e| format!("Failed to read history file: {}", e))?;
        serde_json::from_str(&content)
            .unwrap_or_else(|_| Vec::new())
    } else {
        Vec::new()
    };

    history.push(item);

    let json = serde_json::to_string_pretty(&history)
        .map_err(|e| format!("Failed to serialize history: {}", e))?;

    fs::write(history_path, json)
        .map_err(|e| format!("Failed to write history file: {}", e))?;

    Ok(())
}

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
            google_login,
            google_logout,
            check_cached_account,
            get_account,
            list_drive_folders,
            create_drive_folder,
            delete_drive_folder,
            set_root_folder,
            get_root_folder,
            select_folder,
            select_file,
            get_file_info,
            process_photos,
            get_images_in_folder,
            get_images_with_metadata,
            save_dropped_image,
            clear_temp_images,
            remove_temp_image,
            get_history,
            clear_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}