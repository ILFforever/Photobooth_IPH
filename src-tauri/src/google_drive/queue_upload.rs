use crate::state::AppState;
use google_drive3::{api::File, DriveHub};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Manager, State};

/// Upload a single photo to an existing Google Drive folder.
/// This is designed to be used by the upload queue system.
#[tauri::command]
pub async fn upload_photo_to_drive(
    local_path: String,
    drive_folder_id: String,
    app: tauri::AppHandle,
    _state: State<'_, AppState>,
) -> Result<String, String> {
    upload_photo_to_drive_internal(local_path, drive_folder_id, app).await
}

/// Internal version of upload_photo_to_drive that can be called from the queue processor.
/// Takes AppHandle instead of State so it can be called from background tasks.
pub async fn upload_photo_to_drive_internal(
    local_path: String,
    drive_folder_id: String,
    app: AppHandle,
) -> Result<String, String> {
    // Get the AppState from the app
    let state = app.state::<AppState>();

    println!("\n📤 Queue Upload (Internal): Starting single photo upload");
    println!("   Local path: {}", local_path);
    println!("   Drive folder ID: {}", drive_folder_id);

    // Get authentication
    let auth = {
        let auth_guard = state.auth.lock().map_err(|e| format!("State lock poisoned: {}", e))?;
        auth_guard.as_ref().ok_or("Not logged in")?.clone()
    };

    // Check if upload was cancelled
    if state.upload_cancelled.load(Ordering::SeqCst) {
        return Err("Upload cancelled".to_string());
    }

    // Setup Drive client
    let https = hyper_rustls::HttpsConnectorBuilder::new()
        .with_native_roots()
        .map_err(|e| format!("HTTPS error: {}", e))?
        .https_or_http()
        .enable_http1()
        .build();

    let client = hyper::Client::builder().build(https);
    let hub = DriveHub::new(client, auth);

    // Validate file exists
    let path = PathBuf::from(&local_path);
    if !path.exists() {
        return Err(format!("File does not exist: {}", local_path));
    }

    let name = path.file_name()
        .and_then(|n| n.to_str())
        .ok_or("Invalid filename")?
        .to_string();

    // Determine MIME type
    let mime = if let Some(ext) = path.extension() {
        let ext_str = ext.to_string_lossy().to_lowercase();
        match ext_str.as_str() {
            "png" => "image/png",
            "jpg" | "jpeg" => "image/jpeg",
            "gif" => "image/gif",
            "webp" => "image/webp",
            "mp4" => "video/mp4",
            "webm" => "video/webm",
            "mov" => "video/quicktime",
            _ => return Err(format!("Unsupported file format: {}", ext_str)),
        }
    } else {
        return Err("No file extension".to_string());
    };

    println!("   📋 Filename: {}", name);
    println!("   📋 MIME type: {}", mime);

    // Read file data
    let data = fs::read(&path).map_err(|e| {
        println!("   ❌ Failed to read file: {}", e);
        e.to_string()
    })?;
    println!("   ✅ Read {} bytes", data.len());

    // Upload with retry logic
    let max_retries = 3;

    for attempt in 1..=max_retries {
        if attempt > 1 {
            println!("   🔄 Retry attempt {}/{} for: {}", attempt, max_retries, name);
            tokio::time::sleep(tokio::time::Duration::from_secs(2_u64.pow(attempt - 1))).await;
        }

        // Check for cancellation before upload attempt
        if state.upload_cancelled.load(Ordering::SeqCst) {
            println!("   ❌ Upload cancelled by user");
            return Err("Upload cancelled".to_string());
        }

        let meta = File {
            name: Some(name.clone()),
            parents: Some(vec![drive_folder_id.clone()]),
            ..Default::default()
        };

        println!("   🌐 Uploading to Drive... (attempt {})", attempt);

        match hub
            .files()
            .create(meta)
            .supports_all_drives(true)
            .upload(std::io::Cursor::new(data.as_slice()), mime.parse().expect("valid MIME type"))
            .await
        {
            Ok((_response, file)) => {
                let file_id = file.id.ok_or("No file ID returned")?;
                println!("   ✅ Upload SUCCESS: {}", name);
                println!("   📁 File ID: {}", file_id);
                return Ok(file_id);
            }
            Err(e) => {
                let error_str = e.to_string();
                println!("   ⚠️  Upload attempt {} FAILED: {}", attempt, error_str);

                // Check if it's a retryable network error
                if error_str.contains("10054")
                    || error_str.contains("connection")
                    || error_str.contains("timed out")
                    || error_str.contains("broken pipe")
                    || error_str.contains("503")
                    || error_str.contains("502")
                {
                    if attempt < max_retries {
                        println!("   ℹ️  Network error detected, will retry...");
                        continue;
                    }
                }

                // Non-retryable error or max retries exhausted
                println!("   ❌ Upload failed: {}", error_str);
                return Err(error_str);
            }
        }
    }

    Err(format!("Failed to upload after {} attempts", max_retries))
}

