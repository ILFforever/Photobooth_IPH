use crate::asset_library::commands::{
    asset_file_path, bundle_asset, get_library_dir, import_bundled_assets,
    load_registry, register_asset_bytes,
};
use crate::asset_library::types::BundledAsset;
use crate::custom_sets::types::{CustomSet, CustomSetPreview, PortableCustomSet};
use base64::{engine::general_purpose, Engine as _};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn get_custom_sets_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let sets_dir = app_data_dir.join("custom_sets");
    fs::create_dir_all(&sets_dir)
        .map_err(|e| format!("Failed to create custom sets dir: {}", e))?;
    Ok(sets_dir)
}

fn read_set(sets_dir: &PathBuf, set_id: &str) -> Result<CustomSet, String> {
    let set_path = sets_dir.join(format!("{}.json", set_id));
    if !set_path.exists() {
        return Err(format!("Custom set not found: {}", set_id));
    }
    let json = fs::read_to_string(&set_path)
        .map_err(|e| format!("Failed to read custom set: {}", e))?;
    serde_json::from_str(&json).map_err(|e| format!("Failed to parse custom set: {}", e))
}

fn write_set(sets_dir: &PathBuf, set: &CustomSet) -> Result<(), String> {
    let set_path = sets_dir.join(format!("{}.json", set.id));
    let json = serde_json::to_string_pretty(set)
        .map_err(|e| format!("Failed to serialize custom set: {}", e))?;
    fs::write(set_path, json).map_err(|e| format!("Failed to write custom set: {}", e))
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/// Save a custom set. Overlays are expected to already have valid `asset_id`
/// values pointing to entries in the global asset library — no file copying
/// happens here. Background images are managed independently via the
/// backgrounds library and may optionally carry an `asset_id` as well.
#[tauri::command]
pub async fn save_custom_set(
    app: tauri::AppHandle,
    mut custom_set: CustomSet,
) -> Result<CustomSet, String> {
    let sets_dir = get_custom_sets_dir(&app)?;

    if custom_set.id.is_empty() {
        custom_set.id = format!("set-{}", uuid::Uuid::new_v4());
    }

    let now = chrono::Utc::now().to_rfc3339();
    if custom_set.created_at.is_empty() {
        custom_set.created_at = now.clone();
    }
    custom_set.modified_at = now;

    // Persist thumbnail (data URL → file on disk)
    let set_dir = sets_dir.join(&custom_set.id);
    if let Some(thumbnail_data) = &custom_set.thumbnail {
        if thumbnail_data.starts_with("data:image") {
            if let Some(comma_pos) = thumbnail_data.find(',') {
                let base64_data = &thumbnail_data[comma_pos + 1..];
                if let Ok(image_data) = general_purpose::STANDARD.decode(base64_data) {
                    fs::create_dir_all(&set_dir)
                        .map_err(|e| format!("Failed to create set dir: {}", e))?;
                    let thumbnail_path = set_dir.join("thumbnail.jpg");
                    if fs::write(&thumbnail_path, image_data).is_ok() {
                        let path_str = thumbnail_path.to_string_lossy().replace('\\', "/");
                        custom_set.thumbnail = Some(format!("asset://{}", path_str));
                    }
                }
            }
        }
    }

    write_set(&sets_dir, &custom_set)?;
    Ok(custom_set)
}

/// Load lightweight previews for all saved custom sets.
#[tauri::command]
pub async fn load_custom_sets(app: tauri::AppHandle) -> Result<Vec<CustomSetPreview>, String> {
    let sets_dir = get_custom_sets_dir(&app)?;
    let mut sets = Vec::new();

    let entries = fs::read_dir(&sets_dir)
        .map_err(|e| format!("Failed to read custom sets directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        let json = match fs::read_to_string(&path) {
            Ok(j) => j,
            Err(_) => continue,
        };

        let custom_set: CustomSet = match serde_json::from_str(&json) {
            Ok(s) => s,
            Err(_) => continue,
        };

        sets.push(CustomSetPreview {
            id: custom_set.id,
            name: custom_set.name,
            description: custom_set.description,
            thumbnail: custom_set.thumbnail,
            created_at: custom_set.created_at,
        });
    }

    sets.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(sets)
}

/// Load a full custom set by id.
#[tauri::command]
pub async fn get_custom_set(app: tauri::AppHandle, set_id: String) -> Result<CustomSet, String> {
    let sets_dir = get_custom_sets_dir(&app)?;
    read_set(&sets_dir, &set_id)
}

/// Delete a custom set and its resource directory.
#[tauri::command]
pub async fn delete_custom_set(app: tauri::AppHandle, set_id: String) -> Result<(), String> {
    let sets_dir = get_custom_sets_dir(&app)?;
    let set_path = sets_dir.join(format!("{}.json", set_id));

    if !set_path.exists() {
        return Err(format!("Custom set not found: {}", set_id));
    }

    fs::remove_file(&set_path)
        .map_err(|e| format!("Failed to delete custom set file: {}", e))?;

    let resources_dir = sets_dir.join(&set_id);
    if resources_dir.exists() {
        fs::remove_dir_all(&resources_dir)
            .map_err(|e| format!("Failed to delete custom set resources: {}", e))?;
    }

    Ok(())
}

/// Duplicate a custom set with a new id.
#[tauri::command]
pub async fn duplicate_custom_set(
    app: tauri::AppHandle,
    set_id: String,
) -> Result<CustomSet, String> {
    let sets_dir = get_custom_sets_dir(&app)?;
    let original = read_set(&sets_dir, &set_id)?;

    let now = chrono::Utc::now().to_rfc3339();
    let duplicated = CustomSet {
        id: format!("set-{}", uuid::Uuid::new_v4()),
        name: format!("{} (Copy)", original.name),
        created_at: now.clone(),
        modified_at: now,
        is_default: false,
        thumbnail: None, // thumbnail re-generated on next save
        ..original
    };

    write_set(&sets_dir, &duplicated)?;
    Ok(duplicated)
}

/// Ensure an image-type background has an asset_id — register it on-the-fly if missing.
/// Returns the (possibly updated) background and the asset_id to bundle.
fn ensure_background_asset(
    library_dir: &PathBuf,
    mut background: crate::backgrounds::Background,
) -> (crate::backgrounds::Background, Option<String>) {
    if background.background_type != "image" {
        return (background, None);
    }

    // Already registered
    if let Some(id) = background.asset_id.clone() {
        return (background, Some(id));
    }

    // Try to read from value path and register on-the-fly
    let raw_path = background.value.trim_start_matches("asset://");
    let path = PathBuf::from(raw_path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("png")
        .to_lowercase();

    if let Ok(data) = fs::read(&path) {
        if let Ok(asset) = register_asset_bytes(
            library_dir,
            &data,
            &background.name,
            vec!["background".to_string()],
            "background_image",
            &ext,
        ) {
            background.asset_id = Some(asset.id.clone());
            return (background, Some(asset.id));
        }
    }

    (background, None)
}

/// Export a custom set to a .ptbs file.
/// All overlay assets and the background image (registered or discovered on-the-fly)
/// are embedded as BundledAssets so the file is fully self-contained.
#[tauri::command]
pub async fn export_custom_set(
    app: tauri::AppHandle,
    set_id: String,
    file_path: String,
) -> Result<String, String> {
    let sets_dir = get_custom_sets_dir(&app)?;
    let mut custom_set = read_set(&sets_dir, &set_id)?;
    let library_dir = get_library_dir(&app)?;

    // Collect overlay asset ids
    let mut asset_ids: HashSet<String> = custom_set
        .overlays
        .iter()
        .map(|o| o.asset_id.clone())
        .collect();

    // Ensure background image is in the asset library and get its id
    let (updated_bg, bg_asset_id) =
        ensure_background_asset(&library_dir, custom_set.background.clone());
    custom_set.background = updated_bg;
    if let Some(id) = bg_asset_id {
        asset_ids.insert(id);
    }

    // Build bundled asset list
    let mut assets: Vec<BundledAsset> = Vec::new();
    for id in &asset_ids {
        match bundle_asset(&library_dir, id) {
            Ok(bundled) => assets.push(bundled),
            Err(e) => eprintln!("[EXPORT] Warning: could not bundle asset {}: {}", id, e),
        }
    }

    // Bundle the set thumbnail (set-specific, not in asset library)
    let thumbnail_data = custom_set.thumbnail.as_ref().and_then(|thumb| {
        let path = PathBuf::from(thumb.trim_start_matches("asset://"));
        fs::read(&path).ok().map(|data| general_purpose::STANDARD.encode(&data))
    });

    let portable = PortableCustomSet {
        version: 2,
        custom_set,
        assets,
        thumbnail_data,
    };

    let json = serde_json::to_string_pretty(&portable)
        .map_err(|e| format!("Failed to serialize portable set: {}", e))?;

    fs::write(&file_path, json)
        .map_err(|e| format!("Failed to write export file: {}", e))?;

    Ok(file_path)
}

/// Import a custom set from a .ptbs file.
/// Each bundled asset is registered into the local asset library — if the same
/// file (by SHA-256 hash) already exists it is reused, preventing duplicates.
#[tauri::command]
pub async fn import_custom_set(
    app: tauri::AppHandle,
    file_path: String,
) -> Result<CustomSet, String> {
    let json = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read import file: {}", e))?;

    let portable: PortableCustomSet = serde_json::from_str(&json).map_err(|_| {
        "Invalid .ptbs file. This file may have been exported with an incompatible version."
            .to_string()
    })?;

    if portable.version < 2 {
        return Err(
            "This .ptbs file was created with an older version and is no longer supported. \
             Please re-export it from the original device."
                .to_string(),
        );
    }

    let library_dir = get_library_dir(&app)?;

    // Register all bundled assets into the local library (skips existing ones)
    import_bundled_assets(&library_dir, &portable.assets)?;

    // Assign a new id to avoid collisions with existing sets
    let now = chrono::Utc::now().to_rfc3339();
    let mut custom_set = portable.custom_set;
    custom_set.id = format!("set-{}", uuid::Uuid::new_v4());
    custom_set.created_at = now.clone();
    custom_set.modified_at = now;
    custom_set.thumbnail = None;

    // Resolve background.value to the local asset library path.
    // The exported value points to the source device's path which won't exist here.
    if custom_set.background.background_type == "image" {
        if let Some(ref asset_id) = custom_set.background.asset_id.clone() {
            let registry = load_registry(&library_dir);
            if let Some(asset) = registry.get(asset_id) {
                let local_path = asset_file_path(&library_dir, asset_id, &asset.file_ext);
                let path_str = local_path.to_string_lossy().replace('\\', "/");
                custom_set.background.value = format!("asset://{}", path_str);
            }
        }
    }

    let sets_dir = get_custom_sets_dir(&app)?;

    // Restore thumbnail if bundled
    if let Some(thumb_b64) = portable.thumbnail_data {
        if let Ok(thumb_data) = general_purpose::STANDARD.decode(&thumb_b64) {
            let set_dir = sets_dir.join(&custom_set.id);
            fs::create_dir_all(&set_dir)
                .map_err(|e| format!("Failed to create set dir: {}", e))?;
            let thumb_path = set_dir.join("thumbnail.jpg");
            if fs::write(&thumb_path, &thumb_data).is_ok() {
                let path_str = thumb_path.to_string_lossy().replace('\\', "/");
                custom_set.thumbnail = Some(format!("asset://{}", path_str));
            }
        }
    }

    write_set(&sets_dir, &custom_set)?;

    Ok(custom_set)
}
