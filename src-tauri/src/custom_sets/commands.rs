use crate::backgrounds::types::Background;
use crate::custom_sets::types::{CustomSet, CustomSetPreview};
use base64::{engine::general_purpose, Engine as _};
use percent_encoding::percent_decode;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Portable export format that embeds all images as base64
#[derive(Serialize, Deserialize)]
struct PortableCustomSet {
    version: u32,
    custom_set: CustomSet,
    /// Map of resource key -> base64-encoded file data
    /// Keys: "background", "background_thumbnail", "thumbnail", "overlay_0", "overlay_1", etc.
    resources: HashMap<String, String>,
}

/// Read a file from an asset:// path and return base64-encoded data
fn read_asset_as_base64(asset_path: &str) -> Option<String> {
    let file_path = if asset_path.starts_with("asset://") {
        asset_path.trim_start_matches("asset://")
    } else {
        asset_path
    };
    let path = PathBuf::from(file_path);
    if path.exists() {
        if let Ok(data) = fs::read(&path) {
            return Some(general_purpose::STANDARD.encode(&data));
        }
    }
    None
}

/// Get file extension from a path string
fn get_extension(path: &str) -> String {
    PathBuf::from(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin")
        .to_lowercase()
}

/// Get the custom sets directory path
fn get_custom_sets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app.path().app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let sets_dir = app_data_dir.join("custom_sets");
    fs::create_dir_all(&sets_dir)
        .map_err(|e| format!("Failed to create custom sets dir: {}", e))?;
    Ok(sets_dir)
}

/// Copy background image resource to custom set directory
fn copy_background_resource(
    app: &tauri::AppHandle,
    set_id: &str,
    background: &Background,
) -> Result<Background, String> {
    if background.background_type != "image" {
        // No need to copy colors or gradients
        return Ok(background.clone());
    }

    let sets_dir = get_custom_sets_dir(app)?;
    let set_resources_dir = sets_dir.join(&set_id);
    fs::create_dir_all(&set_resources_dir)
        .map_err(|e| format!("Failed to create set resources dir: {}", e))?;

    // Check if value starts with "asset://" protocol
    let source_path = if background.value.starts_with("asset://") {
        PathBuf::from(&background.value.trim_start_matches("asset://"))
    } else {
        PathBuf::from(&background.value)
    };

    if !source_path.exists() {
        return Err(format!("Background source file not found: {:?}", source_path));
    }

    let file_name = source_path
        .file_name()
        .ok_or("Invalid background file path")?
        .to_string_lossy()
        .to_string();

    let dest_path = set_resources_dir.join(&file_name);
    fs::copy(&source_path, &dest_path)
        .map_err(|e| format!("Failed to copy background resource: {}", e))?;

    // Copy thumbnail if it exists
    let thumbnail_result = if let Some(thumb) = &background.thumbnail {
        let thumb_path = if thumb.starts_with("asset://") {
            PathBuf::from(thumb.trim_start_matches("asset://"))
        } else {
            PathBuf::from(thumb)
        };

        if thumb_path.exists() {
            let thumb_name = thumb_path
                .file_name()
                .ok_or("Invalid thumbnail path")?
                .to_string_lossy()
                .to_string();
            let thumb_dest = set_resources_dir.join(&thumb_name);
            fs::copy(&thumb_path, &thumb_dest).ok();
            // Convert backslashes to forward slashes for asset:// protocol
            let thumb_path_str = thumb_dest.to_string_lossy().replace('\\', "/");
            Some(format!("asset://{}", thumb_path_str))
        } else {
            None
        }
    } else {
        None
    };

    // Convert backslashes to forward slashes for asset:// protocol
    let dest_path_str = dest_path.to_string_lossy().replace('\\', "/");
    Ok(Background {
        value: format!("asset://{}", dest_path_str),
        thumbnail: thumbnail_result,
        ..background.clone()
    })
}

/// Save a custom set to disk
#[tauri::command]
pub async fn save_custom_set(app: tauri::AppHandle, mut custom_set: CustomSet) -> Result<CustomSet, String> {
    let sets_dir = get_custom_sets_dir(&app)?;

    // Generate ID if not provided
    if custom_set.id.is_empty() {
        custom_set.id = format!("set-{}", uuid::Uuid::new_v4());
    }

    // Set timestamps
    let now = chrono::Utc::now().to_rfc3339();
    if custom_set.created_at.is_empty() {
        custom_set.created_at = now.clone();
    }
    custom_set.modified_at = now;

    // Copy background resource to appdata if it's an image
    custom_set.background = copy_background_resource(&app, &custom_set.id, &custom_set.background)?;

    // Create set resources directory for thumbnail and overlays
    let set_resources_dir = sets_dir.join(&custom_set.id);
    fs::create_dir_all(&set_resources_dir)
        .map_err(|e| format!("Failed to create set resources dir: {}", e))?;

    // Save thumbnail if provided (convert data URL to file)
    if let Some(thumbnail_data) = &custom_set.thumbnail {
        if thumbnail_data.starts_with("data:image") {
            // Extract base64 data from data URL
            if let Some(comma_pos) = thumbnail_data.find(',') {
                let base64_data = &thumbnail_data[comma_pos + 1..];

                // Decode base64
                if let Ok(image_data) = general_purpose::STANDARD.decode(base64_data) {
                    let thumbnail_path = set_resources_dir.join("thumbnail.jpg");
                    if fs::write(&thumbnail_path, image_data).is_ok() {
                        // Update thumbnail to point to file path (convert backslashes to forward slashes)
                        let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
                        custom_set.thumbnail = Some(format!("asset://{}", path_str));
                    }
                }
            }
        }
    }

    // Copy overlay images to set directory and update paths
    let overlays_dir = set_resources_dir.join("overlays");
    fs::create_dir_all(&overlays_dir)
        .map_err(|e| format!("Failed to create overlays dir: {}", e))?;

    for (index, overlay) in custom_set.overlays.iter_mut().enumerate() {
        // Skip if the overlay source is already in the set directory
        if overlay.source_path.contains(&format!("custom_sets/{}/overlays", custom_set.id)) {
            continue;
        }

        // Get the original file path (handle various URL formats)
        let original_path = if overlay.source_path.starts_with("http://asset.localhost/") {
            // Tauri convertFileSrc format: http://asset.localhost/path/to/file
            // Decode URL-encoded path
            let path_part = overlay.source_path.trim_start_matches("http://asset.localhost/");
            percent_decode(path_part.as_bytes())
                .decode_utf8()
                .map(|c| c.to_string())
                .unwrap_or_else(|_| path_part.to_string())
        } else if overlay.source_path.starts_with("asset://") {
            // Direct asset protocol: asset://path/to/file
            overlay.source_path.trim_start_matches("asset://").to_string()
        } else if overlay.source_path.starts_with("asset:////") {
            // Windows path variant: asset:////C:/path
            overlay.source_path.replace("asset:////", "//")
        } else {
            // Already a plain path
            overlay.source_path.clone()
        };

        // Check if it's a data URL
        if original_path.starts_with("data:image/png;base64,") {
            if let Some(comma_pos) = original_path.find(',') {
                let base64_data = &original_path[comma_pos + 1..];
                if let Ok(image_data) = general_purpose::STANDARD.decode(base64_data) {
                    let filename = format!("overlay_{}.png", index);
                    let overlay_path = overlays_dir.join(&filename);
                    if fs::write(&overlay_path, image_data).is_ok() {
                        let path_str = overlay_path.to_string_lossy().replace('\\', "/");
                        overlay.source_path = format!("asset://{}", path_str);
                    }
                }
            }
        } else {
            // Try to copy from file path
            let src_path = PathBuf::from(&original_path);
            if src_path.exists() {
                let filename = src_path.file_name()
                    .and_then(|n| n.to_str())
                    .unwrap_or("overlay.png");
                let overlay_path = overlays_dir.join(format!("{}_{}", index, filename));

                if fs::copy(&src_path, &overlay_path).is_ok() {
                    let path_str = overlay_path.to_string_lossy().replace('\\', "/");
                    overlay.source_path = format!("asset://{}", path_str);
                }
            }
        }
    }

    // Save custom set metadata
    let set_path = sets_dir.join(format!("{}.json", custom_set.id));
    let json = serde_json::to_string_pretty(&custom_set)
        .map_err(|e| format!("Failed to serialize custom set: {}", e))?;

    fs::write(set_path, json)
        .map_err(|e| format!("Failed to write custom set file: {}", e))?;

    Ok(custom_set)
}

/// Load all custom sets from disk (preview only)
#[tauri::command]
pub async fn load_custom_sets(app: tauri::AppHandle) -> Result<Vec<CustomSetPreview>, String> {
    let sets_dir = get_custom_sets_dir(&app)?;
    let mut sets = Vec::new();

    if !sets_dir.exists() {
        return Ok(sets);
    }

    let entries = fs::read_dir(&sets_dir)
        .map_err(|e| format!("Failed to read custom sets directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        let json = fs::read_to_string(&path)
            .map_err(|e| format!("Failed to read custom set file: {}", e))?;

        let custom_set: CustomSet = serde_json::from_str(&json)
            .map_err(|e| format!("Failed to parse custom set file: {}", e))?;

        sets.push(CustomSetPreview {
            id: custom_set.id,
            name: custom_set.name,
            description: custom_set.description,
            thumbnail: custom_set.thumbnail,
            created_at: custom_set.created_at,
        });
    }

    // Sort by creation date (newest first)
    sets.sort_by(|a, b| b.created_at.cmp(&a.created_at));

    Ok(sets)
}

/// Get a specific custom set by ID
#[tauri::command]
pub async fn get_custom_set(app: tauri::AppHandle, set_id: String) -> Result<CustomSet, String> {
    let sets_dir = get_custom_sets_dir(&app)?;
    let set_path = sets_dir.join(format!("{}.json", set_id));

    if !set_path.exists() {
        return Err(format!("Custom set not found: {}", set_id));
    }

    let json = fs::read_to_string(&set_path)
        .map_err(|e| format!("Failed to read custom set file: {}", e))?;

    let custom_set: CustomSet = serde_json::from_str(&json)
        .map_err(|e| format!("Failed to parse custom set file: {}", e))?;

    Ok(custom_set)
}

/// Delete a custom set from disk
#[tauri::command]
pub async fn delete_custom_set(app: tauri::AppHandle, set_id: String) -> Result<(), String> {
    let sets_dir = get_custom_sets_dir(&app)?;
    let set_path = sets_dir.join(format!("{}.json", set_id));

    if !set_path.exists() {
        return Err(format!("Custom set not found: {}", set_id));
    }

    // Delete the JSON file
    fs::remove_file(&set_path)
        .map_err(|e| format!("Failed to delete custom set file: {}", e))?;

    // Delete the resources directory if it exists
    let resources_dir = sets_dir.join(&set_id);
    if resources_dir.exists() {
        fs::remove_dir_all(&resources_dir)
            .map_err(|e| format!("Failed to delete custom set resources: {}", e))?;
    }

    Ok(())
}

/// Duplicate a custom set (create a copy with a new ID)
#[tauri::command]
pub async fn duplicate_custom_set(app: tauri::AppHandle, set_id: String) -> Result<CustomSet, String> {
    let original = get_custom_set(app.clone(), set_id).await?;

    let duplicated = CustomSet {
        id: format!("set-{}", uuid::Uuid::new_v4()),
        name: format!("{} (Copy)", original.name),
        description: original.description,
        canvas_size: original.canvas_size,
        auto_match_background: original.auto_match_background,
        background: original.background,
        background_transform: original.background_transform,
        frame: original.frame,
        overlays: original.overlays,
        thumbnail: original.thumbnail,
        created_at: chrono::Utc::now().to_rfc3339(),
        modified_at: chrono::Utc::now().to_rfc3339(),
        is_default: false,
    };

    save_custom_set(app, duplicated).await
}

/// Export a custom set to a .ptbs file with all images embedded as base64
#[tauri::command]
pub async fn export_custom_set(
    app: tauri::AppHandle,
    set_id: String,
    file_path: String,
) -> Result<String, String> {
    println!("[EXPORT] Starting export for set {} to {}", set_id, file_path);
    let custom_set = get_custom_set(app.clone(), set_id).await?;
    println!("[EXPORT] Set: {}, bg_type: {}, overlays: {}", custom_set.name, custom_set.background.background_type, custom_set.overlays.len());

    let mut resources: HashMap<String, String> = HashMap::new();

    // Embed background image
    if custom_set.background.background_type == "image" {
        let ext = get_extension(&custom_set.background.value);
        println!("[EXPORT] Background image: {} (ext: {})", custom_set.background.value, ext);
        if let Some(data) = read_asset_as_base64(&custom_set.background.value) {
            println!("[EXPORT]   -> encoded {} bytes", data.len());
            resources.insert(format!("background.{}", ext), data);
        } else {
            println!("[EXPORT]   -> FAILED to read file!");
        }
    }

    // Embed background thumbnail
    if let Some(ref thumb) = custom_set.background.thumbnail {
        let ext = get_extension(thumb);
        println!("[EXPORT] Background thumbnail: {} (ext: {})", thumb, ext);
        if let Some(data) = read_asset_as_base64(thumb) {
            println!("[EXPORT]   -> encoded {} bytes", data.len());
            resources.insert(format!("background_thumbnail.{}", ext), data);
        }
    }

    // Embed set thumbnail
    if let Some(ref thumb) = custom_set.thumbnail {
        let ext = get_extension(thumb);
        println!("[EXPORT] Set thumbnail: {} (ext: {})", thumb, ext);
        if let Some(data) = read_asset_as_base64(thumb) {
            println!("[EXPORT]   -> encoded {} bytes", data.len());
            resources.insert(format!("thumbnail.{}", ext), data);
        }
    }

    // Embed overlay images
    for (i, overlay) in custom_set.overlays.iter().enumerate() {
        let ext = get_extension(&overlay.source_path);
        println!("[EXPORT] Overlay {}: {} (ext: {})", i, overlay.source_path, ext);
        if let Some(data) = read_asset_as_base64(&overlay.source_path) {
            println!("[EXPORT]   -> encoded {} bytes", data.len());
            resources.insert(format!("overlay_{}.{}", i, ext), data);
        } else {
            println!("[EXPORT]   -> FAILED to read file!");
        }
    }

    println!("[EXPORT] Total resources embedded: {}", resources.len());

    let portable = PortableCustomSet {
        version: 1,
        custom_set,
        resources,
    };

    let json = serde_json::to_string_pretty(&portable)
        .map_err(|e| format!("Failed to serialize custom set: {}", e))?;

    println!("[EXPORT] JSON size: {} bytes", json.len());
    fs::write(&file_path, json)
        .map_err(|e| format!("Failed to write export file: {}", e))?;

    println!("[EXPORT] Successfully wrote to {}", file_path);
    Ok(file_path)
}

/// Write a base64 resource to a file and return the asset:// path
fn write_resource_to_file(
    resources: &HashMap<String, String>,
    key_prefix: &str,
    dest_dir: &PathBuf,
    dest_filename: &str,
) -> Option<String> {
    // Find the resource key that starts with the prefix (e.g., "background." matches "background.jpg")
    let (key, data) = resources.iter().find(|(k, _)| k.starts_with(key_prefix))?;

    // Get extension from the key (e.g., "background.jpg" -> "jpg")
    let ext = key.rsplit('.').next().unwrap_or("bin");
    let filename = format!("{}.{}", dest_filename, ext);
    let dest_path = dest_dir.join(&filename);

    let decoded = general_purpose::STANDARD.decode(data).ok()?;
    fs::write(&dest_path, decoded).ok()?;

    let path_str = dest_path.to_string_lossy().replace('\\', "/");
    Some(format!("asset://{}", path_str))
}

/// Import a custom set from a .ptbs file
#[tauri::command]
pub async fn import_custom_set(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<CustomSet, String> {
    println!("[IMPORT] Starting import from {}", file_path);
    let json = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read import file: {}", e))?;

    println!("[IMPORT] Read {} bytes from file", json.len());

    let portable: PortableCustomSet = serde_json::from_str(&json)
        .map_err(|_| "Invalid .ptbs file. This file may have been exported with an older version that is no longer supported.".to_string())?;

    println!("[IMPORT] Parsed portable format v{}, set: {}, resources: {}", portable.version, portable.custom_set.name, portable.resources.len());

    let mut custom_set = portable.custom_set;
    let resources = portable.resources;

    // Generate a new ID
    let new_id = format!("set-{}", uuid::Uuid::new_v4());
    custom_set.id = new_id.clone();

    let now = chrono::Utc::now().to_rfc3339();
    custom_set.created_at = now.clone();
    custom_set.modified_at = now;

    // Extract embedded resources to disk
    let sets_dir = get_custom_sets_dir(&app)?;
    let set_dir = sets_dir.join(&new_id);
    fs::create_dir_all(&set_dir)
        .map_err(|e| format!("Failed to create set dir: {}", e))?;
    println!("[IMPORT] Created set dir: {:?}", set_dir);

    // Extract background image
    if custom_set.background.background_type == "image" {
        println!("[IMPORT] Extracting background image...");
        if let Some(path) =
            write_resource_to_file(&resources, "background.", &set_dir, "background")
        {
            println!("[IMPORT]   -> extracted to {}", path);
            custom_set.background.value = path;
        } else {
            println!("[IMPORT]   -> FAILED to find background resource!");
        }
    }

    // Extract background thumbnail
    println!("[IMPORT] Extracting background thumbnail...");
    if let Some(path) = write_resource_to_file(
        &resources,
        "background_thumbnail.",
        &set_dir,
        "bg_thumb",
    ) {
        println!("[IMPORT]   -> extracted to {}", path);
        custom_set.background.thumbnail = Some(path);
    } else {
        println!("[IMPORT]   -> no background thumbnail found");
    }

    // Extract set thumbnail
    println!("[IMPORT] Extracting set thumbnail...");
    if let Some(path) =
        write_resource_to_file(&resources, "thumbnail.", &set_dir, "thumbnail")
    {
        println!("[IMPORT]   -> extracted to {}", path);
        custom_set.thumbnail = Some(path);
    } else {
        println!("[IMPORT]   -> no set thumbnail found");
    }

    // Extract overlay images
    let overlays_dir = set_dir.join("overlays");
    fs::create_dir_all(&overlays_dir)
        .map_err(|e| format!("Failed to create overlays dir: {}", e))?;
    println!("[IMPORT] Created overlays dir: {:?}", overlays_dir);

    for (i, overlay) in custom_set.overlays.iter_mut().enumerate() {
        let prefix = format!("overlay_{}.", i);
        println!("[IMPORT] Extracting overlay {}...", i);
        if let Some(path) = write_resource_to_file(
            &resources,
            &prefix,
            &overlays_dir,
            &format!("overlay_{}", i),
        ) {
            println!("[IMPORT]   -> extracted to {}", path);
            overlay.source_path = path;
        } else {
            println!("[IMPORT]   -> FAILED to find overlay resource!");
        }
    }

    // Save the JSON directly (resources already extracted, skip save_custom_set's copy logic)
    let set_path = sets_dir.join(format!("{}.json", new_id));
    let json = serde_json::to_string_pretty(&custom_set)
        .map_err(|e| format!("Failed to serialize custom set: {}", e))?;
    fs::write(set_path, json)
        .map_err(|e| format!("Failed to write custom set file: {}", e))?;

    println!("[IMPORT] Successfully imported set '{}' (id: {})", custom_set.name, new_id);
    Ok(custom_set)
}
