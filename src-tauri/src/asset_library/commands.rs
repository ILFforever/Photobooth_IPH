use crate::asset_library::types::{Asset, AssetRegistry, BundledAsset};
use base64::{engine::general_purpose, Engine as _};
use sha2::{Digest, Sha256};
use std::fs;
use std::path::PathBuf;
use tauri::Manager;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

pub fn get_library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;
    let library_dir = app_data_dir.join("asset_library");
    fs::create_dir_all(&library_dir)
        .map_err(|e| format!("Failed to create asset_library dir: {}", e))?;
    let files_dir = library_dir.join("files");
    fs::create_dir_all(&files_dir)
        .map_err(|e| format!("Failed to create asset_library/files dir: {}", e))?;
    Ok(library_dir)
}

fn registry_path(library_dir: &PathBuf) -> PathBuf {
    library_dir.join("registry.json")
}

pub fn load_registry(library_dir: &PathBuf) -> AssetRegistry {
    let path = registry_path(library_dir);
    if !path.exists() {
        return AssetRegistry::new();
    }
    let json = fs::read_to_string(&path).unwrap_or_default();
    serde_json::from_str(&json).unwrap_or_default()
}

pub fn save_registry(library_dir: &PathBuf, registry: &AssetRegistry) -> Result<(), String> {
    let json = serde_json::to_string_pretty(registry)
        .map_err(|e| format!("Failed to serialize registry: {}", e))?;
    fs::write(registry_path(library_dir), json)
        .map_err(|e| format!("Failed to write registry: {}", e))?;
    Ok(())
}

pub fn compute_sha256(data: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

pub fn asset_file_path(library_dir: &PathBuf, id: &str, ext: &str) -> PathBuf {
    library_dir.join("files").join(format!("{}.{}", id, ext))
}

/// Register an asset from raw bytes (shared between command and bundle import).
/// Returns the Asset, or the existing one if the hash is already in the registry.
pub fn register_asset_bytes(
    library_dir: &PathBuf,
    data: &[u8],
    name: &str,
    tags: Vec<String>,
    asset_type: &str,
    file_ext: &str,
) -> Result<Asset, String> {
    let id = compute_sha256(data);
    let mut registry = load_registry(library_dir);

    // Already registered — return without touching disk
    if let Some(existing) = registry.get(&id) {
        return Ok(existing.clone());
    }

    let dest = asset_file_path(library_dir, &id, file_ext);
    fs::write(&dest, data).map_err(|e| format!("Failed to write asset file: {}", e))?;

    let asset = Asset {
        id: id.clone(),
        name: name.to_string(),
        tags,
        asset_type: asset_type.to_string(),
        file_ext: file_ext.to_string(),
        file_size: data.len() as u64,
        imported_at: chrono::Utc::now().to_rfc3339(),
    };

    registry.insert(id, asset.clone());
    save_registry(library_dir, &registry)?;
    Ok(asset)
}

/// Import a set of BundledAssets into the local library.
/// For each entry: verify SHA-256 matches the declared id, skip if already registered.
pub fn import_bundled_assets(
    library_dir: &PathBuf,
    bundle: &[BundledAsset],
) -> Result<(), String> {
    let mut registry = load_registry(library_dir);

    for entry in bundle {
        // Already in registry — skip
        if registry.contains_key(&entry.id) {
            continue;
        }

        let data = general_purpose::STANDARD
            .decode(&entry.data)
            .map_err(|e| format!("Failed to decode bundled asset '{}': {}", entry.id, e))?;

        // Integrity check
        let computed = compute_sha256(&data);
        if computed != entry.id {
            return Err(format!(
                "Asset integrity check failed for '{}': expected {}, got {}",
                entry.name, entry.id, computed
            ));
        }

        let dest = asset_file_path(library_dir, &entry.id, &entry.file_ext);
        fs::write(&dest, &data)
            .map_err(|e| format!("Failed to write bundled asset '{}': {}", entry.id, e))?;

        let asset = Asset {
            id: entry.id.clone(),
            name: entry.name.clone(),
            tags: entry.tags.clone(),
            asset_type: entry.asset_type.clone(),
            file_ext: entry.file_ext.clone(),
            file_size: data.len() as u64,
            imported_at: chrono::Utc::now().to_rfc3339(),
        };

        registry.insert(entry.id.clone(), asset);
    }

    save_registry(library_dir, &registry)
}

/// Read an asset file and return it as a BundledAsset (for export).
pub fn bundle_asset(library_dir: &PathBuf, id: &str) -> Result<BundledAsset, String> {
    let registry = load_registry(library_dir);
    let asset = registry
        .get(id)
        .ok_or_else(|| format!("Asset not found in registry: {}", id))?;

    let path = asset_file_path(library_dir, id, &asset.file_ext);
    let data = fs::read(&path)
        .map_err(|e| format!("Failed to read asset file '{}': {}", id, e))?;

    Ok(BundledAsset {
        id: id.to_string(),
        name: asset.name.clone(),
        tags: asset.tags.clone(),
        asset_type: asset.asset_type.clone(),
        file_ext: asset.file_ext.clone(),
        data: general_purpose::STANDARD.encode(&data),
    })
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Register a file from the local filesystem into the global asset library.
/// If a file with the same content (SHA-256) already exists, it is returned
/// immediately without copying — deduplication is automatic.
#[tauri::command]
pub async fn register_asset(
    app: tauri::AppHandle,
    src_path: String,
    name: String,
    tags: Vec<String>,
    asset_type: String,
) -> Result<Asset, String> {
    let library_dir = get_library_dir(&app)?;

    let src = PathBuf::from(&src_path);
    let data =
        fs::read(&src).map_err(|e| format!("Failed to read source file '{}': {}", src_path, e))?;

    let file_ext = src
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("bin")
        .to_lowercase();

    register_asset_bytes(&library_dir, &data, &name, tags, &asset_type, &file_ext)
}

/// List all registered assets, optionally filtered by type and/or tags.
#[tauri::command]
pub async fn list_assets(
    app: tauri::AppHandle,
    asset_type: Option<String>,
    tags: Option<Vec<String>>,
) -> Result<Vec<Asset>, String> {
    let library_dir = get_library_dir(&app)?;
    let registry = load_registry(&library_dir);

    let mut assets: Vec<Asset> = registry
        .into_values()
        .filter(|a| {
            if let Some(ref t) = asset_type {
                if &a.asset_type != t {
                    return false;
                }
            }
            if let Some(ref filter_tags) = tags {
                if !filter_tags.iter().any(|ft| a.tags.contains(ft)) {
                    return false;
                }
            }
            true
        })
        .collect();

    assets.sort_by(|a, b| b.imported_at.cmp(&a.imported_at));
    Ok(assets)
}

/// Return the asset:// URL for a given asset id.
#[tauri::command]
pub async fn get_asset_path(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let library_dir = get_library_dir(&app)?;
    let registry = load_registry(&library_dir);

    let asset = registry
        .get(&id)
        .ok_or_else(|| format!("Asset not found: {}", id))?;

    let path = asset_file_path(&library_dir, &id, &asset.file_ext);
    if !path.exists() {
        return Err(format!("Asset file missing from library: {}", id));
    }

    let path_str = path.to_string_lossy().replace('\\', "/");
    Ok(format!("asset://{}", path_str))
}

/// Return asset:// URLs for all known assets as a map of id → url.
/// Used by the frontend to pre-populate its path cache in one round-trip.
#[tauri::command]
pub async fn get_all_asset_paths(app: tauri::AppHandle) -> Result<std::collections::HashMap<String, String>, String> {
    let library_dir = get_library_dir(&app)?;
    let registry = load_registry(&library_dir);

    let mut map = std::collections::HashMap::new();
    for (id, asset) in &registry {
        let path = asset_file_path(&library_dir, id, &asset.file_ext);
        if path.exists() {
            let path_str = path.to_string_lossy().replace('\\', "/");
            map.insert(id.clone(), format!("asset://{}", path_str));
        }
    }
    Ok(map)
}

/// Delete an asset from the library (registry + managed file).
#[tauri::command]
pub async fn delete_asset(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let library_dir = get_library_dir(&app)?;
    let mut registry = load_registry(&library_dir);

    let asset = registry
        .remove(&id)
        .ok_or_else(|| format!("Asset not found: {}", id))?;

    let path = asset_file_path(&library_dir, &id, &asset.file_ext);
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|e| format!("Failed to delete asset file: {}", e))?;
    }

    save_registry(&library_dir, &registry)
}

/// Rename or retag an asset without touching its file.
#[tauri::command]
pub async fn update_asset_metadata(
    app: tauri::AppHandle,
    id: String,
    name: String,
    tags: Vec<String>,
) -> Result<Asset, String> {
    let library_dir = get_library_dir(&app)?;
    let mut registry = load_registry(&library_dir);

    let asset = registry
        .get_mut(&id)
        .ok_or_else(|| format!("Asset not found: {}", id))?;

    asset.name = name;
    asset.tags = tags;
    let updated = asset.clone();

    save_registry(&library_dir, &registry)?;
    Ok(updated)
}
