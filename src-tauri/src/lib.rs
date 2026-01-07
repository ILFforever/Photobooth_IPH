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
    let auth = {
        let auth_guard = state.auth.lock().unwrap();
        auth_guard.as_ref().ok_or("Not logged in")?.clone()
    };

    let root_folder = {
        let folder_guard = state.root_folder.lock().unwrap();
        folder_guard.as_ref().ok_or("No root folder")?.clone()
    };

    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|e| format!("HTTPS error: {}", e))?
        .https_or_http()
        .enable_http1()
        .build();

    let client = hyper::Client::builder().build(https);
    let hub = DriveHub::new(client, auth);

    let folder_name = generate_random_name();
    let _ = app.emit("upload-progress", UploadProgress {
        step: "starting".to_string(),
        current: 0,
        total: 0,
        message: "Starting...".to_string(),
    });

    let folder_metadata = File {
        name: Some(folder_name.clone()),
        mime_type: Some("application/vnd.google-apps.folder".to_string()),
        parents: Some(vec![root_folder.id.clone()]),
        ..Default::default()
    };

    let (_response, folder) = hub
        .files()
        .create(folder_metadata)
        .supports_all_drives(true)
        .upload(std::io::Cursor::new(&[]), "application/vnd.google-apps.folder".parse().unwrap())
        .await
        .map_err(|e| e.to_string())?;

    let folder_id = folder.id.ok_or("No ID")?;
    let mut image_files = Vec::new();

    if let Some(files) = file_list {
        for f in files {
            let p = PathBuf::from(&f);
            if p.exists() {
                if let Some(ext) = p.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if matches!(ext_str.as_str(), "jpg" | "jpeg" | "png") {
                        image_files.push((p, ext_str));
                    }
                }
            }
        }
    }

    let total_files = image_files.len();
    use futures::stream::{self, StreamExt};
    let indexed_files: Vec<_> = image_files.into_iter().enumerate().collect();

    let upload_results: Vec<Result<(), String>> = stream::iter(indexed_files)
        .map(|(index, (path, ext_str))| {
            let hub = hub.clone();
            let folder_id = folder_id.clone();
            let app = app.clone();
            async move {
                let name = path.file_name().unwrap().to_string_lossy().to_string();
                let _ = app.emit("upload-progress", UploadProgress {
                    step: "uploading".to_string(),
                    current: index + 1,
                    total: total_files,
                    message: format!("Uploading {}", name),
                });
                let mime = if ext_str == "png" { "image/png" } else { "image/jpeg" };
                let meta = File { name: Some(name), parents: Some(vec![folder_id]), ..Default::default() };
                let data = fs::read(&path).map_err(|e| e.to_string())?;
                hub.files().create(meta).supports_all_drives(true)
                    .upload(std::io::Cursor::new(data), mime.parse().unwrap()).await.map_err(|e| e.to_string())?;
                Ok(())
            }
        })
        .buffer_unordered(5)
        .collect()
        .await;

    for r in upload_results { r?; }

    let permission = google_drive3::api::Permission {
        role: Some("reader".to_string()),
        type_: Some("anyone".to_string()),
        ..Default::default()
    };
    let _ = hub.permissions().create(permission, &folder_id).doit().await;

    let link = format!("https://drive.google.com/drive/folders/{}", folder_id);
    let qr_data = generate_qr_code_base64(&link)?;

    let _ = app.emit("upload-progress", UploadProgress {
        step: "complete".to_string(),
        current: total_files,
        total: total_files,
        message: "Done".to_string(),
    });

    let _ = append_history_entry(&app, HistoryItem {
        timestamp: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs().to_string(),
        folder_name: folder_name.clone(),
        link: link.clone(),
        qr_data: qr_data.clone(),
    });

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
            remove_temp_image, get_history, clear_history
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}