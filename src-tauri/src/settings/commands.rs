use crate::settings::types::CustomCanvasSize;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Get custom canvas sizes directory in app data
fn get_custom_canvases_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let canvases_dir = app_data_dir.join("custom_canvases");
    fs::create_dir_all(&canvases_dir)
        .map_err(|e| format!("Failed to create custom canvases dir: {}", e))?;
    Ok(canvases_dir)
}

/// Save a custom canvas size to disk
#[tauri::command]
pub async fn save_custom_canvas_size(
    app: tauri::AppHandle,
    canvas: CustomCanvasSize,
) -> Result<CustomCanvasSize, String> {
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

    fs::write(canvas_path, json).map_err(|e| format!("Failed to write canvas file: {}", e))?;

    Ok(canvas_to_save)
}

/// Get all custom canvas sizes from disk
#[tauri::command]
pub async fn get_custom_canvas_sizes(app: tauri::AppHandle) -> Result<Vec<CustomCanvasSize>, String> {
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

        let json = fs::read_to_string(&path).map_err(|e| format!("Failed to read canvas file: {}", e))?;

        let canvas: CustomCanvasSize =
            serde_json::from_str(&json).map_err(|e| format!("Failed to parse canvas file: {}", e))?;

        canvases.push(canvas);
    }

    // Sort by creation date (newest first)
    canvases.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(canvases)
}

/// Delete a custom canvas size from disk
#[tauri::command]
pub async fn delete_custom_canvas_size(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let canvases_dir = get_custom_canvases_dir(&app)?;
    let canvas_path = canvases_dir.join(format!("{}.json", name));

    if !canvas_path.exists() {
        return Err(format!("Custom canvas not found: {}", name));
    }

    fs::remove_file(canvas_path).map_err(|e| format!("Failed to delete canvas: {}", e))?;

    Ok(())
}

/// Get app settings directory in app data
fn get_settings_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    Ok(app_data_dir)
}

/// Save an app setting (key-value pair stored as a JSON file)
#[tauri::command]
pub async fn save_app_setting(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> {
    let settings_dir = get_settings_dir(&app)?;
    let setting_path = settings_dir.join(format!("setting_{}.json", key));

    let setting_data = serde_json::json!({ "value": value });
    let json = serde_json::to_string_pretty(&setting_data)
        .map_err(|e| format!("Failed to serialize setting: {}", e))?;

    fs::write(setting_path, json).map_err(|e| format!("Failed to write setting file: {}", e))?;

    Ok(())
}

/// Get an app setting by key (returns null if not found)
#[tauri::command]
pub async fn get_app_setting(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> {
    let settings_dir = get_settings_dir(&app)?;
    let setting_path = settings_dir.join(format!("setting_{}.json", key));

    if !setting_path.exists() {
        return Ok(None);
    }

    let content =
        fs::read_to_string(setting_path).map_err(|e| format!("Failed to read setting file: {}", e))?;

    if content.trim().is_empty() {
        return Ok(None);
    }

    let setting_data: serde_json::Value =
        serde_json::from_str(&content).map_err(|e| format!("Failed to parse setting file: {}", e))?;

    let value = setting_data
        .get("value")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());

    Ok(value)
}
