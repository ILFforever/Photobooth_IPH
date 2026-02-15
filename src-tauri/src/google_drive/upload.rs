use crate::history::append_history_entry;
use crate::state::AppState;
use crate::types::{HistoryItem, ProcessResult, UploadProgress};
use crate::utils::generate_qr_code_base64;
use crate::utils::generate_random_name;
use google_drive3::{api::File, DriveHub};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::Ordering;
use tauri::{Emitter, State};

#[tauri::command]
pub fn cancel_upload(state: State<'_, AppState>) {
    state.upload_cancelled.store(true, Ordering::SeqCst);
    println!("❌ Upload cancelled by user");
}

#[tauri::command]
pub async fn process_photos(
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
    println!(
        "✅ Root folder: {} (ID: {})",
        root_folder.name, root_folder.id
    );

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

    let _ = app.emit(
        "upload-progress",
        UploadProgress {
            step: "starting".to_string(),
            current: 0,
            total: 0,
            message: "Starting...".to_string(),
        },
    );
    println!("📡 Emitted 'starting' progress event");

    println!("\n📁 Creating Drive folder...");

    // Retry folder creation in case of 503 or other transient errors
    let max_folder_retries = 5;
    let mut folder_id = String::new();
    let mut last_folder_error = String::new();

    for attempt in 1..=max_folder_retries {
        if attempt > 1 {
            println!(
                "   🔄 Retry folder creation attempt {}/{}",
                attempt, max_folder_retries
            );
            tokio::time::sleep(tokio::time::Duration::from_secs(3_u64.pow(attempt - 1))).await;
        }

        let folder_metadata = File {
            name: Some(folder_name.clone()),
            mime_type: Some("application/vnd.google-apps.folder".to_string()),
            parents: Some(vec![root_folder.id.clone()]),
            ..Default::default()
        };

        println!(
            "🌐 Sending folder creation request to Google Drive... (attempt {})",
            attempt
        );
        match hub
            .files()
            .create(folder_metadata)
            .supports_all_drives(true)
            .upload(
                std::io::Cursor::new(&[]),
                "application/vnd.google-apps.folder".parse().unwrap(),
            )
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
                println!(
                    "   ⚠️  Folder creation attempt {} FAILED: {}",
                    attempt, last_folder_error
                );

                // Check if it's a retryable error (503, 500, network errors)
                if last_folder_error.contains("503")
                    || last_folder_error.contains("500")
                    || last_folder_error.contains("502")
                    || last_folder_error.contains("504")
                    || last_folder_error.contains("Service Unavailable")
                    || last_folder_error.contains("10054")
                    || last_folder_error.contains("connection")
                    || last_folder_error.contains("timed out")
                {
                    println!("   ℹ️  Transient error detected (Google server issue), will retry...");
                    if attempt == max_folder_retries {
                        println!(
                            "   ❌ All {} retry attempts exhausted for folder creation",
                            max_folder_retries
                        );
                        return Err(format!(
                            "Failed to create folder after {} attempts. Google Drive may be experiencing issues. Last error: {}",
                            max_folder_retries, last_folder_error
                        ));
                    }
                    continue;
                } else {
                    // Non-retryable error
                    println!(
                        "   ❌ Non-retryable error during folder creation: {}",
                        last_folder_error
                    );
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
                        println!(
                            "      ✅ Valid image - {} ({} bytes)",
                            ext_str.to_uppercase(),
                            metadata.len()
                        );
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
                println!(
                    "\n📤 [{}/{}] Starting upload: {}",
                    index + 1,
                    total_files,
                    name
                );
                println!("   Path: {}", path.display());

                let _ = app.emit(
                    "upload-progress",
                    UploadProgress {
                        step: "uploading".to_string(),
                        current: index + 1,
                        total: total_files,
                        message: format!("Uploading {}", name),
                    },
                );
                println!("   📡 Emitted progress event");

                let mime = if ext_str == "png" {
                    "image/png"
                } else {
                    "image/jpeg"
                };
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
                        println!(
                            "   🔄 Retry attempt {}/{} for: {}",
                            attempt, max_retries, name
                        );
                        // Wait before retrying (exponential backoff)
                        tokio::time::sleep(tokio::time::Duration::from_secs(
                            2_u64.pow(attempt - 1),
                        ))
                        .await;
                    }

                    let meta = File {
                        name: Some(name.clone()),
                        parents: Some(vec![folder_id.clone()]),
                        ..Default::default()
                    };

                    println!(
                        "   🌐 Uploading to Drive (folder_id: {})... attempt {}",
                        folder_id, attempt
                    );
                    match hub
                        .files()
                        .create(meta)
                        .supports_all_drives(true)
                        .upload(std::io::Cursor::new(data.clone()), mime.parse().unwrap())
                        .await
                    {
                        Ok(_) => {
                            println!("   ✅ Upload SUCCESS: {}", name);
                            return Ok(());
                        }
                        Err(e) => {
                            last_error = e.to_string();
                            println!("   ⚠️  Upload attempt {} FAILED: {}", attempt, last_error);

                            // Check if it's a network error that we should retry
                            if last_error.contains("10054")
                                || last_error.contains("connection")
                                || last_error.contains("timed out")
                                || last_error.contains("broken pipe")
                            {
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

                println!(
                    "   ❌ All {} retry attempts exhausted for: {}",
                    max_retries, name
                );
                Err(format!(
                    "Failed after {} attempts: {}",
                    max_retries, last_error
                ))
            }
        })
        .buffer_unordered(2) // Reduced from 5 to 2 to avoid overwhelming the connection
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

    println!(
        "\nResults: {} succeeded, {} failed",
        success_count, failed_count
    );

    for r in upload_results {
        r?;
    }

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

    hub.permissions()
        .create(permission, &folder_id)
        .doit()
        .await
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
    println!(
        "✅ QR code generated (base64 length: {} bytes)",
        qr_data.len()
    );

    println!("\n📡 Emitting 'complete' progress event...");
    let _ = app.emit(
        "upload-progress",
        UploadProgress {
            step: "complete".to_string(),
            current: total_files,
            total: total_files,
            message: "Done".to_string(),
        },
    );

    println!("💾 Saving to history...");
    let _ = append_history_entry(
        &app,
        HistoryItem {
            timestamp: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_secs()
                .to_string(),
            folder_name: folder_name.clone(),
            link: link.clone(),
            qr_data: qr_data.clone(),
        },
    );
    println!("✅ History entry saved");

    println!("\n========================================");
    println!("✅ PROCESS COMPLETE!");
    println!("========================================");
    println!("Folder: {}", folder_name);
    println!("Files uploaded: {}", total_files);
    println!("Link: {}", link);
    println!("========================================\n");

    Ok(ProcessResult {
        folder_name,
        link,
        qr_data,
    })
}
