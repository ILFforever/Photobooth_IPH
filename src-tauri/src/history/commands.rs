use crate::types::HistoryItem;
use std::fs;
use tauri::Manager;

#[tauri::command]
pub async fn get_history(app: tauri::AppHandle) -> Result<Vec<HistoryItem>, String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("history.json");
    if !path.exists() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut history: Vec<HistoryItem> =
        serde_json::from_str(&content).map_err(|e| e.to_string())?;
    history.sort_by(|a, b| b.timestamp.cmp(&a.timestamp));
    Ok(history)
}

#[tauri::command]
pub async fn clear_history(app: tauri::AppHandle) -> Result<(), String> {
    let path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("history.json");
    let _ = fs::remove_file(path);
    Ok(())
}

pub fn append_history_entry(app: &tauri::AppHandle, item: HistoryItem) -> Result<(), String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let _ = fs::create_dir_all(&dir);
    let path = dir.join("history.json");
    let mut history: Vec<HistoryItem> = if path.exists() {
        serde_json::from_str(&fs::read_to_string(&path).unwrap_or_default()).unwrap_or_default()
    } else {
        Vec::new()
    };
    history.push(item);
    fs::write(
        path,
        serde_json::to_string_pretty(&history).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
