use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    /// SHA-256 hex hash of file content — the global identity of this asset across devices
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
    /// "overlay" | "background_image"
    pub asset_type: String,
    pub file_ext: String,
    pub file_size: u64,
    pub imported_at: String,
}

/// Serialized entry inside a portable export bundle
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BundledAsset {
    pub id: String,
    pub name: String,
    pub tags: Vec<String>,
    pub asset_type: String,
    pub file_ext: String,
    /// Base64-encoded file content
    pub data: String,
}

/// In-memory registry: id (SHA-256 hex) → Asset metadata
pub type AssetRegistry = HashMap<String, Asset>;
