use crate::photobooth_sessions::types::{
    DelaySettings, DriveUploadedImage, GifSettings, GoogleDriveMetadata, PhotoboothSessionInfo, PhotoboothSettings, PhotoExifData, PtbPhoto,
    PtbSessionData, PtbWorkspace,
};
use crate::working_folder::commands::generate_cached_thumbnail_high_res;
use std::fs;

/// Scan for existing session folders in the working folder
/// Sessions are identified by folder names matching the pattern: {base_name}_XXX
fn scan_existing_sessions(folder_path: &str) -> Vec<PtbSessionData> {
    let mut sessions = Vec::new();

    let folder = std::path::Path::new(folder_path);
    let base_name = folder
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("Session");

    // Read all entries in the folder
    if let Ok(entries) = fs::read_dir(folder) {
        for entry in entries.flatten() {
            let path = entry.path();

            // Skip if not a directory or if it's hidden (starts with .)
            if !path.is_dir()
                || path
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.starts_with('.'))
                    .unwrap_or(false)
            {
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
                                    .and_then(|content| {
                                        serde_json::from_str::<PtbSessionData>(&content).ok()
                                    })
                            } else {
                                // Create minimal session data from folder metadata
                                path.metadata().ok().and_then(|metadata| {
                                    Some(PtbSessionData {
                                        id: folder_name.to_string(),
                                        name: format!("Session {}", num_str),
                                        folder_name: folder_name.to_string(),
                                        created_at: metadata
                                            .created()
                                            .ok()
                                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                            .and_then(|d| {
                                                chrono::DateTime::from_timestamp(
                                                    d.as_secs() as i64,
                                                    0,
                                                )
                                                .map(|dt| dt.to_rfc3339())
                                            })
                                            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                                        last_used_at: metadata
                                            .modified()
                                            .ok()
                                            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                            .and_then(|d| {
                                                chrono::DateTime::from_timestamp(
                                                    d.as_secs() as i64,
                                                    0,
                                                )
                                                .map(|dt| dt.to_rfc3339())
                                            })
                                            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                                        shot_count: 0,
                                        photos: Vec::new(),
                                        google_drive_metadata: GoogleDriveMetadata::default(),
                                        qr_upload_enabled: true,
                                        qr_upload_all_images: false,
                                        photo_naming_scheme: "IPH_{number}".to_string(),
                                    })
                                })
                            };

                            if let Some(data) = session_data {
                                println!(
                                    "[scan_existing_sessions] Found existing session: {}",
                                    folder_name
                                );
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
            .map_err(|e| format!("The workspace file (.ptb) is corrupted and could not be read ({}). Open the file to fix it manually, or choose a new folder.", e))?;
        println!(
            "[load_ptb_workspace_internal] Loaded existing .ptb file with {} sessions",
            workspace.sessions.len()
        );
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
            delay_settings: DelaySettings::default(),
            photobooth_settings: PhotoboothSettings::default(),
            gif_settings: GifSettings::default(),
        };

        // Save the new workspace to disk
        let json = serde_json::to_string_pretty(&workspace)
            .map_err(|e| format!("Failed to serialize .ptb workspace: {}", e))?;
        fs::write(&ptb_path, json)
            .map_err(|e| format!("Failed to write .ptb file: {}", e))?;

        println!(
            "[load_ptb_workspace_internal] Created new .ptb file at: {:?} with {} existing sessions",
            ptb_path,
            workspace.sessions.len()
        );
        Ok((workspace, true))
    }
}

/// Load or create .ptb workspace file at root level (Tauri command wrapper)
#[tauri::command]
pub async fn load_ptb_workspace(folder_path: String) -> Result<PtbWorkspace, String> {
    load_ptb_workspace_internal(folder_path)
        .await
        .map(|(w, _)| w)
}

/// Save .ptb workspace file at root level
#[tauri::command]
pub async fn save_ptb_workspace(
    folder_path: String,
    workspace: PtbWorkspace,
) -> Result<(), String> {
    let ptb_path = std::path::Path::new(&folder_path).join(".ptb");

    let workspace_to_save = PtbWorkspace {
        last_used_at: chrono::Utc::now().to_rfc3339(),
        ..workspace
    };

    let json = serde_json::to_string_pretty(&workspace_to_save)
        .map_err(|e| format!("Failed to serialize .ptb workspace: {}", e))?;

    fs::write(&ptb_path, json).map_err(|e| format!("Failed to write .ptb file: {}", e))?;

    Ok(())
}

/// Save delay settings to the .ptb workspace file
#[tauri::command]
pub async fn save_delay_settings(
    folder_path: String,
    delay_settings: DelaySettings,
) -> Result<(), String> {
    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    workspace.delay_settings = delay_settings;
    workspace.last_used_at = chrono::Utc::now().to_rfc3339();

    save_ptb_workspace(folder_path, workspace).await?;
    Ok(())
}

/// Save photobooth settings (QR upload, photo naming) to the .ptb workspace file
#[tauri::command]
pub async fn save_photobooth_settings(
    folder_path: String,
    photobooth_settings: PhotoboothSettings,
) -> Result<(), String> {
    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    workspace.photobooth_settings = photobooth_settings;
    workspace.last_used_at = chrono::Utc::now().to_rfc3339();

    save_ptb_workspace(folder_path, workspace).await?;
    Ok(())
}

/// Save GIF settings to the .ptb workspace file
#[tauri::command]
pub async fn save_gif_settings(
    folder_path: String,
    gif_settings: GifSettings,
) -> Result<(), String> {
    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    workspace.gif_settings = gif_settings;
    workspace.last_used_at = chrono::Utc::now().to_rfc3339();

    save_ptb_workspace(folder_path, workspace).await?;
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
        google_drive_metadata: session.google_drive_metadata.clone(),
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
                let is_image = path
                    .extension()
                    .and_then(|ext| ext.to_str())
                    .map(|ext| {
                        ext.eq_ignore_ascii_case("jpg")
                            || ext.eq_ignore_ascii_case("jpeg")
                            || ext.eq_ignore_ascii_case("png")
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
        google_drive_metadata: session.google_drive_metadata.clone(),
    }
}

/// List all sessions from the .ptb file with thumbnails
/// Returns (sessions, was_ptb_created) where was_ptb_created indicates if a new .ptb file was created
#[tauri::command]
pub async fn list_photobooth_sessions(
    folder_path: String,
    app: tauri::AppHandle,
) -> Result<(Vec<PhotoboothSessionInfo>, bool), String> {
    let (workspace, was_created) = load_ptb_workspace_internal(folder_path.clone()).await?;

    // Convert sessions to info format with thumbnails (in parallel for performance)
    let sessions_futures: Vec<_> = workspace
        .sessions
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
pub async fn create_photobooth_session(
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
    println!(
        "[create_photobooth_session] Looking for sessions starting with '{}_'",
        base_name
    );
    println!(
        "[create_photobooth_session] Total sessions in workspace: {}",
        workspace.sessions.len()
    );
    for session in &workspace.sessions {
        println!(
            "[create_photobooth_session] Checking session: folder_name='{}'",
            session.folder_name
        );
        if session
            .folder_name
            .starts_with(&format!("{}_", base_name))
        {
            // Extract number from folder name like "Myshoot_001"
            if let Some(num_str) = session.folder_name.split('_').last() {
                println!(
                    "[create_photobooth_session] Found number part: '{}'",
                    num_str
                );
                if let Ok(num) = num_str.parse::<u32>() {
                    println!(
                        "[create_photobooth_session] Parsed number: {}, current next_num: {}",
                        num, next_num
                    );
                    if num >= next_num {
                        next_num = num + 1;
                        println!(
                            "[create_photobooth_session] Updated next_num to: {}",
                            next_num
                        );
                    }
                }
            }
        }
    }
    println!(
        "[create_photobooth_session] Final next_num: {}, will create session: {}",
        next_num,
        format!("{}_{:03}", base_name, next_num)
    );

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
        google_drive_metadata: GoogleDriveMetadata::default(),
        qr_upload_enabled: true,
        qr_upload_all_images: false,
        photo_naming_scheme: "IPH_{number}".to_string(),
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
pub async fn get_current_session(
    folder_path: String,
) -> Result<Option<PhotoboothSessionInfo>, String> {
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
pub async fn set_current_session(folder_path: String, session_id: String) -> Result<(), String> {
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
pub async fn get_session_data(
    folder_path: String,
    session_id: String,
) -> Result<PtbSessionData, String> {
    let (workspace, _) = load_ptb_workspace_internal(folder_path).await?;

    if let Some(session) = workspace.sessions.iter().find(|s| s.id == session_id) {
        Ok(session.clone())
    } else {
        Err(format!("Session not found: {}", session_id))
    }
}

/// Update Google Drive metadata for a session
#[tauri::command]
pub async fn update_session_drive_metadata(
    folder_path: String,
    session_id: String,
    folder_id: Option<String>,
    folder_name: Option<String>,
    folder_link: Option<String>,
    account_id: Option<String>,
) -> Result<(), String> {
    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    if let Some(session) = workspace.sessions.iter_mut().find(|s| s.id == session_id) {
        session.google_drive_metadata.folder_id = folder_id;
        session.google_drive_metadata.folder_name = folder_name;
        session.google_drive_metadata.folder_link = folder_link;
        session.google_drive_metadata.account_id = account_id;
        session.last_used_at = chrono::Utc::now().to_rfc3339();

        save_ptb_workspace(folder_path, workspace).await?;
        Ok(())
    } else {
        Err(format!("Session not found: {}", session_id))
    }
}

/// Add an uploaded image to session's Google Drive metadata
#[tauri::command]
pub async fn add_session_drive_upload(
    folder_path: String,
    session_id: String,
    filename: String,
    drive_file_id: String,
) -> Result<(), String> {
    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    if let Some(session) = workspace.sessions.iter_mut().find(|s| s.id == session_id) {
        let upload = DriveUploadedImage {
            filename,
            drive_file_id,
            uploaded_at: chrono::Utc::now().to_rfc3339(),
        };
        session.google_drive_metadata.uploaded_images.push(upload);
        session.last_used_at = chrono::Utc::now().to_rfc3339();

        save_ptb_workspace(folder_path, workspace).await?;
        Ok(())
    } else {
        Err(format!("Session not found: {}", session_id))
    }
}

/// Check if an image has been uploaded to Google Drive for a session
#[tauri::command]
pub async fn is_image_uploaded_to_drive(
    folder_path: String,
    session_id: String,
    filename: String,
) -> Result<bool, String> {
    let (workspace, _) = load_ptb_workspace_internal(folder_path).await?;

    if let Some(session) = workspace.sessions.iter().find(|s| s.id == session_id) {
        let is_uploaded = session
            .google_drive_metadata
            .uploaded_images
            .iter()
            .any(|img| img.filename == filename);
        Ok(is_uploaded)
    } else {
        Err(format!("Session not found: {}", session_id))
    }
}

/// Clear all uploaded images from session's Google Drive metadata
#[tauri::command]
pub async fn clear_session_drive_uploads(
    folder_path: String,
    session_id: String,
) -> Result<(), String> {
    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    if let Some(session) = workspace.sessions.iter_mut().find(|s| s.id == session_id) {
        session.google_drive_metadata.uploaded_images.clear();
        session.last_used_at = chrono::Utc::now().to_rfc3339();

        save_ptb_workspace(folder_path, workspace).await?;
        Ok(())
    } else {
        Err(format!("Session not found: {}", session_id))
    }
}

/// Update QR upload setting for a session
#[tauri::command]
pub async fn update_session_qr_setting(
    folder_path: String,
    session_id: String,
    qr_upload_all_images: bool,
    qr_upload_enabled: Option<bool>,
) -> Result<(), String> {
    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    if let Some(session) = workspace.sessions.iter_mut().find(|s| s.id == session_id) {
        session.qr_upload_all_images = qr_upload_all_images;
        if let Some(enabled) = qr_upload_enabled {
            session.qr_upload_enabled = enabled;
        }
        session.last_used_at = chrono::Utc::now().to_rfc3339();

        save_ptb_workspace(folder_path, workspace).await?;
        Ok(())
    } else {
        Err(format!("Session not found: {}", session_id))
    }
}

/// Update photo naming scheme for a session
#[tauri::command]
pub async fn update_session_naming_scheme(
    folder_path: String,
    session_id: String,
    photo_naming_scheme: String,
) -> Result<(), String> {
    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    if let Some(session) = workspace.sessions.iter_mut().find(|s| s.id == session_id) {
        session.photo_naming_scheme = photo_naming_scheme;
        session.last_used_at = chrono::Utc::now().to_rfc3339();

        save_ptb_workspace(folder_path, workspace).await?;
        Ok(())
    } else {
        Err(format!("Session not found: {}", session_id))
    }
}

/// Save photo data to session folder and update root .ptb file
/// Photos are saved to: {working_folder}/{session_id}/{filename}
#[tauri::command]
pub async fn save_photo_to_working_folder(
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

/// Check if a file exists in the session folder
#[tauri::command]
pub async fn file_exists_in_session(
    folder_path: String,
    session_id: String,
    filename: String,
) -> Result<bool, String> {
    let session_folder = std::path::Path::new(&folder_path).join(&session_id);
    let file_path = session_folder.join(&filename);
    Ok(file_path.exists())
}

/// Save file to session folder WITHOUT updating session metadata (.ptb)
/// Use this for collages and other files that shouldn't appear in the photo list
/// Files are saved to: {working_folder}/{session_id}/{filename}
#[tauri::command]
pub async fn save_file_to_session_folder(
    folder_path: String,
    session_id: String,
    filename: String,
    file_data: Vec<u8>,
) -> Result<(), String> {
    // Build the session folder path
    let session_folder = std::path::Path::new(&folder_path).join(&session_id);

    // Ensure session folder exists
    if !session_folder.exists() {
        fs::create_dir_all(&session_folder)
            .map_err(|e| format!("Failed to create session folder: {}", e))?;
    }

    // Save the file in the session folder
    let file_path = session_folder.join(&filename);
    fs::write(&file_path, &file_data).map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(())
}

/// Save file data to an arbitrary path (used by export/save-as dialogs)
#[tauri::command]
pub async fn save_file_to_path(
    file_path: String,
    file_data: Vec<u8>,
) -> Result<(), String> {
    let path = std::path::Path::new(&file_path);
    if let Some(parent) = path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        }
    }
    fs::write(path, &file_data).map_err(|e| format!("Failed to write file: {}", e))?;
    Ok(())
}

/// Download photo directly from daemon and save to session folder
/// This is much faster than passing binary data through JS/IPC
/// Photos are saved to: {working_folder}/{session_id}/{filename}
#[tauri::command]
pub async fn download_photo_from_daemon(
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
    println!(
        "[Rust::download_photo_from_daemon] folder_path: {}",
        folder_path
    );
    println!(
        "[Rust::download_photo_from_daemon] session_id: {}",
        session_id
    );
    println!("[Rust::download_photo_from_daemon] filename: {}", filename);
    println!(
        "[Rust::download_photo_from_daemon] camera_path: {}",
        camera_path
    );
    println!(
        "[Rust::download_photo_from_daemon] original_daemon_path: {}",
        original_daemon_path
    );
    println!(
        "[Rust::download_photo_from_daemon] photo_naming_scheme: {}",
        photo_naming_scheme
    );

    // Download photo directly from daemon
    let photo_url = format!("{}/api/photo/{}", daemon_url, filename);
    println!(
        "[Rust::download_photo_from_daemon] photo_url: {}",
        photo_url
    );

    let client = reqwest::Client::new();
    let response = client.get(&photo_url).send().await.map_err(|e| {
        println!(
            "[Rust::download_photo_from_daemon] ERROR: Failed to fetch photo from daemon: {}",
            e
        );
        format!("Failed to fetch photo from daemon: {}", e)
    })?;

    println!(
        "[Rust::download_photo_from_daemon] response status: {}",
        response.status()
    );

    if !response.status().is_success() {
        println!("[Rust::download_photo_from_daemon] ERROR: Daemon returned non-success status");
        return Err(format!("Daemon returned error: {}", response.status()));
    }

    let photo_data = response.bytes().await.map_err(|e| {
        println!(
            "[Rust::download_photo_from_daemon] ERROR: Failed to read photo data: {}",
            e
        );
        format!("Failed to read photo data: {}", e)
    })?;

    println!(
        "[Rust::download_photo_from_daemon] photo_data size: {} bytes",
        photo_data.len()
    );

    // Load workspace first to determine the next photo number
    println!("[Rust::download_photo_from_daemon] Loading workspace to determine photo number");
    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;
    println!(
        "[Rust::download_photo_from_daemon] Workspace loaded, sessions count: {}",
        workspace.sessions.len()
    );

    // Find the session and determine the next photo number
    let (next_photo_num, session_folder) = if let Some(session) =
        workspace.sessions.iter().find(|s| s.id == session_id)
    {
        // Use shot_count instead of photos.len() to handle deletions correctly
        // shot_count tracks total photos taken, not current count
        let next_num = session.shot_count + 1;
        let folder = std::path::Path::new(&folder_path).join(&session.folder_name);
        println!(
            "[Rust::download_photo_from_daemon] Session found: {}, next photo number: {}",
            session.name, next_num
        );
        (next_num, folder)
    } else {
        println!(
            "[Rust::download_photo_from_daemon] ERROR: Session not found: {}",
            session_id
        );
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

    println!(
        "[Rust::download_photo_from_daemon] Generated custom filename: {}",
        custom_filename
    );

    // Save the photo file with the custom name
    let custom_photo_path = session_folder.join(&custom_filename);
    fs::write(&custom_photo_path, &photo_data).map_err(|e| {
        println!(
            "[Rust::download_photo_from_daemon] ERROR: Failed to write photo file: {}",
            e
        );
        format!("Failed to write photo file: {}", e)
    })?;
    println!(
        "[Rust::download_photo_from_daemon] Photo file written with custom name: {:?}",
        custom_photo_path
    );

    // Find and update the session
    let updated_session = if let Some(session) =
        workspace.sessions.iter_mut().find(|s| s.id == session_id)
    {
        println!("[Rust::download_photo_from_daemon] Found session, adding photo entry");
        let photo_entry = PtbPhoto {
            filename: custom_filename.clone(),
            original_path: original_daemon_path,
            camera_path,
            captured_at: chrono::Utc::now().to_rfc3339(),
        };
        session.photos.push(photo_entry);
        session.shot_count += 1; // Increment shot counter (handles deletions correctly)
        session.last_used_at = chrono::Utc::now().to_rfc3339();
        println!(
            "[Rust::download_photo_from_daemon] Session updated, shot_count: {}",
            session.shot_count
        );

        Some(session.clone())
    } else {
        println!(
            "[Rust::download_photo_from_daemon] ERROR: Session not found: {}",
            session_id
        );
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
            println!(
                "[Rust::download_photo_from_daemon] Deleted photo from daemon: {}",
                filename
            );
        }
        Ok(resp) => {
            eprintln!(
                "[Rust::download_photo_from_daemon] WARN: Failed to delete photo from daemon (status {}): {}",
                resp.status(),
                filename
            );
        }
        Err(e) => {
            eprintln!(
                "[Rust::download_photo_from_daemon] WARN: Failed to delete photo from daemon: {} - {}",
                filename, e
            );
        }
    }

    println!("[Rust::download_photo_from_daemon] END - returning session");
    Ok(updated_session.unwrap())
}

/// Delete a single photo from a session
/// Removes the photo file from disk and updates the session metadata
#[tauri::command]
pub async fn delete_session_photo(
    folder_path: String,
    session_id: String,
    filename: String,
) -> Result<PtbSessionData, String> {
    println!("[delete_session_photo] Starting deletion for photo: {} in session: {}", filename, session_id);

    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    // Find the session to get its folder name
    let session_folder_name = workspace
        .sessions
        .iter()
        .find(|s| s.id == session_id)
        .map(|s| s.folder_name.clone());

    if session_folder_name.is_none() {
        println!("[delete_session_photo] Session not found: {}", session_id);
        return Err(format!("Session not found: {}", session_id));
    }

    let session_folder_name = session_folder_name.unwrap();
    println!(
        "[delete_session_photo] Found session folder name: {}",
        session_folder_name
    );

    // Delete the photo file from disk
    let photo_path = std::path::Path::new(&folder_path).join(&session_folder_name).join(&filename);
    println!("[delete_session_photo] Deleting photo: {:?}", photo_path);

    if photo_path.exists() {
        fs::remove_file(&photo_path)
            .map_err(|e| {
                format!(
                    "Failed to delete photo file '{}': {}",
                    photo_path.display(),
                    e
                )
            })?;
        println!(
            "[delete_session_photo] Successfully deleted photo: {:?}",
            photo_path
        );
    } else {
        println!(
            "[delete_session_photo] Photo file does not exist: {:?}",
            photo_path
        );
    }

    // Remove photo from session metadata and update workspace
    let updated_session = if let Some(session) = workspace.sessions.iter_mut().find(|s| s.id == session_id) {
        println!("[delete_session_photo] Removing photo from session metadata");

        // Also remove from Google Drive uploaded images if present
        session.google_drive_metadata.uploaded_images.retain(|img| img.filename != filename);

        // Remove from photos array
        let original_len = session.photos.len();
        session.photos.retain(|p| p.filename != filename);
        let removed_count = original_len - session.photos.len();

        if removed_count > 0 {
            println!("[delete_session_photo] Removed {} photo(s) from metadata", removed_count);
        } else {
            println!("[delete_session_photo] WARN: Photo was not in photos array");
        }

        // Don't reset shot_count - it should keep increasing to track highest photo number
        // session.shot_count = session.photos.len() as u32;  // REMOVED - this was causing duplicates
        session.last_used_at = chrono::Utc::now().to_rfc3339();

        Some(session.clone())
    } else {
        println!(
            "[delete_session_photo] ERROR: Session not found: {}",
            session_id
        );
        return Err(format!("Session not found: {}", session_id));
    };

    // Save updated workspace
    println!("[delete_session_photo] Saving workspace");
    save_ptb_workspace(folder_path, workspace).await?;
    println!("[delete_session_photo] Workspace saved successfully");

    println!("[delete_session_photo] END - deletion complete");
    Ok(updated_session.unwrap())
}

/// Delete a photobooth session
/// Removes the session folder from disk and removes it from the workspace
#[tauri::command]
pub async fn delete_photobooth_session(
    folder_path: String,
    session_id: String,
) -> Result<(), String> {
    println!("[delete_photobooth_session] Starting deletion for session: {}", session_id);

    let (mut workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    // Find the session to get its folder name
    let session_folder_name = workspace
        .sessions
        .iter()
        .find(|s| s.id == session_id)
        .map(|s| s.folder_name.clone());

    if session_folder_name.is_none() {
        println!("[delete_photobooth_session] Session not found: {}", session_id);
        return Err(format!("Session not found: {}", session_id));
    }

    let session_folder_name = session_folder_name.unwrap();
    println!(
        "[delete_photobooth_session] Found session folder name: {}",
        session_folder_name
    );

    // Delete the session folder from disk
    let session_folder_path = std::path::Path::new(&folder_path).join(&session_folder_name);
    println!(
        "[delete_photobooth_session] Deleting folder: {:?}",
        session_folder_path
    );

    if session_folder_path.exists() {
        fs::remove_dir_all(&session_folder_path)
            .map_err(|e| {
                format!(
                    "Failed to delete session folder '{}': {}",
                    session_folder_path.display(),
                    e
                )
            })?;
        println!(
            "[delete_photobooth_session] Successfully deleted folder: {:?}",
            session_folder_path
        );
    } else {
        println!(
            "[delete_photobooth_session] Session folder does not exist: {:?}",
            session_folder_path
        );
    }

    // Remove session from workspace
    let original_len = workspace.sessions.len();
    workspace.sessions.retain(|s| s.id != session_id);

    if workspace.sessions.len() == original_len {
        println!(
            "[delete_photobooth_session] WARN: Session was not in workspace list: {}",
            session_id
        );
    } else {
        println!(
            "[delete_photobooth_session] Removed session from workspace, remaining: {}",
            workspace.sessions.len()
        );
    }

    // If the deleted session was the current session, clear current_session_id
    // or set it to the first available session
    if workspace.current_session_id.as_ref() == Some(&session_id) {
        if let Some(first_session) = workspace.sessions.first() {
            workspace.current_session_id = Some(first_session.id.clone());
            println!(
                "[delete_photobooth_session] Changed current session to: {}",
                first_session.id
            );
        } else {
            workspace.current_session_id = None;
            println!(
                "[delete_photobooth_session] No sessions remaining, cleared current_session_id"
            );
        }
    }

    // Save updated workspace
    save_ptb_workspace(folder_path, workspace).await?;
    println!("[delete_photobooth_session] Workspace saved successfully");

    println!("[delete_photobooth_session] END - deletion complete");
    Ok(())
}

/// Get EXIF metadata for a photo in a session
#[tauri::command]
pub async fn get_photo_exif(
    folder_path: String,
    session_id: String,
    filename: String,
) -> Result<PhotoExifData, String> {
    println!("[get_photo_exif] Getting EXIF for: {} in session: {}", filename, session_id);

    // Load workspace to find the session folder name
    let (workspace, _) = load_ptb_workspace_internal(folder_path.clone()).await?;

    let session_folder_name = workspace
        .sessions
        .iter()
        .find(|s| s.id == session_id)
        .map(|s| s.folder_name.clone())
        .ok_or_else(|| format!("Session not found: {}", session_id))?;

    // Build the full photo path
    let photo_path = std::path::Path::new(&folder_path)
        .join(&session_folder_name)
        .join(&filename);

    if !photo_path.exists() {
        return Err(format!("Photo file not found: {:?}", photo_path));
    }

    // Get file metadata
    let metadata = fs::metadata(&photo_path)
        .map_err(|e| format!("Failed to read photo metadata: {}", e))?;
    let file_size = Some(metadata.len());

    // Try to read EXIF data using rexif
    let exif_data = rexif::parse_file(&photo_path).ok();

    let mut image_width: Option<u32> = None;
    let mut image_height: Option<u32> = None;
    let mut make: Option<String> = None;
    let mut model: Option<String> = None;
    let mut iso: Option<u32> = None;
    let mut aperture: Option<String> = None;
    let mut shutter_speed: Option<String> = None;
    let mut focal_length: Option<String> = None;
    let mut date_taken: Option<String> = None;

    if let Some(exif) = exif_data {
        for entry in &exif.entries {
            match entry.tag {
                rexif::ExifTag::Make => {
                    if let rexif::TagValue::Ascii(ref val) = entry.value {
                        make = Some(val.trim().to_string());
                    }
                }
                rexif::ExifTag::Model => {
                    if let rexif::TagValue::Ascii(ref val) = entry.value {
                        model = Some(val.trim().to_string());
                    }
                }
                rexif::ExifTag::ISOSpeedRatings => {
                    if let rexif::TagValue::U16(ref shorts) = entry.value {
                        if let Some(&val) = shorts.first() {
                            iso = Some(val as u32);
                        }
                    } else if let rexif::TagValue::U32(ref vals) = entry.value {
                        if let Some(&val) = vals.first() {
                            iso = Some(val);
                        }
                    }
                }
                rexif::ExifTag::FNumber => {
                    if let rexif::TagValue::URational(ref rats) = entry.value {
                        if let Some(rat) = rats.first() {
                            if rat.denominator > 0 {
                                let f_val = rat.numerator as f64 / rat.denominator as f64;
                                aperture = Some(format!("f/{:.1}", f_val));
                            }
                        }
                    }
                }
                rexif::ExifTag::ExposureTime => {
                    if let rexif::TagValue::URational(ref rats) = entry.value {
                        if let Some(rat) = rats.first() {
                            if rat.numerator > 0 && rat.denominator > 0 {
                                let exposure = rat.numerator as f64 / rat.denominator as f64;
                                if exposure >= 1.0 {
                                    shutter_speed = Some(format!("{}s", exposure));
                                } else {
                                    shutter_speed = Some(format!("1/{}", (rat.denominator as f64 / rat.numerator as f64).round() as u32));
                                }
                            }
                        }
                    }
                }
                rexif::ExifTag::FocalLength => {
                    if let rexif::TagValue::URational(ref rats) = entry.value {
                        if let Some(rat) = rats.first() {
                            if rat.denominator > 0 {
                                let focal_val = rat.numerator as f64 / rat.denominator as f64;
                                focal_length = Some(format!("{}mm", focal_val.round()));
                            }
                        }
                    }
                }
                rexif::ExifTag::DateTimeOriginal => {
                    if let rexif::TagValue::Ascii(ref val) = entry.value {
                        date_taken = Some(val.trim().to_string());
                    }
                }
                _ => {}
            }
        }
    }

    // If width/height not found in EXIF, try reading from JPEG header
    if image_width.is_none() || image_height.is_none() {
        if let Ok(jpeg_data) = fs::read(&photo_path) {
            if let Ok(decompress) = mozjpeg::Decompress::new_mem(&jpeg_data) {
                image_width = Some(decompress.width() as u32);
                image_height = Some(decompress.height() as u32);
            }
        }
    }

    Ok(PhotoExifData {
        filename,
        file_size,
        image_width,
        image_height,
        make,
        model,
        iso,
        aperture,
        shutter_speed,
        focal_length,
        date_taken,
    })
}
