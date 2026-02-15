use crate::frames::types::Frame;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

fn get_frames_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let frames_dir = app_data_dir.join("frames");
    fs::create_dir_all(&frames_dir).map_err(|e| format!("Failed to create frames dir: {}", e))?;

    Ok(frames_dir)
}

/// Initialize default frames on first run
fn initialize_default_frames(_app: &tauri::AppHandle) -> Result<(), String> {
    // No default frames - user creates their own
    Ok(())
}

/// Save a frame to disk
#[tauri::command]
pub async fn save_frame(app: tauri::AppHandle, frame: Frame) -> Result<Frame, String> {
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

    fs::write(frame_path, json).map_err(|e| format!("Failed to write frame file: {}", e))?;

    Ok(frame_to_save)
}

/// Load all frames from disk
#[tauri::command]
pub async fn load_frames(app: tauri::AppHandle) -> Result<Vec<Frame>, String> {
    // Initialize default frames if needed
    initialize_default_frames(&app)?;

    let frames_dir = get_frames_dir(&app)?;
    let mut frames = Vec::new();

    let entries =
        fs::read_dir(frames_dir).map_err(|e| format!("Failed to read frames directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) == Some("json") {
            let content =
                fs::read_to_string(&path).map_err(|e| format!("Failed to read frame file: {}", e))?;

            let frame: Frame = serde_json::from_str(&content)
                .map_err(|e| format!("Failed to parse frame JSON: {}", e))?;

            frames.push(frame);
        }
    }

    // Sort frames: default frames first, then by creation date
    frames.sort_by(|a, b| match (a.is_default, b.is_default) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => b.created_at.cmp(&a.created_at),
    });

    Ok(frames)
}

/// Delete a frame from disk
#[tauri::command]
pub async fn delete_frame(app: tauri::AppHandle, frame_id: String) -> Result<(), String> {
    let frames_dir = get_frames_dir(&app)?;
    let frame_path = frames_dir.join(format!("{}.json", frame_id));

    if !frame_path.exists() {
        return Err(format!("Frame not found: {}", frame_id));
    }

    fs::remove_file(frame_path).map_err(|e| format!("Failed to delete frame: {}", e))?;

    Ok(())
}

/// Duplicate a frame (create a copy with a new ID)
#[tauri::command]
pub async fn duplicate_frame(app: tauri::AppHandle, frame_id: String) -> Result<Frame, String> {
    let frames_dir = get_frames_dir(&app)?;
    let frame_path = frames_dir.join(format!("{}.json", frame_id));

    if !frame_path.exists() {
        return Err(format!("Frame not found: {}", frame_id));
    }

    // Load the original frame
    let frame_content =
        fs::read_to_string(&frame_path).map_err(|e| format!("Failed to read frame file: {}", e))?;
    let original: Frame = serde_json::from_str(&frame_content)
        .map_err(|e| format!("Failed to parse frame JSON: {}", e))?;

    // Create a new frame with a unique ID and is_default = false
    let duplicated = Frame {
        id: format!(
            "custom-{}-{}",
            chrono::Utc::now().timestamp(),
            uuid::Uuid::new_v4()
                .to_string()
                .chars()
                .take(8)
                .collect::<String>()
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

    fs::write(duplicated_path, json).map_err(|e| format!("Failed to write frame file: {}", e))?;

    Ok(duplicated)
}
