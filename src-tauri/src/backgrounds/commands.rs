use crate::backgrounds::types::Background;
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

/// Get backgrounds directory in app data
fn get_backgrounds_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let backgrounds_dir = app_data_dir.join("backgrounds");
    fs::create_dir_all(&backgrounds_dir)
        .map_err(|e| format!("Failed to create backgrounds dir: {}", e))?;
    Ok(backgrounds_dir)
}

/// Initialize default backgrounds
fn initialize_default_backgrounds(app: &tauri::AppHandle) -> Result<(), String> {
    let backgrounds_dir = get_backgrounds_dir(app)?;

    // Check if already initialized
    if backgrounds_dir.exists()
        && backgrounds_dir
            .read_dir()
            .is_ok_and(|mut entries| entries.next().is_some())
    {
        return Ok(());
    }

    let default_backgrounds = vec![
        Background {
            id: "bg-white".to_string(),
            name: "Pure White".to_string(),
            description: "Clean white background".to_string(),
            background_type: "color".to_string(),
            value: "#ffffff".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Background {
            id: "bg-black".to_string(),
            name: "Pure Black".to_string(),
            description: "Solid black background".to_string(),
            background_type: "color".to_string(),
            value: "#000000".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Background {
            id: "bg-gray-light".to_string(),
            name: "Light Gray".to_string(),
            description: "Subtle light gray background".to_string(),
            background_type: "color".to_string(),
            value: "#f5f5f5".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Background {
            id: "bg-gray-dark".to_string(),
            name: "Dark Gray".to_string(),
            description: "Dark gray background".to_string(),
            background_type: "color".to_string(),
            value: "#2a2a2a".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Background {
            id: "bg-sunset".to_string(),
            name: "Sunset Gradient".to_string(),
            description: "Warm sunset gradient".to_string(),
            background_type: "gradient".to_string(),
            value: "linear-gradient(135deg, #ff6b6b 0%, #feca57 100%)".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Background {
            id: "bg-ocean".to_string(),
            name: "Ocean Gradient".to_string(),
            description: "Cool ocean gradient".to_string(),
            background_type: "gradient".to_string(),
            value: "linear-gradient(135deg, #667eea 0%, #764ba2 100%)".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
        Background {
            id: "bg-forest".to_string(),
            name: "Forest Gradient".to_string(),
            description: "Natural forest gradient".to_string(),
            background_type: "gradient".to_string(),
            value: "linear-gradient(135deg, #11998e 0%, #38ef7d 100%)".to_string(),
            thumbnail: None,
            is_default: true,
            created_at: chrono::Utc::now().to_rfc3339(),
        },
    ];

    // Save default backgrounds
    for bg in default_backgrounds {
        let bg_path = backgrounds_dir.join(format!("{}.json", bg.id));
        let json = serde_json::to_string_pretty(&bg)
            .map_err(|e| format!("Failed to serialize background: {}", e))?;
        fs::write(bg_path, json).map_err(|e| format!("Failed to write background file: {}", e))?;
    }

    Ok(())
}

/// Save a background to disk
#[tauri::command]
pub async fn save_background(
    app: tauri::AppHandle,
    background: Background,
) -> Result<Background, String> {
    let backgrounds_dir = get_backgrounds_dir(&app)?;

    // Create background with timestamp if not provided
    let bg_to_save = Background {
        created_at: if background.created_at.is_empty() {
            chrono::Utc::now().to_rfc3339()
        } else {
            background.created_at
        },
        ..background
    };

    let bg_path = backgrounds_dir.join(format!("{}.json", bg_to_save.id));
    let json = serde_json::to_string_pretty(&bg_to_save)
        .map_err(|e| format!("Failed to serialize background: {}", e))?;

    fs::write(bg_path, json).map_err(|e| format!("Failed to write background file: {}", e))?;

    Ok(bg_to_save)
}

/// Load all backgrounds from disk
#[tauri::command]
pub async fn load_backgrounds(app: tauri::AppHandle) -> Result<Vec<Background>, String> {
    // Initialize default backgrounds if needed
    initialize_default_backgrounds(&app)?;

    let backgrounds_dir = get_backgrounds_dir(&app)?;
    let mut backgrounds = Vec::new();

    let entries = fs::read_dir(backgrounds_dir)
        .map_err(|e| format!("Failed to read backgrounds directory: {}", e))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let path = entry.path();

        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }

        let json =
            fs::read_to_string(&path).map_err(|e| format!("Failed to read background file: {}", e))?;

        let background: Background = serde_json::from_str(&json)
            .map_err(|e| format!("Failed to parse background file: {}", e))?;

        backgrounds.push(background);
    }

    // Sort: defaults first, then by date
    backgrounds.sort_by(|a, b| match (a.is_default, b.is_default) {
        (true, false) => std::cmp::Ordering::Less,
        (false, true) => std::cmp::Ordering::Greater,
        _ => b.created_at.cmp(&a.created_at),
    });

    Ok(backgrounds)
}

/// Delete a background from disk
#[tauri::command]
pub async fn delete_background(app: tauri::AppHandle, background_id: String) -> Result<(), String> {
    let backgrounds_dir = get_backgrounds_dir(&app)?;
    let bg_path = backgrounds_dir.join(format!("{}.json", background_id));

    if !bg_path.exists() {
        return Err(format!("Background not found: {}", background_id));
    }

    // Prevent deleting default backgrounds
    let json =
        fs::read_to_string(&bg_path).map_err(|e| format!("Failed to read background file: {}", e))?;
    let background: Background =
        serde_json::from_str(&json).map_err(|e| format!("Failed to parse background file: {}", e))?;

    if background.is_default {
        return Err("Cannot delete default backgrounds".to_string());
    }

    // Delete the image file if it's an imported image
    if background.background_type == "image" && background.value.starts_with("asset://") {
        // Convert asset:// URL back to file path
        let image_path_str = background.value.trim_start_matches("asset://");
        let image_path = PathBuf::from(image_path_str);

        if image_path.exists() {
            fs::remove_file(&image_path)
                .map_err(|e| format!("Failed to delete background image: {}", e))?;
        }

        // Delete the thumbnail if it exists
        if let Some(thumbnail_url) = &background.thumbnail {
            if thumbnail_url.starts_with("asset://") {
                let thumb_path_str = thumbnail_url.trim_start_matches("asset://");
                let thumb_path = PathBuf::from(thumb_path_str);

                if thumb_path.exists() {
                    fs::remove_file(&thumb_path)
                        .map_err(|e| format!("Failed to delete background thumbnail: {}", e))?;
                }
            }
        }
    }

    // Delete the JSON metadata file
    fs::remove_file(bg_path).map_err(|e| format!("Failed to delete background metadata: {}", e))?;

    Ok(())
}

/// Import a background from a file
#[tauri::command]
pub async fn import_background(
    app: tauri::AppHandle,
    file_path: String,
    name: String,
) -> Result<Background, String> {
    use image::ImageFormat;

    let path_buf = PathBuf::from(&file_path);
    let extension = path_buf
        .extension()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_lowercase();

    // Generate unique ID
    let id = format!("bg-{}", uuid::Uuid::new_v4());

    // Copy image to backgrounds directory
    let backgrounds_dir = get_backgrounds_dir(&app)?;
    let dest_filename = format!("{}.{}", id, extension);
    let dest_path = backgrounds_dir.join(&dest_filename);

    fs::copy(&path_buf, &dest_path)
        .map_err(|e| format!("Failed to copy background image: {}", e))?;

    // Generate thumbnail
    let thumbnail_path = backgrounds_dir.join(format!("thumb_{}", dest_filename));
    if let Ok(img) = image::open(&dest_path) {
        let thumbnail = img.resize(200, 200, image::imageops::FilterType::Lanczos3);
        thumbnail
            .save_with_format(&thumbnail_path, ImageFormat::Jpeg)
            .ok();
    }

    let path_str = dest_path.to_string_lossy().replace('\\', "/");
    let thumb_str = thumbnail_path.to_string_lossy().replace('\\', "/");
    let asset_url = format!("asset://{}", path_str);
    let thumbnail_url = format!("asset://{}", thumb_str);

    let background = Background {
        id: id.clone(),
        name: name.clone(),
        description: format!(
            "Imported from {}",
            path_buf
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or("unknown")
        ),
        background_type: "image".to_string(),
        value: asset_url,
        thumbnail: Some(thumbnail_url),
        is_default: false,
        created_at: chrono::Utc::now().to_rfc3339(),
    };

    // Save metadata
    let bg_meta_path = backgrounds_dir.join(format!("{}.json", id));
    let json = serde_json::to_string_pretty(&background)
        .map_err(|e| format!("Failed to serialize background: {}", e))?;
    fs::write(bg_meta_path, json)
        .map_err(|e| format!("Failed to write background metadata: {}", e))?;

    Ok(background)
}
