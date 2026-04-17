use crate::display_layouts::types::{DisplayLayout, DisplayLayoutPreview};
use base64::{engine::general_purpose, Engine as _};
use percent_encoding::percent_decode;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Portable export format that embeds all images as base64
#[derive(Serialize, Deserialize)]
struct PortableDisplayLayout {
    version: u32,
    layout: DisplayLayout,
    /// Map of resource key -> base64-encoded file data
    /// Keys: "thumbnail", "background", "element_0", "element_1", etc.
    resources: HashMap<String, String>,
}

/// Read a file from an asset:// or http://asset.localhost/ path and return base64-encoded data
fn read_asset_as_base64(asset_path: &str) -> Option<String> {
    let file_path = if asset_path.starts_with("http://asset.localhost/") {
        let path_part = asset_path.trim_start_matches("http://asset.localhost/");
        percent_decode(path_part.as_bytes())
            .decode_utf8()
            .map(|c| c.to_string())
            .unwrap_or_else(|_| path_part.to_string())
    } else if asset_path.starts_with("asset://") {
        asset_path.trim_start_matches("asset://").to_string()
    } else {
        asset_path.to_string()
    };
    let path = PathBuf::from(&file_path);
    if path.exists() {
        if let Ok(data) = fs::read(&path) {
            return Some(general_purpose::STANDARD.encode(&data));
        }
    }
    None
}

/// Get file extension from a path/URL string
fn get_asset_extension(path: &str) -> String {
    // Strip query strings (e.g. asset://...thumbnail.jpg?v=1)
    let clean = path.split('?').next().unwrap_or(path);
    PathBuf::from(clean)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin")
        .to_lowercase()
}

fn get_display_layouts_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let dir = app_data_dir.join("display_layouts");
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create display layouts dir: {}", e))?;
    Ok(dir)
}

#[tauri::command]
pub async fn save_display_layout(
    app: tauri::AppHandle,
    mut layout: DisplayLayout,
) -> Result<DisplayLayout, String> {
    let layouts_dir = get_display_layouts_dir(&app)?;

    if layout.id.is_empty() {
        layout.id = format!("layout-{}", uuid::Uuid::new_v4());
    }

    let now = chrono::Utc::now().to_rfc3339();
    if layout.created_at.is_empty() {
        layout.created_at = now.clone();
    }
    layout.modified_at = now;

    let layout_dir = layouts_dir.join(&layout.id);
    fs::create_dir_all(&layout_dir)
        .map_err(|e| format!("Failed to create layout dir: {}", e))?;

    if let Some(thumbnail_data) = &layout.thumbnail {
        if thumbnail_data.starts_with("data:image") {
            if let Some(comma_pos) = thumbnail_data.find(',') {
                let base64_data = &thumbnail_data[comma_pos + 1..];
                if let Ok(image_data) = general_purpose::STANDARD.decode(base64_data) {
                    let thumbnail_path = layout_dir.join("thumbnail.jpg");
                    if fs::write(&thumbnail_path, image_data).is_ok() {
                        let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
                        layout.thumbnail = Some(format!("asset://{}", path_str));
                    }
                }
            }
        }
    }

    if let Some(ref bg_image) = layout.background_image {
        if !bg_image.contains(&format!("display_layouts/{}/", layout.id)) {
            let original_path = if bg_image.starts_with("http://asset.localhost/") {
                let path_part = bg_image.trim_start_matches("http://asset.localhost/");
                percent_decode(path_part.as_bytes())
                    .decode_utf8()
                    .map(|c| c.to_string())
                    .unwrap_or_else(|_| path_part.to_string())
            } else if bg_image.starts_with("asset://") {
                bg_image.trim_start_matches("asset://").to_string()
            } else {
                bg_image.clone()
            };

            if original_path.starts_with("data:image") {
                if let Some(comma_pos) = original_path.find(',') {
                    let base64_data = &original_path[comma_pos + 1..];
                    if let Ok(image_data) = general_purpose::STANDARD.decode(base64_data) {
                        let bg_path = layout_dir.join("background.jpg");
                        if fs::write(&bg_path, image_data).is_ok() {
                            let path_str = bg_path.to_string_lossy().replace('\\', "/");
                            layout.background_image = Some(format!("asset://{}", path_str));
                        }
                    }
                }
            } else {
                let src_path = PathBuf::from(&original_path);
                if src_path.exists() {
                    let filename = src_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or("background.jpg");
                    let dest_path = layout_dir.join(filename);
                    if fs::copy(&src_path, &dest_path).is_ok() {
                        let path_str = dest_path.to_string_lossy().replace('\\', "/");
                        layout.background_image = Some(format!("asset://{}", path_str));
                    }
                }
            }
        }
    }

    for (index, element) in layout.elements.iter_mut().enumerate() {
        if let Some(ref source) = element.source_path {
            if source.contains(&format!("display_layouts/{}/", layout.id)) {
                continue;
            }

            let original_path = if source.starts_with("http://asset.localhost/") {
                let path_part = source.trim_start_matches("http://asset.localhost/");
                percent_decode(path_part.as_bytes())
                    .decode_utf8()
                    .map(|c| c.to_string())
                    .unwrap_or_else(|_| path_part.to_string())
            } else if source.starts_with("asset://") {
                source.trim_start_matches("asset://").to_string()
            } else {
                source.clone()
            };

            if original_path.starts_with("data:image") {
                if let Some(comma_pos) = original_path.find(',') {
                    let base64_data = &original_path[comma_pos + 1..];
                    if let Ok(image_data) = general_purpose::STANDARD.decode(base64_data) {
                        let ext = if original_path.contains("png") { "png" } else { "jpg" };
                        let filename = format!("element_{}.{}", index, ext);
                        let dest_path = layout_dir.join(&filename);
                        if fs::write(&dest_path, image_data).is_ok() {
                            let path_str = dest_path.to_string_lossy().replace('\\', "/");
                            element.source_path = Some(format!("asset://{}", path_str));
                        }
                    }
                }
            } else {
                let src_path = PathBuf::from(&original_path);
                if src_path.exists() {
                    let default_filename = format!("element_{}.png", index);
                    let filename = src_path
                        .file_name()
                        .and_then(|n| n.to_str())
                        .unwrap_or(&default_filename);
                    let dest_filename = format!("{}_{}", index, filename);
                    let dest_path = layout_dir.join(&dest_filename);
                    if fs::copy(&src_path, &dest_path).is_ok() {
                        let path_str = dest_path.to_string_lossy().replace('\\', "/");
                        element.source_path = Some(format!("asset://{}", path_str));
                    }
                }
            }
        }
    }

    // Cleanup unused files in the layout directory
    if let Ok(entries) = fs::read_dir(&layout_dir) {
        let mut used_filenames = std::collections::HashSet::new();

        let extract_filename = |url: &str| -> Option<String> {
            if url.starts_with("asset://") {
                PathBuf::from(url.trim_start_matches("asset://"))
                    .file_name()
                    .and_then(|n| n.to_str())
                    .map(|s| s.to_string())
            } else {
                None
            }
        };

        if let Some(thumb) = &layout.thumbnail {
            if let Some(name) = extract_filename(thumb) {
                used_filenames.insert(name);
            }
        }

        if let Some(bg) = &layout.background_image {
            if let Some(name) = extract_filename(bg) {
                used_filenames.insert(name);
            }
        }

        for element in &layout.elements {
            if let Some(src) = &element.source_path {
                if let Some(name) = extract_filename(src) {
                    used_filenames.insert(name);
                }
            }
        }

        for entry in entries.filter_map(Result::ok) {
            let path = entry.path();
            if path.is_file() {
                if let Some(file_name) = path.file_name().and_then(|n| n.to_str()) {
                    if !used_filenames.contains(file_name) {
                        let _ = fs::remove_file(&path);
                    }
                }
            }
        }
    }

    let layout_path = layouts_dir.join(format!("{}.json", layout.id));
    let json = serde_json::to_string_pretty(&layout)
        .map_err(|e| format!("Failed to serialize display layout: {}", e))?;
    fs::write(layout_path, json)
        .map_err(|e| format!("Failed to write display layout file: {}", e))?;

    Ok(layout)
}

#[tauri::command]
pub async fn load_display_layouts(
    app: tauri::AppHandle,
) -> Result<Vec<DisplayLayoutPreview>, String> {
    let layouts_dir = get_display_layouts_dir(&app)?;
    let mut layouts = Vec::new();

    if !layouts_dir.exists() {
        return Ok(layouts);
    }

    let entries = fs::read_dir(&layouts_dir)
        .map_err(|e| format!("Failed to read display layouts directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        let json = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read display layout file: {}", e))?;

        let layout: DisplayLayout = serde_json::from_str(&json)
            .map_err(|e| format!("Failed to parse display layout file: {}", e))?;

        layouts.push(DisplayLayoutPreview {
            id: layout.id,
            name: layout.name,
            thumbnail: layout.thumbnail,
            created_at: layout.created_at,
            is_default: layout.is_default,
        });
    }

    layouts.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(layouts)
}

#[tauri::command]
pub async fn get_display_layout(
    app: tauri::AppHandle,
    layout_id: String,
) -> Result<DisplayLayout, String> {
    let layouts_dir = get_display_layouts_dir(&app)?;
    let layout_path = layouts_dir.join(format!("{}.json", layout_id));

    if !layout_path.exists() {
        return Err(format!("Display layout not found: {}", layout_id));
    }

    let json = fs::read_to_string(&layout_path)
        .map_err(|e| format!("Failed to read display layout file: {}", e))?;

    let layout: DisplayLayout = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse display layout file: {}", e))?;

    Ok(layout)
}

#[tauri::command]
pub async fn delete_display_layout(
    app: tauri::AppHandle,
    layout_id: String,
) -> Result<(), String> {
    let layouts_dir = get_display_layouts_dir(&app)?;
    let layout_path = layouts_dir.join(format!("{}.json", layout_id));

    if !layout_path.exists() {
        return Err(format!("Display layout not found: {}", layout_id));
    }

    // Refuse to delete protected default layouts
    let json = fs::read_to_string(&layout_path)
        .map_err(|e| format!("Failed to read display layout file: {}", e))?;
    let layout: crate::display_layouts::types::DisplayLayout = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse display layout file: {}", e))?;
    if layout.is_default {
        return Err("Cannot delete the default layout".to_string());
    }

    fs::remove_file(&layout_path)
        .map_err(|e| format!("Failed to delete display layout file: {}", e))?;

    let resources_dir = layouts_dir.join(&layout_id);
    if resources_dir.exists() {
        fs::remove_dir_all(&resources_dir)
            .map_err(|e| format!("Failed to delete display layout resources: {}", e))?;
    }

    Ok(())
}

#[tauri::command]
pub async fn duplicate_display_layout(
    app: tauri::AppHandle,
    layout_id: String,
) -> Result<DisplayLayout, String> {
    let original = get_display_layout(app.clone(), layout_id).await?;

    let duplicated = DisplayLayout {
        id: format!("layout-{}", uuid::Uuid::new_v4()),
        name: format!("{} (Copy)", original.name),
        background_color: original.background_color,
        background_image: original.background_image,
        elements: original.elements,
        thumbnail: original.thumbnail,
        created_at: chrono::Utc::now().to_rfc3339(),
        modified_at: chrono::Utc::now().to_rfc3339(),
        is_default: false, // duplicates are never protected
        canvas_width: original.canvas_width,
        canvas_height: original.canvas_height,
    };

    save_display_layout(app, duplicated).await
}

/// Export a display layout to a .iplayout file with all images embedded as base64.
/// The exported file has isDefault stripped (set to false) so it imports as a regular layout.
#[tauri::command]
pub async fn export_display_layout(
    app: tauri::AppHandle,
    layout_id: String,
    file_path: String,
) -> Result<String, String> {
    let mut layout = get_display_layout(app.clone(), layout_id).await?;

    // Strip default status — exported layouts should always import as regular layouts
    layout.is_default = false;
    // Clear the ID so the importer assigns a fresh one
    layout.id = String::new();

    let mut resources: HashMap<String, String> = HashMap::new();

    // Embed thumbnail
    if let Some(ref thumb) = layout.thumbnail {
        let ext = get_asset_extension(thumb);
        if let Some(data) = read_asset_as_base64(thumb) {
            resources.insert(format!("thumbnail.{}", ext), data);
        }
    }

    // Embed background image
    if let Some(ref bg) = layout.background_image {
        let ext = get_asset_extension(bg);
        if let Some(data) = read_asset_as_base64(bg) {
            resources.insert(format!("background.{}", ext), data);
        }
    }

    // Embed element source paths (logos, GIFs)
    for (i, element) in layout.elements.iter().enumerate() {
        if let Some(ref source) = element.source_path {
            let ext = get_asset_extension(source);
            if let Some(data) = read_asset_as_base64(source) {
                resources.insert(format!("element_{}.{}", i, ext), data);
            }
        }
    }

    // Replace asset paths with resource keys so the importer can restore them
    if layout.thumbnail.is_some() {
        let key = resources
            .keys()
            .find(|k| k.starts_with("thumbnail."))
            .cloned();
        if let Some(k) = key {
            layout.thumbnail = Some(format!("resource://{}", k));
        }
    }

    if layout.background_image.is_some() {
        let key = resources
            .keys()
            .find(|k| k.starts_with("background."))
            .cloned();
        if let Some(k) = key {
            layout.background_image = Some(format!("resource://{}", k));
        }
    }

    for (i, element) in layout.elements.iter_mut().enumerate() {
        if element.source_path.is_some() {
            let prefix = format!("element_{}.", i);
            let key = resources.keys().find(|k| k.starts_with(&prefix)).cloned();
            if let Some(k) = key {
                element.source_path = Some(format!("resource://{}", k));
            }
        }
    }

    let portable = PortableDisplayLayout {
        version: 1,
        layout,
        resources,
    };

    let json = serde_json::to_string_pretty(&portable)
        .map_err(|e| format!("Failed to serialize layout: {}", e))?;

    fs::write(&file_path, json)
        .map_err(|e| format!("Failed to write export file: {}", e))?;

    Ok(file_path)
}

/// Import a display layout from a .iplayout file.
/// Assigns a new ID, fresh timestamps, and sets isDefault = false.
#[tauri::command]
pub async fn import_display_layout(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<DisplayLayout, String> {
    let json = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read import file: {}", e))?;

    let portable: PortableDisplayLayout = serde_json::from_str(&json)
        .map_err(|_| "Invalid .iplayout file or unsupported format version.".to_string())?;

    let mut layout = portable.layout;
    let resources = portable.resources;

    // Always force a new identity — never preserve original ID or default status
    layout.id = String::new();
    layout.is_default = false;
    let now = chrono::Utc::now().to_rfc3339();
    layout.created_at = now.clone();
    layout.modified_at = now;

    // Restore resource:// references to base64 data URIs so save_display_layout
    // will write them to disk inside the new layout directory.
    let restore_resource = |path: &str, resources: &HashMap<String, String>| -> Option<String> {
        if let Some(key) = path.strip_prefix("resource://") {
            if let Some(data) = resources.get(key) {
                let ext = get_asset_extension(key);
                let mime = match ext.as_str() {
                    "png" => "image/png",
                    "gif" => "image/gif",
                    "webp" => "image/webp",
                    _ => "image/jpeg",
                };
                return Some(format!("data:{};base64,{}", mime, data));
            }
        }
        None
    };

    if let Some(ref thumb) = layout.thumbnail.clone() {
        if let Some(data_uri) = restore_resource(thumb, &resources) {
            layout.thumbnail = Some(data_uri);
        }
    }

    if let Some(ref bg) = layout.background_image.clone() {
        if let Some(data_uri) = restore_resource(bg, &resources) {
            layout.background_image = Some(data_uri);
        }
    }

    for element in layout.elements.iter_mut() {
        if let Some(ref source) = element.source_path.clone() {
            if let Some(data_uri) = restore_resource(source, &resources) {
                element.source_path = Some(data_uri);
            }
        }
    }

    // save_display_layout will assign the new UUID, write files, and return the saved layout
    save_display_layout(app, layout).await
}
