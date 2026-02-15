use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn select_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .pick_folder(|folder_path| {
            println!("Selected folder: {:?}", folder_path);
        });
    Ok(None)
}

#[tauri::command]
pub async fn select_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    app.dialog()
        .file()
        .pick_file(|file_path| {
            println!("Selected file: {:?}", file_path);
        });
    Ok(None)
}

#[tauri::command]
pub fn get_file_info(file_path: String) -> Result<crate::types::FileInfo, String> {
    let metadata = std::fs::metadata(&file_path)
        .map_err(|e| format!("Failed to get file info: {}", e))?;
    Ok(crate::types::FileInfo {
        size: metadata.len(),
    })
}

#[allow(dead_code)]
pub fn get_app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data directory: {}", e))
}
