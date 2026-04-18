use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Background {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub background_type: String, // "color", "gradient", "image"
    pub value: String, // hex color, gradient CSS, or asset:// path
    pub thumbnail: Option<String>,
    #[serde(default)]
    pub is_default: bool,
    #[serde(default)]
    pub created_at: String,
    /// SHA-256 asset library id for image-type backgrounds.
    /// Set when importing via import_background; enables cross-device deduplication.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub asset_id: Option<String>,
}
