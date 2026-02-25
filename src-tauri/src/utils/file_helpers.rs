use std::path::PathBuf;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[tauri::command]
pub async fn select_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let folder_path = app
        .dialog()
        .file()
        .set_title("Select Folder")
        .blocking_pick_folder();

    match folder_path {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn select_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let file_path = app
        .dialog()
        .file()
        .set_title("Select Image")
        .add_filter("Images", &["jpg", "jpeg", "png", "gif", "bmp", "webp", "tiff", "tif", "cr2", "cr3", "nef", "arw", "raf", "dng", "orf", "rw2"])
        .blocking_pick_file();

    match file_path {
        Some(path) => Ok(Some(path.to_string())),
        None => Ok(None),
    }
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
